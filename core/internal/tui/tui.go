// Model本体。画面遷移ではなく3ペイン（panes.go）＋detailModeの
// 中身差し替えで状態を表す。call画面もdetailペイン内モード。
package tui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
	"github.com/naatin777/plugumi/core/internal/wire"
)

// callState は入力、接続準備、呼び出し、取消後の結果待ちを区別する。
type callState int

const (
	callInput callState = iota
	callPreparing
	callActive
	callFinished
)

// Model はplugumi tuiのTUI状態。
type Model struct {
	width      int
	height     int
	focus      pane
	detailMode detailMode

	// cores pane
	actions           Actions
	cores             []coreinstances.Instance
	coreSelection     int
	coresLoading      bool
	coresError        error
	coreActionPending bool
	confirmCore       coreinstances.Instance
	confirmVerb       string // "Stop" | "Restart"

	// plugins pane（catalog ∪ 実行中registry。Coreとは独立のライフサイクル）
	pluginRows           []pluginRow
	pluginSelection      int
	localPluginsLoading  bool
	localPluginsError    error
	addingLaunchCommand  bool
	addInput             textinput.Model
	pendingPluginRefresh bool
	// `l`で開いたlogの全面表示。Core・Pluginどちらのlogでも入る。
	logView *logView

	// detail pane（選択したCoreの登録・Tool・ログ）
	coreView

	// callモード
	callOperation  *wire.OperationDeclaration
	callTicket     *CallTicket
	callID         string
	callGeneration int // requestCallごとに+1。古いticketMsgを弾く世代番号
	callState      callState
	callLines      []string
	pendingInput   json.RawMessage
	inputArea      textarea.Model
	callChunks     viewport.Model

	// mouseヒットテスト。View()が構築し、次のMouseMsgが参照する。
	hits        map[pane]paneHits
	lastClick   locatedTarget
	lastClickAt time.Time

	statusMsg string
}

func New(actions Actions) *Model {
	inputArea := textarea.New()
	inputArea.SetHeight(5)
	inputArea.Prompt = ""
	// detailペインは狭いので行番号gutterを切る
	inputArea.ShowLineNumbers = false

	addInput := textinput.New()
	addInput.Placeholder = "name <command>"
	addInput.CharLimit = 256

	return &Model{
		focus:           paneCores,
		inputArea:       inputArea,
		addInput:        addInput,
		callChunks:      viewport.New(viewport.WithWidth(10), viewport.WithHeight(3)),
		actions:         actions,
		coreSelection:   -1,
		pluginSelection: -1,
		hits:            map[pane]paneHits{},
	}
}

func (m *Model) Disconnect() {
	if m.client != nil {
		m.client.disconnect()
	}
}

func (m *Model) Init() tea.Cmd {
	return tea.Batch(m.refreshCores(), m.refreshPlugins(), tickCmd())
}

// ---- msgs ----

type ticketMsg struct {
	ticket     *CallTicket
	generation int
	err        error
}

type callDoneMsg struct {
	client    *Client
	callID    string
	execution *wire.Execution
	rpcErr    *wire.RPCError
	err       error
}

type eventMsg struct {
	client *Client
	event  Event
}

type registryChangeMsg struct{ client *Client }

type setStatusMsg struct {
	client  *Client
	text    string
	refresh bool
}

type tickMsg struct{}

// ---- cmds ----

func ticketCmd(client *Client, generation int) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		ticket, err := client.NewCallTicket(ctx)
		return ticketMsg{ticket: ticket, generation: generation, err: err}
	}
}

func callCmd(client *Client, ticket *CallTicket, params wire.InvokeParams) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 130*time.Second)
		defer cancel()
		execution, rpcErr, err := client.Invoke(ctx, ticket, params)
		return callDoneMsg{
			client: client, callID: ticket.CallID(), execution: execution,
			rpcErr: rpcErr, err: err,
		}
	}
}

func removePluginCmd(client *Client, registrationID string) tea.Cmd {
	return func() tea.Msg {
		if err := client.RemovePlugin(registrationID); err != nil {
			return setStatusMsg{client: client, text: styleError.Render("registration removal failed: " + err.Error())}
		}
		return setStatusMsg{client: client, text: styleOK.Render("Removed " + registrationID), refresh: true}
	}
}

func waitEventCmd(client *Client) tea.Cmd {
	return func() tea.Msg {
		select {
		case event := <-client.events:
			return eventMsg{client: client, event: event}
		case <-client.ctx.Done():
			return nil
		}
	}
}

