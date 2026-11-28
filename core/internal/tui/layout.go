// 描画。ヘッダ＋3ペイン本体＋フッタの固定枠。
// 幅が足りない端末ではfocus中の1ペインだけを全幅で出す
// （常駐3ペインが潰れて読めなくなるのを避けるため）。
package tui

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// 端末背景の明暗はrunTUI開始前に調べてSetDarkBackgroundへ渡す。
// 未初期化（テスト等）ではdark側を既定にする。
var (
	styleHeader   lipgloss.Style
	styleLabel    lipgloss.Style
	styleDim      lipgloss.Style
	styleRule     lipgloss.Style
	styleError    lipgloss.Style
	styleOK       lipgloss.Style
	styleWarn     lipgloss.Style
	styleSelected lipgloss.Style
	styleCursor   lipgloss.Style
)

func SetDarkBackground(isDark bool) {
	initStyles(isDark)
}

func initStyles(isDark bool) {
	pick := lipgloss.LightDark(isDark)
	accent := pick(lipgloss.Color("#006D65"), lipgloss.Color("#60E5CA"))
	muted := pick(lipgloss.Color("#52636A"), lipgloss.Color("#A1B0B7"))
	styleHeader = lipgloss.NewStyle().Bold(true)
	styleLabel = styleHeader.Foreground(accent)
	styleDim = lipgloss.NewStyle().Foreground(muted)
	styleRule = lipgloss.NewStyle().Foreground(pick(lipgloss.Color("#91AAA8"), lipgloss.Color("#37605F")))
	styleError = lipgloss.NewStyle().Foreground(pick(lipgloss.Color("#A81835"), lipgloss.Color("#FF8793")))
	styleOK = lipgloss.NewStyle().Foreground(accent)
	styleWarn = lipgloss.NewStyle().Foreground(pick(lipgloss.Color("#845000"), lipgloss.Color("#FFCB70")))
	styleSelected = styleHeader.Reverse(true)
	// 非focusペインの選択行は反転だと主張が強すぎるので、markerだけ色付けする
	styleCursor = lipgloss.NewStyle().Foreground(accent)
}

func init() { initStyles(true) }

const (
	minimumWidth  = 32
	minimumHeight = 16
	// tripleWidth 未満では1ペイン表示へ退避する（横3分割が読めなくなる幅）
	tripleWidth = 80
	headerRows  = 2
	footerRows  = 3
)

var paneTitles = [...]string{
	paneCores:   "CORES",
	panePlugins: "PLUGINS",
	paneDetail:  "DETAIL",
}

var paneIndicators = [...]string{
	paneCores:   "1 Cores",
	panePlugins: "2 Plugins",
	paneDetail:  "3 Detail",
}

func (m *Model) View() tea.View {
	clear(m.hits)
	var view tea.View
	if m.width == 0 || m.height == 0 {
		return view
	}
	// AltScreenは常時。マウスはhoverでの行追従も欲しいのでAllMotion。
	view.AltScreen = true
	view.MouseMode = tea.MouseModeAllMotion
	if !m.hasWorkspace() {
		view.SetContent(fitLine("Resize to 32 × 16 or larger", m.width))
		return view
	}

	rule := styleRule.Render(strings.Repeat("─", m.width))
	hints, status := m.footer()
	lines := append([]string{fitLine(m.headerLine(), m.width), rule}, m.renderBody()...)
	lines = append(lines, rule, fitLine(hints, m.width), fitLine(status, m.width))
	view.SetContent(strings.Join(lines, "\n"))
	return view
}

func (m *Model) headerLine() string {
	title := styleLabel.Render("PLUGUMI") + styleDim.Render("  /  LOCAL CONSOLE")
	var indicators []string
	for _, p := range panes {
		label := paneIndicators[p]
		if p == m.focus {
			indicators = append(indicators, styleSelected.Render(label))
		} else {
			indicators = append(indicators, styleDim.Render(label))
		}
	}
	gap := m.width - lipgloss.Width(title) - lipgloss.Width(strings.Join(indicators, "  "))
	if gap < 2 {
		return title
	}
	return title + strings.Repeat(" ", gap) + strings.Join(indicators, "  ")
}

