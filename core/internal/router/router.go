// Package router は caller Plugin → Core → target Plugin の呼び出し中継
// （docs/contracts/00004）。id空間は接続ごと送信者ごと。Coreはtarget側へ
// forward idを自空間から発行し、呼び出しに紐付くnotificationの params.callId を
// 各方間のidへ書き換えて配送する。
package router

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

type Router struct {
	registry    *registry.Registry
	routes      map[string]*Route // target connection.ID + "\x00" + callId →
	byCaller    map[string]*Route // caller connection.ID + "\x00" + callId →
	mu          sync.Mutex
	cancelGrace time.Duration
}

type Route struct {
	Caller   *rpc.Connection
	CallerID json.RawMessage // caller側connection上のid
	Target   *rpc.Connection
	TargetID json.RawMessage // Coreが発行したforward id
	Kind     string

	// ready はcallerへのresponse書込みが終わった時点で閉じる。
	// 非同期callのoutput/resultは受理応答より後に配送する。
	ready     chan struct{}
	readyOnce sync.Once
	// dropped はroute撤収で閉じる。ready待機中のnotification配送を抜けさせる。
	dropped         chan struct{}
	dropOnce        sync.Once
	accepted        bool       // 非同期callが受理されたか。r.muで保護する。
	delivery        sync.Mutex // 対象切断の終端と、配送中の通知を直列化する。
	cancelRequested bool
	// requestWritten はcallのrequestをtargetへ書き終えたか。
	// 先着したcloseはこれが立つまで送らない（接続上の順序を保つため）。
	requestWritten bool
	cancelTimer    *time.Timer // cancelRequestedとともにr.muで保護する。
}

func New(registry *registry.Registry) *Router {
	return &Router{
		registry:    registry,
		routes:      make(map[string]*Route),
		byCaller:    make(map[string]*Route),
		cancelGrace: 5 * time.Second,
	}
}

func routeKey(c *rpc.Connection, id json.RawMessage) string { return c.ID + "\x00" + string(id) }

// HandleCall はconnection上の tools.call request を捌く。targetへforwardし、
// responseをそのままこのrequestのresponseとして返す。
// OnRequestのgoroutine内で同期的に完結させる。
func (r *Router) HandleCall(caller *rpc.Connection, message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
	var params wire.CallParams
	if err := wire.Unmarshal(message.Params, &params); err != nil {
		return nil, &wire.RPCError{Code: -32602, Message: "invalid params"}
	}

	if params.Target.RegistrationID == "" || params.Target.ToolPath == "" {
		return nil, &wire.RPCError{Code: -32602, Message: "registrationId and toolPath are required"}
	}
	target, kind, lookupErr := r.registry.ResolveTool(params.Target)
	switch lookupErr {
	case nil:
	case registry.ErrUnknownRegistration:
		return nil, &wire.RPCError{Code: -32007, Message: "unknown registration: " + params.Target.RegistrationID}
	case registry.ErrConnectionUnavailable:
		return nil, &wire.RPCError{Code: -32002, Message: "plugin connection unavailable"}
	case registry.ErrUnknownTool:
		return nil, &wire.RPCError{Code: -32601, Message: "no such toolPath: " + params.Target.ToolPath}
	default:
		return nil, &wire.RPCError{Code: -32603, Message: "failed to resolve tool target"}
	}

	forwardID := target.NextID()
	route := &Route{
		Caller: caller, CallerID: message.ID,
		Target: target, TargetID: forwardID,
		Kind:    kind,
		ready:   make(chan struct{}),
		dropped: make(chan struct{}),
	}
	r.mu.Lock()
	select {
	case <-caller.Done():
		r.mu.Unlock()
		return nil, &wire.RPCError{Code: -32000, Message: "caller connection closed"}
	case <-target.Done():
		r.mu.Unlock()
		return nil, &wire.RPCError{Code: -32000, Message: "forward failed: target connection closed"}
	default:
	}
	targetKey := routeKey(target, forwardID)
	if r.byCaller[routeKey(caller, message.ID)] != nil {
		r.mu.Unlock()
		return nil, &wire.RPCError{Code: -32600, Message: "call ID is already in use"}
	}
	r.routes[targetKey] = route
	r.byCaller[routeKey(caller, message.ID)] = route
	r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	res, err := target.RequestWithID(ctx, forwardID, wire.MethodCall,
		wire.ForwardCallParams{ToolPath: params.Target.ToolPath, Input: params.Input},
		func() { r.markRequestSent(route) })
	if err != nil {
		r.removeRoute(route)
		// target側で実行中のcallがあれば止める。timeout/送信失敗で
		// こちらが諦めても、相手側の購読・長時間callは実行され続けるため。
		_ = target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: forwardID})
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, &wire.RPCError{Code: -32003, Message: "forward deadline exceeded"}
		}
		return nil, &wire.RPCError{Code: -32000, Message: "forward failed: " + err.Error()}
	}

	if kind == "sync" {
		// 同期Toolは途中出力を実行中に配送でき、最終応答が終端となる。
		err := target.WaitNotifications(ctx)
		r.removeRoute(route)
		if err != nil {
			return nil, &wire.RPCError{Code: -32000, Message: "forward failed: " + err.Error()}
		}
		return res.Result, res.Error
	}
	if res.Error != nil {
		r.removeRoute(route)
		return nil, res.Error
	}
	var acceptance struct {
		Accepted bool `json:"accepted"`
	}
	if json.Unmarshal(res.Result, &acceptance) != nil || !acceptance.Accepted {
		r.removeRoute(route)
		return res.Result, nil
	}
	// 切断処理と受理判定を直列化する。先にrouteが消えた場合はresponseで終端する。
	r.mu.Lock()
	if r.routes[targetKey] != route {
		r.mu.Unlock()
		return nil, &wire.RPCError{Code: -32000, Message: "forward failed: connection closed before acceptance"}
	}
	route.accepted = true
	if route.cancelRequested {
		r.startCancelTimerLocked(route)
	}
	r.mu.Unlock()
	return res.Result, nil
}