func waitRegistryChangeCmd(client *Client) tea.Cmd {
	return func() tea.Msg {
		select {
		case <-client.registryChanges:
			return registryChangeMsg{client: client}
		case <-client.ctx.Done():
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

	case tea.KeyPressMsg:
		if msg.String() == "ctrl+c" {
			// 終了時は切断に任せる。Coreが実行中の呼び出しにcloseを転送する。
			return m, tea.Quit
		}
		return m.updateKey(msg)

	case tea.MouseClickMsg:
		return m, m.onMouseClick(msg)

	case tea.MouseWheelMsg:
		return m, m.onMouseWheel(msg)

	case tea.MouseMotionMsg:
		return m, m.onMouseMotion(msg)

	case coreViewMsg:
		if msg.client != m.client {
			return m, nil
		}
		m.registryRefreshPending = false
		m.updateCoreView(msg)
		if m.registryRefreshAgain {
			m.registryRefreshAgain = false
			return m, m.refreshCoreView()
		}
		return m, nil

	case registryChangeMsg:
		if msg.client == m.client {
			return m, tea.Batch(m.refreshCoreView(), waitRegistryChangeCmd(msg.client))
		}
		return m, nil

	case pluginListMsg:
		m.updatePluginList(msg)
		return m, nil

	case logTailMsg:
		m.updateLogTail(msg)
		return m, nil

	case ticketMsg:
		// 準備を離れた後に、遅れて届いた結果で呼び出しを始めない。
		if msg.generation != m.callGeneration || m.detailMode != detailCall || m.callState != callPreparing {
			return m, nil
		}
		if msg.err != nil {
			m.appendCallLine(styleError.Render("connect failed: " + msg.err.Error()))
			m.callState = callFinished
			return m, nil
		}
		// id確定済みなので、以後のchunk/result通知をcallIDで照合できる。
		m.callTicket = msg.ticket
		m.callID = msg.ticket.CallID()
		m.callState = callActive
		m.appendCallLine("→ invoking " + m.callOperation.Path)
		return m, callCmd(m.client, msg.ticket, wire.InvokeParams{
			Operation: m.callOperation.Path,
			Input:     m.pendingInput,
		})

	case callDoneMsg:
		// 前のcallの遅れ応答を新しいcallへ混ぜない
		if msg.client != m.client || msg.callID != m.callID {
			return m, nil
		}
		m.onCallDone(msg)
		return m, nil


	case eventMsg:
		if msg.client != m.client {
			return m, nil
		}
		m.onEvent(msg.event)
		// events channelを読み続けるために再度待つ
		return m, waitEventCmd(m.client)

	case setStatusMsg:
		if msg.client == m.client {
			m.statusMsg = msg.text
			if msg.refresh {
				return m, m.refreshCoreView()
			}
		}
		return m, nil

	case coreListMsg:
		m.updateCoreList(msg)
		return m, nil

	case coreActionMsg:
		return m, m.updateCoreAction(msg)

	case pluginActionMsg:
		if msg.err != nil {
			m.statusMsg = styleError.Render(msg.err.Error())
		} else {
			m.statusMsg = ""
		}
		return m, m.refreshPlugins()

	case tickMsg:
		var refresh tea.Cmd
		if m.loadError != nil {
			refresh = m.refreshCoreView()
		}
		return m, tea.Batch(refresh, m.refreshCores(), m.refreshPlugins(), m.readCoreLog(), tickCmd())
	}
	return m, nil
}

func (m *Model) updateKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	// モーダル系はグローバルキーより先に食わせる
	if m.confirmCore.ID != "" {
		return m, m.confirmCoreKey(msg)
	}
	if m.confirmRemoveRegistrationID != "" {
		return m, m.confirmRemoveRegistrationKey(msg)
	}
	if m.addingLaunchCommand {
		return m.updateAddLaunchCommandKey(msg)
	}
	if m.detailMode == detailCall {
		return m.updateCallKey(msg)
	}

	switch msg.String() {
	case "tab":
		m.cycleFocus(1)
		return m, nil
	case "shift+tab":
		m.cycleFocus(-1)
		return m, nil
	case "1":
		m.focusPane(paneCores)
		return m, nil
	case "2":
		m.focusPane(panePlugins)
		return m, nil
	case "3":
		m.focusPane(paneDetail)
		return m, nil
	case "esc":
		if m.logView != nil {
			m.logView = nil
			return m, nil
		}
		if m.detailMode == detailHelp {
			m.detailMode = detailBrowse
			return m, nil
		}
		if m.focus != paneCores {
			m.focusPane(paneCores)
			return m, nil
		}
	case "?":
		if m.detailMode == detailHelp {
			m.detailMode = detailBrowse
		} else {
			m.detailMode = detailHelp
		}
		return m, nil
	case "r":
		return m, tea.Batch(m.refreshCores(), m.refreshPlugins(), m.refreshCoreView(), m.readCoreLog())
	case "q":
		return m, tea.Quit
	}

	var cmd tea.Cmd
	switch m.focus {
	case paneCores:
		_, cmd = m.updateCoresPaneKey(msg)
	case panePlugins:
		_, cmd = m.updatePluginsPaneKey(msg)
	case paneDetail:
		_, cmd = m.updateDetailKey(msg)
	}
	// catalog登録・解除後は一覧を取り直す。ペイン側のhandlerから
	// cmdを返せない経路（追加入力のenterなど）用にフラグで受ける。
	if m.pendingPluginRefresh {
		m.pendingPluginRefresh = false
		return m, tea.Batch(cmd, m.refreshPlugins())
	}
	return m, cmd
}

// ---- callモード ----

