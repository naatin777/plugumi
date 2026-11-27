package server

import (
	"bufio"
	"encoding/base64"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/wire"
)

func TestPluginInitiatedRegistrationAndRPC(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	server := New(ctx, "test-core", "", "test-token", t.TempDir())
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

	const identity = `{"providerId":"test","instanceId":"instance-1"}`
	request("POST", "/v1/registrations", identity, false, 401).Body.Close()
	request("POST", "/v1/registrations", `{"providerId":23}`, true, 400).Body.Close()
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
	event("provider.added")
	var repeated wire.RegistrationLease
	if err := json.NewDecoder(request("POST", "/v1/registrations", identity, true, 200).Body).Decode(&repeated); err != nil || repeated.RegistrationID != lease.RegistrationID {
		t.Fatalf("retry did not return existing registration: %+v %v", repeated, err)
	}
	registrationPath := "/v1/registrations/" + lease.RegistrationID
	request("POST", registrationPath+"/renew", "", true, 200).Body.Close()
	request("PUT", registrationPath+"/operations", `{"operations":[{"path":"echo"},{"path":"echo"}]}`, true, 400).Body.Close()
	const operations = `{"operations":[{"path":"echo"}]}`
	request("PUT", registrationPath+"/operations", operations, true, 204).Body.Close()
	request("PUT", registrationPath+"/operations", operations, true, 204).Body.Close()
	event("operations.changed")

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
	event("provider.changed")
	request("POST", registrationPath+"/ready", "", true, 204).Body.Close()
	event("provider.changed")
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
	send(caller, wire.Request{JSONRPC: "2.0", Method: wire.MethodOperationsInvoke, ID: json.RawMessage(callerID), Params: wire.Marshal(wire.InvokeParams{
		Operation: "echo", Input: json.RawMessage(`"hello"`),
	})})
	forward := read(plugin)
	if forward.Method != wire.MethodOperationsInvoke || string(forward.ID) == callerID {
		t.Fatalf("expected a forwarded request with a different ID, got %+v", forward)
	}
	var forwardParams wire.ForwardInvokeParams
	if err := wire.Unmarshal(forward.Params, &forwardParams); err != nil {
		t.Fatalf("forward params: %v", err)
	}
	if forwardParams.ExecutionID == "" || forwardParams.Operation != "echo" || string(forwardParams.Input) != `"hello"` {
		t.Fatalf("unexpected forward params: %+v", forwardParams)
	}
	// providerはterminal応答を返し、callerはsucceededのExecutionを受け取る
	send(plugin, wire.Response{JSONRPC: "2.0", ID: forward.ID, Result: wire.Marshal(wire.ProviderInvokeResult{
		Status: wire.ExecutionSucceeded,
		Result: json.RawMessage(`"hello"`),
	})})
	result := read(caller)
	if string(result.ID) != callerID {
		t.Fatalf("unexpected response id: %+v", result)
	}
	var invokeResult wire.InvokeResult
	if err := wire.Unmarshal(result.Result, &invokeResult); err != nil || invokeResult.Execution == nil {
		t.Fatalf("unexpected invoke result: %s", result.Result)
	}
	exec := invokeResult.Execution
	if exec.Status != wire.ExecutionSucceeded || string(exec.Result) != `"hello"` || exec.ID != forwardParams.ExecutionID || exec.Operation != "echo" {
		t.Fatalf("unexpected execution: %+v", exec)
	}

	_ = plugin.CloseNow()
	event("provider.changed")
	var afterDisconnect wire.RegistrySnapshot
	err = json.NewDecoder(request("GET", "/v1/registry", "", true, 200).Body).Decode(&afterDisconnect)
	if err != nil || len(afterDisconnect.Registrations) != 1 || afterDisconnect.Registrations[0].RPCAvailable ||
		afterDisconnect.Registrations[0].RegistrationID != lease.RegistrationID || len(afterDisconnect.Registrations[0].Operations) != 1 {
		t.Fatalf("WS disconnect should preserve the registration and operations: %+v %v", afterDisconnect, err)
	}
	_ = connect(pluginPath)
	event("provider.changed")
	request("DELETE", registrationPath, "", true, 204).Body.Close()
	event("provider.removed")
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
	handler := New(ctx, "test-core", "test-name", "", "").Handler()
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
	if len(api.Paths) != 8 || api.Paths["/v1/registrations"]["post"].OperationID != "createRegistration" ||
		api.Paths["/v1/core"]["get"].OperationID != "getCore" ||
		api.Paths["/v1/registrations/{registrationId}/ui"]["put"].OperationID != "replaceUIManifest" ||
		api.Paths["/v1/registrations/{registrationId}/ready"]["post"].OperationID != "markRegistrationReady" {
		t.Fatalf("unexpected REST operations: %+v", api.Paths)
	}
}

