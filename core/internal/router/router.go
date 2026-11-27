// Package router はoperation invocationの配送とExecution状態の更新を担う。
// contracts/00004: caller→Coreのoperations.invokeをproviderへforwardし、
// providerからのoperations.eventをExecution recordへ反映する。
package router

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/execution"
	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

type Router struct {
	registry   *registry.Registry
	executions *execution.Store

	// OnExecutionEvent はexecution event（provider由来・Core合成の両方）が
	// 発生するたびに呼ばれるhook。SSE feedへのfan-outに使う。
	OnExecutionEvent func(params wire.OperationsEventParams)

	mu sync.Mutex
	// inflight[connectionID] = そのconnectionのproviderが処理中のexecution ID集合。
	// 切断時にproviderDisconnectedでfailedへ進めるために使う。
	inflight map[string]map[string]bool
	// executionOwner[executionID] = 配送先providerのconnection。cancel転送に使う。
	executionOwner map[string]*rpc.Connection
	// invokers[executionID] = そのexecutionをinvokeしたcallerのconnection。
	// executions.eventの自動push先（contracts/00004「呼んだ本人」）。
	invokers map[string]*rpc.Connection
}

func New(reg *registry.Registry, executions *execution.Store) *Router {
	return &Router{
		registry:       reg,
		executions:     executions,
		inflight:       make(map[string]map[string]bool),
		executionOwner: make(map[string]*rpc.Connection),
		invokers:       make(map[string]*rpc.Connection),
	}
}

// rpcErrorForResolve はoperation解決の失敗をJSON-RPC errorへ写像する。
func rpcErrorForResolve(err error) *wire.RPCError {
	switch err {
	case registry.ErrUnknownOperation:
		return &wire.RPCError{Code: -32003, Message: "no provider for operation"}
	case registry.ErrAmbiguousOperation:
		return &wire.RPCError{Code: -32003, Message: "operation is ambiguous"}
	case registry.ErrConnectionUnavailable:
		return &wire.RPCError{Code: -32003, Message: "provider connection unavailable"}
	default:
		return &wire.RPCError{Code: -32603, Message: "internal error"}
	}
}

// HandleInvoke はcaller→Coreのoperations.invokeを捌く。
// providerへforwardし、応答に応じてExecutionを更新してcallerへ返す。
func (r *Router) HandleInvoke(caller *rpc.Connection, message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
	var params wire.InvokeParams
	if err := wire.Unmarshal(message.Params, &params); err != nil || params.Operation == "" {
		return nil, &wire.RPCError{Code: -32602, Message: "invalid invoke params"}
	}

	target, err := r.registry.ResolveOperation(params.Operation)
	if err != nil {
		return nil, rpcErrorForResolve(err)
	}

	exec := r.executions.Create(params.Operation, params.Input, params.Context)
	r.mu.Lock()
	r.invokers[exec.ID] = caller
	r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	r.trackInflight(target, exec.ID)
	forward := wire.ForwardInvokeParams{
		Operation:   params.Operation,
		ExecutionID: exec.ID,
		Input:       params.Input,
	}
	res, invokeErr := target.Request(ctx, wire.MethodOperationsInvoke, forward)

	if invokeErr != nil {
		// 配送失敗・切断: providerDisconnectedでfailedへ
		r.executions.ApplyEvent(exec.ID, "error", wire.Marshal(wire.ExecutionError{
			Code:    "provider_disconnected",
			Message: "invoke delivery failed: " + invokeErr.Error(),
			Kind:    wire.ErrorKindProviderDisconnected,
		}))
		r.untrackInflight(target, exec.ID)
		updated, _ := r.executions.Get(exec.ID)
		return wire.Marshal(wire.InvokeResult{Execution: updated}), nil
	}

	if res.Error != nil {
		r.executions.ApplyEvent(exec.ID, "error", wire.Marshal(wire.ExecutionError{
			Code:    "execution_failed",
			Message: res.Error.Message,
			Kind:    wire.ErrorKindExecutionFailed,
		}))
		r.untrackInflight(target, exec.ID)
		updated, _ := r.executions.Get(exec.ID)
		return wire.Marshal(wire.InvokeResult{Execution: updated}), nil
	}

	var providerResult wire.ProviderInvokeResult
	if err := wire.Unmarshal(res.Result, &providerResult); err != nil {
		r.executions.ApplyEvent(exec.ID, "error", wire.Marshal(wire.ExecutionError{
			Code:    "invalid_provider_response",
			Message: "provider response is not a valid execution state",
			Kind:    wire.ErrorKindExecutionFailed,
		}))
		r.untrackInflight(target, exec.ID)
		updated, _ := r.executions.Get(exec.ID)
		return wire.Marshal(wire.InvokeResult{Execution: updated}), nil
	}

	updated := r.executions.Complete(exec.ID, &providerResult)
	if updated != nil && isTerminal(updated.Status) {
		r.untrackInflight(target, exec.ID)
	}
	return wire.Marshal(wire.InvokeResult{Execution: updated}), nil
}

func isTerminal(status string) bool {
	return status == wire.ExecutionSucceeded || status == wire.ExecutionFailed || status == wire.ExecutionCancelled
}

func (r *Router) trackInflight(connection *rpc.Connection, executionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	set := r.inflight[connection.ID]
	if set == nil {
		set = make(map[string]bool)
		r.inflight[connection.ID] = set
	}
	set[executionID] = true
	r.executionOwner[executionID] = connection
}

func (r *Router) untrackInflight(connection *rpc.Connection, executionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if set := r.inflight[connection.ID]; set != nil {
		delete(set, executionID)
		if len(set) == 0 {
			delete(r.inflight, connection.ID)
		}
	}
	delete(r.executionOwner, executionID)
}

