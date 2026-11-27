package router

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/naatin777/plugumi/core/internal/execution"
	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

func testConnection(t *testing.T) (*rpc.Connection, *websocket.Conn) {
	t.Helper()
	accepted := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := websocket.Accept(w, r, nil)
		if err == nil {
			accepted <- connection
		}
	}))
	t.Cleanup(server.Close)
	peer, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	connection := rpc.NewConnection(<-accepted, "test-")
	ctx, cancel := context.WithCancel(context.Background())
	go connection.Run(ctx)
	t.Cleanup(func() { cancel(); peer.CloseNow(); connection.Close() })
	return connection, peer
}

func readMessage(t *testing.T, connection *websocket.Conn) wire.Incoming {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, data, err := connection.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var message wire.Incoming
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatal(err)
	}
	return message
}

func writeMessage(t *testing.T, connection *websocket.Conn, message any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	data, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	if err := connection.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
}

// setupProvider はoperationを宣言し、接続済みのproviderをregistryへ登録する。
func setupProvider(t *testing.T, reg *registry.Registry, connection *rpc.Connection, operations ...string) {
	t.Helper()
	lease, _, err := reg.Create(wire.ProviderIdentity{ProviderID: "test-provider", InstanceID: "instance"})
	if err != nil {
		t.Fatal(err)
	}
	declarations := make([]wire.OperationDeclaration, 0, len(operations))
	for _, path := range operations {
		declarations = append(declarations, wire.OperationDeclaration{Path: path})
	}
	if err := reg.ReplaceOperations(lease.RegistrationID, declarations); err != nil {
		t.Fatal(err)
	}
	reservation, err := reg.ReserveConnection(lease.RegistrationID)
	if err != nil {
		t.Fatal(err)
	}
	if !reservation.Complete(connection) {
		t.Fatal("could not attach provider connection")
	}
}

type invokeOutcome struct {
	result json.RawMessage
	rpcErr *wire.RPCError
}

func invoke(t *testing.T, router *Router, caller *rpc.Connection, params wire.InvokeParams) chan invokeOutcome {
	t.Helper()
	outcome := make(chan invokeOutcome, 1)
	go func() {
		result, rpcErr := router.HandleInvoke(caller, &wire.Incoming{
			Method: wire.MethodOperationsInvoke,
			Params: wire.Marshal(params),
		})
		outcome <- invokeOutcome{result: result, rpcErr: rpcErr}
	}()
	return outcome
}

func parseExecution(t *testing.T, result json.RawMessage) *wire.Execution {
	t.Helper()
	var invokeResult wire.InvokeResult
	if err := wire.Unmarshal(result, &invokeResult); err != nil || invokeResult.Execution == nil {
		t.Fatalf("invoke result is not an execution: %s", result)
	}
	return invokeResult.Execution
}

func TestInvokeForwardsAndReturnsTerminalExecution(t *testing.T) {
	reg := registry.New("test-core")
	store := execution.NewStore()
	r := New(reg, store)
	caller, _ := testConnection(t)
	provider, providerPeer := testConnection(t)
	setupProvider(t, reg, provider, "test/echo")

	outcome := invoke(t, r, caller, wire.InvokeParams{
		Operation: "test/echo",
		Input:     wire.Marshal(map[string]string{"text": "hello"}),
	})

	// provider側: 転送されたinvokeを読み、executionId付き・input引き継ぎを検証
	forwarded := readMessage(t, providerPeer)
	if forwarded.Method != wire.MethodOperationsInvoke {
		t.Fatalf("unexpected method: %s", forwarded.Method)
	}
	var forwardParams wire.ForwardInvokeParams
	if err := wire.Unmarshal(forwarded.Params, &forwardParams); err != nil {
		t.Fatal(err)
	}
	if forwardParams.ExecutionID == "" || forwardParams.Operation != "test/echo" {
		t.Fatalf("unexpected forward params: %+v", forwardParams)
	}
	if string(forwardParams.Input) != `{"text":"hello"}` {
		t.Fatalf("input not forwarded: %s", forwardParams.Input)
	}

	// terminal応答を返す
	writeMessage(t, providerPeer, wire.Response{
		JSONRPC: "2.0",
		ID:      forwarded.ID,
		Result: wire.Marshal(wire.ProviderInvokeResult{
			Status: wire.ExecutionSucceeded,
			Result: wire.Marshal(map[string]string{"echo": "hello"}),
		}),
	})

	res := <-outcome
	if res.rpcErr != nil {
		t.Fatalf("invoke failed: %+v", res.rpcErr)
	}
	exec := parseExecution(t, res.result)
	if exec.Status != wire.ExecutionSucceeded {
		t.Fatalf("execution not succeeded: %+v", exec)
	}
	if exec.ID != forwardParams.ExecutionID {
		t.Fatalf("execution id mismatch: %s vs %s", exec.ID, forwardParams.ExecutionID)
	}
	if string(exec.Result) != `{"echo":"hello"}` {
		t.Fatalf("unexpected result: %s", exec.Result)
	}

	// storeにも終端が記録されている
	stored, err := store.Get(exec.ID)
	if err != nil || stored.Status != wire.ExecutionSucceeded {
		t.Fatalf("stored execution: %+v, %v", stored, err)
	}
}

