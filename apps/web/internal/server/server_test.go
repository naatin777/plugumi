package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/coder/websocket"
	"time"

	"github.com/naatin777/plugumi/apps/web/internal/corerest"
	"github.com/naatin777/plugumi/apps/web/internal/cores"
)

// fakeCore はGET /v1/coreと登録だけを持つ偽のCore。
func fakeCore(t *testing.T, name string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/core", func(w http.ResponseWriter, _ *http.Request) {
		body := map[string]string{"coreId": "fake-" + name}
		if name != "" {
			body["name"] = name
		}
		_ = json.NewEncoder(w).Encode(body)
	})
	mux.HandleFunc("POST /v1/registrations", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"registrationId": "reg-1", "coreId": "fake-" + name, "leaseSeconds": 60,
			"expiresAt": time.Now().Add(time.Minute),
		})
	})
	mux.HandleFunc("DELETE /v1/registrations/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

type fixture struct {
	handler http.Handler
	manager *cores.Manager
	store   *cores.Store
}

func newFixture(t *testing.T, static fs.FS) *fixture {
	t.Helper()
	manager := cores.NewManager("plugin-test", "")
	t.Cleanup(manager.Close)
	store := cores.NewStore(filepath.Join(t.TempDir(), "web.json"))
	server := New(manager, store, "", static, t.TempDir())
	return &fixture{handler: server.Handler(), manager: manager, store: store}
}

func do(t *testing.T, handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	return response
}

func TestAddCoreErrors(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	for _, test := range []struct {
		name       string
		target     func() *httptest.Server
		body       func() string
		wantStatus int
	}{
		{
			name: "unreachable",
			body: func() string {
				dead := httptest.NewServer(http.NotFoundHandler())
				url := dead.URL
				dead.Close()
				return `{"url":"` + url + `"}`
			},
			wantStatus: http.StatusBadGateway,
		},
		{
			name:       "no core name",
			target:     func() *httptest.Server { return fakeCore(t, "") },
			body:       func() string { return "" },
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "reserved core name",
			target:     func() *httptest.Server { return fakeCore(t, "api") },
			body:       func() string { return "" },
			wantStatus: http.StatusBadRequest,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var targetURL string
			if test.target != nil {
				targetURL = test.target().URL
			}
			body := test.body()
			if body == "" {
				body = `{"url":"` + targetURL + `"}`
			}
			response := do(t, fixture.handler, http.MethodPost, "/api/cores", body)
			if response.Code != test.wantStatus {
				t.Fatalf("got %d, want %d: %s", response.Code, test.wantStatus, response.Body)
			}
		})
	}
}

func TestAddCoreConflictsAndSuccess(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	named := fakeCore(t, "local")
	duplicateName := fakeCore(t, "local")
	add := func(url string) *httptest.ResponseRecorder {
		return do(t, fixture.handler, http.MethodPost, "/api/cores", `{"url":"`+url+`"}`)
	}
	if response := add(named.URL); response.Code != http.StatusCreated {
		t.Fatalf("add: got %d: %s", response.Code, response.Body)
	}
	// 同じURLの再登録は409。
	if response := add(named.URL); response.Code != http.StatusConflict {
		t.Fatalf("same URL: got %d: %s", response.Code, response.Body)
	}
	// 別URLで同じcore.nameは409。
	if response := add(duplicateName.URL); response.Code != http.StatusConflict {
		t.Fatalf("same name: got %d: %s", response.Code, response.Body)
	}
	// 保存先に記録される。
	saved, err := fixture.store.Load()
	if err != nil || len(saved) != 1 || saved[0] != named.URL {
		t.Fatalf("saved = %v, %v", saved, err)
	}
}

