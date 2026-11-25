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
	t.Cleanup(func() { peer.CloseNow(); connection.Close() })
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

func TestCloseForwardsTerminalResult(t *testing.T) {
	caller, callerPeer := testConnection(t)
	target, targetPeer := testConnection(t)
	router := New(nil)
	route := &Route{Caller: caller, CallerID: wire.Marshal("caller-id"), Target: target, TargetID: wire.Marshal("forward-id"), Kind: "async", accepted: true, requestWritten: true, ready: make(chan struct{}), dropped: make(chan struct{})}
	close(route.ready)
	router.routes[routeKey(target, route.TargetID)] = route
	router.byCaller[routeKey(caller, route.CallerID)] = route

	router.HandleCallerNotification(caller, &wire.Incoming{Params: wire.Marshal(wire.CallCloseParams{CallID: route.CallerID})})
	forwarded := readMessage(t, targetPeer)
	var closeParams wire.CallCloseParams
	if err := wire.Unmarshal(forwarded.Params, &closeParams); err != nil || forwarded.Method != wire.MethodCallClose || string(closeParams.CallID) != string(route.TargetID) {
		t.Fatalf("unexpected close: %+v", forwarded)
	}
	router.HandleTargetNotification(target, &wire.Incoming{Method: wire.MethodCallResult, Params: wire.Marshal(wire.CallResultParams{CallID: route.TargetID, Result: wire.Marshal("closed")})})
	result := readMessage(t, callerPeer)
	var resultParams wire.CallResultParams
	if err := wire.Unmarshal(result.Params, &resultParams); err != nil || result.Method != wire.MethodCallResult || string(resultParams.CallID) != string(route.CallerID) || string(resultParams.Result) != `"closed"` {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(router.routes) != 0 || len(router.byCaller) != 0 {
		t.Fatal("terminal result did not remove route")
	}
}

// call のrequest書き込み前に届いたcloseは、callの後に送られなければならない。
// 先に届くとtargetは未知callIdのcloseを捨て、callが取消なしで実行される。
func TestCloseBeforeForwardWriteWaitsForCallWrite(t *testing.T) {
	caller, _ := testConnection(t)
	target, targetPeer := testConnection(t)
	callRouter := New(nil)
	route := &Route{Caller: caller, CallerID: wire.Marshal("caller-id"), Target: target, TargetID: wire.Marshal("forward-id"), Kind: "async", ready: make(chan struct{}), dropped: make(chan struct{})}
	callRouter.routes[routeKey(target, route.TargetID)] = route
	callRouter.byCaller[routeKey(caller, route.CallerID)] = route
	// coder/websocket は読み取り失敗後に再読み取りできないため、
	// 受信は別goroutineで受け続ける。
	received := make(chan wire.Incoming, 4)
	go func() {
		for {
			_, data, err := targetPeer.Read(context.Background())
			if err != nil {
				return
			}
			var message wire.Incoming
			if json.Unmarshal(data, &message) == nil {
				received <- message
			}
		}
	}()

	callRouter.HandleCallerNotification(caller, &wire.Incoming{Params: wire.Marshal(wire.CallCloseParams{CallID: route.CallerID})})
	// まだcloseは送られない。書き込み前に転送されるとcallより先に届く。
	select {
	case early := <-received:
		t.Fatalf("close was forwarded before the call request was written: %+v", early)
	case <-time.After(100 * time.Millisecond):
	}

	callRouter.markRequestSent(route)
	select {
	case forwarded := <-received:
		var closeParams wire.CallCloseParams
		if err := wire.Unmarshal(forwarded.Params, &closeParams); err != nil || forwarded.Method != wire.MethodCallClose || string(closeParams.CallID) != string(route.TargetID) {
			t.Fatalf("deferred close was not forwarded after the call write: %+v", forwarded)
		}
	case <-time.After(time.Second):
		t.Fatal("deferred close was not forwarded after the call write")
	}
}

func TestCancelBeforeAcceptanceReportsUnknownWhenTargetDoesNotFinish(t *testing.T) {
	caller, callerPeer := testConnection(t)
	target, targetPeer := testConnection(t)
	callRouter, registrationID := registerTarget(t, target, wire.ToolDeclaration{ToolPath: "ticks", Kind: "async"})
	callRouter.cancelGrace = 20 * time.Millisecond
	caller.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
		return callRouter.HandleCall(caller, message)
	}
	caller.OnNotification = func(message *wire.Incoming) { callRouter.DispatchNotification(caller, message) }
	caller.OnResponded = func(id json.RawMessage) { callRouter.NotifyResponded(caller, id) }
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go caller.Run(ctx)
	go target.Run(ctx)

	callerID := wire.Marshal("caller-1")
	writeMessage(t, callerPeer, wire.Request{JSONRPC: "2.0", ID: callerID, Method: wire.MethodCall,
		Params: wire.Marshal(wire.CallParams{Target: wire.CallTarget{RegistrationID: registrationID, ToolPath: "ticks"}})})
	forwarded := readMessage(t, targetPeer)
	writeMessage(t, callerPeer, wire.Notification{JSONRPC: "2.0", Method: wire.MethodCallClose,
		Params: wire.Marshal(wire.CallCloseParams{CallID: callerID})})
	if forwardedClose := readMessage(t, targetPeer); forwardedClose.Method != wire.MethodCallClose {
		t.Fatalf("unexpected cancellation: %+v", forwardedClose)
	}
	writeMessage(t, targetPeer, wire.Response{JSONRPC: "2.0", ID: forwarded.ID, Result: json.RawMessage(`{"accepted":true}`)})
	if response := readMessage(t, callerPeer); string(response.ID) != string(callerID) || string(response.Result) != `{"accepted":true}` {
		t.Fatalf("expected acceptance before terminal notification: %+v", response)
	}
	terminal := readMessage(t, callerPeer)
	var result wire.CallResultParams
	if err := wire.Unmarshal(terminal.Params, &result); err != nil || terminal.Method != wire.MethodCallResult ||
		string(result.CallID) != string(callerID) || result.Error == nil || result.Error.Code != -32004 {
		t.Fatalf("expected outcome unknown: %+v", terminal)
	}
	callRouter.mu.Lock()
	routeCount := len(callRouter.routes) + len(callRouter.byCaller)
	callRouter.mu.Unlock()
	if routeCount != 0 {
		t.Fatal("timed-out cancellation did not remove the route")
	}
	callRouter.HandleTargetNotification(target, &wire.Incoming{Method: wire.MethodCallResult,
		Params: wire.Marshal(wire.CallResultParams{CallID: forwarded.ID, Result: wire.Marshal("too late")})})
	callRouter.DropConnection(target)
	if err := caller.Notify("test.marker", nil); err != nil {
		t.Fatal(err)
	}
	if message := readMessage(t, callerPeer); message.Method != "test.marker" {
		t.Fatalf("received another terminal result: %+v", message)
	}
}