func TestInvokeRunningThenTerminalEvent(t *testing.T) {
	reg := registry.New("test-core")
	store := execution.NewStore()
	r := New(reg, store)
	caller, _ := testConnection(t)
	provider, providerPeer := testConnection(t)
	setupProvider(t, reg, provider, "test/slow")

	outcome := invoke(t, r, caller, wire.InvokeParams{Operation: "test/slow"})

	forwarded := readMessage(t, providerPeer)
	var forwardParams wire.ForwardInvokeParams
	if err := wire.Unmarshal(forwarded.Params, &forwardParams); err != nil {
		t.Fatal(err)
	}
	// running応答: callerにはrunningのexecutionが返る
	writeMessage(t, providerPeer, wire.Response{
		JSONRPC: "2.0",
		ID:      forwarded.ID,
		Result:  wire.Marshal(wire.ProviderInvokeResult{Status: wire.ExecutionRunning}),
	})

	res := <-outcome
	exec := parseExecution(t, res.result)
	if exec.Status != wire.ExecutionRunning {
		t.Fatalf("execution should still be running: %+v", exec)
	}

	// progress event → progressが記録される
	r.HandleOperationsEvent(provider, &wire.Incoming{
		Method: wire.MethodOperationsEvent,
		Params: wire.Marshal(wire.OperationsEventParams{
			ExecutionID: forwardParams.ExecutionID,
			Seq:         1,
			Type:        "progress",
			Payload:     wire.Marshal(map[string]int{"percent": 50}),
		}),
	})
	stored, _ := store.Get(exec.ID)
	if string(stored.Progress) != `{"percent":50}` {
		t.Fatalf("progress not recorded: %s", stored.Progress)
	}

	// result event → succeededへ進む
	r.HandleOperationsEvent(provider, &wire.Incoming{
		Method: wire.MethodOperationsEvent,
		Params: wire.Marshal(wire.OperationsEventParams{
			ExecutionID: forwardParams.ExecutionID,
			Seq:         2,
			Type:        "result",
			Payload:     wire.Marshal(map[string]string{"done": "yes"}),
		}),
	})
	stored, _ = store.Get(exec.ID)
	if stored.Status != wire.ExecutionSucceeded || string(stored.Result) != `{"done":"yes"}` {
		t.Fatalf("execution not completed: %+v", stored)
	}
}

func TestDropConnectionFailsInflightExecution(t *testing.T) {
	reg := registry.New("test-core")
	store := execution.NewStore()
	r := New(reg, store)
	caller, _ := testConnection(t)
	provider, providerPeer := testConnection(t)
	setupProvider(t, reg, provider, "test/slow")

	outcome := invoke(t, r, caller, wire.InvokeParams{Operation: "test/slow"})

	forwarded := readMessage(t, providerPeer)
	var forwardParams wire.ForwardInvokeParams
	if err := wire.Unmarshal(forwarded.Params, &forwardParams); err != nil {
		t.Fatal(err)
	}
	writeMessage(t, providerPeer, wire.Response{
		JSONRPC: "2.0",
		ID:      forwarded.ID,
		Result:  wire.Marshal(wire.ProviderInvokeResult{Status: wire.ExecutionRunning}),
	})
	<-outcome

	// provider切断: in-flightのexecutionはproviderDisconnectedでfailedへ
	r.DropConnection(provider)
	stored, err := store.Get(forwardParams.ExecutionID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != wire.ExecutionFailed {
		t.Fatalf("execution should be failed: %+v", stored)
	}
	if stored.Error == nil || stored.Error.Kind != wire.ErrorKindProviderDisconnected {
		t.Fatalf("error kind should be providerDisconnected: %+v", stored.Error)
	}
}

func TestInvokeUnknownOperation(t *testing.T) {
	reg := registry.New("test-core")
	store := execution.NewStore()
	r := New(reg, store)
	caller, _ := testConnection(t)

	result, rpcErr := r.HandleInvoke(caller, &wire.Incoming{
		Method: wire.MethodOperationsInvoke,
		Params: wire.Marshal(wire.InvokeParams{Operation: "no/such"}),
	})
	if result != nil || rpcErr == nil || rpcErr.Code != -32003 {
		t.Fatalf("expected -32003: %+v", rpcErr)
	}
}
