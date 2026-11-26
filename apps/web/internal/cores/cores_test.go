package cores

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// fakeCore は登録・renew・GET /v1/coreだけを持つ偽のCore。
func fakeCore(t *testing.T, name, token string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/registrations", func(w http.ResponseWriter, r *http.Request) {
		if token != "" && r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"registrationId": "reg-1", "coreId": "fake-core", "leaseSeconds": 60,
			"expiresAt": time.Now().Add(time.Minute),
		})
	})
	mux.HandleFunc("POST /v1/registrations/{id}/renew", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"registrationId": "reg-1", "coreId": "fake-core", "leaseSeconds": 60,
			"expiresAt": time.Now().Add(time.Minute),
		})
	})
	mux.HandleFunc("DELETE /v1/registrations/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /v1/core", func(w http.ResponseWriter, r *http.Request) {
		if token != "" && r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		body := map[string]string{"coreId": "fake-core"}
		if name != "" {
			body["name"] = name
		}
		_ = json.NewEncoder(w).Encode(body)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func waitForStatus(t *testing.T, m *Manager, coreURL string, want Status) Core {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		core, found := m.Get(coreURL)
		if found && core.Status == want {
			return core
		}
		time.Sleep(10 * time.Millisecond)
	}
	core, _ := m.Get(coreURL)
	t.Fatalf("status = %q (%q), want %q", core.Status, core.Error, want)
	return Core{}
}

func TestManagerConnectsAndReadsCoreInfo(t *testing.T) {
	core := fakeCore(t, "local", "")
	manager := NewManager("plugin-test", "")
	t.Cleanup(manager.Close)
	if err := manager.Add(core.URL, SourceCommand); err != nil {
		t.Fatal(err)
	}
	got := waitForStatus(t, manager, core.URL, StatusConnected)
	if got.CoreID != "fake-core" || got.Name != "local" || got.Key != "local" || got.Source != SourceCommand {
		t.Fatalf("unexpected core: %+v", got)
	}
}

func TestManagerRejectedOnUnauthorized(t *testing.T) {
	core := fakeCore(t, "local", "secret")
	manager := NewManager("plugin-test", "wrong-token")
	t.Cleanup(manager.Close)
	if err := manager.Add(core.URL, SourceCommand); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, manager, core.URL, StatusRejected)
}

func TestManagerUnreachable(t *testing.T) {
	manager := NewManager("plugin-test", "")
	t.Cleanup(manager.Close)
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close()
	if err := manager.Add(url, SourceCommand); err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, manager, url, StatusUnreachable)
}

func TestNormalizeURL(t *testing.T) {
	for _, test := range []struct {
		raw     string
		want    string
		wantErr bool
	}{
		{"http://127.0.0.1:7700", "http://127.0.0.1:7700", false},
		{"http://localhost:7700/", "http://localhost:7700", false},
		{"http://[::1]:7700", "http://[::1]:7700", false},
		{"https://127.0.0.1:7700", "", true},
		{"http://127.0.0.1", "", true},
		{"http://127.0.0.1:7700/path", "", true},
		{"http://192.168.0.1:7700", "", true},
		{"http://user:pass@127.0.0.1:7700", "", true},
		{"not a url", "", true},
	} {
		got, err := NormalizeURL(test.raw)
		if test.wantErr != (err != nil) || (!test.wantErr && got != test.want) {
			t.Fatalf("NormalizeURL(%q) = %q, %v; want %q, wantErr=%v", test.raw, got, err, test.want, test.wantErr)
		}
	}
}

func TestReservedCoreNameGetsNoKey(t *testing.T) {
	core := fakeCore(t, "assets", "")
	manager := NewManager("plugin-test", "")
	t.Cleanup(manager.Close)
	if err := manager.Add(core.URL, SourceCommand); err != nil {
		t.Fatal(err)
	}
	got := waitForStatus(t, manager, core.URL, StatusConnected)
	if got.Name != "assets" || got.Key != "" {
		t.Fatalf("a reserved name must stay listed without a URL key: %+v", got)
	}
}

func TestReservedName(t *testing.T) {
	for _, name := range []string{"api", "assets", "ui"} {
		if !ReservedName(name) {
			t.Fatalf("%q should be reserved", name)
		}
	}
	if ReservedName("local") {
		t.Fatal("ordinary names must not be reserved")
	}
}