// NotifyResponded はcaller connectionへのresponse書込み完了を受ける
// （connection.OnRespondedから呼ぶ）。routeのreadyを閉じて
// 非同期callのnotification中継を解禁する。
func (r *Router) NotifyResponded(c *rpc.Connection, id json.RawMessage) {
	r.mu.Lock()
	route := r.byCaller[routeKey(c, id)]
	r.mu.Unlock()
	if route == nil {
		return
	}
	route.readyOnce.Do(func() { close(route.ready) })
}

// HandleTargetNotification はtarget側connectionからのnotification中継（途中出力・終端）。
// callIdをcaller側のidへ書き換えて配送する。
// callerがresponseを受け取る前にnotificationを届けないよう、
// route.readyが閉じるまで待機する。
func (r *Router) HandleTargetNotification(c *rpc.Connection, message *wire.Incoming) {
	var chunk wire.CallChunkParams
	var result wire.CallResultParams
	var callID json.RawMessage
	switch message.Method {
	case wire.MethodCallChunk:
		if err := wire.Unmarshal(message.Params, &chunk); err != nil {
			return
		}
		callID = chunk.CallID
	case wire.MethodCallResult:
		if err := wire.Unmarshal(message.Params, &result); err != nil {
			return
		}
		callID = result.CallID
	default:
		return
	}

	r.mu.Lock()
	route := r.routes[routeKey(c, callID)]
	r.mu.Unlock()
	if route == nil {
		return
	}

	if route.Kind == "async" {
		select {
		case <-route.ready:
		case <-route.dropped:
			return
		}
	}

	route.delivery.Lock()
	defer route.delivery.Unlock()
	switch message.Method {
	case wire.MethodCallResult:
		// 切断処理に先を越された場合は、ここから終端を重ねて送らない。
		if route.Kind != "async" || !r.removeRoute(route) {
			return
		}
		result.CallID = route.CallerID
		_ = route.Caller.Notify(wire.MethodCallResult, result)
	case wire.MethodCallChunk:
		select {
		case <-route.dropped:
			return
		default:
		}
		chunk.CallID = route.CallerID
		_ = route.Caller.Notify(wire.MethodCallChunk, chunk)
	}
}

