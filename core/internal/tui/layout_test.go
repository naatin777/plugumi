package tui

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
	"github.com/naatin777/plugumi/core/internal/wire"
)

// ペイン枠・セクション見出しはfocus・読み込み・選択で動かない。
// 画面遷移型ではなく常駐ペインなので、位置の不変性が重要な約束。
func TestPaneLayoutStaysPutWhenFocusOrDataChanges(t *testing.T) {
	first := coreinstances.Instance{URL: "http://127.0.0.1:7700", ID: "first"}
	second := coreinstances.Instance{URL: "http://127.0.0.1:7701", ID: "second"}
	for _, size := range []tea.WindowSizeMsg{{Width: 120, Height: 25}, {Width: 96, Height: 20}} {
		t.Run(fmt.Sprintf("%dx%d", size.Width, size.Height), func(t *testing.T) {
			model := New(Actions{})
			t.Cleanup(model.Disconnect)
			model.Update(size)
			labels := []string{"CORES", "PLUGINS", "DETAIL", "REGISTRATIONS", "LOG"}
			initial := positions(t, model.View().Content, size, labels...)
			check := func(state string) {
				t.Helper()
				got := positions(t, model.View().Content, size, labels...)
				for _, label := range labels {
					if got[label] != initial[label] {
						t.Fatalf("%s moved %v → %v when %s", label, initial[label], got[label], state)
					}
				}
			}
			model.Update(coreListMsg{instances: []coreinstances.Instance{first, second}})
			check("core list arrives")
			client, err := NewClient(first.URL)
			if err != nil {
				t.Fatal(err)
			}
			model.coreView = coreView{client: client, viewedCore: first}
			model.Update(coreViewMsg{client: client, snapshot: wire.RegistrySnapshot{
				Registrations: []wire.RegistryRegistration{{
					RegistrationID: "registration",
					RPCAvailable:   true,
					Operations:     []wire.OperationDeclaration{{Path: "echo"}},
				}},
			}})
			check("registration and tools arrive")
			model.Update(tea.KeyPressMsg{Code: tea.KeyTab})
			check("focus moves to Plugins")
			model.Update(tea.KeyPressMsg{Code: tea.KeyTab})
			check("focus moves to Detail")
			model.Update(tea.KeyPressMsg{Code: tea.KeyDown})
			check("selection changes")
			model.Update(coreListMsg{instances: []coreinstances.Instance{first, second}})
			check("list refreshes")
		})
	}
}

// 狭い端末では1ペイン表示へ退避し、focusの切替で中身が入れ替わる。
func TestNarrowShowsOnlyTheFocusedPane(t *testing.T) {
	model := New(Actions{})
	t.Cleanup(model.Disconnect)
	model.Update(tea.WindowSizeMsg{Width: 50, Height: 18})
	view := model.View().Content
	if !strings.Contains(view, "CORES") || strings.Contains(view, "REGISTRATIONS") {
		t.Fatalf("narrow view should show only the Cores pane:\n%s", view)
	}
	model.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	view = model.View().Content
	if !strings.Contains(view, "PLUGINS") {
		t.Fatalf("narrow view should switch to the Plugins pane:\n%s", view)
	}
	model.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	view = model.View().Content
	if !strings.Contains(view, "DETAIL") || !strings.Contains(view, "REGISTRATIONS") {
		t.Fatalf("narrow view should switch to the Detail pane:\n%s", view)
	}
}

func TestMouseTargetsFollowVisiblePluginRows(t *testing.T) {
	for _, width := range []int{52, 96} {
		t.Run(fmt.Sprint(width), func(t *testing.T) {
			model := New(Actions{})
			size := tea.WindowSizeMsg{Width: width, Height: 16}
			model.Update(size)
			model.focusPane(panePlugins)
			for index := range 8 {
				model.pluginRows = append(model.pluginRows, pluginRow{
					name: fmt.Sprintf("plugin-%02d", index), command: fmt.Sprintf("run-plugin-%02d", index),
				})
			}
			model.pluginSelection = 7
			label := "run-plugin-04"
			point := positions(t, model.View().Content, size, label)[label]
			click := tea.MouseClickMsg(tea.Mouse{X: point[1], Y: point[0], Button: tea.MouseLeft})
			model.Update(click)
			if model.pluginSelection != 4 {
				t.Fatalf("clicking a command should select its Plugin, got %d", model.pluginSelection)
			}

			model.Update(tea.WindowSizeMsg{Width: minimumWidth - 1, Height: size.Height})
			model.View()
			model.pluginSelection = 7
			model.Update(click)
			if model.pluginSelection != 7 {
				t.Fatalf("a hidden row should not receive clicks, got %d", model.pluginSelection)
			}
		})
	}
}

func positions(t *testing.T, view string, size tea.WindowSizeMsg, labels ...string) map[string][2]int {
	t.Helper()
	lines := strings.Split(view, "\n")
	if len(lines) != size.Height {
		t.Fatalf("view has %d lines; want %d:\n%s", len(lines), size.Height, view)
	}
	found := make(map[string][2]int)
	for row, line := range lines {
		if width := lipgloss.Width(line); width > size.Width {
			t.Fatalf("row %d has width %d, want at most %d: %q", row, width, size.Width, line)
		}
		// lipgloss v2は非TTYでもANSIを出力するので、ラベル検索は剥がした行で行う。
		plain := ansi.Strip(line)
		for _, label := range labels {
			if offset := strings.Index(plain, label); offset >= 0 {
				found[label] = [2]int{row, lipgloss.Width(plain[:offset])}
			}
		}
	}
	for _, label := range labels {
		if _, ok := found[label]; !ok {
			t.Fatalf("missing %q in:\n%s", label, view)
		}
	}
	return found
}
