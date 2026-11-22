package main

import (
	"bytes"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/naatin777/plugumi/core/internal/config"
	"github.com/naatin777/plugumi/core/internal/coreinstances"
)

func TestDefaultCoresUseDistinctPortsAndStopIndependently(t *testing.T) {
	t.Chdir(t.TempDir())
	cacheDirectory := t.TempDir()
	for _, key := range []string{"HOME", "XDG_CACHE_HOME", "LocalAppData", "home"} {
		t.Setenv(key, cacheDirectory)
	}

	startCore := func() coreinstances.Instance {
		t.Helper()
		settings, err := config.Load("")
		if err != nil {
			t.Fatal(err)
		}
		core := newRuntime(settings)
		t.Cleanup(core.shutdown)
		if err := core.start("", "", ""); err != nil {
			t.Fatal(err)
		}
		return coreinstances.Instance{URL: settings.Core.URL, ID: core.instanceID}
	}
	first, second := startCore(), startCore()
	if first.URL == second.URL {
		t.Fatalf("both Core servers use %s", first.URL)
	}
	instances, err := coreinstances.Local()
	if err != nil {
		t.Fatal(err)
	}
	running, err := instances.Running(t.Context())
	contains := func(target coreinstances.Instance) bool {
		return slices.ContainsFunc(running, func(instance coreinstances.Instance) bool {
			return instance.URL == target.URL && instance.ID == target.ID
		})
	}
	if err != nil || len(running) != 2 || !contains(first) || !contains(second) {
		t.Fatalf("running = %v, %v; want %v and %v", running, err, first, second)
	}

	response, err := http.Post(first.URL+coreinstances.StopPath, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("stop without the token returned %d", response.StatusCode)
	}
	var output bytes.Buffer
	if err := runStop(t.Context(), &output, nil); err == nil || !strings.Contains(err.Error(), "multiple Core") {
		t.Fatalf("ambiguous stop returned %v", err)
	}
	if err := runStop(t.Context(), &output, []string{first.URL}); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); {
		running, err = instances.Running(t.Context())
		if err == nil && len(running) == 1 && contains(second) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("running after stop = %v, %v; want only %v", running, err, second)
}

func TestConflictingName(t *testing.T) {
	running := []coreinstances.Instance{
		{URL: "http://127.0.0.1:7700", ID: "core-a", Name: "local"},
		{URL: "http://127.0.0.1:7701", ID: "core-b"},
		{URL: "http://127.0.0.1:7702", ID: "core-c", Name: "other"},
	}
	if conflict, found := conflictingName(running, "local"); !found || conflict.URL != "http://127.0.0.1:7700" {
		t.Fatalf("got (%v, %v), want the named instance", conflict, found)
	}
	if _, found := conflictingName(running, "unused"); found {
		t.Fatal("reported a conflict for an unused name")
	}
	if _, found := conflictingName(running, ""); found {
		t.Fatal("reported a conflict for an empty name")
	}
}
