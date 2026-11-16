// Package server はPlugin→Core側のHTTP server。
// REST呼び出し（tools.set/ping/tools.list）はOpenAPI (huma) で定義し、
// transportの受付はOpenAPI対象外としてraw handlerのまま同居させる
// （docs/contracts/00001・00002）。
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
	return &Server{registry: registry, router: router, connector: connector}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	api := humago.New(mux, huma.DefaultConfig("Plugumi Core", "0.1.0"))

	// transportはOpenAPI対象外。同じmuxにraw handlerで同居させる。
	mux.HandleFunc("GET /v1/transport", s.handleTransport)

	huma.Register(api, huma.Operation{
		OperationID: "tools-set",
		Method:      http.MethodPost,
		Path:        "/v1/tools/set",
		Summary:     "Tool宣言のアトミック置換",
		Description: "このLinkが提供するTool一覧を置き換える。接続時と宣言変更時に呼ぶ。",
	}, s.toolsSet)
	huma.Register(api, huma.Operation{
		OperationID: "link-ping",
		Method:      http.MethodPost,
		Path:        "/v1/link/ping",
		Summary:     "Linkを維持するping",
	}, s.ping)
	huma.Register(api, huma.Operation{
		OperationID: "tools-list",
		Method:      http.MethodPost,
		Path:        "/v1/tools/list",
		Summary:     "登録中の全Toolを返す最小Discovery（MVP暫定）",
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

// ---- huma operations ----

type ToolsSetInput struct {
	Body wire.ToolsSetRequest
}
type ToolsSetOutput struct {
	Body struct {
		Count int `json:"count"`
	}
}

func (s *Server) toolsSet(_ context.Context, input *ToolsSetInput) (*ToolsSetOutput, error) {
	if err := s.registry.SetTools(input.Body.LinkID, input.Body.Tools); err != nil {
		if errors.Is(err, registry.ErrNoLink) {
			return nil, newErr(http.StatusUnauthorized, "unknown_link", "unknown linkId")
		}
		return nil, newErr(http.StatusConflict, "duplicate_tool_path", err.Error())
	}
	if link, ok := s.registry.Find(input.Body.LinkID); ok {
		log.Printf("[core] tools.set: %d tool(s) from %s", len(input.Body.Tools), link.Plugin().ID)
	}
	out := &ToolsSetOutput{}
	out.Body.Count = len(input.Body.Tools)
	return out, nil
}

type PingInput struct {
	Body wire.PingRequest
}
type PingOutput struct {
	Body struct {
		Ok bool `json:"ok"`
	}
}

func (s *Server) ping(_ context.Context, input *PingInput) (*PingOutput, error) {
	if err := s.registry.Touch(input.Body.LinkID); err != nil {
		return nil, newErr(http.StatusUnauthorized, "unknown_link", "unknown linkId")
	}
	out := &PingOutput{}
	out.Body.Ok = true
	return out, nil
}

type ToolsListInput struct {
	Body wire.ToolsListRequest
}
type ToolsListOutput struct {
	Body wire.ToolsListResponse
}

func (s *Server) toolsList(_ context.Context, input *ToolsListInput) (*ToolsListOutput, error) {
	if _, ok := s.registry.Find(input.Body.LinkID); !ok {
		return nil, newErr(http.StatusUnauthorized, "unknown_link", "unknown linkId")
	}
	out := &ToolsListOutput{}
	out.Body.Tools = s.registry.AllTools()
	return out, nil
}

type PluginsAddInput struct {
	Body wire.PluginsAddRequest
}
type PluginsAddOutput struct {
	Body struct {
		Endpoint string `json:"endpoint"`
	}
}

func (s *Server) pluginsAdd(_ context.Context, input *PluginsAddInput) (*PluginsAddOutput, error) {
	endpoint := input.Body.Endpoint
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		return nil, newErr(http.StatusBadRequest, "invalid_endpoint",
			"endpoint must be an http(s) URL")
	}
	if !s.connector.Watch(endpoint) {
		return nil, newErr(http.StatusConflict, "duplicate_endpoint", "endpoint already registered")
	}
	log.Printf("[core] plugin endpoint registered: %s", endpoint)
	out := &PluginsAddOutput{}
	out.Body.Endpoint = endpoint
	return out, nil
}

type PluginsListOutput struct {
	Body wire.PluginsListResponse
}

func (s *Server) pluginsList(_ context.Context, _ *struct{}) (*PluginsListOutput, error) {
	out := &PluginsListOutput{}
	for _, endpoint := range s.connector.Known() {
		entry := wire.RegisteredPlugin{Endpoint: endpoint}
		if link, ok := s.registry.FindEndpoint(endpoint); ok {
			entry.LinkID = link.ID
			entry.PluginID = link.Plugin().ID
		}
		out.Body.Plugins = append(out.Body.Plugins, entry)
	}
	return out, nil
}

// ---- transport（OpenAPI対象外）----

// handleTransport はPlugin→Coreのtransport受付（hello後に接続される）。
// ?linkId= でLinkに紐付ける。
func (s *Server) handleTransport(w http.ResponseWriter, r *http.Request) {
	linkID := r.URL.Query().Get("linkId")
	link, ok := s.registry.Find(linkID)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{
			"code": "unknown_link", "message": "unknown linkId"}})
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Printf("[core] transport accept failed: %v", err)
		return
	}
	conn := rpc.NewConn(c, "core-")
	if err := s.registry.SetTransport(linkID, conn); err != nil {
		conn.Close()
		return
	}
	log.Printf("[core] transport: %s (%s)", link.Plugin().ID, linkID)

	conn.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.Error) {
		if message.Method == wire.MethodCall {
			return s.router.HandleCall(conn, message)
		}
		return nil, &wire.Error{Code: -32601, Message: "method not found"}
	}
	conn.OnNotif = func(message *wire.Incoming) { s.router.DispatchNotif(conn, message) }

	err = conn.Run(r.Context())
	log.Printf("[core] transport closed: %s (%s): %v", link.Plugin().ID, linkID, err)
	s.router.DropConn(conn)
	// transport切断はLink失効とは別（contracts/00002）— transportだけ外し、
	// Linkはpingの失効か再helloでの差替えで消える。
	s.registry.ClearTransport(linkID, conn)
}
