// Coresペイン。ローカルregistryのCore一覧を表示し、起動・停止・再起動と
// 「選んだCoreをdetailペインでpreviewする」選択を受け付ける。
package tui

import (
	"slices"

	tea "charm.land/bubbletea/v2"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
	"github.com/naatin777/plugumi/core/internal/plugincatalog"
	"github.com/naatin777/plugumi/core/internal/plugininstances"
)

// Actions はTUIが外部へ触れるための操作群。process管理とregistry探索を
// cmd側が供給する（TUI自体はCore・Pluginプロセスを抱えない）。
type Actions struct {
	FindCores   func() ([]coreinstances.Instance, error)
	StartCore   func() (string, error)
	StopCore    func(coreinstances.Instance) error
	RestartCore func(coreinstances.Instance) error
	FindPlugins func() ([]plugininstances.Instance, error)
	// catalog（ユーザー登録の定義）操作。起動中registryとは別物。
	CatalogPlugins func() ([]plugincatalog.Entry, error)
	RegisterPlugin func(plugincatalog.Entry) error
	RemovePlugin   func(name string) error
	StartPlugin    func(name string) error
}

type coreListMsg struct {
	instances []coreinstances.Instance
	err       error
}

type coreActionMsg struct {
	url     string
	stopped coreinstances.Instance
	err     error
}

func (m *Model) focusedCore() (coreinstances.Instance, bool) {
	if m.coreSelection < 0 || m.coreSelection >= len(m.cores) {
		return coreinstances.Instance{}, false
	}
	return m.cores[m.coreSelection], true
}

func (m *Model) refreshCores() tea.Cmd {
	if m.coresLoading {
		return nil
	}
	m.coresLoading = true
	findCores := m.actions.FindCores
	return func() tea.Msg {
		instances, err := findCores()
		return coreListMsg{instances: instances, err: err}
	}
}

func (m *Model) updateCoreList(msg coreListMsg) {
	m.coresLoading = false
	m.coresError = msg.err
	if msg.err != nil {
		m.cores = nil
		m.coreSelection = -1
		m.closeCoreView()
		return
	}
	focused, _ := m.focusedCore()
	m.cores = msg.instances
	m.coreSelection = slices.Index(m.cores, focused)
	if m.client != nil && !slices.Contains(m.cores, m.viewedCore) {
		m.closeCoreView()
		m.statusMsg = styleWarn.Render("That Core is no longer running.")
	}
}

func (m *Model) updateCoresPaneKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "a":
		if !m.coreActionPending {
			m.coreActionPending = true
			m.statusMsg = "Starting a new Core..."
			start := m.actions.StartCore
			return m, func() tea.Msg {
				coreURL, err := start()
				return coreActionMsg{url: coreURL, err: err}
			}
		}
	case "d":
		if !m.coreActionPending {
			if target, ok := m.focusedCore(); ok {
				m.confirmCore = target
				m.confirmVerb = "Stop"
			} else {
				m.statusMsg = styleWarn.Render("Use ↑/↓ to choose a Core before stopping it.")
			}
		}
	case "l":
		// registry記録のlog pathをdetailペイン全面で見る。
		// viewedCoreではなく選択行のCoreを対象にする（preview未起動でも見れる）。
		if target, ok := m.focusedCore(); ok && target.LogPath != "" {
			m.openLogView(target.URL, target.LogPath)
		} else {
			m.statusMsg = styleWarn.Render("No log recorded for this Core.")
		}
	case "R":
		if !m.coreActionPending {
			if target, ok := m.focusedCore(); ok {
				m.confirmCore = target
				m.confirmVerb = "Restart"
			} else {
				m.statusMsg = styleWarn.Render("Use ↑/↓ to choose a Core before restarting it.")
			}
		}
	case "up", "k":
		return m, m.moveCoreFocus(-1)
	case "down", "j":
		return m, m.moveCoreFocus(1)
	case "pgup":
		return m, m.moveCoreFocus(-10)
	case "pgdown":
		return m, m.moveCoreFocus(10)
	case "enter":
		// hoverは選択だけ動かすので、previewが追い付いていなければここで開く。
		target, ok := m.focusedCore()
		if !ok {
			m.statusMsg = styleWarn.Render("No Core to show.")
			return m, nil
		}
		var cmd tea.Cmd
		if target.URL != m.viewedCore.URL {
			cmd = m.openCoreView(target)
		}
		m.focusPane(paneDetail)
		return m, cmd
	}
	return m, nil
}

// confirmCoreKey は停止・再起動の確認応答。対象は確認開始時のものを保持し、
// 待機中に一覧が更新されても同じCoreへ向く。
func (m *Model) confirmCoreKey(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "esc", "n":
		m.confirmCore = coreinstances.Instance{}
		m.confirmVerb = ""
	case "y":
		target := m.confirmCore
		verb := m.confirmVerb
		m.confirmCore = coreinstances.Instance{}
		m.confirmVerb = ""
		m.coreActionPending = true
		m.statusMsg = verb + " " + target.URL + "..."
		action := m.actions.StopCore
		if verb == "Restart" {
			action = m.actions.RestartCore
		}
		return func() tea.Msg {
			return coreActionMsg{stopped: target, err: action(target)}
		}
	}
	return nil
}

func (m *Model) updateCoreAction(msg coreActionMsg) tea.Cmd {
	switch {
	case msg.err != nil:
		m.statusMsg = styleError.Render(msg.err.Error())
	case msg.stopped.ID != "":
		m.statusMsg = styleOK.Render("Done for " + msg.stopped.URL)
	default:
		m.statusMsg = styleOK.Render("Started " + msg.url)
	}
	m.coreActionPending = false
	return m.refreshCores()
}

func (m *Model) moveCoreFocus(delta int) tea.Cmd {
	if len(m.cores) == 0 {
		return nil
	}
	next := min(len(m.cores)-1, max(0, m.coreSelection+delta))
	if next == m.coreSelection {
		return nil
	}
	m.coreSelection = next
	// 移動のたびにpreviewを張り直す。detailペインは常にfocused Coreを映す。
	return m.openCoreView(m.cores[next])
}

func (m *Model) openCoreView(target coreinstances.Instance) tea.Cmd {
	client, err := NewClient(target.URL)
	if err != nil {
		m.statusMsg = styleError.Render(err.Error())
		return nil
	}
	m.closeCoreView()
	m.coreView = coreView{client: client, viewedCore: target}
	m.statusMsg = ""
	go client.watchRegistry()
	return tea.Batch(m.refreshCoreView(), m.readCoreLog(), waitEventCmd(client), waitRegistryChangeCmd(client))
}

func (m *Model) closeCoreView() {
	m.Disconnect()
	m.coreView = coreView{}
	m.callTool, m.callTicket = nil, nil
	m.callID = ""
	m.callState = callFinished
	m.callGeneration++
	m.detailMode = detailBrowse
	m.inputArea.Blur()
	m.addInput.Blur()
}
