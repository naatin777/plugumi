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

	mu sync.Mutex
	// inflight[connectionID] = そのconnectionのproviderが処理中のexecution ID集合。
	// 切断時にproviderDisconnectedでfailedへ進めるために使う。
	inflight map[string]map[string]bool
	// executionOwner[executionID] = connectionID
	executionOwner map[string]string
}

func New(reg *registry.Registry, executions *execution.Store) *Router {
	return &Router{
		registry:       reg,
		executions:     executions,
		inflight:       make(map[string]map[string]bool),
		executionOwner: make(map[string]string),
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
	r.executionOwner[executionID] = connection.ID
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
	if isTerminal(updated.Status) {
		r.untrackInflight(provider, params.ExecutionID)
	}
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
	r.mu.Unlock()
	r.executions.FailDisconnected(ids)
}
