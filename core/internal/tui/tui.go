package tui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/naatin777/plugumi/core/internal/wire"
)

// screen はTUIの表示面。dashboardが一覧、callがTool呼び出し、
// addPluginがEndpoint登録、logsがcoreログ閲覧。
type screen int

const (
	screenDashboard screen = iota
	screenCall
	screenAddPlugin
	screenLogs
)

// callState はcall画面のフェーズ。
// input=JSON入力中、active=call実行中（受理〜終端待ち）、
// finished=終端（結果・エラー）まで到達。
type callState int

const (
	callInput callState = iota
	callActive
	callFinished
)

var (
	styleHeader   = lipgloss.NewStyle().Bold(true)
	styleDim      = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	styleError    = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
	styleOK       = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	styleWarn     = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))
	stylePanel    = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1)
	styleSelected = lipgloss.NewStyle().Reverse(true)
)

// Model はplugumi tuiのTUI状態。
type Model struct {
	client  *Client
	coreURL string
	screen  screen
	width   int
	height  int

	// dashboard
	plugins    []wire.RegisteredPlugin
	pluginSel  int
	tools      []wire.ListedTool
	toolSel    int
	panel      int               // 0=plugins, 1=tools
	pluginByID map[string]string // linkId → pluginId（tools行の表示用）

	// plugins panelでd押下後の確認待ち。endpointを保持し、
	// 確認までに一覧がrefreshされても対象がずれないようにする
	confirmRemoveEndpoint string

	// call screen
	callTool      *wire.ListedTool
	callTicket    *CallTicket
	callID        string
	callState     callState
	closeSent     bool
	callLines     []string
	pendingTarget wire.CallTarget
	pendingInput  json.RawMessage
	input         textarea.Model
	out           viewport.Model

	// add plugin screen
	addInput textinput.Model

	// logs
	logs  []string
	logCh chan string

	statusMsg string
	events    <-chan Event
}

// New はTUIのModelを組み立てる。logBufの溜まった行を初期ログに取り込み、
// 以後の行はlogCh経由で画面に流す。
func New(client *Client, coreURL string, logBuf *LogBuffer) *Model {
	input := textarea.New()
	input.SetHeight(5)
	input.Prompt = ""

	addInput := textinput.New()
	addInput.Placeholder = "http://127.0.0.1:9001"
	addInput.CharLimit = 256

	m := &Model{
		client:   client,
		coreURL:  coreURL,
		input:    input,
		addInput: addInput,
		out:      viewport.New(10, 3),
		logs:     logBuf.Drain(),
		logCh:    make(chan string, 256),
		events:   client.Events(),
	}
	logBuf.SetSink(m.logCh)
	return m
}

func (m *Model) Init() tea.Cmd {
	return tea.Batch(
		refreshCmd(m.client),
		waitEventCmd(m.events),
		waitLogCmd(m.logCh),
		tickCmd(),
	)
}

// ---- msgs ----

type dashboardMsg struct {
	plugins []wire.RegisteredPlugin
	tools   []wire.ListedTool
	err     error
}

type ticketMsg struct {
	ticket *CallTicket
	err    error
}

type callDoneMsg struct {
	callID  string
	outcome CallOutcome
	result  json.RawMessage
	rpcErr  *wire.Error
	err     error
}

type eventMsg struct{ event Event }

type logLineMsg struct{ line string }

type setStatusMsg struct{ text string }

type tickMsg struct{}

// ---- cmds ----

func refreshCmd(client *Client) tea.Cmd {
	return func() tea.Msg {
		plugins, perr := client.ListPlugins()
		tools, terr := client.ListTools()
		if perr != nil || terr != nil {
			return dashboardMsg{err: firstErr(perr, terr)}
		}
		return dashboardMsg{plugins: plugins, tools: tools}
	}
}

func firstErr(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

func ticketCmd(client *Client) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		ticket, err := client.NewCallTicket(ctx)
		return ticketMsg{ticket: ticket, err: err}
	}
}

func callCmd(client *Client, ticket *CallTicket, linkID, toolPath string, input json.RawMessage) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 130*time.Second)
		defer cancel()
		outcome, result, rpcErr, err := client.Call(ctx, ticket, linkID, toolPath, input)
		return callDoneMsg{
			callID: CallIDString(ticket), outcome: outcome,
			result: result, rpcErr: rpcErr, err: err,
		}
	}
}

