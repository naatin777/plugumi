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
	reg    *registry.Registry
	routes map[string]*Route // conn.UID + "\x00" + callId →
	mu     sync.Mutex
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

func New(reg *registry.Registry) *Router {
	return &Router{reg: reg, routes: map[string]*Route{}}
}

func routeKey(c *rpc.Conn, id json.RawMessage) string { return c.UID + "\x00" + string(id) }

// HandleCall はconn上の tools.call request を捌く。targetへforwardし、
// responseをそのままこのrequestのresponseとして返す。
// OnRequestのgoroutine内で同期的に完結させる。
func (rt *Router) HandleCall(caller *rpc.Conn, in *wire.Incoming) (json.RawMessage, *wire.Error) {
	var params wire.CallParams
	if err := wire.Unmarshal(in.Params, &params); err != nil {
		return nil, &wire.Error{Code: -32602, Message: "invalid params"}
	}

	sess, ok := rt.reg.FindRegistration(params.Target.RegistrationID)
	if !ok {
		return nil, &wire.Error{Code: -32602, Message: "no such registrationId: " + params.Target.RegistrationID}
	}
	if sess.WS == nil {
		return nil, &wire.Error{Code: -32000, Message: "plugin channel unavailable"}
	}
	kind := "sync"
	toolFound := false
	for _, t := range sess.Tools {
		if t.ToolPath == params.Target.ToolPath {
			toolFound = true
			kind = t.Kind
		}
	}
	if !toolFound {
		return nil, &wire.Error{Code: -32601, Message: "no such toolPath: " + params.Target.ToolPath}
	}

	target := sess.WS
	fwdID := target.NextID()
	route := &Route{
		Caller: caller, CallerID: in.ID,
		Target: target, TargetID: fwdID,
		RegID: params.Target.RegistrationID, ToolPath: params.Target.ToolPath, Kind: kind,
	}
	rt.mu.Lock()
	rt.routes[routeKey(target, fwdID)] = route
	rt.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	res, err := target.RequestWithID(ctx, fwdID, wire.MethodCall,
		wire.ForwardCallParams{ToolPath: params.Target.ToolPath, Input: params.Input})
	if err != nil {
		rt.removeRoute(route)
		return nil, &wire.Error{Code: -32000, Message: "forward failed: " + err.Error()}
	}

	// sync呼出・または受理がエラーなら経路はここで終了。
	// async受理後はrouteを残してnotification中継を継続する。
	if kind != "async" || res.Error != nil {
		rt.removeRoute(route)
	}
	return res.Result, res.Error
}

// HandleTargetNotif はtarget側connからのnotification中継（途中出力・終端）。
// callIdをcaller側のidへ書き換えて配送する。
func (rt *Router) HandleTargetNotif(c *rpc.Conn, in *wire.Incoming) {
	var callID json.RawMessage
	switch in.Method {
	case wire.MethodCallOutput:
		var p wire.CallOutputParams
		if err := wire.Unmarshal(in.Params, &p); err != nil {
			return
		}
		callID = p.CallID
	case wire.MethodCallResult:
		var p wire.CallResultParams
		if err := wire.Unmarshal(in.Params, &p); err != nil {
			return
		}
		callID = p.CallID
	default:
		return
	}

	rt.mu.Lock()
	route := rt.routes[routeKey(c, callID)]
	if in.Method == wire.MethodCallResult && route != nil {
		delete(rt.routes, routeKey(c, callID))
	}
	rt.mu.Unlock()
	if route == nil {
		return
	}

	var params json.RawMessage
	switch in.Method {
	case wire.MethodCallOutput:
		var p wire.CallOutputParams
		_ = wire.Unmarshal(in.Params, &p)
		p.CallID = route.CallerID
		params = wire.Marshal(p)
	case wire.MethodCallResult:
		var p wire.CallResultParams
		_ = wire.Unmarshal(in.Params, &p)
		p.CallID = route.CallerID
		params = wire.Marshal(p)
	}
	_ = route.Caller.Notify(in.Method, json.RawMessage(params))
}

// HandleCallerNotif は呼出元側connからの tools.call.close notification。
// 対応routeを引き、callIdをforward idへ書き換えてtargetへ配送する。
func (rt *Router) HandleCallerNotif(c *rpc.Conn, in *wire.Incoming) {
	var p wire.CallCloseParams
	if err := wire.Unmarshal(in.Params, &p); err != nil {
		return
	}
	rt.mu.Lock()
	var route *Route
	for _, r := range rt.routes {
		if r.Caller == c && string(r.CallerID) == string(p.CallID) {
			route = r
			delete(rt.routes, routeKey(r.Target, r.TargetID))
			break
		}
	}
	rt.mu.Unlock()
	if route == nil {
		return
	}
	_ = route.Target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: route.TargetID})
}

// DispatchNotif はWS上のnotificationの振り分け。plugin conn上でcaller/target
// 両方の役割を持ち得るため、callIdでrouteを引いて適切な方向へ流す。
func (rt *Router) DispatchNotif(c *rpc.Conn, in *wire.Incoming) {
	var callID json.RawMessage
	switch in.Method {
	case wire.MethodCallOutput:
		var p wire.CallOutputParams
		_ = wire.Unmarshal(in.Params, &p)
		callID = p.CallID
	case wire.MethodCallResult:
		var p wire.CallResultParams
		_ = wire.Unmarshal(in.Params, &p)
		callID = p.CallID
	case wire.MethodCallClose:
		var p wire.CallCloseParams
		_ = wire.Unmarshal(in.Params, &p)
		callID = p.CallID
	default:
		return
	}
	rt.mu.Lock()
	_, isTargetSide := rt.routes[routeKey(c, callID)]
	rt.mu.Unlock()
	if isTargetSide {
		rt.HandleTargetNotif(c, in)
		return
	}
	if in.Method == wire.MethodCallClose {
		rt.HandleCallerNotif(c, in)
	}
}

// DropConn はconn終了時の後始末。そのconnに紐付くrouteを失敗として閉じる。
func (rt *Router) DropConn(c *rpc.Conn) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	for key, r := range rt.routes {
		if r.Target == c || r.Caller == c {
			delete(rt.routes, key)
			if r.Caller != c {
				_ = r.Caller.Notify(wire.MethodCallResult, wire.CallResultParams{
					CallID: r.CallerID,
					Error:  &wire.Error{Code: -32000, Message: "target channel closed"},
				})
			}
		}
	}
}

func (rt *Router) removeRoute(r *Route) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	delete(rt.routes, routeKey(r.Target, r.TargetID))
}