// HandleOperationsEvent はprovider→Coreのoperations.event notificationを捌く。
// Execution recordへ反映し、terminalならin-flight追跡を外す。
func (r *Router) HandleOperationsEvent(provider *rpc.Connection, message *wire.Incoming) {
	var params wire.OperationsEventParams
	if err := wire.Unmarshal(message.Params, &params); err != nil || params.ExecutionID == "" {
		return
	}
	updated, err := r.executions.ApplyEvent(params.ExecutionID, params.Type, params.Payload)
	if err != nil {
		return
	}
	r.fanout(params)
	if isTerminal(updated.Status) {
		r.untrackInflight(provider, params.ExecutionID)
		r.dropInvoker(params.ExecutionID)
	}
}

// fanout はexecution eventをinvokerの接続とSSE hookへ配信する。
func (r *Router) fanout(params wire.OperationsEventParams) {
	r.mu.Lock()
	invoker := r.invokers[params.ExecutionID]
	r.mu.Unlock()
	if invoker != nil {
		// 書き込み失敗（切断済み）は気にしない。次の接続でgetすれば取り直せる。
		_ = invoker.Notify(wire.MethodExecutionsEvent, params)
	}
	if r.OnExecutionEvent != nil {
		r.OnExecutionEvent(params)
	}
}

func (r *Router) dropInvoker(executionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.invokers, executionID)
}

// HandleExecutionsGet はcaller→Coreのexecutions.getを捌く。
func (r *Router) HandleExecutionsGet(caller *rpc.Connection, message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
	var params struct {
		ExecutionID string `json:"executionId"`
	}
	if err := wire.Unmarshal(message.Params, &params); err != nil || params.ExecutionID == "" {
		return nil, &wire.RPCError{Code: -32602, Message: "invalid params"}
	}
	exec, err := r.executions.Get(params.ExecutionID)
	if err != nil {
		return nil, &wire.RPCError{Code: -32005, Message: "unknown execution"}
	}
	return wire.Marshal(exec), nil
}

// HandleExecutionsList はcaller→Coreのexecutions.listを捌く。
func (r *Router) HandleExecutionsList(caller *rpc.Connection, message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
	return wire.Marshal(struct {
		Executions []*wire.Execution `json:"executions"`
	}{Executions: r.executions.List()}), nil
}

// HandleOperationsList はcaller→Coreのoperations.listを捌く。
func (r *Router) HandleOperationsList(caller *rpc.Connection, message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
	return wire.Marshal(struct {
		Operations []wire.OperationDeclaration `json:"operations"`
	}{Operations: r.registry.ListOperations()}), nil
}

// DispatchNotification はprovider側connectionからのnotificationをmethodで振り分ける。
func (r *Router) DispatchNotification(c *rpc.Connection, message *wire.Incoming) {
	switch message.Method {
	case wire.MethodOperationsEvent:
		r.HandleOperationsEvent(c, message)
	}
}

// DropConnection はconnection切断時の清算。in-flightのExecutionを
// providerDisconnectedでfailedへ進める（contracts/00004）。
// caller側の接続ならinvoker登録を外す。
func (r *Router) DropConnection(c *rpc.Connection) {
	r.mu.Lock()
	ids := make([]string, 0)
	if set := r.inflight[c.ID]; set != nil {
		for id := range set {
			ids = append(ids, id)
			delete(r.executionOwner, id)
		}
		delete(r.inflight, c.ID)
	}
	// callerとして切断した場合、それがinvokerのexecutionの登録を外す。
	for id, invoker := range r.invokers {
		if invoker == c {
			delete(r.invokers, id)
		}
	}
	r.mu.Unlock()
	r.executions.FailDisconnected(ids)
	// provider切断でfailedへ進んだexecutionへは、終端を知る術がないと
	// callerがrunningのまま待ち続けるので、Core合成のerror eventをfanoutする。
	for _, id := range ids {
		seq := r.executions.NextSeq(id)
		params := wire.OperationsEventParams{
			ExecutionID: id,
			Seq:         seq,
			Type:        "error",
			Payload: wire.Marshal(wire.ExecutionError{
				Code:    "provider_disconnected",
				Message: "provider disconnected",
				Kind:    wire.ErrorKindProviderDisconnected,
			}),
		}
		r.fanout(params)
		r.dropInvoker(id)
	}
}

// HandleExecutionsCancel はcaller→Coreのexecutions.cancelを捌く。
// providerへcancel notificationを転送し、受理時点のExecutionを返す。
// 終端はproviderのterminal eventを待つ（contracts/00004）。
func (r *Router) HandleExecutionsCancel(caller *rpc.Connection, message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
	var params struct {
		ExecutionID string `json:"executionId"`
	}
	if err := wire.Unmarshal(message.Params, &params); err != nil || params.ExecutionID == "" {
		return nil, &wire.RPCError{Code: -32602, Message: "invalid params"}
	}
	exec, err := r.executions.Get(params.ExecutionID)
	if err != nil {
		return nil, &wire.RPCError{Code: -32005, Message: "unknown execution"}
	}
	if isTerminal(exec.Status) {
		return wire.Marshal(exec), nil
	}
	r.mu.Lock()
	owner := r.executionOwner[params.ExecutionID]
	r.mu.Unlock()
	if owner != nil {
		_ = owner.Notify(wire.MethodExecutionsCancel, map[string]string{
			"executionId": params.ExecutionID,
		})
	}
	return wire.Marshal(exec), nil
}