func TestDeleteCore(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	commandCore := fakeCore(t, "fixed")
	if err := fixture.manager.Add(commandCore.URL, cores.SourceCommand); err != nil {
		t.Fatal(err)
	}
	savedCore := fakeCore(t, "saved")
	response := do(t, fixture.handler, http.MethodPost, "/api/cores", `{"url":"`+savedCore.URL+`"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", response.Code, response.Body)
	}
	// command由来は削除できない。
	response = do(t, fixture.handler, http.MethodDelete, "/api/cores?url="+commandCore.URL, "")
	if response.Code != http.StatusBadRequest {
		t.Fatalf("command delete: got %d", response.Code)
	}
	response = do(t, fixture.handler, http.MethodDelete, "/api/cores?url="+savedCore.URL, "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("saved delete: got %d", response.Code)
	}
	if _, found := fixture.manager.Get(savedCore.URL); found {
		t.Fatal("deleted Core is still tracked")
	}
	response = do(t, fixture.handler, http.MethodDelete, "/api/cores?url="+savedCore.URL, "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("unknown delete: got %d", response.Code)
	}
}

func TestListAndGetCore(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	core := fakeCore(t, "local")
	if response := do(t, fixture.handler, http.MethodPost, "/api/cores", `{"url":"`+core.URL+`"}`); response.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", response.Code, response.Body)
	}
	response := do(t, fixture.handler, http.MethodGet, "/api/cores/local", "")
	if response.Code != http.StatusOK {
		t.Fatalf("get by key: %d", response.Code)
	}
	var entry cores.Core
	if err := json.Unmarshal(response.Body.Bytes(), &entry); err != nil || entry.Key != "local" || entry.URL != core.URL {
		t.Fatalf("unexpected entry: %+v %v", entry, err)
	}
	if response := do(t, fixture.handler, http.MethodGet, "/api/cores/missing", ""); response.Code != http.StatusNotFound {
		t.Fatalf("unknown key: %d", response.Code)
	}
}

func TestStaticAndUnbuilt(t *testing.T) {
	// index.htmlなしのdistは未ビルド案内を返す。
	fixture := newFixture(t, fstest.MapFS{".gitkeep": {Data: nil}})
	response := do(t, fixture.handler, http.MethodGet, "/", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "未ビルド") {
		t.Fatalf("unbuilt /: %d %q", response.Code, response.Body)
	}
	built := newFixture(t, fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/app.js": {Data: []byte("console.log(1)")},
	})
	if response := do(t, built.handler, http.MethodGet, "/", ""); !strings.Contains(response.Body.String(), "<html>app</html>") {
		t.Fatalf("/ did not serve index.html: %q", response.Body)
	}
	// SPAフォールバック: 未知のパスもindex.htmlを返す。
	if response := do(t, built.handler, http.MethodGet, "/some/route", ""); !strings.Contains(response.Body.String(), "<html>app</html>") {
		t.Fatalf("SPA fallback failed: %q", response.Body)
	}
	response = do(t, built.handler, http.MethodGet, "/assets/app.js", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("static asset: %d %v", response.Code, response.Header())
	}
	// 拡張子付きで存在しないパスは404（index.htmlを返さない）。
	for _, missing := range []string{"/assets/missing.js", "/favicon.ico"} {
		if response := do(t, built.handler, http.MethodGet, missing, ""); response.Code != http.StatusNotFound {
			t.Fatalf("%s: got %d, want 404", missing, response.Code)
		}
	}
	// 拡張子なしのパスはindex.htmlにフォールバックする。
	for _, spa := range []string{"/local/", "/local/xxx", "/settings"} {
		if response := do(t, built.handler, http.MethodGet, spa, ""); !strings.Contains(response.Body.String(), "<html>app</html>") {
			t.Fatalf("%s: SPA fallback failed: %d %q", spa, response.Code, response.Body)
		}
	}
	// 未定義の/api配下はJSONの404。
	response = do(t, built.handler, http.MethodGet, "/api/unknown", "")
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"error"`) {
		t.Fatalf("/api/unknown: %d %q", response.Code, response.Body)
	}
	// HEADも標準の配信に任せる。
	response = do(t, built.handler, http.MethodHead, "/assets/app.js", "")
	if response.Code != http.StatusOK {
		t.Fatalf("HEAD /assets/app.js: %d", response.Code)
	}
}

