// Package router は caller Plugin → Core → target Plugin の呼出中継
// （docs/contracts/00003）。id空間は接続ごと送信者ごと。Coreはtarget側へ
// forward idを自空間から発行し、呼出に紐付くnotificationの params.callId を
// 各方間のidへ書き換えて配送する。
package router

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

type Router struct {
	registry *registry.Registry
	routes   map[string]*Route // conn.ID + "\x00" + callId →
	mu       sync.Mutex
}

type Route struct {
	Caller   *rpc.Conn
	CallerID json.RawMessage // caller側conn上のid
	Target   *rpc.Conn
	TargetID json.RawMessage // Coreが発行したforward id
	RegID    string
	ToolPath string
	Kind     string
}

func New(registry *registry.Registry) *Router {
	return &Router{registry: registry, routes: map[string]*Route{}}
}

func routeKey(c *rpc.Conn, id json.RawMessage) string { return c.ID + "\x00" + string(id) }

// HandleCall はconn上の tools.call request を捌く。targetへforwardし、
// responseをそのままこのrequestのresponseとして返す。
// OnRequestのgoroutine内で同期的に完結させる。
func (r *Router) HandleCall(caller *rpc.Conn, message *wire.Incoming) (json.RawMessage, *wire.Error) {
	var params wire.CallParams
	if err := wire.Unmarshal(message.Params, &params); err != nil {
		return nil, &wire.Error{Code: -32602, Message: "invalid params"}
	}

	session, ok := r.registry.FindRegistration(params.Target.RegistrationID)
	if !ok {
		return nil, &wire.Error{Code: -32602, Message: "no such registrationId: " + params.Target.RegistrationID}
	}
	if session.Channel() == nil {
		return nil, &wire.Error{Code: -32000, Message: "plugin channel unavailable"}
	}
	kind := "sync"
	toolFound := false
	for _, tool := range session.Tools() {
		if tool.ToolPath == params.Target.ToolPath {
			toolFound = true
			kind = tool.Kind
		}
	}
	if !toolFound {
		return nil, &wire.Error{Code: -32601, Message: "no such toolPath: " + params.Target.ToolPath}
	}

	target := session.Channel()
	forwardID := target.NextID()
	route := &Route{
		Caller: caller, CallerID: message.ID,
		Target: target, TargetID: forwardID,
		RegID: params.Target.RegistrationID, ToolPath: params.Target.ToolPath, Kind: kind,
	}
	r.mu.Lock()
	r.routes[routeKey(target, forwardID)] = route
	r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	res, err := target.RequestWithID(ctx, forwardID, wire.MethodCall,
		wire.ForwardCallParams{ToolPath: params.Target.ToolPath, Input: params.Input})
	if err != nil {
		r.removeRoute(route)
		// target側で実行中のcallがあれば止める — timeout/送信失敗で
		// こちらが諦めても、相手側の購読・長時間callは走り続けるため。
		_ = target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: forwardID})
		return nil, &wire.Error{Code: -32000, Message: "forward failed: " + err.Error()}
	}

	// sync呼出・または受理がエラーなら経路はここで終了。
	// async受理後はrouteを残してnotification中継を継続する。
	if kind != "async" || res.Error != nil {
		r.removeRoute(route)
	}
	return res.Result, res.Error
}

