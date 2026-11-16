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
	// transport上のPlugin→Coreメッセージをここで捌く。
	connector.OnRequest = s.onLinkRequest
	connector.OnNotif = s.onLinkNotif
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
	if !strings.HasPrefix(endpoint, "ws://") && !strings.HasPrefix(endpoint, "wss://") {
		return errors.New("endpoint must be a ws(s):// URL")
	}
	return nil
}

type PluginsListOutput struct {
	Body wire.PluginsListResult
}

func (s *Server) pluginsList(_ context.Context, _ *struct{}) (*PluginsListOutput, error) {
	out := &PluginsListOutput{}
	out.Body.Plugins = s.registeredPlugins()
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

// ---- transport上のPlugin→Coreメッセージ ----

func (s *Server) onLinkRequest(conn *rpc.Conn, message *wire.Incoming) (json.RawMessage, *wire.Error) {
	switch message.Method {
	case wire.MethodToolsSet:
		return s.onToolsSet(conn, message)
	case wire.MethodPluginsAdd:
		return s.onPluginsAdd(message)
	case wire.MethodPluginsList:
		return wire.Marshal(wire.PluginsListResult{Plugins: s.registeredPlugins()}), nil
	case wire.MethodCall:
		return s.router.HandleCall(conn, message)
	default:
		return nil, &wire.Error{Code: -32601, Message: "method not found"}
	}
}

// onToolsSet はPluginのTool宣言をアトミック置換する。
// transportがLinkに紐付くため linkId はparamsに無く、conn.LinkIDで引く。
func (s *Server) onToolsSet(conn *rpc.Conn, message *wire.Incoming) (json.RawMessage, *wire.Error) {
	var params wire.ToolsSetRequest
	if err := wire.Unmarshal(message.Params, &params); err != nil {
		return nil, &wire.Error{Code: -32602, Message: "invalid params"}
	}
	if err := s.registry.SetTools(conn.LinkID, params.Tools); err != nil {
		return nil, &wire.Error{Code: -32602, Message: err.Error()}
	}
	if link, ok := s.registry.Find(conn.LinkID); ok {
		log.Printf("[core] tools.set: %d tool(s) from %s", len(params.Tools), link.Plugin().ID)
	}
	// tools.setはcatalogを変えるため、全Linkへpushし直す契約。
	s.connector.BroadcastCatalog()
	return wire.Marshal(wire.ToolsSetResult{Count: len(params.Tools)}), nil
}

func (s *Server) onPluginsAdd(message *wire.Incoming) (json.RawMessage, *wire.Error) {
	var params wire.PluginsAddRequest
	if err := wire.Unmarshal(message.Params, &params); err != nil {
		return nil, &wire.Error{Code: -32602, Message: "invalid params"}
	}
	if err := validateEndpoint(params.Endpoint); err != nil {
		return nil, &wire.Error{Code: -32602, Message: err.Error()}
	}
	if !s.connector.Watch(params.Endpoint) {
		return nil, &wire.Error{Code: -32602, Message: "endpoint already registered"}
	}
	log.Printf("[core] plugin endpoint registered (via transport): %s", params.Endpoint)
	return wire.Marshal(wire.PluginsAddResult{Endpoint: params.Endpoint}), nil
}

func (s *Server) onLinkNotif(conn *rpc.Conn, message *wire.Incoming) {
	if message.Method == wire.MethodLinkPing {
		// 最終応答時刻の更新。失効済みならもうLinkはない（何もしない）。
		_ = s.registry.Touch(conn.LinkID)
		return
	}
	s.router.DispatchNotif(conn, message)
}