// fakeUICore はregistry・UI配信・WS RPCまで持つ偽のCore。
func fakeUICore(t *testing.T, name string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/core", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"coreId": "fake-ui", "name": name})
	})
	mux.HandleFunc("POST /v1/registrations", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"registrationId": "reg-1", "coreId": "fake-ui", "leaseSeconds": 60,
			"expiresAt": time.Now().Add(time.Minute),
		})
	})
	mux.HandleFunc("GET /v1/registry", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"coreId": "fake-ui", "revision": "r1",
			"registrations": []map[string]any{
				{"registrationId": "reg-1", "pluginId": "standard", "rpcAvailable": true, "uiSha256": "deadbeef",
					"tools":  []map[string]string{{"toolPath": "fs/list", "kind": "sync"}, {"toolPath": "exec", "kind": "async"}},
					"panels": []map[string]any{{"panelId": "files", "title": "Files", "entry": "panel.js", "styles": []string{"panel.css"}}}},
				{"registrationId": "reg-2", "pluginId": "other", "rpcAvailable": false, "tools": []map[string]string{}},
			},
		})
	})
	mux.HandleFunc("GET /v1/ui/{registrationId}/{path...}", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("registrationId") != "reg-1" || r.PathValue("path") != "panel.js" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("ETag", `"abc123"`)
		_, _ = w.Write([]byte("export function mount() {}"))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func addUIKeyCore(t *testing.T, fixture *fixture, name string) *httptest.Server {
	t.Helper()
	core := fakeUICore(t, name)
	response := do(t, fixture.handler, http.MethodPost, "/api/cores", `{"url":"`+core.URL+`"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", response.Code, response.Body)
	}
	return core
}

func TestListPanels(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	addUIKeyCore(t, fixture, "uicore")
	response := do(t, fixture.handler, http.MethodGet, "/api/cores/uicore/panels", "")
	if response.Code != http.StatusOK {
		t.Fatalf("panels: %d %s", response.Code, response.Body)
	}
	var panels []struct {
		RegistrationID string   `json:"registrationId"`
		PluginID       string   `json:"pluginId"`
		PanelID        string   `json:"panelId"`
		Title          string   `json:"title"`
		Entry          string   `json:"entry"`
		Styles         []string `json:"styles"`
		UISHA256       string   `json:"uiSha256"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &panels); err != nil {
		t.Fatal(err)
	}
	if len(panels) != 1 || panels[0].PanelID != "files" || panels[0].PluginID != "standard" ||
		panels[0].RegistrationID != "reg-1" || panels[0].Entry != "panel.js" || panels[0].Title != "Files" ||
		panels[0].UISHA256 != "deadbeef" || len(panels[0].Styles) != 1 || panels[0].Styles[0] != "panel.css" {
		t.Fatalf("unexpected panels: %+v", panels)
	}
	if response := do(t, fixture.handler, http.MethodGet, "/api/cores/nope/panels", ""); response.Code != http.StatusNotFound {
		t.Fatalf("unknown core: %d", response.Code)
	}
}

func TestUIAssetProxy(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	addUIKeyCore(t, fixture, "uicore")
	response := do(t, fixture.handler, http.MethodGet, "/ui/uicore/reg-1/panel.js", "")
	if response.Code != http.StatusOK {
		t.Fatalf("ui proxy: %d %s", response.Code, response.Body)
	}
	if ct := response.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Fatalf("content-type = %q", ct)
	}
	if etag := response.Header().Get("ETag"); etag != `"abc123"` {
		t.Fatalf("etag = %q", etag)
	}
	if body := response.Body.String(); body != "export function mount() {}" {
		t.Fatalf("body = %q", body)
	}
	if response := do(t, fixture.handler, http.MethodGet, "/ui/uicore/reg-1/missing.js", ""); response.Code != http.StatusNotFound {
		t.Fatalf("upstream 404: %d", response.Code)
	}
	if response := do(t, fixture.handler, http.MethodGet, "/ui/nope/reg-1/panel.js", ""); response.Code != http.StatusNotFound {
		t.Fatalf("unknown core: %d", response.Code)
	}
}