func addPluginCmd(client *Client, endpoint string) tea.Cmd {
	return func() tea.Msg {
		if err := client.AddPlugin(endpoint); err != nil {
			return setStatusMsg{text: styleError.Render("add failed: " + err.Error())}
		}
		return setStatusMsg{text: styleOK.Render("endpoint registered: " + endpoint)}
	}
}

func removePluginCmd(client *Client, endpoint string) tea.Cmd {
	return func() tea.Msg {
		if err := client.RemovePlugin(endpoint); err != nil {
			return setStatusMsg{text: styleError.Render("remove failed: " + err.Error())}
		}
		return setStatusMsg{text: styleOK.Render("endpoint removed: " + endpoint)}
	}
}

func waitEventCmd(ch <-chan Event) tea.Cmd {
	return func() tea.Msg {
		select {
		case event := <-ch:
			return eventMsg{event: event}
		case <-time.After(24 * time.Hour):
			return nil
		}
	}
}

func waitLogCmd(ch <-chan string) tea.Cmd {
	return func() tea.Msg {
		select {
		case line := <-ch:
			return logLineMsg{line: line}
		case <-time.After(24 * time.Hour):
			return nil
		}
	}
}

func tickCmd() tea.Cmd {
	return tea.Tick(2*time.Second, func(time.Time) tea.Msg { return tickMsg{} })
}

// ---- Update ----

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.resize()
		return m, nil

	case tea.KeyMsg:
		if msg.Type == tea.KeyCtrlC {
			m.closeActiveCall()
			return m, tea.Quit
		}
		return m.updateKey(msg)

	case dashboardMsg:
		if msg.err != nil {
			m.statusMsg = styleError.Render("refresh failed: " + msg.err.Error())
			return m, nil
		}
		m.plugins = msg.plugins
		m.tools = msg.tools
		m.rebuildPluginIndex()
		m.clampSelections()
		return m, nil

	case ticketMsg:
		if msg.err != nil {
			m.appendCallLine(styleError.Render("connect failed: " + msg.err.Error()))
			m.callState = callFinished
			return m, nil
		}
		// id確定済みなので、以後のoutput/result通知をcallIDで照合できる。
		m.callTicket = msg.ticket
		m.callID = CallIDString(msg.ticket)
		m.callState = callActive
		return m, callCmd(m.client, msg.ticket,
			m.pendingTarget.LinkID, m.pendingTarget.ToolPath, m.pendingInput)

	case callDoneMsg:
		// 前のcallの遅れ応答を新しいcallへ混ぜない
		if msg.callID != m.callID {
			return m, nil
		}
		m.onCallDone(msg)
		return m, nil

	case eventMsg:
		m.onEvent(msg.event)
		// events channelを読み続けるために再度待つ
		return m, waitEventCmd(m.events)

	case logLineMsg:
		m.logs = append(m.logs, msg.line)
		if len(m.logs) > 500 {
			m.logs = m.logs[len(m.logs)-500:]
		}
		return m, waitLogCmd(m.logCh)

	case setStatusMsg:
		m.statusMsg = msg.text
		return m, nil

	case tickMsg:
		return m, tea.Batch(refreshCmd(m.client), tickCmd())
	}
	return m, nil
}

func (m *Model) updateKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch m.screen {
	case screenDashboard:
		return m.updateDashboardKey(msg)
	case screenCall:
		return m.updateCallKey(msg)
	case screenAddPlugin:
		return m.updateAddKey(msg)
	case screenLogs:
		if msg.String() == "esc" || msg.String() == "q" {
			m.screen = screenDashboard
		}
	}
	return m, nil
}

func (m *Model) updateDashboardKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q":
		return m, tea.Quit
	case "tab", "right", "left":
		m.panel = 1 - m.panel
	case "up", "k":
		m.moveSel(-1)
	case "down", "j":
		m.moveSel(1)
	case "pgup":
		m.moveSel(-10)
	case "pgdown":
		m.moveSel(10)
	case "enter", "c":
		if m.panel == 1 && m.toolSel >= 0 && m.toolSel < len(m.tools) {
			return m.openCallScreen(&m.tools[m.toolSel])
		}
	case "a":
		m.screen = screenAddPlugin
		m.addInput.SetValue("")
		m.addInput.Focus()
		return m, textinput.Blink
	case "d":
		return m.requestRemovePlugin()
	case "l":
		m.screen = screenLogs
	case "r":
		return m, refreshCmd(m.client)
	}
	return m, nil
}

