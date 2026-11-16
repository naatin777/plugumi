// Package server はPlugin→Core側のHTTP server。
// REST呼出（tools.set/ping/tools.list）はOpenAPI (huma) で定義し、
// WS channelの受付はOpenAPI対象外としてraw handlerのまま同居させる
// （docs/contracts/00001・00002）。
package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/coder/websocket"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

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
	huma.NewError = func(status int, message string, errs ...error) huma.StatusError {
		return newErr(status, http.StatusText(status), message).(*apiErr)
	}
}

type Server struct {
	registry *registry.Registry
	router   *router.Router
}

func New(registry *registry.Registry, router *router.Router) *Server {
	return &Server{registry: registry, router: router}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	api := humago.New(mux, huma.DefaultConfig("Plugumi Core", "0.1.0"))

	// WS channelはOpenAPI対象外。同じmuxにraw handlerで同居させる。
	mux.HandleFunc("GET /v1/ws", s.handleWebSocket)

	huma.Register(api, huma.Operation{
		OperationID: "tools-set",
		Method:      http.MethodPost,
		Path:        "/v1/tools/set",
		Summary:     "Tool宣言のアトミック置換",
		Description: "このRegistrationが提供するTool一覧を置き換える。接続時と宣言変更時に呼ぶ。",
	}, s.toolsSet)
	huma.Register(api, huma.Operation{
		OperationID: "session-ping",
		Method:      http.MethodPost,
		Path:        "/v1/session/ping",
		Summary:     "Sessionの維持信号",
	}, s.ping)
	huma.Register(api, huma.Operation{
		OperationID: "tools-list",
		Method:      http.MethodPost,
		Path:        "/v1/tools/list",
		Summary:     "登録中の全Toolを返す最小Discovery（MVP仮置き）",
	}, s.toolsList)

	return mux
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
	if err := s.registry.SetTools(input.Body.SessionID, input.Body.Tools); err != nil {
		if errors.Is(err, registry.ErrNoSession) {
			return nil, newErr(http.StatusUnauthorized, "unknown_session", "unknown sessionId")
		}
		return nil, newErr(http.StatusConflict, "duplicate_tool_path", err.Error())
	}
	session, _ := s.registry.FindSession(input.Body.SessionID)
	log.Printf("[core] tools.set: %d tool(s) from %s", len(input.Body.Tools), session.Plugin.ID)
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
	if err := s.registry.Touch(input.Body.SessionID); err != nil {
		return nil, newErr(http.StatusUnauthorized, "unknown_session", "unknown sessionId")
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
	if _, ok := s.registry.FindSession(input.Body.SessionID); !ok {
		return nil, newErr(http.StatusUnauthorized, "unknown_session", "unknown sessionId")
	}
	out := &ToolsListOutput{}
	out.Body.Tools = s.registry.AllTools()
	return out, nil
}

// ---- WS channel（OpenAPI対象外）----

// handleWebSocket はPlugin→CoreのWS channel受付（hello後に張られる）。
// ?sessionId= でSessionに紐付ける。
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	session, ok := s.registry.FindSession(sessionID)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{
			"code": "unknown_session", "message": "unknown sessionId"}})
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Printf("[core] ws accept failed: %v", err)
		return
	}
	conn := rpc.NewConn(c, "c-")
	if err := s.registry.SetWebSocket(sessionID, conn); err != nil {
		conn.Close()
		return
	}
	log.Printf("[core] ws channel: %s (%s)", session.Plugin.ID, sessionID)

	conn.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.Error) {
		if message.Method == wire.MethodCall {
			return s.router.HandleCall(conn, message)
		}
		return nil, &wire.Error{Code: -32601, Message: "method not found"}
	}
	conn.OnNotif = func(message *wire.Incoming) { s.router.DispatchNotif(conn, message) }

	err = conn.Run(r.Context())
	log.Printf("[core] ws closed: %s (%s): %v", session.Plugin.ID, sessionID, err)
	s.router.DropConn(conn)
	s.registry.Remove(sessionID)
}