// HandleTargetNotif はtarget側connからのnotification中継（途中出力・終端）。
// callIdをcaller側のidへ書き換えて配送する。
func (r *Router) HandleTargetNotif(c *rpc.Conn, message *wire.Incoming) {
	var callID json.RawMessage
	switch message.Method {
	case wire.MethodCallOutput:
		var outputParams wire.CallOutputParams
		if err := wire.Unmarshal(message.Params, &outputParams); err != nil {
			return
		}
		callID = outputParams.CallID
	case wire.MethodCallResult:
		var resultParams wire.CallResultParams
		if err := wire.Unmarshal(message.Params, &resultParams); err != nil {
			return
		}
		callID = resultParams.CallID
	default:
		return
	}

	r.mu.Lock()
	route := r.routes[routeKey(c, callID)]
	if message.Method == wire.MethodCallResult && route != nil {
		delete(r.routes, routeKey(c, callID))
	}
	r.mu.Unlock()
	if route == nil {
		return
	}

	var params json.RawMessage
	switch message.Method {
	case wire.MethodCallOutput:
		var outputParams wire.CallOutputParams
		_ = wire.Unmarshal(message.Params, &outputParams)
		outputParams.CallID = route.CallerID
		params = wire.Marshal(outputParams)
	case wire.MethodCallResult:
		var resultParams wire.CallResultParams
		_ = wire.Unmarshal(message.Params, &resultParams)
		resultParams.CallID = route.CallerID
		params = wire.Marshal(resultParams)
	}
	_ = route.Caller.Notify(message.Method, json.RawMessage(params))
}

// HandleCallerNotif は呼出元側connからの tools.call.close notification。
// 対応routeを引き、callIdをforward idへ書き換えてtargetへ配送する。
func (r *Router) HandleCallerNotif(c *rpc.Conn, message *wire.Incoming) {
	var closeParams wire.CallCloseParams
	if err := wire.Unmarshal(message.Params, &closeParams); err != nil {
		return
	}
	r.mu.Lock()
	var route *Route
	for _, candidate := range r.routes {
		if candidate.Caller == c && string(candidate.CallerID) == string(closeParams.CallID) {
			route = candidate
			delete(r.routes, routeKey(candidate.Target, candidate.TargetID))
			break
		}
	}
	r.mu.Unlock()
	if route == nil {
		return
	}
	_ = route.Target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: route.TargetID})
}

// DispatchNotif はWS上のnotificationの振り分け。plugin conn上でcaller/target
// 両方の役割を持ち得るため、callIdでrouteを引いて適切な方向へ流す。
func (r *Router) DispatchNotif(c *rpc.Conn, message *wire.Incoming) {
	var callID json.RawMessage
	switch message.Method {
	case wire.MethodCallOutput:
		var outputParams wire.CallOutputParams
		_ = wire.Unmarshal(message.Params, &outputParams)
		callID = outputParams.CallID
	case wire.MethodCallResult:
		var resultParams wire.CallResultParams
		_ = wire.Unmarshal(message.Params, &resultParams)
		callID = resultParams.CallID
	case wire.MethodCallClose:
		var closeParams wire.CallCloseParams
		_ = wire.Unmarshal(message.Params, &closeParams)
		callID = closeParams.CallID
	default:
		return
	}
	r.mu.Lock()
	_, isTargetSide := r.routes[routeKey(c, callID)]
	r.mu.Unlock()
	if isTargetSide {
		r.HandleTargetNotif(c, message)
		return
	}
	if message.Method == wire.MethodCallClose {
		r.HandleCallerNotif(c, message)
	}
}

// DropConn はconn終了時の後始末。そのconnに紐付くrouteを失敗として閉じる。
// targetが死んだときはcallerへerror終端を、callerが死んだときはtargetへ
// closeを送る — 送らないと購読・長時間callが相手側で走り続ける。
func (r *Router) DropConn(c *rpc.Conn) {
	r.mu.Lock()
	dropped := map[string]*Route{}
	for key, route := range r.routes {
		if route.Target == c || route.Caller == c {
			dropped[key] = route
			delete(r.routes, key)
		}
	}
	r.mu.Unlock()

	for _, route := range dropped {
		if route.Target == c && route.Caller != c {
			_ = route.Caller.Notify(wire.MethodCallResult, wire.CallResultParams{
				CallID: route.CallerID,
				Error:  &wire.Error{Code: -32000, Message: "target channel closed"},
			})
		}
		if route.Caller == c && route.Target != c {
			_ = route.Target.Notify(wire.MethodCallClose,
				wire.CallCloseParams{CallID: route.TargetID})
		}
	}
}

func (r *Router) removeRoute(route *Route) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.routes, routeKey(route.Target, route.TargetID))
}
