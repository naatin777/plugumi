package tui

import (
	"testing"

	"github.com/naatin777/plugumi/core/internal/plugincatalog"
	"github.com/naatin777/plugumi/core/internal/plugininstances"
)

func TestMergePluginRowsMatchesRunningByName(t *testing.T) {
	rows := mergePluginRows(
		[]plugininstances.Instance{
			{Name: "standard", ID: "plugin-another-standard"},
			{Name: "standard", ID: "plugin-standard", Version: "0.1.0", Log: "/tmp/std.log"},
			{Name: "other", ID: "plugin-other"},
		},
		[]plugincatalog.Entry{
			{Name: "standard", Command: "cargo run"},
			{Name: "agent", Command: "plugumi-agent"},
		},
	)
	if len(rows) != 4 {
		t.Fatalf("expected both instances of standard, got %+v", rows)
	}
	var standard, agent, other pluginRow
	for _, row := range rows {
		switch row.name {
		case "standard":
			if row.registered {
				standard = row
			}
		case "agent":
			agent = row
		case "other":
			other = row
		}
	}
	// catalog定義と実行中が名前で1行にまとまり、実行中のIDとログを表示する。
	if !standard.running || !standard.registered ||
		standard.instanceID != "plugin-standard" || standard.log != "/tmp/std.log" {
		t.Fatalf("standard row should merge catalog + running: %+v", standard)
	}
	if agent.running || !agent.registered || agent.instanceID != "" || agent.command != "plugumi-agent" {
		t.Fatalf("agent row should be registered-but-stopped: %+v", agent)
	}
	// 実行中だが未登録
	if !other.running || other.registered {
		t.Fatalf("other row should be running-but-unregistered: %+v", other)
	}
}