func (m *Model) footer() (hints, status string) {
	status = m.statusMsg
	if status == "" && m.loadError != nil {
		status = styleError.Render("Refresh failed: " + m.loadError.Error())
	}
	switch {
	case m.confirmCore.ID != "":
		return keys("y", "Confirm "+strings.ToLower(m.confirmVerb), "esc", "Cancel"),
			styleWarn.Render(m.confirmVerb + " " + m.confirmCore.URL + "? Plugins keep running.")
	case m.confirmRemoveRegistrationID != "":
		return keys("y", "Confirm removal", "esc", "Cancel"),
			styleWarn.Render("Remove " + m.confirmRemoveRegistrationID + "? The Plugin may reconnect.")
	case m.addingLaunchCommand:
		return keys("Enter", "Register command", "esc", "Cancel"), status
	case m.detailMode == detailCall:
		hints = keys("PgUp/PgDn", "Scroll", "esc", "Back")
		if m.callState == callInput {
			hints = keys("Ctrl+S", "Run Tool", "esc", "Back")
		} else if m.callState == callActive {
			hints = keys("PgUp/PgDn", "Scroll", "esc", "Close")
		}
		return hints, status
	case m.detailMode == detailHelp:
		return keys("?", "Close help", "esc", "Back"), status
	}
	var contextHints string
	switch m.focus {
	case paneCores:
		contextHints = keys("a", "Start", "d", "Stop", "R", "Restart", "l", "Log", "Enter", "Detail")
	case panePlugins:
		contextHints = keys("Enter", "Start", "a", "Register", "d", "Remove", "l", "Log")
	case paneDetail:
		contextHints = keys("Enter", "Open/Call", "d", "Remove", "←", "To registration")
	}
	return contextHints + styleDim.Render("  tab panes · ? help · q quit"), status
}

func (m *Model) hasWorkspace() bool {
	return m.width >= minimumWidth && m.height >= minimumHeight
}

func (m *Model) bodyHeight() int { return m.height - headerRows - footerRows }

// paneWidth はペインの表示幅。1ペイン表示では常に全幅。
func (m *Model) paneWidth(p pane) int {
	if m.width < tripleWidth {
		return m.width
	}
	side := max(26, m.width/4)
	if p == paneDetail {
		return m.width - 2*side - 2
	}
	return side
}

// renderBody は画面に配置するペインだけを描画・クリック判定の対象にする。
func (m *Model) renderBody() []string {
	visiblePanes := panes[:]
	if m.width < tripleWidth {
		visiblePanes = []pane{m.focus}
	}
	height := m.bodyHeight()
	body := make([]string, height)
	divider := styleRule.Render("│")
	x := 0
	for _, p := range visiblePanes {
		width := m.paneWidth(p)
		rows := m.paneContent(p, width, height)
		m.hits[p] = paneHits{bounds: rect{x: x, y: headerRows, w: width, h: height}, rows: rows}
		cellStyle := lipgloss.NewStyle().Width(width).MaxWidth(width)
		for index, row := range rows {
			if x != 0 {
				body[index] += divider
			}
			if len(visiblePanes) == 1 {
				body[index] += row.text
			} else {
				body[index] += cellStyle.Render(row.text)
			}
		}
		x += width + 1 // 1列の区切り
	}
	return body
}

// paneRow は描画する1行と、クリックされたときの対象を一緒に持つ。
type paneRow struct {
	text   string
	target mouseTarget
}

func textRows(lines ...string) []paneRow {
	rows := make([]paneRow, len(lines))
	for index, line := range lines {
		rows[index].text = line
	}
	return rows
}

func (m *Model) paneContent(p pane, width, height int) []paneRow {
	rows := make([]paneRow, height)
	rows[0].text = m.paneHeader(p, width)
	var content []paneRow
	switch p {
	case paneCores:
		content = m.coreRows(width, height-1)
	case panePlugins:
		content = m.localPluginRows(width, height-1)
	case paneDetail:
		content = m.detailContent(width, height-1)
	}
	// 折り返しで描画行とクリック対象がずれないよう、各表示行を1行に収める。
	count := copy(rows[1:], content)
	for index := 1; index <= count; index++ {
		rows[index].text = fitLine(rows[index].text, width)
	}
	return rows
}

func (m *Model) paneHeader(p pane, width int) string {
	count := "—"
	switch p {
	case paneCores:
		if m.coresError == nil {
			count = fmt.Sprint(len(m.cores))
		}
	case panePlugins:
		if m.localPluginsError == nil {
			count = fmt.Sprint(len(m.pluginRows))
		}
	case paneDetail:
		if m.loaded {
			count = fmt.Sprint(len(m.rows))
		}
	}
	marker := "  "
	style := styleHeader
	if m.focus == p {
		marker = styleCursor.Render("▸ ")
		style = styleLabel
	}
	return fitLine(marker+style.Render(paneTitles[p])+styleDim.Render("  /  "+count), width)
}

// ---- coresペイン ----

