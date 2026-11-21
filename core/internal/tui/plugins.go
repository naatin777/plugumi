// Plugin検出ペイン。catalog（ユーザー登録の定義）と実行中registryの和を
// 1行ずつにして見せる。catalogに起動コマンドがある場合のみ起動できる。
// Coreとの接続はPlugin自身が開始する。
package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/naatin777/plugumi/core/internal/plugincatalog"
	"github.com/naatin777/plugumi/core/internal/plugininstances"
)

// pluginRow はPluginsペインの1行。catalog定義と実行中registryを
// 名前で突き合わせ、両方に現れるものは1行にまとめる。
type pluginRow struct {
	name       string
	instanceID string
	command    string // catalogのみ
	version    string
	log        string // 実行中Pluginがregistryに記録したlog path
	running    bool
	registered bool // catalogに定義がある
}

type pluginListMsg struct {
	instances []plugininstances.Instance
	entries   []plugincatalog.Entry
	err       error
}

func (m *Model) refreshPlugins() tea.Cmd {
	if m.localPluginsLoading {
		return nil
	}
	m.localPluginsLoading = true
	findPlugins := m.actions.FindPlugins
	catalogPlugins := m.actions.CatalogPlugins
	return func() tea.Msg {
		var msg pluginListMsg
		if findPlugins != nil {
			msg.instances, msg.err = findPlugins()
		}
		if catalogPlugins != nil && msg.err == nil {
			msg.entries, msg.err = catalogPlugins()
		}
		return msg
	}
}

// mergePluginRows はcatalogと実行中を名前で突き合わせて行を作る。
// 実行中だが未登録のものはregistryだけの行として末尾に並べる。
func mergePluginRows(instances []plugininstances.Instance, entries []plugincatalog.Entry) []pluginRow {
	rows := []pluginRow{}
	remaining := map[string]plugininstances.Instance{}
	for _, instance := range instances {
		remaining[instance.Name] = instance
	}
	merged := make(map[string]bool, len(entries))
	for _, entry := range entries {
		row := pluginRow{name: entry.Name, command: entry.Command, registered: true}
		if instance, ok := remaining[entry.Name]; ok {
			row.running = true
			row.instanceID = instance.ID
			row.version = instance.Version
			row.log = instance.Log
			merged[instance.ID] = true
		}
		rows = append(rows, row)
	}
	for _, instance := range instances {
		if merged[instance.ID] {
			continue
		}
		rows = append(rows, pluginRow{
			name: instance.Name, instanceID: instance.ID,
			version: instance.Version, log: instance.Log, running: true,
		})
	}
	return rows
}

func (m *Model) updatePluginList(msg pluginListMsg) {
	m.localPluginsLoading = false
	m.localPluginsError = msg.err
	if msg.err != nil {
		m.pluginRows = nil
		m.pluginSelection = -1
		return
	}
	var focused string
	if m.pluginSelection >= 0 && m.pluginSelection < len(m.pluginRows) {
		focused = m.pluginRows[m.pluginSelection].name + "\x00" + m.pluginRows[m.pluginSelection].instanceID
	}
	m.pluginRows = mergePluginRows(msg.instances, msg.entries)
	m.pluginSelection = -1
	for index, row := range m.pluginRows {
		if row.name+"\x00"+row.instanceID == focused {
			m.pluginSelection = index
		}
	}
	if m.pluginSelection < 0 && len(m.pluginRows) > 0 {
		m.pluginSelection = 0
	}
}

func (m *Model) selectedPlugin() (pluginRow, bool) {
	if m.pluginSelection < 0 || m.pluginSelection >= len(m.pluginRows) {
		return pluginRow{}, false
	}
	return m.pluginRows[m.pluginSelection], true
}

func (m *Model) movePluginFocus(delta int) {
	if len(m.pluginRows) == 0 {
		return
	}
	m.pluginSelection = min(len(m.pluginRows)-1, max(0, m.pluginSelection+delta))
}

// activateSelectedPlugin はカタログにあるローカル起動コマンドだけを実行する。
func (m *Model) activateSelectedPlugin() (tea.Model, tea.Cmd) {
	row, ok := m.selectedPlugin()
	if !ok {
		return m, nil
	}
	switch {
	case row.running:
		m.statusMsg = "This Plugin connects to Core itself."
	case row.command != "":
		if m.actions.StartPlugin == nil {
			m.statusMsg = styleWarn.Render("Plugin start is not available.")
			return m, nil
		}
		m.statusMsg = "Starting " + row.name + "..."
		name := row.name
		startPlugin := m.actions.StartPlugin
		return m, func() tea.Msg {
			return pluginActionMsg{err: startPlugin(name)}
		}
	default:
		m.statusMsg = styleWarn.Render("Configure a startup command with a Core URL.")
	}
	return m, nil
}

// removeSelectedRegistration はcatalog定義だけを消す。
// 実行中のPluginプロセスとCore上の登録は残す。
func (m *Model) removeSelectedRegistration() {
	row, ok := m.selectedPlugin()
	if !ok || !row.registered || m.actions.RemovePlugin == nil {
		return
	}
	if err := m.actions.RemovePlugin(row.name); err != nil {
		m.statusMsg = styleError.Render(err.Error())
		return
	}
	m.statusMsg = "Unregistered " + row.name
	m.pendingPluginRefresh = true
}

type pluginActionMsg struct{ err error }

func (m *Model) updatePluginsPaneKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		m.movePluginFocus(-1)
	case "down", "j":
		m.movePluginFocus(1)
	case "pgup":
		m.movePluginFocus(-10)
	case "pgdown":
		m.movePluginFocus(10)
	case "enter":
		return m.activateSelectedPlugin()
	case "d":
		m.removeSelectedRegistration()
	case "l":
		// 実行中Pluginがregistryに記録したlogをdetailペインで見る。
		if row, ok := m.selectedPlugin(); ok && row.log != "" {
			m.openLogView(row.name, row.log)
		} else {
			m.statusMsg = styleWarn.Render("No log recorded for this Plugin.")
		}
	case "a":
		m.addingLaunchCommand = true
		m.statusMsg = ""
		m.addInput.SetValue("")
		m.addInput.Placeholder = "name <command>"
		return m, m.addInput.Focus()
	}
	return m, nil
}

// updateAddLaunchCommandKey は `a` のカタログ登録入力を処理する。
func (m *Model) updateAddLaunchCommandKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.addingLaunchCommand = false
		m.addInput.Blur()
		return m, nil
	case "enter":
		parts := strings.Fields(m.addInput.Value())
		if len(parts) < 2 {
			m.statusMsg = styleError.Render("Enter: name <command>")
			return m, nil
		}
		entry := plugincatalog.Entry{Name: parts[0], Command: strings.Join(parts[1:], " ")}
		if m.actions.RegisterPlugin == nil {
			m.statusMsg = styleWarn.Render("Plugin catalog is not available.")
			return m, nil
		}
		if err := m.actions.RegisterPlugin(entry); err != nil {
			m.statusMsg = styleError.Render(err.Error())
			return m, nil
		}
		m.addingLaunchCommand = false
		m.addInput.Blur()
		m.statusMsg = "Registered " + entry.Name
		m.pendingPluginRefresh = true
		return m, nil
	}
	var cmd tea.Cmd
	m.addInput, cmd = m.addInput.Update(msg)
	return m, cmd
}
