package server

import (
	"bufio"
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

func TestPluginInitiatedRegistrationAndRPC(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	server := New(ctx, "test-core", "test-token")
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(func() {
		cancel()
		httpServer.Close()
	})
	request := func(method, path, body string, authorized bool, want int) *http.Response {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, httpServer.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if authorized {
			req.Header.Set("Authorization", "Bearer test-token")
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := httpServer.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = res.Body.Close() })
		if res.StatusCode != want {
			var value json.RawMessage
			_ = json.NewDecoder(res.Body).Decode(&value)
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, res.StatusCode, want, value)
		}
		return res
	}

	const identity = `{"pluginId":"test","pluginInstanceId":"instance-1"}`
	request("POST", "/v1/registrations", identity, false, 401).Body.Close()
	request("POST", "/v1/registrations", `{"pluginId":23}`, true, 400).Body.Close()
	request("POST", "/v1/link/hello", `{}`, true, 404).Body.Close()
	request("GET", "/v2/registry", "", true, 426).Body.Close()
	request("GET", "/docs", "", false, 200).Body.Close()
	request("GET", "/openapi.json", "", false, 200).Body.Close()
	request("GET", "/openapi.yaml", "", false, 200).Body.Close()

	eventStream := request("GET", "/v1/events", "", true, 200)
	if got := eventStream.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("got %q, expected SSE", got)
	}
	scanner := bufio.NewScanner(eventStream.Body)
	event := func(want string) {
		t.Helper()
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "event: ") {
				if want != strings.TrimPrefix(line, "event: ") {
					t.Fatalf("got %s, want event: %s", line, want)
				}
				return
			}
		}
		t.Fatalf("missing event %q: %v", want, scanner.Err())
	}
	event("registry.reset")

	var lease wire.RegistrationLease
	err := json.NewDecoder(request("POST", "/v1/registrations", identity, true, 201).Body).Decode(&lease)
	if err != nil || lease.RegistrationID == "" || lease.CoreID != "test-core" {
		t.Fatalf("unexpected lease: %+v %v", lease, err)
	}
	event("plugin.added")
	var repeated wire.RegistrationLease
	if err := json.NewDecoder(request("POST", "/v1/registrations", identity, true, 200).Body).Decode(&repeated); err != nil || repeated.RegistrationID != lease.RegistrationID {
		t.Fatalf("retry did not return existing registration: %+v %v", repeated, err)
	}
	registrationPath := "/v1/registrations/" + lease.RegistrationID
	request("POST", registrationPath+"/renew", "", true, 200).Body.Close()
	request("PUT", registrationPath+"/tools", `{"tools":[{"toolPath":"echo"},{"toolPath":"echo"}]}`, true, 400).Body.Close()
	const tools = `{"tools":[{"toolPath":"echo"}]}`
	request("PUT", registrationPath+"/tools", tools, true, 204).Body.Close()
	request("PUT", registrationPath+"/tools", tools, true, 204).Body.Close()
	event("tools.changed")

	connect := func(path string) *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+path, &websocket.DialOptions{
			HTTPHeader: http.Header{"Authorization": {"Bearer test-token"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.CloseNow() })
		return conn
	}
	pluginPath := "/v1/rpc?registrationId=" + lease.RegistrationID
	plugin := connect(pluginPath)
	event("plugin.changed")
	caller := connect("/v1/rpc")
	send := func(conn *websocket.Conn, payload any) {
		t.Helper()
		if err := conn.Write(ctx, websocket.MessageText, wire.Marshal(payload)); err != nil {
			t.Fatal(err)
		}
	}
	read := func(conn *websocket.Conn) wire.Incoming {
		t.Helper()
		_, payload, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var result wire.Incoming
		if err := json.Unmarshal(payload, &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	const callerID = `"caller-echo"`
	send(caller, wire.Request{JSONRPC: "2.0", Method: wire.MethodCall, ID: json.RawMessage(callerID), Params: wire.Marshal(wire.CallParams{
		Target: wire.CallTarget{RegistrationID: lease.RegistrationID, ToolPath: "echo"}, Input: json.RawMessage(`"hello"`),
	})})
	forward := read(plugin)
	if forward.Method != wire.MethodCall || string(forward.ID) == callerID {
		t.Fatalf("expected a forwarded request with a different ID, got %+v", forward)
	}
	send(plugin, wire.Response{JSONRPC: "2.0", ID: forward.ID, Result: json.RawMessage(`"hello"`)})
	if result := read(caller); string(result.ID) != callerID || string(result.Result) != `"hello"` {
		t.Fatalf("unexpected forwarded result: %+v", result)
	}

	_ = plugin.CloseNow()
	event("plugin.changed")
	var afterDisconnect wire.RegistrySnapshot
	err = json.NewDecoder(request("GET", "/v1/registry", "", true, 200).Body).Decode(&afterDisconnect)
	if err != nil || len(afterDisconnect.Registrations) != 1 || afterDisconnect.Registrations[0].RPCAvailable ||
		afterDisconnect.Registrations[0].RegistrationID != lease.RegistrationID || len(afterDisconnect.Registrations[0].Tools) != 1 {
		t.Fatalf("WS disconnect should preserve the registration and tools: %+v %v", afterDisconnect, err)
	}
	_ = connect(pluginPath)
	event("plugin.changed")
	request("DELETE", registrationPath, "", true, 204).Body.Close()
	event("plugin.removed")
	request("POST", registrationPath+"/renew", "", true, 404).Body.Close()

	eventStream.Body.Close()
	reconnect, err := http.NewRequestWithContext(ctx, http.MethodGet, httpServer.URL+"/v1/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	reconnect.Header.Set("Authorization", "Bearer test-token")
	reconnect.Header.Set("Last-Event-ID", afterDisconnect.Revision)
	reconnected, err := httpServer.Client().Do(reconnect)
	if err != nil {
		t.Fatal(err)
	}
	defer reconnected.Body.Close()
	scanner = bufio.NewScanner(reconnected.Body)
	event("registry.reset")
}

func TestOpenAPIDescribesOnlyNativeREST(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handler := New(ctx, "test-core", "").Handler()
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/openapi.json", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var api struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
		} `json:"paths"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &api) != nil {
		t.Fatalf("OpenAPI is not available: %d %s", response.Code, response.Body)
	}
	if len(api.Paths) != 5 || api.Paths["/v1/registrations"]["post"].OperationID != "createRegistration" {
		t.Fatalf("unexpected REST operations: %+v", api.Paths)
	}
}
