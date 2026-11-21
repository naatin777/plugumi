// Detailペインは選択中のCoreの登録、Tool、ログを表示する。
package tui

import (
	"fmt"
	"io"
	"os"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
	"github.com/naatin777/plugumi/core/internal/wire"
)

// coreView は、CoresペインでfocusしたCoreへのpreviewクライアントとその一覧。
// 表示は選択中のCoreに属するので、focusが外れたら丸ごと破棄する。
type coreView struct {
	client     *Client
	viewedCore coreinstances.Instance

	registrations   []wire.RegistryRegistration
	rows            []detailRow
	detailSelection int

	loaded                 bool
	loadError              error
	logLines               []string
	registryRefreshPending bool
	registryRefreshAgain   bool

	// 更新で並び順が変わっても、確認済みの登録だけを解除する。
	confirmRemoveRegistrationID string
}

// detailRow はSnapshotから作る表示行。toolがnilなら登録行。
type detailRow struct {
	registration *wire.RegistryRegistration
	tool         *wire.ToolDeclaration
}

func registrationRows(registrations []wire.RegistryRegistration) []detailRow {
	rows := make([]detailRow, 0, len(registrations))
	for index := range registrations {
		registration := &registrations[index]
		rows = append(rows, detailRow{registration: registration})
		if !registration.RPCAvailable {
			continue
		}
		for toolIndex := range registration.Tools {
			rows = append(rows, detailRow{registration: registration, tool: &registration.Tools[toolIndex]})
		}
	}
	return rows
}

func (row detailRow) identity() wire.CallTarget {
	target := wire.CallTarget{RegistrationID: row.registration.RegistrationID}
	if row.tool != nil {
		target.ToolPath = row.tool.ToolPath
	}
	return target
}

type coreViewMsg struct {
	client   *Client
	snapshot wire.RegistrySnapshot
	err      error
}

type logTailMsg struct {
	core  coreinstances.Instance
	lines []string
}

func (view *coreView) refreshCoreView() tea.Cmd {
	client := view.client
	if client == nil {
		return nil
	}
	if view.registryRefreshPending {
		view.registryRefreshAgain = true
		return nil
	}
	view.registryRefreshPending = true
	return func() tea.Msg {
		snapshot, err := client.Registry()
		return coreViewMsg{client: client, snapshot: snapshot, err: err}
	}
}

// readCoreLog は記録済みのLogPathから末尾を読む。serve等ファイルが
// 無い起動なら空のまま — ログペインはその旨を表示する。
func (m *Model) readCoreLog() tea.Cmd {
	if m.client == nil || m.viewedCore.LogPath == "" {
		return nil
	}
	target := m.viewedCore
	return func() tea.Msg {
		return logTailMsg{core: target, lines: tailLines(target.LogPath, logTailRows)}
	}
}

const (
	logTailRows     = 200
	logReadCapacity = 256 * 1024
)

// tailLines はファイル末尾最大capacityバイトから最後のcount行を返す。
// logsコマンドの末尾読みと同じ考え方だが、TUIでは行数を多めに取って
// ペイン内スクロールに備える。
func tailLines(path string, count int) []string {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil
	}
	start := max(0, info.Size()-logReadCapacity)
	data, err := io.ReadAll(io.NewSectionReader(file, start, info.Size()-start))
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(lines) > count {
		lines = lines[len(lines)-count:]
	}
	return lines
}

func (view *coreView) updateCoreView(msg coreViewMsg) {
	if msg.client != view.client {
		return
	}
	view.loadError = msg.err
	if msg.err != nil {
		return
	}
	view.loaded = true

	var selected wire.CallTarget
	if row, ok := view.selectedRow(); ok {
		selected = row.identity()
	}
	view.registrations = msg.snapshot.Registrations
	view.rows = registrationRows(view.registrations)
	view.detailSelection = -1
	for index, row := range view.rows {
		if row.identity() == selected {
			view.detailSelection = index
			break
		}
	}
}

func (m *Model) updateLogTail(msg logTailMsg) {
	// 読み終わる前に別のCoreへ移っていたら捨てる
	if msg.core.ID == m.viewedCore.ID && msg.core.ID != "" {
		m.logLines = msg.lines
	}
}

// ---- detailペインのキー処理（detailBrowse中） ----

// logView はdetailペイン全面のlog表示。Core・Pluginどちらの
// ログでも同じ見せ方にするため、表示対象はtitleとpathだけを持つ。
type logView struct {
	title  string
	path   string
	offset int // 末尾からさかのぼる行数。0=最新
}

// openLogView は `l` で対象のlogをdetailペインに開く。
func (m *Model) openLogView(title, path string) {
	m.logView = &logView{title: title, path: path}
	m.focusPane(paneDetail)
}

// scrollLog はoffsetを動かす。正で過去方向、負で最新方向。
// 上限は描画側でlinesの長さに合わせてクランプする。
func (m *Model) scrollLog(delta int) {
	m.logView.offset = max(0, m.logView.offset+delta)
}