func (m *Model) openCall(row detailRow) (tea.Model, tea.Cmd) {
	// Snapshotの更新後も、呼び出しは選択時点のoperationを使う。
	operationCopy := *row.operation
	m.callOperation = &operationCopy
	m.callState = callInput
	m.callID = ""
	m.callTicket = nil
	m.callLines = nil
	m.statusMsg = ""
	m.inputArea.SetValue("")
	m.inputArea.Focus()
	m.detailMode = detailCall
	m.focus = paneDetail
	m.resize()
	return m, nil
}

func (m *Model) updateCallKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if m.callState == callInput {
		// esc・ctrl+sはtextareaへ渡す前に処理する
		// （textareaのキーバインドと二重解釈しないため）。
		switch msg.String() {
		case "ctrl+s":
			return m.requestCall()
		case "esc":
			m.detailMode = detailBrowse
			m.inputArea.Blur()
			return m, nil
		}
		var cmd tea.Cmd
		m.inputArea, cmd = m.inputArea.Update(msg)
		return m, cmd
	}
	switch msg.String() {
	case "pgup":
		m.callChunks.HalfPageUp()
		return m, nil
	case "pgdown":
		m.callChunks.HalfPageDown()
		return m, nil
	case "esc":
		// executions.cancelは未実装。active中に抜けてもExecutionはCore側で進行する。
		m.callID = ""
		m.callTicket = nil
		m.callState = callFinished
		m.statusMsg = ""
		m.detailMode = detailBrowse
		m.inputArea.Blur()
	}
	return m, nil
}

// requestCall は入力JSONを検証し、call ticketの発行を始める。
// 実際の送信はticketMsg処理時（callIDが確定してから）。
func (m *Model) requestCall() (tea.Model, tea.Cmd) {
	if m.callOperation == nil {
		return m, nil
	}
	raw := strings.TrimSpace(m.inputArea.Value())
	if raw != "" && !json.Valid([]byte(raw)) {
		m.statusMsg = styleError.Render("invalid JSON input")
		return m, nil
	}
	if raw == "" {
		m.pendingInput = nil
	} else {
		m.pendingInput = json.RawMessage(raw)
	}
	m.inputArea.Blur()
	m.statusMsg = ""
	m.callGeneration++
	m.callState = callPreparing
	return m, ticketCmd(m.client, m.callGeneration)
}

func (m *Model) onCallDone(msg callDoneMsg) {
	if m.callState == callFinished {
		return
	}
	switch {
	case msg.err != nil:
		m.appendCallLine(styleError.Render("invoke failed: " + msg.err.Error()))
		m.callState = callFinished
	case msg.rpcErr != nil:
		m.appendCallLine(styleError.Render(fmt.Sprintf("error %d: %s", msg.rpcErr.Code, msg.rpcErr.Message)))
		m.callState = callFinished
	default:
		execution := msg.execution
		m.appendCallLine("execution " + execution.ID + "  status: " + execution.Status)
		if execution.Progress != nil {
			m.appendCallLine("progress:")
			m.appendCallLine(indentJSON(execution.Progress))
		}
		if execution.Result != nil {
			m.appendCallLine("result:")
			m.appendCallLine(indentJSON(execution.Result))
		}
		if execution.Error != nil {
			errorJSON := wire.Marshal(execution.Error)
			m.appendCallLine("error:")
			m.appendCallLine(indentJSON(errorJSON))
		}
		m.callState = callFinished
	}
}

func (m *Model) onEvent(event Event) {
	if event.Kind == EventConnectionClosed {
		m.statusMsg = styleWarn.Render("call channel disconnected — will reconnect on next call")
		if m.detailMode == detailCall && m.callState == callActive {
			m.appendCallLine(styleError.Render("connection lost"))
			m.callState = callFinished
		}
		return
	}
}

func (m *Model) appendCallLine(line string) {
	m.callLines = append(m.callLines, line)
	if len(m.callLines) > 2000 {
		m.callLines = m.callLines[len(m.callLines)-2000:]
	}
	m.refreshViewport()
}

func (m *Model) refreshViewport() {
	if m.callChunks.Width() == 0 {
		return
	}
	m.callChunks.SetContent(strings.Join(m.callLines, "\n"))
	m.callChunks.GotoBottom()
}

// ---- resize / layout ----

func (m *Model) resize() {
	if !m.hasWorkspace() {
		return
	}
	width := m.paneWidth(paneDetail)
	m.addInput.SetWidth(m.paneWidth(panePlugins) - 3)
	if m.detailMode == detailCall {
		height := m.bodyHeight() - 1 // paneヘッダ行を引く
		inputRows := callInputRows(height)
		m.inputArea.SetWidth(width)
		m.inputArea.SetHeight(inputRows)
		m.callChunks.SetWidth(width)
		m.callChunks.SetHeight(height - inputRows - 3)
		m.refreshViewport()
	}
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
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return string(raw)
	}
	return buf.String()
}

func indentJSON(raw json.RawMessage) string {
	out := displayJSON(raw)
	lines := strings.Split(out, "\n")
	for i := range lines {
		lines[i] = "  " + lines[i]
	}
	return strings.Join(lines, "\n")
}
