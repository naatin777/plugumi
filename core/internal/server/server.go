// Package server は管理REST API（UI Host・人間向け）と、
// transport上のPlugin→Coreメッセージの振り分けを担う。
// RESTはOpenAPI (huma) で定義する。PluginはこのAPIを使わない
// （docs/contracts/00001・00002、decisions/00010）。
package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/coder/websocket"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/naatin777/plugumi/core/internal/connector"
	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/router"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

// apiErr は契約のエラー形 `{ "error": { "code", "message" } }`
// （docs/contracts/00001）。huma.NewErrorを差し替えて
// 入力バリデーション含め全エラーをこの形に揃える。
// OpenAPIの $schema リンクが先頭に付与される（schemaへの参照・実害なし）。
type apiErr struct {
	status int
	Body   struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (e *apiErr) Error() string  { return e.Body.Message }
func (e *apiErr) GetStatus() int { return e.status }

func newErr(status int, code, message string) error {
	apiError := &apiErr{status: status}
	apiError.Body.Code = code
	apiError.Body.Message = message
	return apiError
}

func init() {
	// humaの入力バリデーションも契約のエラーcodeに揃える（docs/contracts/00001）。
	// humaは入力不正を422で返すが、契約のinvalid_paramsは400に正規化する。
	huma.NewError = func(status int, message string, errs ...error) huma.StatusError {
		code := map[int]string{
			http.StatusBadRequest:          "invalid_params",
			http.StatusUnprocessableEntity: "invalid_params",
			http.StatusNotFound:            "unknown_endpoint",
		}[status]
		if code == "invalid_params" {
			status = http.StatusBadRequest
		}
		if code == "" {
			code = http.StatusText(status)
		}
		return newErr(status, code, message).(*apiErr)
	}
}

type Server struct {
	registry  *registry.Registry
	router    *router.Router
	connector *connector.Connector
}

func New(registry *registry.Registry, router *router.Router, connector *connector.Connector) *Server {
	s := &Server{registry: registry, router: router, connector: connector}
	// transport上のcall系メッセージをここで捌く。
	// Plugin transport connとcaller channel connの両方に同じ振り分けを使う
	// （Route.Callerはconn抽象で、Link所属を要求しない）。
	connector.OnRequest = s.onTransportRequest
	connector.OnNotif = s.onTransportNotif
	connector.OnResponded = s.router.NotifyResponded
	connector.OnCatalogChanged = connector.BroadcastCatalog
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	api := humago.New(mux, huma.DefaultConfig("Plugumi Core", "0.1.0"))

	huma.Register(api, huma.Operation{
		OperationID: "tools-list",
		Method:      http.MethodPost,
		Path:        "/v1/tools/list",
		Summary:     "登録中の全Toolを返す（管理・UI Host向け）",
	}, s.toolsList)
	huma.Register(api, huma.Operation{
		OperationID: "plugins-add",
		Method:      http.MethodPost,
		Path:        "/v1/plugins",
		Summary:     "Plugin Endpointの動的登録",
		Description: "Endpointを接続対象に追加する。受理のみで、Link確立は非同期（connectorが再試行する）。",
	}, s.pluginsAdd)
	huma.Register(api, huma.Operation{
		OperationID: "plugins-list",
		Method:      http.MethodPost,
		Path:        "/v1/plugins/list",
		Summary:     "登録済みPlugin Endpoint一覧",
	}, s.pluginsList)
	huma.Register(api, huma.Operation{
		OperationID: "plugins-remove",
		Method:      http.MethodPost,
		Path:        "/v1/plugins/remove",
		Summary:     "Plugin Endpointの登録解除",
		Description: "Endpointを接続対象から外す。確立済みLinkは失効し、再試行loopは停止する。",
	}, s.pluginsRemove)

	// caller channel: Pluginでない呼び出し元（TUI・UI Host・スクリプト）が
	// tools.call系だけを流すWS。Linkには紐付かず、connの寿命=接続の寿命。
	mux.HandleFunc("/v1/call", s.handleCall)

	// 未知のoperationも契約のエラー形で返す（contracts/00001）。
	// ServeMuxはパターン競合で最長一致するため、"/" は未知pathだけに届く。
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{
			"code": "unknown_endpoint", "message": "unknown endpoint"}})
	})

	// versionはURL prefixで表す（docs/contracts/00001）。
	// 未サポートの/vN/（Nは数字）はprotocol_mismatchで拒否する。
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		versioned := len(path) > 2 && path[0] == '/' && path[1] == 'v' &&
			path[2] >= '0' && path[2] <= '9'
		if versioned && !strings.HasPrefix(path, "/v1/") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUpgradeRequired)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{
				"code": "protocol_mismatch", "message": "unsupported protocol version"}})
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// ---- 管理REST operations ----

type ToolsListInput struct{}
type ToolsListOutput struct {
	Body struct {
		Tools []wire.ListedTool `json:"tools"`
	}
}

