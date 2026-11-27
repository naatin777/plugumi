// view channelのrouting。instanceにbindされたview接続と、
// instanceを所有するregistrationのruntime接続の間で
// opaqueなviews.messageを転送する。lifecycle event（opened/closed）の
// 通知も担う。
package view

import (
	"encoding/json"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

type Manager struct {
	store    *Store
	registry *registry.Registry
}

func NewManager(store *Store, reg *registry.Registry) *Manager {
	return &Manager{store: store, registry: reg}
}

func (m *Manager) Store() *Store { return m.store }

// HandleConnect はview→Coreのviews.connectを捌く。
// ticketを検証して接続をinstanceへbindし、runtimeへopenedを通知する。
func (m *Manager) HandleConnect(connection *rpc.Connection, message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
	var params wire.ViewsConnectParams
	if err := wire.Unmarshal(message.Params, &params); err != nil || params.Ticket == "" {
		return nil, &wire.RPCError{Code: -32602, Message: "invalid views.connect params"}
	}
	bound, err := m.store.Bind(params.Ticket, connection)
	if err != nil {
		code := -32602
		if err == ErrAlreadyBound {
			code = -32009
		}
		return nil, &wire.RPCError{Code: code, Message: err.Error()}
	}
	m.notifyRuntime(bound, wire.ViewsEventOpened)
	return wire.Marshal(wire.ViewsConnectResult{Instance: *bound}), nil
}

// HandleMessage はviews.message notificationをroutingする。
// 送信元がbind済みview接続ならruntimeへ、所有registrationのruntime接続なら
// viewへ転送する。それ以外の第三者からのmessageはdropする。
func (m *Manager) HandleMessage(connection *rpc.Connection, message *wire.Incoming) {
	var params wire.ViewsMessageParams
	if err := wire.Unmarshal(message.Params, &params); err != nil || params.Instance == "" {
		return
	}
	instance, err := m.store.Get(params.Instance)
	if err != nil || instance.Status != wire.ViewOpen {
		return
	}
	viewConnection := m.store.ConnectionFor(params.Instance)
	runtimeConnection := m.registry.ConnectionFor(instance.RegistrationID)
	switch connection {
	case viewConnection:
		// view → runtime
		if runtimeConnection != nil {
			_ = runtimeConnection.Notify(wire.MethodViewsMessage, params)
		}
	case runtimeConnection:
		// runtime → view
		if viewConnection != nil {
			_ = viewConnection.Notify(wire.MethodViewsMessage, params)
		}
	default:
		// 第三者はdrop
	}
}

// HandleClose はruntime→Coreのviews.close notificationを捌く。
// 所有registrationのruntime接続からだけ受け付け、instanceを閉じて
// viewへ通知する。
func (m *Manager) HandleClose(connection *rpc.Connection, message *wire.Incoming) {
	var params struct {
		Instance string `json:"instance"`
	}
	if err := wire.Unmarshal(message.Params, &params); err != nil || params.Instance == "" {
		return
	}
	instance, err := m.store.Get(params.Instance)
	if err != nil || instance.Status != wire.ViewOpen {
		return
	}
	if m.registry.ConnectionFor(instance.RegistrationID) != connection {
		return
	}
	m.CloseInstance(params.Instance)
}

// DropViewConnection はWS接続の切断時に呼ばれる。
// view接続ならinstanceを閉じてruntimeへclosedを通知する。
func (m *Manager) DropViewConnection(connection *rpc.Connection) {
	closed := m.store.CloseForConnection(connection.ID)
	if closed != nil {
		m.notifyRuntime(closed, wire.ViewsEventClosed)
	}
}

// DropRuntime はruntime（registration）の切断時に呼ばれる。
// そのregistrationの開いているinstanceを全て閉じ、view接続へclosedを通知する。
func (m *Manager) DropRuntime(registrationID string) {
	for _, closed := range m.store.CloseForRegistration(registrationID) {
		if closed.Connection != nil {
			notifyClosed(closed.Connection, &closed.Instance)
		}
	}
}

// CloseInstance はhostのDELETE /v1/views/{id}でinstanceを閉じる。
// view接続とruntimeの両方へclosedを通知し、view接続はcloseする。
func (m *Manager) CloseInstance(instanceID string) bool {
	closed, viewConnection := m.store.Close(instanceID)
	if closed == nil {
		return false
	}
	if viewConnection != nil {
		notifyClosed(viewConnection, closed)
		viewConnection.CloseNow()
	}
	m.notifyRuntime(closed, wire.ViewsEventClosed)
	return true
}

// notifyRuntime はinstanceを所有するregistrationのruntime接続へ
// lifecycle eventを通知する。未接続なら何もしない（best effort）。
func (m *Manager) notifyRuntime(instance *wire.ViewInstance, eventType string) {
	connection := m.registry.ConnectionFor(instance.RegistrationID)
	if connection == nil {
		return
	}
	_ = connection.Notify(wire.MethodViewsEvent, wire.ViewsEventParams{
		Instance: instance.ID,
		Type:     eventType,
		PanelID:  instance.PanelID,
	})
}

func notifyClosed(connection *rpc.Connection, instance *wire.ViewInstance) {
	_ = connection.Notify(wire.MethodViewsEvent, wire.ViewsEventParams{
		Instance: instance.ID,
		Type:     wire.ViewsEventClosed,
		PanelID:  instance.PanelID,
	})
}