func writeMessage(t *testing.T, connection *websocket.Conn, message any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := connection.Write(ctx, websocket.MessageText, wire.Marshal(message)); err != nil {
		t.Fatal(err)
	}
}

func registerTarget(t *testing.T, target *rpc.Connection, tools ...wire.ToolDeclaration) (*Router, string) {
	t.Helper()
	pluginRegistry := registry.New("test-core")
	lease, _, err := pluginRegistry.Create(wire.PluginIdentity{PluginID: "test-plugin", PluginInstanceID: "instance"})
	if err != nil {
		t.Fatal(err)
	}
	if err := pluginRegistry.ReplaceTools(lease.RegistrationID, tools); err != nil {
		t.Fatal(err)
	}
	reservation, err := pluginRegistry.ReserveConnection(lease.RegistrationID)
	if err != nil || !reservation.Complete(target) {
		t.Fatalf("failed to attach target: %v", err)
	}
	return New(pluginRegistry), lease.RegistrationID
}

func TestSyncOutputArrivesBeforeResponse(t *testing.T) {
	caller, callerPeer := testConnection(t)
	target, targetPeer := testConnection(t)
	callRouter, registrationID := registerTarget(t, target, wire.ToolDeclaration{ToolPath: "echo", Kind: "sync"})
	caller.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
		return callRouter.HandleCall(caller, message)
	}
	target.OnNotification = func(message *wire.Incoming) {
		callRouter.DispatchNotification(target, message)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go caller.Run(ctx)
	go target.Run(ctx)

	callerID := wire.Marshal("caller-1")
	writeMessage(t, callerPeer, wire.Request{JSONRPC: "2.0", ID: callerID, Method: wire.MethodCall,
		Params: wire.Marshal(wire.CallParams{Target: wire.CallTarget{RegistrationID: registrationID, ToolPath: "echo"}})})
	forwarded := readMessage(t, targetPeer)
	writeMessage(t, targetPeer, wire.Notification{JSONRPC: "2.0", Method: wire.MethodCallChunk,
		Params: wire.Marshal(wire.CallChunkParams{CallID: forwarded.ID, Payload: wire.Marshal("step 1")})})
	output := readMessage(t, callerPeer)
	var params wire.CallChunkParams
	if err := wire.Unmarshal(output.Params, &params); err != nil || output.Method != wire.MethodCallChunk || string(params.CallID) != string(callerID) {
		t.Fatalf("途中出力が届かなかった: %+v", output)
	}

	writeMessage(t, targetPeer, wire.Notification{JSONRPC: "2.0", Method: wire.MethodCallChunk,
		Params: wire.Marshal(wire.CallChunkParams{CallID: forwarded.ID, Payload: wire.Marshal("step 2")})})
	writeMessage(t, targetPeer, wire.Response{JSONRPC: "2.0", ID: forwarded.ID, Result: wire.Marshal("done")})
	if output := readMessage(t, callerPeer); output.Method != wire.MethodCallChunk {
		t.Fatalf("最終応答より先に最後の途中出力が届かなかった: %+v", output)
	}
	if response := readMessage(t, callerPeer); string(response.ID) != string(callerID) || string(response.Result) != `"done"` {
		t.Fatalf("最終応答が届かなかった: %+v", response)
	}
}

