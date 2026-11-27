package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/wire"
)

// JSON-RPCメッセージをWSでやり取りするtest helper。
func writeRPC(t *testing.T, ctx context.Context, conn *websocket.Conn, value any) {
	t.Helper()
	if err := conn.Write(ctx, websocket.MessageText, wire.Marshal(value)); err != nil {
		t.Fatal(err)
	}
}

func readRPC(t *testing.T, ctx context.Context, conn *websocket.Conn) wire.Incoming {
	t.Helper()
	_, payload, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var message wire.Incoming
	if err := json.Unmarshal(payload, &message); err != nil {
		t.Fatalf("not JSON-RPC: %s", payload)
	}
	return message
}

// 目的のmethodのnotificationが来るまで読み進める。
func awaitNotification(t *testing.T, ctx context.Context, conn *websocket.Conn, method string) wire.Incoming {
	t.Helper()
	for {
		message := readRPC(t, ctx, conn)
		if message.IsNotification() && message.Method == method {
			return message
		}
	}
}

func setupViewProvider(t *testing.T, ctx context.Context, httpServer *httptest.Server) (registrationID string, runtimeConn *websocket.Conn) {
	t.Helper()
	body := `{"providerId":"test-provider","instanceId":"instance-1"}`
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, httpServer.URL+"/v1/registrations", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	res, err := httpServer.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var lease wire.RegistrationLease
	if json.NewDecoder(res.Body).Decode(&lease) != nil {
		t.Fatal("bad lease")
	}
	res.Body.Close()

	panelManifest := `{"files":[{"path":"panel.js","sha256":"` + strings.Repeat("0", 64) + `"}],"panels":[{"panelId":"chat","title":"Chat","entry":"panel.js"}]}`
	req, err = http.NewRequestWithContext(ctx, http.MethodPut,
		httpServer.URL+"/v1/registrations/"+lease.RegistrationID+"/ui", strings.NewReader(panelManifest))
	if err != nil {
		t.Fatal(err)
	}
	res, err = httpServer.Client().Do(req)
	if err != nil || res.StatusCode != 204 {
		t.Fatalf("put ui: %v", res)
	}
	res.Body.Close()

	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/v1/rpc?registrationId="+lease.RegistrationID, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	return lease.RegistrationID, conn
}

func createViewInstance(t *testing.T, ctx context.Context, httpServer *httptest.Server, registrationID, panelID string) wire.ViewTicket {
	t.Helper()
	body, err := json.Marshal(wire.ViewCreateParams{RegistrationID: registrationID, PanelID: panelID})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, httpServer.URL+"/v1/views", strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	res, err := httpServer.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("create view: %d", res.StatusCode)
	}
	var ticket wire.ViewTicket
	if err := json.NewDecoder(res.Body).Decode(&ticket); err != nil {
		t.Fatal(err)
	}
	return ticket
}

func dialRPC(t *testing.T, ctx context.Context, httpServer *httptest.Server, query string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/v1/rpc"+query, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	return conn
}

func TestViewChannelLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server := New(ctx, "test-core", "", "", t.TempDir())
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	registrationID, runtimeConn := setupViewProvider(t, ctx, httpServer)

	// host: instance登録。未知panel/registrationは拒否される。
	ticket := createViewInstance(t, ctx, httpServer, registrationID, "chat")
	if !strings.HasPrefix(ticket.ID, "view-") || ticket.Ticket == "" || ticket.Status != wire.ViewPending {
		t.Fatalf("ticket = %+v", ticket)
	}

	// view: WS接続してviews.connectでbind。
	viewConn := dialRPC(t, ctx, httpServer, "")
	writeRPC(t, ctx, viewConn, wire.Request{
		JSONRPC: "2.0", ID: json.RawMessage(`1`), Method: wire.MethodViewsConnect,
		Params: wire.Marshal(wire.ViewsConnectParams{Ticket: ticket.Ticket}),
	})
	response := readRPC(t, ctx, viewConn)
	if !response.IsResponse() || response.Error != nil {
		t.Fatalf("connect response = %+v", response)
	}
	var connectResult wire.ViewsConnectResult
	if err := wire.Unmarshal(response.Result, &connectResult); err != nil ||
		connectResult.Instance.Status != wire.ViewOpen || connectResult.Instance.ID != ticket.ID {
		t.Fatalf("connect result = %+v", connectResult)
	}

	// runtimeへopenedが届く。
	opened := awaitNotification(t, ctx, runtimeConn, wire.MethodViewsEvent)
	var openedParams wire.ViewsEventParams
	if err := wire.Unmarshal(opened.Params, &openedParams); err != nil ||
		openedParams.Type != wire.ViewsEventOpened || openedParams.Instance != ticket.ID || openedParams.PanelID != "chat" {
		t.Fatalf("opened = %+v", openedParams)
	}

	// view → runtimeのmessageがopaqueのまま届く。
	payload := json.RawMessage(`{"type":"userInput","text":"hello"}`)
	writeRPC(t, ctx, viewConn, wire.Notification{
		JSONRPC: "2.0", Method: wire.MethodViewsMessage,
		Params: wire.Marshal(wire.ViewsMessageParams{Instance: ticket.ID, Payload: payload}),
	})
	received := awaitNotification(t, ctx, runtimeConn, wire.MethodViewsMessage)
	var receivedParams wire.ViewsMessageParams
	if err := wire.Unmarshal(received.Params, &receivedParams); err != nil ||
		receivedParams.Instance != ticket.ID || string(receivedParams.Payload) != string(payload) {
		t.Fatalf("runtime received = %+v", receivedParams)
	}

	// runtime → viewのmessageも届く（対称）。
	reply := json.RawMessage(`{"type":"patch","n":1}`)
	writeRPC(t, ctx, runtimeConn, wire.Notification{
		JSONRPC: "2.0", Method: wire.MethodViewsMessage,
		Params: wire.Marshal(wire.ViewsMessageParams{Instance: ticket.ID, Payload: reply}),
	})
	viewReceived := awaitNotification(t, ctx, viewConn, wire.MethodViewsMessage)
	var viewParams wire.ViewsMessageParams
	if err := wire.Unmarshal(viewReceived.Params, &viewParams); err != nil ||
		string(viewParams.Payload) != string(reply) {
		t.Fatalf("view received = %+v", viewParams)
	}

	// 第三者の接続からのmessageはroutingされない。
	stranger := dialRPC(t, ctx, httpServer, "")
	writeRPC(t, ctx, stranger, wire.Notification{
		JSONRPC: "2.0", Method: wire.MethodViewsMessage,
		Params: wire.Marshal(wire.ViewsMessageParams{Instance: ticket.ID, Payload: json.RawMessage(`{"evil":true}`)}),
	})
	// 悪いmessageが届かないことを、view切断のclosed通知で確認する
	// （strangerのmessageより後に処理されたclosedだけが届くはず）。

	// view切断 → runtimeへclosed。
	_ = viewConn.CloseNow()
	closed := awaitNotification(t, ctx, runtimeConn, wire.MethodViewsEvent)
	var closedParams wire.ViewsEventParams
	if err := wire.Unmarshal(closed.Params, &closedParams); err != nil ||
		closedParams.Type != wire.ViewsEventClosed || closedParams.Instance != ticket.ID {
		t.Fatalf("closed = %+v", closedParams)
	}
}

func TestViewChannelRuntimeDisconnectClosesInstances(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server := New(ctx, "test-core", "", "", t.TempDir())
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	registrationID, runtimeConn := setupViewProvider(t, ctx, httpServer)
	ticket := createViewInstance(t, ctx, httpServer, registrationID, "chat")

	viewConn := dialRPC(t, ctx, httpServer, "")
	writeRPC(t, ctx, viewConn, wire.Request{
		JSONRPC: "2.0", ID: json.RawMessage(`1`), Method: wire.MethodViewsConnect,
		Params: wire.Marshal(wire.ViewsConnectParams{Ticket: ticket.Ticket}),
	})
	if response := readRPC(t, ctx, viewConn); response.Error != nil {
		t.Fatalf("connect failed: %+v", response.Error)
	}
	awaitNotification(t, ctx, runtimeConn, wire.MethodViewsEvent)

	// runtime切断 → viewへclosedが届く。
	_ = runtimeConn.CloseNow()
	closed := awaitNotification(t, ctx, viewConn, wire.MethodViewsEvent)
	var params wire.ViewsEventParams
	if err := wire.Unmarshal(closed.Params, &params); err != nil ||
		params.Type != wire.ViewsEventClosed || params.Instance != ticket.ID {
		t.Fatalf("view closed = %+v", params)
	}
}