func (m *Model) updateCallKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.callState == callInput {
		// esc・ctrl+sはtextareaへ渡す前に処理する
		// （textareaのキーバインドと二重解釈しないため）。
		switch msg.String() {
		case "ctrl+s":
			return m.requestCall()
		case "esc":
			m.screen = screenDashboard
			m.input.Blur()
			return m, nil
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		return m, cmd
	}
	switch msg.String() {
	case "pgup":
		m.out.HalfPageUp()
		return m, nil
	case "pgdown":
		m.out.HalfPageDown()
		return m, nil
	case "esc":
		if m.callState == callActive && !m.closeSent {
			// まずcloseを送り、結果が来るか再度escするまで待つ
			m.closeActiveCall()
			m.closeSent = true
			m.statusMsg = "close sent — esc again to leave"
		} else {
			m.closeActiveCall()
			m.screen = screenDashboard
			m.input.Blur()
		}
	}
	return m, nil
}

func (m *Model) updateAddKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.screen = screenDashboard
		m.addInput.Blur()
		return m, nil
	case "enter":
		endpoint := strings.TrimSpace(m.addInput.Value())
		m.addInput.Blur()
		m.screen = screenDashboard
		if endpoint == "" {
			return m, nil
		}
		return m, tea.Batch(addPluginCmd(m.client, endpoint), refreshCmd(m.client))
	}
	var cmd tea.Cmd
	m.addInput, cmd = m.addInput.Update(msg)
	return m, cmd
}

// ---- dashboard helpers ----

func (m *Model) moveSel(delta int) {
	n := len(m.tools)
	sel := &m.toolSel
	if m.panel == 0 {
		n = len(m.plugins)
		sel = &m.pluginSel
	}
	if n == 0 {
		return
	}
	*sel += delta
	if *sel < 0 {
		*sel = 0
	}
	if *sel >= n {
		*sel = n - 1
	}
}

func (m *Model) clampSelections() {
	if m.pluginSel >= len(m.plugins) {
		m.pluginSel = max(0, len(m.plugins)-1)
	}
	if m.toolSel >= len(m.tools) {
		m.toolSel = max(0, len(m.tools)-1)
	}
}

func (m *Model) rebuildPluginIndex() {
	m.pluginByID = map[string]string{}
	for _, p := range m.plugins {
		if p.LinkID != "" {
			m.pluginByID[p.LinkID] = p.PluginID
		}
	}
}

func (m *Model) requestRemovePlugin() (tea.Model, tea.Cmd) {
	// panelを行き来しても誤爆しないよう、両分岐でplugins panelを要求する
	if m.panel != 0 || len(m.plugins) == 0 {
		m.confirmRemoveEndpoint = ""
		return m, nil
	}
	if m.confirmRemoveEndpoint != "" {
		endpoint := m.confirmRemoveEndpoint
		m.confirmRemoveEndpoint = ""
		return m, tea.Batch(removePluginCmd(m.client, endpoint), refreshCmd(m.client))
	}
	if m.pluginSel >= 0 && m.pluginSel < len(m.plugins) {
		m.confirmRemoveEndpoint = m.plugins[m.pluginSel].Endpoint
		m.statusMsg = "d again to confirm remove " + m.confirmRemoveEndpoint
	}
	return m, nil
}

// ---- call screen ----

func (m *Model) openCallScreen(tool *wire.ListedTool) (tea.Model, tea.Cmd) {
	// tools一覧はrefreshで差し替わるため、選択時点の値をコピーして保持する
	toolCopy := *tool
	m.callTool = &toolCopy
	m.callState = callInput
	m.callID = ""
	m.callTicket = nil
	m.closeSent = false
	m.callLines = nil
	m.input.SetValue("")
	m.input.Focus()
	m.screen = screenCall
	m.resize()
	return m, nil
}

// requestCall は入力JSONを検証し、call ticketの発行を始める。
// 実際の送信はticketMsg処理時（callIDが確定してから）。
func (m *Model) requestCall() (tea.Model, tea.Cmd) {
	if m.callTool == nil {
		return m, nil
	}
	raw := strings.TrimSpace(m.input.Value())
	if raw != "" && !json.Valid([]byte(raw)) {
		m.statusMsg = styleError.Render("invalid JSON input")
		return m, nil
	}
	m.pendingTarget = wire.CallTarget{LinkID: m.callTool.LinkID, ToolPath: m.callTool.ToolPath}
	if raw == "" {
		m.pendingInput = nil
	} else {
		m.pendingInput = json.RawMessage(raw)
	}
	m.input.Blur()
	m.callState = callActive // ticket待ち。callIDはticketMsgで確定
	m.appendCallLine("→ calling " + m.callTool.ToolPath)
	return m, ticketCmd(m.client)
}