func (m *Model) coreRows(width, height int) []paneRow {
	switch {
	case m.coresError != nil:
		return textRows(styleError.Render("Discovery failed"))
	case len(m.cores) == 0 && m.coresLoading:
		return textRows(styleDim.Render("Looking for Core servers…"))
	case len(m.cores) == 0:
		return textRows(styleDim.Render("No running Cores"), styleDim.Render("press a to start"))
	}
	start, end := visibleRange(len(m.cores), m.coreSelection, height)
	var rows []paneRow
	for index := start; index < end; index++ {
		rows = append(rows, paneRow{
			text:   selectableRow(fitLine(m.cores[index].URL, width-2), index == m.coreSelection, m.focus == paneCores),
			target: mouseTarget{kind: hitCore, index: index},
		})
	}
	return rows
}

// selectableRow は選択マーカー付きの行。focusが外れていても選択位置は
// markerで示し、反転はfocus中だけにする（どこが選ばれてるか常に見える）。
func selectableRow(label string, selected, focused bool) string {
	if selected {
		if focused {
			return styleSelected.Render("▸ " + label)
		}
		return styleCursor.Render("▸ ") + label
	}
	return "  " + label
}

// ---- pluginsペイン ----

func (m *Model) localPluginRows(width, height int) []paneRow {
	if m.addingLaunchCommand {
		return textRows(
			styleLabel.Render("REGISTER STARTUP COMMAND"),
			m.addInput.View(),
			"",
			styleDim.Render("name <command>"),
		)
	}
	switch {
	case m.localPluginsError != nil:
		return textRows(styleError.Render("Discovery failed"))
	case len(m.pluginRows) == 0 && m.localPluginsLoading:
		return textRows(styleDim.Render("Looking for Plugins…"))
	case len(m.pluginRows) == 0:
		return textRows(styleDim.Render("No Plugins"), styleDim.Render("a: register name + command"))
	}
	// 名前と実行情報の2行を同じクリック対象にする。
	capacity := max(1, height/2)
	start, end := visibleRange(len(m.pluginRows), m.pluginSelection, capacity)
	var rows []paneRow
	for index := start; index < end; index++ {
		row := m.pluginRows[index]
		selected := index == m.pluginSelection
		name := row.name
		if row.version != "" {
			name += " " + row.version
		}
		if !row.running {
			name = styleDim.Render(name)
		}
		target := mouseTarget{kind: hitPlugin, index: index}
		rows = append(rows, paneRow{
			text:   selectableRow(fitLine(name, width-2), selected, m.focus == panePlugins),
			target: target,
		})
		var sub string
		switch {
		case row.running:
			sub = row.instanceID
		case row.command != "":
			sub = "stopped · " + row.command
		default:
			sub = "no launch command"
		}
		rows = append(rows, paneRow{text: "  " + styleDim.Render(fitLine(sub, width-2)), target: target})
	}
	return rows
}

// ---- detailペイン ----

func (m *Model) detailContent(width, height int) []paneRow {
	switch m.detailMode {
	case detailCall:
		return textRows(m.callRows(height)...)
	case detailHelp:
		return textRows(helpRows...)
	}
	if m.logView != nil {
		return textRows(m.logViewRows(height)...)
	}
	return m.browseRows(width, height)
}

// logViewRows は `l`で開いたlogの全面表示。Core・Pluginどちらの
// ログでもpathをtail読みして、offsetぶん末尾からさかのぼる。
func (m *Model) logViewRows(height int) []string {
	view := m.logView
	rows := []string{
		styleOK.Render(view.title),
		sectionTitle("LOG", -1, m.focus == paneDetail),
	}
	visible := height - len(rows)
	if visible < 1 {
		return rows
	}
	// 表示分＋さかのぼり分をまとめて読み、offsetぶん末尾から捨てる
	lines := tailLines(view.path, view.offset+visible)
	maxOffset := max(0, len(lines)-visible)
	view.offset = min(view.offset, maxOffset)
	lines = lines[:len(lines)-view.offset]
	if len(lines) > visible {
		lines = lines[len(lines)-visible:]
	}
	if len(lines) == 0 {
		lines = []string{styleDim.Render("(empty)")}
	}
	return append(rows, lines...)
}

// browseRows はCoreの接続先、登録ツリー、ログを並べる。
// 領域は先に割り当てて中身だけ流すので、読み込みやフォーカスで見出しが動かない。
func (m *Model) browseRows(width, height int) []paneRow {
	var coreLine string
	if m.client == nil {
		coreLine = styleDim.Render("choose a Core in 1 Cores")
	} else {
		coreLine = styleOK.Render(m.viewedCore.URL)
	}
	rest := height - 1
	logH := min(6, max(3, rest/4))
	treeH := rest - logH

	rows := make([]paneRow, 1+treeH, height)
	rows[0].text = coreLine
	copy(rows[1:], m.registrationTreeRows(width, treeH))
	return append(rows, textRows(m.logSectionRows(width, logH)...)...)
}

