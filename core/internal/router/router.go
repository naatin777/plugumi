// Package router は caller Plugin → Core → target Plugin の呼び出し中継
// （docs/contracts/00003）。id空間は接続ごと送信者ごと。Coreはtarget側へ
// forward idを自空間から発行し、呼び出しに紐付くnotificationの params.callId を
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
	routes   map[string]*Route // target conn.ID + "\x00" + callId →
	byCaller map[string]*Route // caller conn.ID + "\x00" + callId →
	mu       sync.Mutex
}

type Route struct {
	Caller   *rpc.Conn
	CallerID json.RawMessage // caller側conn上のid
	Target   *rpc.Conn
	TargetID json.RawMessage // Coreが発行したforward id
	LinkID   string
	ToolPath string
	Kind     string

	// ready はcallerへのresponse書込みが終わった時点で閉じる。
	// notification中継はこれが閉じるまで待機し、呼び出し元が
	// responseより先にoutput/resultを受け取らないことを保証する。
	ready     chan struct{}
	readyOnce sync.Once
	// dropped はroute撤収で閉じる。ready待機中のnotification配送を抜けさせる。
	dropped  chan struct{}
	dropOnce sync.Once
	// final は「responseで終わるcall」（sync完了・受理失敗・転送失敗）。
	// trueならOnResponded時に撤収マーカーをnotifQへ注入する。
	final bool
}

func New(registry *registry.Registry) *Router {
	return &Router{registry: registry, routes: map[string]*Route{}, byCaller: map[string]*Route{}}
}

func routeKey(c *rpc.Conn, id json.RawMessage) string { return c.ID + "\x00" + string(id) }

// methodRouteDone はroute撤収マーカー。wire上に流れない内部methodで、
// target connのnotifQに注入され「先行する全notificationを配送してから
// routeを消す」順序を作る（responseで終わるcall用）。
const methodRouteDone = "plugumi.internal.route.done"

// HandleCall はconn上の tools.call request を捌く。targetへforwardし、
// responseをそのままこのrequestのresponseとして返す。
// OnRequestのgoroutine内で同期的に完結させる。
func (r *Router) HandleCall(caller *rpc.Conn, message *wire.Incoming) (json.RawMessage, *wire.Error) {
	var params wire.CallParams
	if err := wire.Unmarshal(message.Params, &params); err != nil {
		return nil, &wire.Error{Code: -32602, Message: "invalid params"}
	}

	link, ok := r.registry.Find(params.Target.LinkID)
	if !ok {
		return nil, &wire.Error{Code: -32602, Message: "no such linkId: " + params.Target.LinkID}
	}
	if link.Transport() == nil {
		return nil, &wire.Error{Code: -32000, Message: "plugin transport unavailable"}
	}
	kind := "sync"
	toolFound := false
	for _, tool := range link.Tools() {
		if tool.ToolPath == params.Target.ToolPath {
			toolFound = true
			kind = tool.Kind
		}
	}
	if !toolFound {
		return nil, &wire.Error{Code: -32601, Message: "no such toolPath: " + params.Target.ToolPath}
	}

	target := link.Transport()
	forwardID := target.NextID()
	route := &Route{
		Caller: caller, CallerID: message.ID,
		Target: target, TargetID: forwardID,
		LinkID: params.Target.LinkID, ToolPath: params.Target.ToolPath, Kind: kind,
		ready:   make(chan struct{}),
		dropped: make(chan struct{}),
	}
	r.mu.Lock()
	r.routes[routeKey(target, forwardID)] = route
	r.byCaller[routeKey(caller, message.ID)] = route
	r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	res, err := target.RequestWithID(ctx, forwardID, wire.MethodCall,
		wire.ForwardCallParams{ToolPath: params.Target.ToolPath, Input: params.Input})
	if err != nil {
		r.removeRoute(route)
		// target側で実行中のcallがあれば止める。timeout/送信失敗で
		// こちらが諦めても、相手側の購読・長時間callは実行され続けるため。
		_ = target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: forwardID})
		return nil, &wire.Error{Code: -32000, Message: "forward failed: " + err.Error()}
	}

	// responseで終わるcall（sync・受理失敗）はfinal化。撤収は
	// NotifyRespondedがtombstoneを注入してdispatcher側で行う
	// （先行notificationを全部届けてからrouteを消すため）。
	// async受理後はrouteを残してnotification中継を継続する。
	route.final = kind != "async" || res.Error != nil
	return res.Result, res.Error
}