func TestTargetDisconnectWaitsForAcceptanceResponse(t *testing.T) {
	caller, callerPeer := testConnection(t)
	target, targetPeer := testConnection(t)
	callRouter, registrationID := registerTarget(t, target, wire.ToolDeclaration{ToolPath: "ticks", Kind: "async"})
	caller.OnResponded = func(id json.RawMessage) { callRouter.NotifyResponded(caller, id) }
	accepted, respond := make(chan struct{}), make(chan struct{})
	caller.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
		result, rpcError := callRouter.HandleCall(caller, message)
		close(accepted)
		select {
		case <-respond:
		case <-caller.Done():
		}
		return result, rpcError
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go caller.Run(ctx)
	go target.Run(ctx)

	callerID := wire.Marshal("caller-1")
	writeMessage(t, callerPeer, wire.Request{JSONRPC: "2.0", ID: callerID, Method: wire.MethodCall,
		Params: wire.Marshal(wire.CallParams{Target: wire.CallTarget{RegistrationID: registrationID, ToolPath: "ticks"}})})
	forwarded := readMessage(t, targetPeer)
	writeMessage(t, targetPeer, wire.Response{JSONRPC: "2.0", ID: forwarded.ID, Result: json.RawMessage(`{"accepted":true}`)})
	select {
	case <-accepted:
	case <-time.After(time.Second):
		t.Fatal("受理されなかった")
	}
	callRouter.DropConnection(target)
	close(respond)
	if response := readMessage(t, callerPeer); string(response.ID) != string(callerID) || string(response.Result) != `{"accepted":true}` {
		t.Fatalf("終端通知より先に受理応答が届かなかった: %+v", response)
	}
	terminal := readMessage(t, callerPeer)
	var params wire.CallResultParams
	if err := wire.Unmarshal(terminal.Params, &params); err != nil || terminal.Method != wire.MethodCallResult || string(params.CallID) != string(callerID) || params.Error == nil || params.Error.Code != -32000 {
		t.Fatalf("対象切断の終端通知が届かなかった: %+v", terminal)
	}
}