func (s *Server) toolsList(_ context.Context, _ *ToolsListInput) (*ToolsListOutput, error) {
	out := &ToolsListOutput{}
	out.Body.Tools = s.registry.AllTools()
	// nilだと `"tools": null` になり受け手のdecodeが面倒になるため空配列に揃える
	if out.Body.Tools == nil {
		out.Body.Tools = []wire.ListedTool{}
	}
	return out, nil
}

type PluginsAddInput struct {
	Body wire.PluginsAddRequest
}
type PluginsAddOutput struct {
	Body wire.PluginsAddResult
}

func (s *Server) pluginsAdd(_ context.Context, input *PluginsAddInput) (*PluginsAddOutput, error) {
	if err := validateEndpoint(input.Body.Endpoint); err != nil {
		return nil, newErr(http.StatusBadRequest, "invalid_endpoint", err.Error())
	}
	if !s.connector.Watch(input.Body.Endpoint) {
		return nil, newErr(http.StatusConflict, "duplicate_endpoint", "endpoint already registered")
	}
	log.Printf("[core] plugin endpoint registered: %s", input.Body.Endpoint)
	out := &PluginsAddOutput{}
	out.Body.Endpoint = input.Body.Endpoint
	return out, nil
}

func validateEndpoint(endpoint string) error {
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		return errors.New("endpoint must be an http(s):// URL")
	}
	return nil
}

type PluginsListOutput struct {
	Body wire.PluginsListResult
}

func (s *Server) pluginsList(_ context.Context, _ *struct{}) (*PluginsListOutput, error) {
	out := &PluginsListOutput{}
	out.Body.Plugins = s.registeredPlugins()
	if out.Body.Plugins == nil {
		out.Body.Plugins = []wire.RegisteredPlugin{}
	}
	return out, nil
}

type PluginsRemoveInput struct {
	Body wire.PluginsRemoveRequest
}
type PluginsRemoveOutput struct {
	Body wire.PluginsRemoveResult
}

func (s *Server) pluginsRemove(_ context.Context, input *PluginsRemoveInput) (*PluginsRemoveOutput, error) {
	if !s.connector.Unwatch(input.Body.Endpoint) {
		return nil, newErr(http.StatusNotFound, "unknown_endpoint", "endpoint not registered: "+input.Body.Endpoint)
	}
	log.Printf("[core] plugin endpoint unregistered: %s", input.Body.Endpoint)
	out := &PluginsRemoveOutput{}
	out.Body.Endpoint = input.Body.Endpoint
	return out, nil
}

func (s *Server) registeredPlugins() []wire.RegisteredPlugin {
	var out []wire.RegisteredPlugin
	for _, endpoint := range s.connector.Known() {
		entry := wire.RegisteredPlugin{Endpoint: endpoint}
		if link, ok := s.registry.FindEndpoint(endpoint); ok {
			entry.LinkID = link.ID
			entry.PluginID = link.Plugin().ID
		}
		out = append(out, entry)
	}
	return out
}

// ---- caller channel（GET /v1/call） ----

// handleCall はcaller向けWS upgradeを受け付ける。callerはLinkを持たず、
// tools.call request・tools.call.close notificationを送り、responseと
// output/result notificationを受け取る（contracts/00003のcaller側）。
func (s *Server) handleCall(w http.ResponseWriter, r *http.Request) {
	if !isWebSocketUpgrade(r) {
		writeAPIError(w, http.StatusBadRequest, "invalid_params", "websocket upgrade required")
		return
	}
	// Origin検証はしない。MVPはloopback限定で認証自体が未解決事項
	// （contracts/00001）。将来のweb UI HostはbrowserがOriginを送るため、
	// ここを締めるときはOriginPatternsの設計とセットで行う。
	raw, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return // AcceptがHTTPエラー応答を書き込み済み
	}
	conn := rpc.NewConn(raw, "caller-")
	conn.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.Error) {
		return s.onTransportRequest(conn, message)
	}
	conn.OnNotif = func(message *wire.Incoming) {
		s.onTransportNotif(conn, message)
	}
	conn.OnResponded = func(id json.RawMessage) {
		s.router.NotifyResponded(conn, id)
	}
	go func() {
		_ = conn.Run(context.Background())
		// caller切断時、実行中callへはtarget側へcloseが転送される
		// （router.DropConn。購読・長時間callを残さないため）。
		s.router.DropConn(conn)
	}()
}

func isWebSocketUpgrade(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	for _, value := range r.Header.Values("Connection") {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
				return true
			}
		}
	}
	return false
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{
		"code": code, "message": message}})
}

// ---- transport上のcall系メッセージ（tools.call系のみ） ----

func (s *Server) onTransportRequest(conn *rpc.Conn, message *wire.Incoming) (json.RawMessage, *wire.Error) {
	if message.Method == wire.MethodCall {
		return s.router.HandleCall(conn, message)
	}
	return nil, &wire.Error{Code: -32601, Message: "method not found"}
}

func (s *Server) onTransportNotif(conn *rpc.Conn, message *wire.Incoming) {
	s.router.DispatchNotif(conn, message)
}