func (m *Model) registrationTreeRows(width, height int) []paneRow {
	interactive := m.client != nil
	focused := m.focus == paneDetail
	rows := textRows(sectionTitle("REGISTRATIONS", m.catalogCount(len(m.registrations)), focused))
	if height < 2 {
		return rows
	}
	if len(m.rows) == 0 {
		return append(rows, paneRow{text: m.catalogMessage("No registrations")})
	}
	selection := m.detailSelection
	if !interactive {
		selection = -1
	}
	start, end := visibleRange(len(m.rows), selection, height-1)
	for index := start; index < end; index++ {
		row := m.rows[index]
		if row.operation != nil {
			label := "  " + selectableRow(operationLabel(row.operation, row.registration.ProviderID), index == selection, focused)
			rows = append(rows, paneRow{text: label, target: mouseTarget{kind: hitTool, index: index}})
			continue
		}
		state := styleWarn.Render("WAIT")
		if row.registration.RPCAvailable {
			state = styleOK.Render("LIVE")
		}
		label := selectableRow(registrationLabel(row.registration, width-9), index == selection, focused)
		rows = append(rows, paneRow{
			text:   fitLine(label, width-5) + "  " + state,
			target: mouseTarget{kind: hitRegistration, index: index},
		})
	}
	return rows
}

func (m *Model) logSectionRows(width, height int) []string {
	rows := []string{sectionTitle("LOG", -1, false)}
	if height < 2 {
		return rows
	}
	switch {
	case m.client == nil:
		return append(rows, styleDim.Render("—"))
	case m.viewedCore.LogPath == "":
		return append(rows, styleDim.Render("no log file (not started via plugumi start)"))
	case len(m.logLines) == 0:
		return append(rows, styleDim.Render("log is empty"))
	}
	start := max(0, len(m.logLines)-(height-1))
	for _, line := range m.logLines[start:] {
		rows = append(rows, fitLine(styleDim.Render(line), width))
	}
	return rows
}

// ---- detailCall ----

func (m *Model) callRows(height int) []string {
	label := "JSON INPUT"
	var input []string
	if m.callState == callInput {
		input = strings.Split(m.inputArea.View(), "\n")
		label += "  /  empty = no input"
	} else {
		if len(m.pendingInput) != 0 {
			input = strings.Split(displayJSON(m.pendingInput), "\n")
		} else {
			input = []string{styleDim.Render("No input")}
		}
	}
	output := "OUTPUT"
	if m.callOperation != nil {
		output += "  /  " + m.callOperation.Path
	}
	switch m.callState {
	case callPreparing:
		output += "  /  connecting"
	case callActive:
		output += "  /  running"
	case callFinished:
		output += "  /  done"
	}
	rows := []string{styleLabel.Render(label)}
	rows = append(rows, fitRows(input, callInputRows(height))...)
	rows = append(rows, styleLabel.Render(output))
	return append(rows, strings.Split(m.callChunks.View(), "\n")...)
}

func callInputRows(height int) int { return min(5, max(1, height/3)) }

// ---- helpers ----

func sectionTitle(label string, count int, active bool) string {
	value := "—"
	if count >= 0 {
		value = fmt.Sprint(count)
	}
	style := styleHeader
	if active {
		style = styleLabel
	}
	return style.Render(label) + styleDim.Render("  /  "+value)
}

func visibleRange(length, selection, capacity int) (start, end int) {
	start = max(0, selection-capacity+1)
	return start, min(length, start+capacity)
}

// fitLine は表示を必ず1行width以内に収める。lipglossのMaxWidthは
// 切り捨てではなく折り返しなので、長い行は崩れずセクション位置を保つよう
// ANSI対応のtruncateで切る。
func fitLine(line string, width int) string {
	line = singleLine.Replace(line)
	return ansi.Truncate(line, width, "")
}

var singleLine = strings.NewReplacer("\r", " ", "\n", " ", "\t", " ")

func fitRows(lines []string, height int) []string {
	rows := make([]string, height)
	copy(rows, lines)
	return rows
}

func keys(pairs ...string) string {
	var labels []string
	for index := 0; index < len(pairs); index += 2 {
		labels = append(labels, styleLabel.Render(pairs[index])+" "+pairs[index+1])
	}
	return strings.Join(labels, "  ")
}