func TestViewChannelHostClose(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server := New(ctx, "test-core", "", "", t.TempDir())
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	registrationID, runtimeConn := setupViewProvider(t, ctx, httpServer)
	_ = runtimeConn.CloseNow()
	ticket := createViewInstance(t, ctx, httpServer, registrationID, "chat")

	// hostがDELETE → runtimeへclosed。2回目は404。
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, httpServer.URL+"/v1/views/"+ticket.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := httpServer.Client().Do(req)
	if err != nil || res.StatusCode != 204 {
		t.Fatalf("delete: %v", res)
	}
	res.Body.Close()

	// pendingのまま閉じたのでruntimeへは届かない（まだopenedを送っていない）。
	// 閉じたinstanceのticketでは接続できない。
	viewConn := dialRPC(t, ctx, httpServer, "")
	writeRPC(t, ctx, viewConn, wire.Request{
		JSONRPC: "2.0", ID: json.RawMessage(`1`), Method: wire.MethodViewsConnect,
		Params: wire.Marshal(wire.ViewsConnectParams{Ticket: ticket.Ticket}),
	})
	if response := readRPC(t, ctx, viewConn); response.Error == nil {
		t.Fatal("closed ticket must not connect")
	}

	res2, err := httpServer.Client().Do(req)
	if err != nil || res2.StatusCode != 404 {
		t.Fatalf("second delete: %v", res2)
	}
	if res2 != nil {
		res2.Body.Close()
	}
}

func TestViewChannelRuntimeInitiatedClose(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server := New(ctx, "test-core", "", "", t.TempDir())
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	registrationID, runtimeConn := setupViewProvider(t, ctx, httpServer)
	ticket := createViewInstance(t, ctx, httpServer, registrationID, "chat")

	viewConn := dialRPC(t, ctx, httpServer, "")
	writeRPC(t, ctx, viewConn, wire.Request{
		JSONRPC: "2.0", ID: json.RawMessage(`1`), Method: wire.MethodViewsConnect,
		Params: wire.Marshal(wire.ViewsConnectParams{Ticket: ticket.Ticket}),
	})
	if response := readRPC(t, ctx, viewConn); response.Error != nil {
		t.Fatalf("connect failed: %+v", response.Error)
	}
	awaitNotification(t, ctx, runtimeConn, wire.MethodViewsEvent)

	// runtime主導のclose: views.closeでviewへclosedが届く。
	writeRPC(t, ctx, runtimeConn, wire.Notification{
		JSONRPC: "2.0", Method: wire.MethodViewsClose,
		Params:  wire.Marshal(map[string]string{"instance": ticket.ID}),
	})
	closed := awaitNotification(t, ctx, viewConn, wire.MethodViewsEvent)
	var params wire.ViewsEventParams
	if err := wire.Unmarshal(closed.Params, &params); err != nil ||
		params.Type != wire.ViewsEventClosed || params.Instance != ticket.ID {
		t.Fatalf("view closed = %+v", params)
	}

	// 閉じた後はmessageはroutingされず、instanceもclosed。
	instance, err := server.views.Store().Get(ticket.ID)
	if err != nil || instance.Status != wire.ViewClosed {
		t.Fatalf("instance = %+v, %v", instance, err)
	}
}

func TestViewChannelRejectsInvalidTickets(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server := New(ctx, "test-core", "", "", t.TempDir())
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)

	registrationID, runtimeConn := setupViewProvider(t, ctx, httpServer)
	_ = runtimeConn
	ticket := createViewInstance(t, ctx, httpServer, registrationID, "chat")

	// 未知ticketは拒否。
	viewConn := dialRPC(t, ctx, httpServer, "")
	writeRPC(t, ctx, viewConn, wire.Request{
		JSONRPC: "2.0", ID: json.RawMessage(`1`), Method: wire.MethodViewsConnect,
		Params:  wire.Marshal(wire.ViewsConnectParams{Ticket: "bogus-ticket"}),
	})
	if response := readRPC(t, ctx, viewConn); response.Error == nil {
		t.Fatal("bogus ticket must be rejected")
	}

	// 正しいticketでbindし、同じinstanceへの二重bindは拒否。
	writeRPC(t, ctx, viewConn, wire.Request{
		JSONRPC: "2.0", ID: json.RawMessage(`1`), Method: wire.MethodViewsConnect,
		Params:  wire.Marshal(wire.ViewsConnectParams{Ticket: ticket.Ticket}),
	})
	if response := readRPC(t, ctx, viewConn); response.Error != nil {
		t.Fatalf("valid ticket rejected: %+v", response.Error)
	}
	second := dialRPC(t, ctx, httpServer, "")
	writeRPC(t, ctx, second, wire.Request{
		JSONRPC: "2.0", ID: json.RawMessage(`1`), Method: wire.MethodViewsConnect,
		Params:  wire.Marshal(wire.ViewsConnectParams{Ticket: ticket.Ticket}),
	})
	if response := readRPC(t, ctx, second); response.Error == nil {
		t.Fatal("second bind must be rejected")
	}
}
