package registry

import (
	"testing"

	"github.com/naatin777/plugumi/core/internal/wire"
)

// kind省略時のsync補完はcontract 00001の規定。connectのpull経路で
// pluginがkindを省略してもtools/list・catalogに""が漏れないことを固定する。
func TestSetToolsDefaultsKindToSync(t *testing.T) {
	link := &Link{ID: "link-test", Endpoint: "http://127.0.0.1:9001"}
	link.SetTools([]wire.ToolDeclaration{
		{ToolPath: "a/one"},
		{ToolPath: "a/two", Kind: "async"},
	})

	tools := link.Tools()
	if tools[0].Kind != "sync" {
		t.Fatalf("kind省略時はsyncのはず: got %q", tools[0].Kind)
	}
	if tools[1].Kind != "async" {
		t.Fatalf("明示したkindを上書きしてはいけない: got %q", tools[1].Kind)
	}
}

func TestAllToolsReportsNormalizedKind(t *testing.T) {
	registry := New()
	link := &Link{ID: "link-test", Endpoint: "http://127.0.0.1:9001"}
	link.SetTools([]wire.ToolDeclaration{{ToolPath: "a/one"}})
	registry.Add(link)

	tools := registry.AllTools()
	if len(tools) != 1 || tools[0].Kind != "sync" {
		t.Fatalf("AllToolsが正規化後のkindを返すはず: %+v", tools)
	}
}