func (m *Model) onCallDone(msg callDoneMsg) {
	switch {
	case msg.err != nil:
		m.appendCallLine(styleError.Render("call failed: " + msg.err.Error()))
		m.callState = callFinished
	case msg.rpcErr != nil:
		m.appendCallLine(styleError.Render(fmt.Sprintf("error %d: %s", msg.rpcErr.Code, msg.rpcErr.Message)))
		m.callState = callFinished
	case msg.outcome == CallAsync:
		m.appendCallLine(styleOK.Render("accepted — waiting for output/result"))
	case msg.outcome == CallSyncDone:
		m.appendCallLine("result:")
		m.appendCallLine(indentJSON(msg.result))
		m.callState = callFinished
	}
}

func (m *Model) onEvent(event Event) {
	if event.Kind == "conn-closed" {
		m.statusMsg = styleWarn.Render("call channel disconnected — will reconnect on next call")
		if m.screen == screenCall && m.callState == callActive {
			m.appendCallLine(styleError.Render("connection lost"))
			m.callState = callFinished
		}
		return
	}
	if m.screen != screenCall || event.CallID != m.callID || m.callID == "" {
		return
	}
	switch event.Kind {
	case "output":
		// 途中出力は高頻度なので1行compactで流す
		m.appendCallLine("out " + compactJSON(event.Payload))
	case "result":
		if event.Err != nil {
			m.appendCallLine(styleError.Render(fmt.Sprintf("error %d: %s", event.Err.Code, event.Err.Message)))
		} else {
			m.appendCallLine("result:")
			m.appendCallLine(indentJSON(event.Result))
		}
		m.callState = callFinished
	}
}

func (m *Model) closeActiveCall() {
	if m.callState == callActive {
		m.client.Close(m.callTicket)
	}
	m.callID = ""
	m.callTicket = nil
	m.callState = callFinished
	m.closeSent = false
}

func (m *Model) appendCallLine(line string) {
	m.callLines = append(m.callLines, line)
	if len(m.callLines) > 2000 {
		m.callLines = m.callLines[len(m.callLines)-2000:]
	}
	m.refreshViewport()
}

func (m *Model) refreshViewport() {
	if m.out.Width == 0 {
		return
	}
	m.out.SetContent(strings.Join(m.callLines, "\n"))
	m.out.GotoBottom()
}

// ---- resize / layout ----

func (m *Model) resize() {
	if m.width == 0 {
		return
	}
	m.input.SetWidth(max(20, m.width-4))
	m.addInput.Width = max(20, m.width-4)
	if m.screen == screenCall {
		m.out.Width = max(10, m.width-4)
		m.out.Height = max(3, m.height-10)
		m.input.SetHeight(5)
		m.refreshViewport()
	}
}

// ---- View ----

func (m *Model) View() string {
	if m.width == 0 {
		return ""
	}
	var body string
	switch m.screen {
	case screenCall:
		body = m.viewCall()
	case screenAddPlugin:
		body = m.viewAddPlugin()
	case screenLogs:
		body = m.viewLogs()
	default:
		body = m.viewDashboard()
	}
	return body
}

func (m *Model) viewDashboard() string {
	panelW := max(20, (m.width-3)/2)
	// header 1行 + footer 最大2行 + 余白1行を引いた高さ
	panelH := max(4, m.height-4)
	// border上下2行 + タイトル行1行を引いた、項目に使える行数
	innerH := panelH - 3

	pluginsView := m.renderPluginList(panelW-4, innerH/2, "Plugins")
	toolsView := m.renderToolList(panelW-4, innerH, "Tools")

	left := stylePanel.Width(panelW).Height(panelH).Render(pluginsView)
	right := stylePanel.Width(panelW).Height(panelH).Render(toolsView)

	footer := m.footer("tab switch · enter call · a add · d remove · l logs · r refresh · q quit")
	return lipgloss.JoinVertical(lipgloss.Left,
		styleHeader.Render("plugumi — "+m.coreURL),
		lipgloss.JoinHorizontal(lipgloss.Top, left, right),
		footer,
	)
}