// HandleCallerNotification は呼び出し元側connectionからの tools.call.close notification。
// 対応routeを引き、callIdをforward idへ書き換えてtargetへ配送する。
func (r *Router) HandleCallerNotification(c *rpc.Connection, message *wire.Incoming) {
	var closeParams wire.CallCloseParams
	if err := wire.Unmarshal(message.Params, &closeParams); err != nil {
		return
	}
	r.mu.Lock()
	route := r.byCaller[routeKey(c, closeParams.CallID)]
	if route == nil || route.cancelRequested || r.routes[routeKey(route.Target, route.TargetID)] != route {
		r.mu.Unlock()
		return
	}
	route.cancelRequested = true
	if route.accepted {
		r.startCancelTimerLocked(route)
	}
	written := route.requestWritten
	r.mu.Unlock()
	// 同期呼び出しと受理前の呼び出しには既存のrequest期限がある。
	// callの書き込み前なら、markRequestSentがcallに続けてcloseを送る。
	if written {
		_ = route.Target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: route.TargetID})
	}
}

// markRequestSent はforward requestの書き込み完了フック。
// callの送信前に届いていたcloseがあれば、callに続けて送る。
func (r *Router) markRequestSent(route *Route) {
	r.mu.Lock()
	route.requestWritten = true
	sendClose := route.cancelRequested
	r.mu.Unlock()
	if sendClose {
		_ = route.Target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: route.TargetID})
	}
}

func (r *Router) startCancelTimerLocked(route *Route) {
	route.cancelTimer = time.AfterFunc(r.cancelGrace, func() {
		// 結果不明でも、受理応答より先に終端通知を送らない（contracts/00004）。
		select {
		case <-route.ready:
		case <-route.dropped:
			return
		case <-route.Caller.Done():
			return
		}
		route.delivery.Lock()
		defer route.delivery.Unlock()
		if r.removeRoute(route) {
			_ = route.Caller.Notify(wire.MethodCallResult, wire.CallResultParams{
				CallID: route.CallerID,
				Error:  &wire.RPCError{Code: -32004, Message: "outcome unknown: no terminal result after cancellation request"},
			})
		}
	})
}

// DispatchNotification はメソッドの方向に対応するID空間を使う。
func (r *Router) DispatchNotification(c *rpc.Connection, message *wire.Incoming) {
	switch message.Method {
	case wire.MethodCallChunk, wire.MethodCallResult:
		r.HandleTargetNotification(c, message)
	case wire.MethodCallClose:
		r.HandleCallerNotification(c, message)
	}
}

// DropConnection はconnection終了時の後始末。そのconnectionに紐付くrouteを失敗として閉じる。
// targetが死んだときはcallerへerror終端を、callerが死んだときはtargetへ
// closeを送る。送らないと購読・長時間callが相手側で実行され続ける。
func (r *Router) DropConnection(c *rpc.Connection) {
	r.mu.Lock()
	var abandoned, interrupted []*Route
	for key, route := range r.routes {
		if route.Target == c || route.Caller == c {
			delete(r.routes, key)
			route.dropLocked()
			if route.Target == c && route.Caller != c && route.accepted {
				// 受理応答の書き込みを待つ間はNotifyResponded用の索引を残す。
				interrupted = append(interrupted, route)
			} else {
				delete(r.byCaller, routeKey(route.Caller, route.CallerID))
				if route.Caller == c && route.Target != c {
					abandoned = append(abandoned, route)
				}
			}
		}
	}
	r.mu.Unlock()
	for _, route := range interrupted {
		go r.notifyTargetClosed(route)
	}
	for _, route := range abandoned {
		_ = route.Target.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: route.TargetID})
	}
}

func (r *Router) notifyTargetClosed(route *Route) {
	defer func() {
		r.mu.Lock()
		key := routeKey(route.Caller, route.CallerID)
		if r.byCaller[key] == route {
			delete(r.byCaller, key)
		}
		r.mu.Unlock()
	}()
	select {
	case <-route.ready:
	case <-route.Caller.Done():
		return
	}
	route.delivery.Lock()
	defer route.delivery.Unlock()
	_ = route.Caller.Notify(wire.MethodCallResult, wire.CallResultParams{
		CallID: route.CallerID,
		Error:  &wire.RPCError{Code: -32000, Message: "target connection closed"},
	})
}

func (r *Router) removeRoute(route *Route) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	targetKey := routeKey(route.Target, route.TargetID)
	if r.routes[targetKey] != route {
		return false
	}
	delete(r.routes, targetKey)
	callerKey := routeKey(route.Caller, route.CallerID)
	if r.byCaller[callerKey] == route {
		delete(r.byCaller, callerKey)
	}
	route.dropLocked()
	return true
}

func (route *Route) dropLocked() {
	if route.cancelTimer != nil {
		route.cancelTimer.Stop()
	}
	route.dropOnce.Do(func() { close(route.dropped) })
}