// fakeRPCCore はGET /v1/rpcのupgradeを受けてtools.callに応答する偽のCore。
// respondはリクエストparamsを見てresult/errorを返す。
func fakeRPCCore(t *testing.T, respond func(params json.RawMessage) (any, any)) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/core", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"coreId": "fake-rpc", "name": "rpccore"})
	})
	mux.HandleFunc("POST /v1/registrations", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"registrationId": "reg-1", "coreId": "fake-rpc", "leaseSeconds": 60,
			"expiresAt": time.Now().Add(time.Minute),
		})
	})
	mux.HandleFunc("GET /v1/registry", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"coreId": "fake-rpc", "revision": "r1",
			"registrations": []map[string]any{
				{"registrationId": "reg-1", "pluginId": "standard", "rpcAvailable": true,
					"tools": []map[string]string{{"toolPath": "fs/list", "kind": "sync"}, {"toolPath": "exec", "kind": "async"}}},
			},
		})
	})
	mux.HandleFunc("GET /v1/rpc", func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		for {
			_, data, err := socket.Read(r.Context())
			if err != nil {
				return
			}
			var request struct {
				ID     json.RawMessage `json:"id"`
				Params json.RawMessage `json:"params"`
			}
			if json.Unmarshal(data, &request) != nil || len(request.ID) == 0 {
				continue
			}
			result, rpcErr := respond(request.Params)
			response, _ := json.Marshal(map[string]any{
				"jsonrpc": "2.0", "id": request.ID, "result": result, "error": rpcErr,
			})
			if err := socket.Write(r.Context(), websocket.MessageText, response); err != nil {
				return
			}
		}
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func TestCallTool(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	core := fakeRPCCore(t, func(params json.RawMessage) (any, any) {
		var decoded struct {
			Target struct {
				RegistrationID string `json:"registrationId"`
				ToolPath       string `json:"toolPath"`
			} `json:"target"`
			Input json.RawMessage `json:"input"`
		}
		if err := json.Unmarshal(params, &decoded); err != nil {
			return nil, map[string]any{"code": -32602, "message": "bad params"}
		}
		if decoded.Target.ToolPath == "fs/list" {
			return map[string]any{"entries": []string{"a.txt"}}, nil
		}
		return nil, map[string]any{"code": -32000, "message": "unknown toolPath: " + decoded.Target.ToolPath}
	})
	response := do(t, fixture.handler, http.MethodPost, "/api/cores", `{"url":"`+core.URL+`"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", response.Code, response.Body)
	}
	call := func(body string) *httptest.ResponseRecorder {
		return do(t, fixture.handler, http.MethodPost, "/api/cores/rpccore/call", body)
	}
	// sync Toolの成功。
	response = call(`{"registrationId":"reg-1","toolPath":"fs/list","input":{"path":"."}}`)
	if response.Code != http.StatusOK {
		t.Fatalf("call: %d %s", response.Code, response.Body)
	}
	var result struct {
		Result struct {
			Entries []string `json:"entries"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || len(result.Result.Entries) != 1 {
		t.Fatalf("unexpected result: %s", response.Body)
	}
	// JSON-RPC errorは502で{error:{message,code}}。
	response = call(`{"registrationId":"reg-1","toolPath":"missing","input":{}}`)
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "unknown toolPath") {
		t.Fatalf("rpc error: %d %s", response.Code, response.Body)
	}
	// async Toolは事前に400。
	response = call(`{"registrationId":"reg-1","toolPath":"exec","input":{}}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("async call: %d %s", response.Code, response.Body)
	}
}

func TestProjectAPIs(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	addUIKeyCore(t, fixture, "uicore")
	base := "/api/cores/uicore"

	// 一覧は空配列（nullでない）。
	response := do(t, fixture.handler, http.MethodGet, base+"/projects", "")
	if response.Code != http.StatusOK || response.Body.String() != "[]\n" && !strings.Contains(response.Body.String(), "[]") {
		t.Fatalf("empty list: %d %s", response.Code, response.Body)
	}
	// titleをPOSTするとkeyが発行される。titleは識別子ではなく重複してもよい。
	response = do(t, fixture.handler, http.MethodPost, base+"/projects", `{"title":"plugumi"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", response.Code, response.Body)
	}
	project := responseKey(t, response)
	if response := do(t, fixture.handler, http.MethodPost, base+"/projects", `{"title":"plugumi"}`); response.Code != http.StatusCreated {
		t.Fatalf("duplicate title: %d", response.Code)
	}
	if response := do(t, fixture.handler, http.MethodPost, base+"/projects", `{"title":""}`); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid: %d", response.Code)
	}
	// 直下と子Area。URLには発行されたkeyを使う。
	response = do(t, fixture.handler, http.MethodPost, base+"/projects/"+project+"/areas", `{"parent":[],"title":"main"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("area: %d %s", response.Code, response.Body)
	}
	main := responseKey(t, response)
	response = do(t, fixture.handler, http.MethodPost, base+"/projects/"+project+"/areas", `{"parent":["`+main+`"],"title":"feature-a"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("child area: %d", response.Code)
	}
	feature := responseKey(t, response)
	if response := do(t, fixture.handler, http.MethodPost, base+"/projects/"+project+"/areas", `{"parent":["nope"],"title":"x"}`); response.Code != http.StatusNotFound {
		t.Fatalf("missing parent: %d", response.Code)
	}
	// workspaceのPUT/GET。
	docks := `{"version":1,"center":{"root":{"kind":"leaf","id":"leaf-a","panels":[{"instanceId":"panel-a1","pluginId":"standard","panelId":"files"}],"selected":"panel-a1"}}}`
	if response := do(t, fixture.handler, http.MethodPut, base+"/projects/"+project+"/areas/"+main+"/"+feature+"/workspace", docks); response.Code != http.StatusNoContent {
		t.Fatalf("put workspace: %d %s", response.Code, response.Body)
	}
	response = do(t, fixture.handler, http.MethodGet, base+"/projects/"+project+"/areas/"+main+"/"+feature+"/workspace", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "panel-a1") {
		t.Fatalf("get workspace: %d %s", response.Code, response.Body)
	}
	// objectでもnullでもないJSONは400。中身はserverが解釈しない。
	if response := do(t, fixture.handler, http.MethodPut, base+"/projects/"+project+"/areas/"+main+"/workspace", `[1,2]`); response.Code != http.StatusBadRequest {
		t.Fatalf("array body: %d", response.Code)
	}
	if response := do(t, fixture.handler, http.MethodPut, base+"/projects/"+project+"/areas/"+main+"/workspace", `"x"`); response.Code != http.StatusBadRequest {
		t.Fatalf("string body: %d", response.Code)
	}
	// nullは消去として受け付ける。
	if response := do(t, fixture.handler, http.MethodPut, base+"/projects/"+project+"/areas/"+main+"/"+feature+"/workspace", `null`); response.Code != http.StatusNoContent {
		t.Fatalf("null body: %d", response.Code)
	}
	// Area削除は子ごと。workspaceも一緒に消える。
	if response := do(t, fixture.handler, http.MethodDelete, base+"/projects/"+project+"/areas/"+main, ""); response.Code != http.StatusNoContent {
		t.Fatalf("delete area: %d", response.Code)
	}
	response = do(t, fixture.handler, http.MethodGet, base+"/projects", "")
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), `"feature-a"`) ||
		strings.Contains(response.Body.String(), `"title":"main"`) {
		t.Fatalf("tree after delete: %s", response.Body)
	}
}

// responseKey は201応答から発行されたkeyを取り出す。
func responseKey(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Key == "" {
		t.Fatalf("no key in response: %s", response.Body)
	}
	return body.Key
}

func TestProjectAPIsRequireCoreName(t *testing.T) {
	fixture := newFixture(t, fstest.MapFS{"index.html": {Data: []byte("ok")}})
	// core.nameの無いCore（command由来）はkey=coreId。保存先が決められないので409。
	nameless := fakeCore(t, "")
	fixture.manager.Add(nameless.URL, cores.SourceCommand)
	fixture.manager.SetInfo(nameless.URL, corerest.CoreInfo{CoreID: "fake-"})
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		response := do(t, fixture.handler, method, "/api/cores/fake-/projects", `{"title":"x"}`)
		if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "core.name") {
			t.Fatalf("%s nameless core: %d %s", method, response.Code, response.Body)
		}
	}
}
