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
	"github.com/naatin777/plugumi/core/internal/server"
	"github.com/naatin777/plugumi/core/internal/wire"
)

func TestRegistryWatcherRefreshesOnCoreEvents(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	const token = "test-token"
	t.Setenv("PLUGUMI_TOKEN", token)
	core := httptest.NewServer(server.New(ctx, "test-core", "", token, "").Handler())
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
		len(snapshot.Registrations[0].Operations) != 0 {
		t.Fatalf("unexpected Registry: %+v, %v", snapshot, err)
	}
}

func TestEscapeWhilePreparingDoesNotSendCall(t *testing.T) {
	model := New(Actions{})
	model.detailMode = detailCall
	model.callOperation = &wire.OperationDeclaration{Path: "echo"}
	if _, command := model.requestCall(); command == nil {
		t.Fatal("call did not start preparing")
	}
	generation := model.callGeneration
	model.updateCallKey(tea.KeyPressMsg{Code: tea.KeyEscape})
	if model.detailMode != detailBrowse {
		t.Fatal("Escape should leave immediately when no call has been sent")
	}

	// 新しい入力画面を開いた後に、前の準備結果が届く。
	model.openCall(detailRow{operation: model.callOperation, registration: &wire.RegistryRegistration{RegistrationID: "registration"}})
	if _, command := model.Update(ticketMsg{generation: generation}); command != nil || model.callState != callInput {
		t.Fatal("a late ticket should not submit a call")
	}
}

func TestInvokeDisplaysTerminalExecution(t *testing.T) {
	ticket := &CallTicket{ID: wire.Marshal("call-1")}
	client := &Client{}
	model := &Model{coreView: coreView{client: client}, detailMode: detailCall, callState: callActive, callTicket: ticket, callID: ticket.CallID()}
	model.Update(callDoneMsg{
		client: client, callID: ticket.CallID(),
		execution: &wire.Execution{
			ID:        "execution/test",
			Operation: "echo",
			Status:    wire.ExecutionSucceeded,
			Result:    json.RawMessage(`"hello"`),
		},
	})
	lines := strings.Join(model.callLines, " ")
	if model.callState != callFinished || !strings.Contains(lines, "succeeded") || !strings.Contains(lines, "hello") {
		t.Fatalf("terminal execution was not displayed: %s", lines)
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
			Operations: []wire.OperationDeclaration{{Path: "tool-from-first"}},
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
			Operations: []wire.OperationDeclaration{{Path: "tool-from-second"}},
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
	message := func(operations ...wire.OperationDeclaration) coreViewMsg {
		return coreViewMsg{snapshot: wire.RegistrySnapshot{Registrations: []wire.RegistryRegistration{{
			RegistrationID: "registration-1", ProviderID: "standard", RPCAvailable: true, Operations: operations,
		}}}}
	}
	first := wire.OperationDeclaration{Path: "echo"}
	second := wire.OperationDeclaration{Path: "exec"}
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
		{RegistrationID: "connected", RPCAvailable: true, Operations: []wire.OperationDeclaration{{Path: "echo"}}},
		{RegistrationID: "disconnected", Operations: []wire.OperationDeclaration{{Path: "echo"}}},
	})
	if len(rows) != 3 || rows[0].operation != nil || rows[1].operationPath() != "echo" ||
		rows[1].registration.RegistrationID != "connected" ||
		rows[2].registration.RegistrationID != "disconnected" || rows[2].operation != nil {
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
