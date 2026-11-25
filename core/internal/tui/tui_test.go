package tui

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/server"
	"github.com/naatin777/plugumi/core/internal/wire"
)

func TestRegistryWatcherRefreshesOnCoreEvents(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	const token = "test-token"
	t.Setenv("PLUGUMI_TOKEN", token)
	core := httptest.NewServer(server.New(ctx, "test-core", "", token).Handler())
	defer core.Close()
	client, err := NewClient(core.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.disconnect()
	go client.watchRegistry()
	waitForChange := func() {
		t.Helper()
		select {
		case <-client.registryChanges:
		case <-ctx.Done():
			t.Fatal("did not receive Registry change")
		}
	}
	waitForChange()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, core.URL+"/v1/registrations",
		strings.NewReader(`{"providerId":"standard","instanceId":"instance-1"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := core.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("registration returned %s", response.Status)
	}
	waitForChange()
	snapshot, err := client.Registry()
	if err != nil || len(snapshot.Registrations) != 1 || snapshot.Registrations[0].ProviderID != "standard" ||
		len(snapshot.Registrations[0].Tools) != 0 {
		t.Fatalf("unexpected Registry: %+v, %v", snapshot, err)
	}
}

func TestEscapeWhilePreparingDoesNotSendCall(t *testing.T) {
	model := New(Actions{})
	model.detailMode = detailCall
	model.callTool = &wire.ToolDeclaration{ToolPath: "echo"}
	if _, command := model.requestCall(); command == nil {
		t.Fatal("call did not start preparing")
	}
	generation := model.callGeneration
	model.updateCallKey(tea.KeyPressMsg{Code: tea.KeyEscape})
	if model.detailMode != detailBrowse {
		t.Fatal("Escape should leave immediately when no call has been sent")
	}

	// 新しい入力画面を開いた後に、前の準備結果が届く。
	model.openCall(detailRow{tool: model.callTool, registration: &wire.RegistryRegistration{RegistrationID: "registration"}})
	if _, command := model.Update(ticketMsg{generation: generation}); command != nil || model.callState != callInput {
		t.Fatal("a late ticket should not submit a call")
	}
}

func TestCloseKeepsCallUntilResult(t *testing.T) {
	ticket := &CallTicket{ID: wire.Marshal("call-1")}
	model := &Model{coreView: coreView{client: &Client{}}, detailMode: detailCall, callState: callActive, callTicket: ticket, callID: ticket.CallID()}
	_, command := model.updateCallKey(tea.KeyPressMsg{Code: tea.KeyEscape})
	if command == nil || model.callState != callClosing || model.callID != ticket.CallID() || !strings.Contains(model.statusMsg, "sending close") {
		t.Fatal("close should preserve the active call while waiting for its result")
	}
	model.onEvent(Event{Kind: EventResult, CallID: ticket.CallID(), Result: json.RawMessage(`"closed"`)})
	model.Update(callCloseSentMsg{ticket: ticket})
	if model.callState != callFinished || model.statusMsg != "" || !strings.Contains(strings.Join(model.callLines, " "), "closed") {
		t.Fatal("terminal result was not displayed")
	}
}

// 接続の張り直しで同じcallIdが回ってきても、旧接続からの遅延通知を
// 新しいcallの結果として表示しない。
func TestEventFromPreviousConnectionIsIgnored(t *testing.T) {
	previous, current := &rpc.Connection{}, &rpc.Connection{}
	ticket := &CallTicket{connection: current, ID: wire.Marshal("call-1")}
	model := &Model{coreView: coreView{client: &Client{}}, detailMode: detailCall, callState: callActive, callTicket: ticket, callID: ticket.CallID()}
	model.onEvent(Event{Kind: EventResult, connection: previous, CallID: ticket.CallID(), Result: json.RawMessage(`"stale"`)})
	if model.callState != callActive || len(model.callLines) != 0 {
		t.Fatal("a stale connection's result changed the active call")
	}
	model.onEvent(Event{Kind: EventResult, connection: current, CallID: ticket.CallID(), Result: json.RawMessage(`"fresh"`)})
	if model.callState != callFinished || !strings.Contains(strings.Join(model.callLines, " "), "fresh") {
		t.Fatal("the current connection's result was not displayed")
	}
}

func TestCloseReportsSendFailureWithoutEndingTheCall(t *testing.T) {
	ticket := &CallTicket{ID: wire.Marshal("call-1")}
	model := &Model{coreView: coreView{client: &Client{}}, detailMode: detailCall, callState: callActive, callTicket: ticket, callID: ticket.CallID()}
	_, command := model.updateCallKey(tea.KeyPressMsg{Code: tea.KeyEscape})
	if command == nil {
		t.Fatal("Escape should schedule a close command")
	}
	model.Update(callCloseSentMsg{ticket: &CallTicket{ID: ticket.ID}})
	if model.callState != callClosing || !strings.Contains(model.statusMsg, "sending close") {
		t.Fatal("a send result from another connection should be ignored")
	}
	model.Update(command()) // このticketには接続がないので送信できない。
	if model.callState != callActive || model.callID != ticket.CallID() || !strings.Contains(model.statusMsg, "close failed") {
		t.Fatal("a failed close should be reported without ending the call")
	}
}

func TestPaneFocusCyclesAndJumps(t *testing.T) {
	model := New(Actions{FindCores: func() ([]coreinstances.Instance, error) { return nil, nil }})
	t.Cleanup(model.Disconnect)
	model.Update(tea.WindowSizeMsg{Width: 100, Height: 24})
	if model.focus != paneCores {
		t.Fatal("initial focus should be on the Cores pane")
	}
	model.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if model.focus != panePlugins {
		t.Fatal("tab should move focus to the Plugins pane")
	}
	model.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if model.focus != paneDetail {
		t.Fatal("second tab should move focus to the Detail pane")
	}
	model.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if model.focus != paneCores {
		t.Fatal("tab should cycle back to the Cores pane")
	}
	model.Update(tea.KeyPressMsg{Code: '3', Text: "3"})
	if model.focus != paneDetail {
		t.Fatal("3 should jump focus to the Detail pane")
	}
	model.Update(tea.KeyPressMsg{Code: '1', Text: "1"})
	if model.focus != paneCores {
		t.Fatal("1 should jump focus back to the Cores pane")
	}
}

func TestCoreFocusShowsOnlyTheFocusedCoresLinksAndTools(t *testing.T) {
	initial := coreinstances.Instance{URL: "http://127.0.0.1:7700", ID: "first"}
	second := coreinstances.Instance{URL: "http://127.0.0.1:7701", ID: "second"}
	model := New(Actions{FindCores: func() ([]coreinstances.Instance, error) { return nil, nil }})
	t.Cleanup(model.Disconnect)
	model.Update(tea.WindowSizeMsg{Width: 100, Height: 24})
	model.Update(coreListMsg{instances: []coreinstances.Instance{initial, second}})
	if model.client != nil || model.coreSelection >= 0 {
		t.Fatal("discovery must not implicitly select a Core")
	}
	model.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	firstPreview := model.client
	if firstPreview == nil || firstPreview.baseURL != initial.URL {
		t.Fatal("moving focus should open a preview for the first Core")
	}
	oldSnapshot := coreViewMsg{
		client: firstPreview,
		snapshot: wire.RegistrySnapshot{Registrations: []wire.RegistryRegistration{{
			RegistrationID: "registration-first", RPCAvailable: true,
			Tools: []wire.ToolDeclaration{{ToolPath: "tool-from-first"}},
		}}},
	}
	model.Update(oldSnapshot)
	// 確認モーダルはキーを全て吸収するので、escで抜けてからfocusを動かす。
	model.confirmRemoveRegistrationID = oldSnapshot.snapshot.Registrations[0].RegistrationID
	model.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if model.confirmRemoveRegistrationID != "" {
		t.Fatal("esc should cancel the unlink confirmation")
	}

	model.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if model.client == nil || model.client.baseURL != second.URL {
		t.Fatal("moving focus should change the previewed Core")
	}
	if firstPreview.ctx.Err() == nil {
		t.Fatal("the old client should be disconnected")
	}
	model.Update(oldSnapshot)
	model.Update(setStatusMsg{client: firstPreview, text: "old status"})
	model.Update(eventMsg{client: firstPreview, event: Event{Kind: EventConnectionClosed}})
	if len(model.registrations) != 0 || len(model.rows) != 0 || model.confirmRemoveRegistrationID != "" || model.statusMsg != "" {
		t.Fatal("the new preview should not retain state or accept late messages from the old Core")
	}
	model.Update(coreViewMsg{
		client: model.client,
		snapshot: wire.RegistrySnapshot{Registrations: []wire.RegistryRegistration{{
			RegistrationID: "registration-second", RPCAvailable: true,
			Tools: []wire.ToolDeclaration{{ToolPath: "tool-from-second"}},
		}}},
	})
	if view := model.View().Content; !strings.Contains(view, "registration-second") || !strings.Contains(view, "tool-from-second") {
		t.Fatalf("the Detail pane should show the focused Core's catalog:\n%s", view)
	}
	replacement := coreinstances.Instance{URL: initial.URL, ID: "replacement"}
	model.Update(coreListMsg{instances: []coreinstances.Instance{replacement, second}})
	if model.coreSelection < 0 || model.cores[model.coreSelection].ID != second.ID {
		t.Fatal("focus should follow the same Core across refreshes")
	}
}

func TestStopConfirmationKeepsTheOriginallySelectedInstance(t *testing.T) {
	original := coreinstances.Instance{URL: "http://127.0.0.1:7700", ID: "original"}
	replacement := coreinstances.Instance{URL: original.URL, ID: "replacement"}
	var stopped coreinstances.Instance
	model := New(Actions{StopCore: func(target coreinstances.Instance) error {
		stopped = target
		return nil
	}})
	t.Cleanup(model.Disconnect)
	model.Update(coreListMsg{instances: []coreinstances.Instance{original}})
	model.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	_, command := model.Update(tea.KeyPressMsg{Code: 'd', Text: "d"})
	if command != nil {
		t.Fatal("stop must wait for confirmation")
	}
	model.Update(coreListMsg{instances: []coreinstances.Instance{replacement}})
	_, command = model.Update(tea.KeyPressMsg{Code: 'y', Text: "y"})
	if command == nil {
		t.Fatal("confirmation should request stop")
	}
	command()
	if stopped != original {
		t.Fatalf("confirmation targeted %v; want %v", stopped, original)
	}
}

func TestDetailSelectionFollowsRowAcrossRefresh(t *testing.T) {
	message := func(tools ...wire.ToolDeclaration) coreViewMsg {
		return coreViewMsg{snapshot: wire.RegistrySnapshot{Registrations: []wire.RegistryRegistration{{
			RegistrationID: "registration-1", ProviderID: "standard", RPCAvailable: true, Tools: tools,
		}}}}
	}
	first := wire.ToolDeclaration{ToolPath: "echo"}
	second := wire.ToolDeclaration{ToolPath: "exec"}
	model := New(Actions{})
	model.Update(message(first, second))
	model.detailSelection = 2
	// 選択は「2番目のTool行」。順序が入れ替わっても同じToolを指し続ける
	model.Update(message(second, first))
	if model.detailSelection != 1 {
		t.Fatalf("tool order changed but selection should follow the same tool, got %d", model.detailSelection)
	}
	model.Update(message(first))
	if model.detailSelection != -1 {
		t.Fatal("選択したToolが消えた場合は、別の行へ選択を移さない")
	}
}

func TestDetailRowsListOnlyCallableToolsUnderTheirRegistration(t *testing.T) {
	rows := registrationRows([]wire.RegistryRegistration{
		{RegistrationID: "connected", RPCAvailable: true, Tools: []wire.ToolDeclaration{{ToolPath: "echo"}}},
		{RegistrationID: "disconnected", Tools: []wire.ToolDeclaration{{ToolPath: "echo"}}},
	})
	if len(rows) != 3 || rows[0].tool != nil || rows[1].identity() != (wire.CallTarget{
		RegistrationID: "connected", ToolPath: "echo",
	}) || rows[2].registration.RegistrationID != "disconnected" || rows[2].tool != nil {
		t.Fatalf("unexpected row order: %+v", rows)
	}
}

func TestMouseClickFocusesAndSelects(t *testing.T) {
	first := coreinstances.Instance{URL: "http://127.0.0.1:7700", ID: "first"}
	second := coreinstances.Instance{URL: "http://127.0.0.1:7701", ID: "second"}
	model := New(Actions{FindCores: func() ([]coreinstances.Instance, error) { return nil, nil }})
	t.Cleanup(model.Disconnect)
	model.Update(tea.WindowSizeMsg{Width: 100, Height: 24})
	model.Update(coreListMsg{instances: []coreinstances.Instance{first, second}})
	model.View() // hit mapを構築させる

	// 2行目のCore行をclick → focus＋選択＋preview
	model.Update(tea.MouseClickMsg(tea.Mouse{X: 1, Y: 4, Button: tea.MouseLeft}))
	if model.coreSelection != 1 || model.focus != paneCores {
		t.Fatalf("click should focus the Cores pane and select row 1 (got %d)", model.coreSelection)
	}
	if model.client == nil || model.client.baseURL != second.URL {
		t.Fatal("clicking a Core should open its preview")
	}
	// Pluginsペインの空きをclick → focusのみ
	model.Update(tea.MouseClickMsg(tea.Mouse{X: 40, Y: 10, Button: tea.MouseLeft}))
	if model.focus != panePlugins {
		t.Fatal("clicking a pane should move focus there")
	}
}