func (m *Model) renderPluginList(w, maxEntries int, title string) string {
	var b strings.Builder
	b.WriteString(styleHeader.Render(title))
	b.WriteString("\n")
	if len(m.plugins) == 0 {
		b.WriteString(styleDim.Render("(no plugins)"))
		return b.String()
	}
	for i, p := range m.plugins {
		if i >= maxEntries {
			break
		}
		status := styleWarn.Render("waiting")
		if p.LinkID != "" {
			status = styleOK.Render("connected")
		}
		pluginID := p.PluginID
		if pluginID == "" {
			pluginID = "-"
		}
		line := fmt.Sprintf("%s\n%s %s", p.Endpoint, pluginID, status)
		line = lipgloss.NewStyle().Width(w).Render(line)
		if m.panel == 0 && i == m.pluginSel {
			line = styleSelected.Render(line)
		}
		b.WriteString(line)
		b.WriteString("\n")
	}
	if m.confirmRemoveEndpoint != "" && m.panel == 0 {
		b.WriteString(styleError.Render("remove? d=yes"))
	}
	return b.String()
}

func (m *Model) renderToolList(w, maxEntries int, title string) string {
	var b strings.Builder
	b.WriteString(styleHeader.Render(title))
	b.WriteString("\n")
	if len(m.tools) == 0 {
		b.WriteString(styleDim.Render("(no tools)"))
		return b.String()
	}
	for i, t := range m.tools {
		if i >= maxEntries {
			break
		}
		pluginID := m.pluginByID[t.LinkID]
		kind := t.Kind
		if kind == "" {
			kind = "sync"
		}
		line := fmt.Sprintf("%s [%s] %s", t.ToolPath, kind, pluginID)
		line = lipgloss.NewStyle().Width(w).Render(line)
		if m.panel == 1 && i == m.toolSel {
			line = styleSelected.Render(line)
		}
		b.WriteString(line)
		b.WriteString("\n")
	}
	return b.String()
}

func (m *Model) viewCall() string {
	tool := m.callTool
	if tool == nil {
		return ""
	}
	pluginID := m.pluginByID[tool.LinkID]
	header := fmt.Sprintf("call %s [%s] @ %s", tool.ToolPath, tool.Kind, pluginID)

	var parts []string
	parts = append(parts, styleHeader.Render(header))
	if m.callState == callInput {
		parts = append(parts, styleDim.Render("input JSON (empty = no input) · ctrl+s send · esc back"))
		parts = append(parts, m.input.View())
	}
	parts = append(parts, m.out.View())
	stateLabel := map[callState]string{
		callInput:    "editing",
		callActive:   "running",
		callFinished: "done",
	}[m.callState]
	if m.closeSent {
		stateLabel += " (close sent)"
	}
	parts = append(parts, m.footer(fmt.Sprintf("%s · pgup/dn scroll · esc close/back · ctrl+c quit", stateLabel)))
	return lipgloss.JoinVertical(lipgloss.Left, parts...)
}

func (m *Model) viewAddPlugin() string {
	return lipgloss.JoinVertical(lipgloss.Left,
		styleHeader.Render("add plugin endpoint"),
		m.addInput.View(),
		styleDim.Render("enter submit · esc back"),
	)
}

func (m *Model) viewLogs() string {
	h := max(3, m.height-4)
	start := 0
	if len(m.logs) > h {
		start = len(m.logs) - h
	}
	lines := make([]string, 0, len(m.logs)-start)
	for _, line := range m.logs[start:] {
		lines = append(lines, truncateRunes(line, m.width))
	}
	body := strings.Join(lines, "\n")
	return lipgloss.JoinVertical(lipgloss.Left,
		styleHeader.Render("core log"),
		lipgloss.NewStyle().Width(m.width).Height(h).Render(body),
		styleDim.Render("esc back"),
	)
}

func (m *Model) footer(hints string) string {
	line := styleDim.Render(hints)
	if m.statusMsg != "" {
		return lipgloss.JoinVertical(lipgloss.Left, line, m.statusMsg)
	}
	return line
}

// ---- 表示ヘルパー ----

func truncateRunes(s string, width int) string {
	runes := []rune(s)
	if len(runes) <= width {
		return s
	}
	return string(runes[:max(0, width-1)]) + "…"
}

func compactJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "(empty)"
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return string(raw)
	}
	return buf.String()
}

func displayJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "(empty)"
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return string(raw)
	}
	switch v.(type) {
	case map[string]any, []any:
		var buf strings.Builder
		enc := json.NewEncoder(&buf)
		enc.SetIndent("", "  ")
		_ = enc.Encode(v)
		return strings.TrimRight(buf.String(), "\n")
	default:
		return string(raw)
	}
}

func indentJSON(raw json.RawMessage) string {
	out := displayJSON(raw)
	lines := strings.Split(out, "\n")
	for i := range lines {
		lines[i] = "  " + lines[i]
	}
	return strings.Join(lines, "\n")
}