func (m *Model) updateDetailKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	// log表示中はツリー操作の代わりにスクロールを割り当てる
	if m.logView != nil {
		switch msg.String() {
		case "up", "k":
			m.scrollLog(1)
		case "down", "j":
			m.scrollLog(-1)
		case "pgup":
			m.scrollLog(10)
		case "pgdown":
			m.scrollLog(-10)
		}
		return m, nil
	}
	switch msg.String() {
	case "left", "h":
		if row, ok := m.selectedRow(); ok && row.tool != nil {
			for index, candidate := range m.rows {
				if candidate.registration == row.registration && candidate.tool == nil {
					m.detailSelection = index
					break
				}
			}
		}
	case "right", "l":
		m.descendIntoRegistration()
	case "up", "k":
		m.moveDetailSelection(-1)
	case "down", "j":
		m.moveDetailSelection(1)
	case "pgup":
		m.moveDetailSelection(-10)
	case "pgdown":
		m.moveDetailSelection(10)
	case "enter", "c":
		row, ok := m.selectedRow()
		if !ok {
			return m, nil
		}
		if row.tool != nil {
			return m.openCall(row)
		}
		m.descendIntoRegistration()
	case "d":
		return m.requestRemoveRegistration()
	case "L":
		// 小文字lは木の「右へ降りる」に使うので、logは大文字で。
		if m.client != nil && m.viewedCore.LogPath != "" {
			m.openLogView(m.viewedCore.URL, m.viewedCore.LogPath)
		}
	case "r":
		return m, m.refreshCoreView()
	}
	return m, nil
}

func (view *coreView) selectedRow() (detailRow, bool) {
	if view.detailSelection < 0 || view.detailSelection >= len(view.rows) {
		return detailRow{}, false
	}
	return view.rows[view.detailSelection], true
}

func (m *Model) descendIntoRegistration() {
	row, ok := m.selectedRow()
	if !ok || row.tool != nil {
		return
	}
	next := m.detailSelection + 1
	if next < len(m.rows) && m.rows[next].registration == row.registration {
		m.detailSelection = next
	}
}

func (m *Model) moveDetailSelection(delta int) {
	if len(m.rows) == 0 {
		m.detailSelection = -1
		return
	}
	m.detailSelection = min(len(m.rows)-1, max(0, m.detailSelection+delta))
}

func (m *Model) requestRemoveRegistration() (tea.Model, tea.Cmd) {
	row, ok := m.selectedRow()
	switch {
	case m.loadError != nil:
		m.statusMsg = styleWarn.Render("Refresh the Registry before removing a registration.")
	case !m.loaded:
		m.statusMsg = "Loading registrations..."
	case len(m.registrations) == 0:
		m.statusMsg = styleDim.Render("No registrations to remove.")
	case !ok || row.tool != nil:
		m.statusMsg = "Choose a registration row, then press d."
	default:
		m.confirmRemoveRegistrationID = row.registration.RegistrationID
	}
	return m, nil
}

func (m *Model) confirmRemoveRegistrationKey(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "esc", "n":
		m.confirmRemoveRegistrationID = ""
	case "y":
		registrationID := m.confirmRemoveRegistrationID
		m.confirmRemoveRegistrationID = ""
		return removePluginCmd(m.client, registrationID)
	}
	return nil
}

// ---- help ----

var helpRows = []string{
	"PANES",
	"  Tab / Shift+Tab   cycle focus    1 / 2 / 3   jump to pane",
	"  ↑/↓ or j/k        move selection",
	"  mouse click       focus & select  double      activate",
	"  wheel             scroll",
	"",
	"CORES",
	"  a   start a detached Core     d   stop (y confirms)",
	"  R   restart with recorded settings",
	"  l   core log                  Enter   open in Detail",
	"",
	"PLUGINS (catalog + running)",
	"  Enter   run the registered startup command",
	"  a   register: name command",
	"  d   remove the catalog entry    l   plugin log",
	"",
	"DETAIL (Registry)",
	"  Enter on registration   move to its first Tool",
	"  Enter / c       call the selected Tool",
	"  ← / h           back from Tool to its registration",
	"  d   remove registration (y confirms)    L   core log",
	"  ?   this help",
	"",
	"LOG VIEW",
	"  ↑/↓ or wheel   scroll        esc   close",
	"",
	"ABOUT",
	"  Discovery is local to this machine and OS user.",
	"  A Plugin can register with several Cores at once.",
	"  Plugin processes are independent of Cores.",
}

// ---- 表示用の行生成はlayout.goへ。ここでは状態遷移のみ ----

func (m *Model) catalogCount(count int) int {
	if !m.loaded {
		return -1
	}
	return count
}

func (m *Model) catalogMessage(empty string) string {
	switch {
	case m.client == nil && len(m.cores) == 0:
		return styleDim.Render("Press a in Cores to start one")
	case m.client == nil:
		return styleDim.Render("Choose a Core in 1 Cores")
	case m.loadError != nil:
		return styleWarn.Render("Unavailable")
	case !m.loaded:
		return styleDim.Render("Loading…")
	default:
		return styleDim.Render(empty)
	}
}

// registrationLabel は狭い表示でもPluginを識別できるようPlugin IDを先に出す。
func registrationLabel(registration *wire.RegistryRegistration, width int) string {
	return fitLine(strings.TrimSpace(registration.PluginID+"  "+registration.RegistrationID), width-8)
}

func toolLabel(tool *wire.ToolDeclaration, pluginID string) string {
	kind := tool.Kind
	if kind == "" {
		kind = "sync"
	}
	return strings.TrimSpace(fmt.Sprintf("%s [%s] %s", tool.ToolPath, kind, pluginID))
}
