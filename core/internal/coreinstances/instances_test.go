package coreinstances

import (
	"cmp"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestRunningListsOnlyRegisteredLiveInstances(t *testing.T) {
	registry := Registry{directory: t.TempDir()}
	start := func(id string) *httptest.Server {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodHead || r.URL.Path != StatusPath {
				http.NotFound(w, r)
				return
			}
			w.Header().Set(IDHeader, id)
			w.WriteHeader(http.StatusNoContent)
		}))
		t.Cleanup(server.Close)
		return server
	}
	register := func(server *httptest.Server, id string) func() error {
		t.Helper()
		unregister, err := registry.Register(Instance{URL: server.URL, ID: id}, "")
		if err != nil {
			t.Fatal(err)
		}
		return unregister
	}
	first := start("first")
	second := start("second")
	stopped := start("stopped")
	replaced := start("new-id")
	register(first, "first")
	unregister := register(second, "second")
	register(stopped, "stopped")
	register(replaced, "old-id")
	stopped.Close()

	want := []Instance{{URL: first.URL, ID: "first"}, {URL: second.URL, ID: "second"}}
	slices.SortFunc(want, func(first, second Instance) int { return cmp.Compare(first.URL, second.URL) })
	assertRunning := func(want []Instance) {
		t.Helper()
		got, err := registry.Running(t.Context())
		if err != nil || !slices.Equal(got, want) {
			t.Fatalf("Running() = %v, %v; want %v", got, err, want)
		}
	}
	assertRunning(want)
	if err := unregister(); err != nil {
		t.Fatal(err)
	}
	assertRunning([]Instance{{URL: first.URL, ID: "first"}})
}

func TestStopRejectsStaleSelectionAtSameURL(t *testing.T) {
	registry := Registry{directory: t.TempDir()}
	calls := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		calls <- struct{}{}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	current := Instance{URL: server.URL, ID: "new"}
	if _, err := registry.Register(current, "new-token"); err != nil {
		t.Fatal(err)
	}
	stale := Instance{URL: server.URL, ID: "old"}
	if err := registry.Stop(t.Context(), stale); err == nil {
		t.Fatal("a stale selection must not stop its replacement")
	}
	select {
	case <-calls:
		t.Fatal("stop must not send a request to the replacement")
	default:
	}
}