// NotifyResponded はcaller connへのresponse書込み完了を受ける
// （conn.OnResponded → connector → server経由）。routeのreadyを閉じて
// notification中継を解禁し、finalなcallは撤収マーカーをnotifQに注入する。
// handleRequestと同じgoroutineで呼ばれるため、route.finalの参照はlock不要。
func (r *Router) NotifyResponded(c *rpc.Conn, id json.RawMessage) {
	r.mu.Lock()
	route := r.byCaller[routeKey(c, id)]
	r.mu.Unlock()
	if route == nil {
		return
	}
	route.readyOnce.Do(func() { close(route.ready) })
	if route.final {
		route.Target.InjectSequenced(&wire.Incoming{
			JSONRPC: "2.0",
			Method:  methodRouteDone,
			Params:  wire.Marshal(wire.CallCloseParams{CallID: route.TargetID}),
		})
	}
}

// HandleTargetNotif はtarget側connからのnotification中継（途中出力・終端）。
// callIdをcaller側のidへ書き換えて配送する。
// callerがresponseを受け取る前にnotificationを届けないよう、
// route.readyが閉じるまで待機する（contracts/00003の順序）。
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
	r.mu.Unlock()
	if route == nil {
		return
	}

	// response書込み完了を待つ。route撤収（caller切断・close）なら配送しない。
	select {
	case <-route.ready:
	case <-route.dropped:
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

	if message.Method == wire.MethodCallResult {
		r.removeRoute(route)
	}
}

// HandleCallerNotif は呼び出し元側connからの tools.call.close notification。
// 対応routeを引き、callIdをforward idへ書き換えてtargetへ配送する。
func (r *Router) HandleCallerNotif(c *rpc.Conn, message *wire.Incoming) {
	var closeParams wire.CallCloseParams
	if err := wire.Unmarshal(message.Params, &closeParams); err != nil {
		return
	}
	r.mu.Lock()
	route := r.byCaller[routeKey(c, closeParams.CallID)]
	r.mu.Unlock()
	if route == nil {
		return
	}
	r.removeRoute(route)
	_ = route.Target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: route.TargetID})
}

// DispatchNotif はWS上のnotificationの振り分け。plugin conn上でcaller/target
// 両方の役割を持ち得るため、callIdでrouteを引いて適切な方向へ流す。
func (r *Router) DispatchNotif(c *rpc.Conn, message *wire.Incoming) {
	if message.Method == methodRouteDone {
		r.HandleRouteDone(c, message)
		return
	}
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

// HandleRouteDone は撤収マーカー（methodRouteDone）を捌く。
// target connのnotifQ上で「先行する全notificationの配送後」の位置に来るため、
// ここでrouteを消せばresponseで終わるcallの通知を取りこぼさない。
func (r *Router) HandleRouteDone(c *rpc.Conn, message *wire.Incoming) {
	var doneParams wire.CallCloseParams
	if err := wire.Unmarshal(message.Params, &doneParams); err != nil {
		return
	}
	r.mu.Lock()
	route := r.routes[routeKey(c, doneParams.CallID)]
	r.mu.Unlock()
	if route != nil {
		r.removeRoute(route)
	}
}

// DropConn はconn終了時の後始末。そのconnに紐付くrouteを失敗として閉じる。
// targetが死んだときはcallerへerror終端を、callerが死んだときはtargetへ
// closeを送る。送らないと購読・長時間callが相手側で実行され続ける。
func (r *Router) DropConn(c *rpc.Conn) {
	r.mu.Lock()
	dropped := map[string]*Route{}
	for key, route := range r.routes {
		if route.Target == c || route.Caller == c {
			dropped[key] = route
			delete(r.routes, key)
			delete(r.byCaller, routeKey(route.Caller, route.CallerID))
		}
	}
	r.mu.Unlock()
	for _, route := range dropped {
		route.dropOnce.Do(func() { close(route.dropped) })
	}

	for _, route := range dropped {
		if route.Target == c && route.Caller != c {
			_ = route.Caller.Notify(wire.MethodCallResult, wire.CallResultParams{
				CallID: route.CallerID,
				Error:  &wire.Error{Code: -32000, Message: "target transport closed"},
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
	delete(r.routes, routeKey(route.Target, route.TargetID))
	delete(r.byCaller, routeKey(route.Caller, route.CallerID))
	r.mu.Unlock()
	route.dropOnce.Do(func() { close(route.dropped) })
}