func TestCoreInfo(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, test := range []struct {
		name     string
		coreName string
		wantBody string
	}{
		{"named", "test-name", `{"coreId":"test-core","name":"test-name"}`},
		{"unnamed", "", `{"coreId":"test-core"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(New(ctx, "test-core", test.coreName, "test-token", "").Handler())
			t.Cleanup(server.Close)
			get := func(authorized bool) *http.Response {
				t.Helper()
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/v1/core", nil)
				if err != nil {
					t.Fatal(err)
				}
				if authorized {
					req.Header.Set("Authorization", "Bearer test-token")
				}
				res, err := server.Client().Do(req)
				if err != nil {
					t.Fatal(err)
				}
				return res
			}
			if res := get(false); res.StatusCode != http.StatusUnauthorized {
				res.Body.Close()
				t.Fatalf("unauthenticated GET /v1/core returned %d", res.StatusCode)
			}
			res := get(true)
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				t.Fatalf("GET /v1/core returned %d", res.StatusCode)
			}
			var info wire.CoreInfo
			if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
				t.Fatal(err)
			}
			var want wire.CoreInfo
			if err := json.Unmarshal([]byte(test.wantBody), &want); err != nil {
				t.Fatal(err)
			}
			if info != want {
				t.Fatalf("got %+v, want %+v", info, want)
			}
		})
	}
}

func TestUIAssets(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	server := New(ctx, "test-core", "", "test-token", t.TempDir())
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(func() {
		cancel()
		httpServer.Close()
	})
	const token = "Bearer test-token"
	request := func(method, path string, body any, want int) *http.Response {
		t.Helper()
		var reader io.Reader
		var contentType string
		switch value := body.(type) {
		case []byte:
			reader = bytes.NewReader(value)
			contentType = "application/octet-stream"
		case string:
			if value != "" {
				reader = strings.NewReader(value)
				contentType = "application/json"
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, httpServer.URL+path, reader)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", token)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		res, err := httpServer.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = res.Body.Close() })
		if res.StatusCode != want {
			var raw json.RawMessage
			_ = json.NewDecoder(res.Body).Decode(&raw)
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, res.StatusCode, want, raw)
		}
		return res
	}
	sha := func(data []byte) string {
		sum := sha256.Sum256(data)
		return hex.EncodeToString(sum[:])
	}
	panelJS := []byte("export function mount() {}")
	panelHash := sha(panelJS)
	extra := []byte("body { color: red; }")
	extraHash := sha(extra)

	// pull modelではupload APIは存在しない
	request("PUT", "/v1/assets/"+panelHash, panelJS, 404)
	request("POST", "/v1/assets/missing", `{}`, 404)

	// 登録してmanifest検証。
	res := request("POST", "/v1/registrations", `{"providerId":"standard","instanceId":"i-1"}`, 201)
	var lease wire.RegistrationLease
	if err := json.NewDecoder(res.Body).Decode(&lease); err != nil {
		t.Fatal(err)
	}
	uiPath := "/v1/registrations/" + lease.RegistrationID + "/ui"
	manifest := func(files, panels string) string {
		return `{"files":[` + files + `],"panels":[` + panels + `]}`
	}
	file := `{"path":"panel.js","sha256":"` + panelHash + `"}`
	cssFile := `{"path":"style.css","sha256":"` + extraHash + `"}`
	panel := `{"panelId":"files","title":"Files","entry":"panel.js"}`

	// pull modelでは宣言時に内容の存在を要求しない。未知のhashでも宣言は受理される。
	request("PUT", uiPath, manifest(`{"path":"x.js","sha256":"`+sha([]byte("absent"))+`"}`, ""), 204)
	// パス検証テーブル。
	for _, bad := range []struct {
		name string
		path string
	}{
		{"empty", ""}, {"absolute", "/panel.js"}, {"dotdot", "../x.js"}, {"dot", "./x.js"},
		{"double slash", "a//b.js"}, {"trailing slash", "a/"}, {"backslash", `a\b.js`},
		{"colon", "a:b.js"}, {"percent", "a%b.js"},
	} {
		t.Run("path/"+bad.name, func(t *testing.T) {
			badFile := `{"path":` + strconv.Quote(bad.path) + `,"sha256":"` + panelHash + `"}`
			request("PUT", uiPath, manifest(badFile, ""), 400)
		})
	}
	// files内重複、panelId検証、entry不在。
	dup := file + `,` + file
	request("PUT", uiPath, manifest(dup, ""), 400)
	request("PUT", uiPath, manifest(file, panel+`,`+panel), 400)
	request("PUT", uiPath, manifest(file, `{"panelId":"Bad","title":"x","entry":"panel.js"}`), 400)
	request("PUT", uiPath, manifest(file, `{"panelId":"files","title":"","entry":"panel.js"}`), 400)
	request("PUT", uiPath, manifest(file, `{"panelId":"files","title":"x","entry":"missing.js"}`), 400)
	// stylesはfiles内のパスのみ・重複なし。
	styledPanel := `{"panelId":"files","title":"Files","entry":"panel.js","styles":["style.css"]}`
	request("PUT", uiPath, manifest(file, `{"panelId":"files","title":"x","entry":"panel.js","styles":["missing.css"]}`), 400)
	request("PUT", uiPath, manifest(file+`,`+cssFile, `{"panelId":"files","title":"x","entry":"panel.js","styles":["style.css","style.css"]}`), 400)

	request("PUT", uiPath, manifest(file+`,`+cssFile, panel), 204)
	// 同じ内容の再送は204。
	request("PUT", uiPath, manifest(file+`,`+cssFile, panel), 204)

	// Snapshotにpanelsが出る。
	res = request("GET", "/v1/registry", "", 200)
	var snapshot wire.RegistrySnapshot
	if err := json.NewDecoder(res.Body).Decode(&snapshot); err != nil ||
		len(snapshot.Registrations) != 1 || len(snapshot.Registrations[0].Panels) != 1 ||
		snapshot.Registrations[0].Panels[0].PanelID != "files" ||
		len(snapshot.Registrations[0].UISHA256) != 64 {
		t.Fatalf("snapshot = %+v, %v", snapshot, err)
	}
	uiSHA := snapshot.Registrations[0].UISHA256

	// styles付きに置き換えるとuiSha256が変わる。
	request("PUT", uiPath, manifest(file+`,`+cssFile, styledPanel), 204)
	res = request("GET", "/v1/registry", "", 200)
	var styled wire.RegistrySnapshot
	if err := json.NewDecoder(res.Body).Decode(&styled); err != nil ||
		styled.Registrations[0].UISHA256 == uiSHA ||
		len(styled.Registrations[0].Panels[0].Styles) != 1 ||
		styled.Registrations[0].Panels[0].Styles[0] != "style.css" {
		t.Fatalf("snapshot = %+v, %v", styled, err)
	}
	// filesの順序を変えてもuiSha256は変わらない（path順に正規化するため）。
	request("PUT", uiPath, manifest(cssFile+`,`+file, styledPanel), 204)
	res = request("GET", "/v1/registry", "", 200)
	var reordered wire.RegistrySnapshot
	if err := json.NewDecoder(res.Body).Decode(&reordered); err != nil ||
		reordered.Registrations[0].UISHA256 != styled.Registrations[0].UISHA256 {
		t.Fatalf("reordered uiSha256 = %+v", reordered.Registrations[0].UISHA256)
	}
	request("PUT", uiPath, manifest(cssFile+`,`+file, styledPanel), 204)

	// provider未接続のうちはfetchできず503。
	base := "/v1/ui/" + lease.RegistrationID + "/"
	request("GET", base+"panel.js", nil, 503)

	// WSで接続し、assets.getに応答するproviderを演じる。
	pluginConn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/v1/rpc?registrationId="+lease.RegistrationID, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer test-token"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer pluginConn.CloseNow()
	contents := map[string][]byte{"panel.js": panelJS, "style.css": extra}
	go func() {
		for {
			_, payload, err := pluginConn.Read(ctx)
			if err != nil {
				return
			}
			var message wire.Incoming
			if json.Unmarshal(payload, &message) != nil || !message.IsRequest() || message.Method != wire.MethodAssetsGet {
				continue
			}
			var params wire.AssetsGetParams
			if wire.Unmarshal(message.Params, &params) != nil {
				continue
			}
			content, ok := contents[params.Path]
			if !ok {
				_ = pluginConn.Write(ctx, websocket.MessageText, wire.Marshal(wire.Response{
					JSONRPC: "2.0", ID: message.ID,
					Error: &wire.RPCError{Code: -32602, Message: "no such file"},
				}))
				continue
			}
			_ = pluginConn.Write(ctx, websocket.MessageText, wire.Marshal(wire.Response{
				JSONRPC: "2.0", ID: message.ID,
				Result: wire.Marshal(wire.AssetsGetResult{Content: base64.StdEncoding.EncodeToString(content)}),
			}))
		}
	}()

	// ファイル配信: 内容・Content-Type・ETag。fetchを経てcacheから返る。
	res = request("GET", base+"panel.js", nil, 200)
	content, _ := io.ReadAll(res.Body)
	if string(content) != string(panelJS) || !strings.Contains(res.Header.Get("Content-Type"), "javascript") ||
		res.Header.Get("ETag") != `"`+panelHash+`"` {
		t.Fatalf("asset = %q, %v", content, res.Header)
	}
	res = request("GET", base+"style.css", nil, 200)
	if ct := res.Header.Get("Content-Type"); ct != "text/css; charset=utf-8" {
		t.Fatalf("css content-type = %q", ct)
	}
	request("GET", base+"missing.js", nil, 404)
	request("GET", "/v1/ui/unknown-registration/panel.js", nil, 404)

	// provider切断後もcacheに入ったファイルは配信できる（pull modelの要）。
	_ = pluginConn.CloseNow()
	res = request("GET", base+"panel.js", nil, 200)
	content, _ = io.ReadAll(res.Body)
	if string(content) != string(panelJS) {
		t.Fatalf("cached asset = %q", content)
	}

	// 登録削除後は参照が消えて配信できない。
	request("DELETE", "/v1/registrations/"+lease.RegistrationID, "", 204)
	request("GET", base+"panel.js", nil, 404)
}
