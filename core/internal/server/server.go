// Package server はPlugin→Core側のHTTP server。
// REST呼出（tools.set/ping/tools.list）とWS channelの受付を同居させる
// （docs/contracts/00001・00002）。
package server

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/router"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

type Server struct {
	reg *registry.Registry
	rt  *router.Router
}

func New(reg *registry.Registry, rt *router.Router) *Server {
	return &Server{reg: reg, rt: rt}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/tools/set", s.handleToolsSet)
	mux.HandleFunc("POST /v1/session/ping", s.handlePing)
	mux.HandleFunc("POST /v1/tools/list", s.handleToolsList)
	mux.HandleFunc("GET /v1/ws", s.handleWS)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": msg}})
}

func (s *Server) handleToolsSet(w http.ResponseWriter, r *http.Request) {
	var req wire.ToolsSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if err := s.reg.SetTools(req.SessionID, req.Tools); err != nil {
		if errors.Is(err, registry.ErrNoSession) {
			writeErr(w, http.StatusUnauthorized, "unknown_session", "unknown sessionId")
			return
		}
		writeErr(w, http.StatusConflict, "duplicate_tool_path", err.Error())
		return
	}
	sess, _ := s.reg.FindSession(req.SessionID)
	log.Printf("[core] tools.set: %d tool(s) from %s", len(req.Tools), sess.Plugin.ID)
	writeJSON(w, http.StatusOK, map[string]any{"count": len(req.Tools)})
}

func (s *Server) handlePing(w http.ResponseWriter, r *http.Request) {
	var req wire.PingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if err := s.reg.Touch(req.SessionID); err != nil {
		writeErr(w, http.StatusUnauthorized, "unknown_session", "unknown sessionId")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleToolsList(w http.ResponseWriter, r *http.Request) {
	var req wire.ToolsListRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if _, ok := s.reg.FindSession(req.SessionID); !ok {
		writeErr(w, http.StatusUnauthorized, "unknown_session", "unknown sessionId")
		return
	}
	writeJSON(w, http.StatusOK, wire.ToolsListResponse{Tools: s.reg.AllTools()})
}

// handleWS はPlugin→CoreのWS channel受付（hello後に張られる）。
// ?sessionId= でSessionに紐付ける。
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	sess, ok := s.reg.FindSession(sessionID)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unknown_session", "unknown sessionId")
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
	if err := s.reg.SetWS(sessionID, conn); err != nil {
		conn.Close()
		return
	}
	log.Printf("[core] ws channel: %s (%s)", sess.Plugin.ID, sessionID)

	conn.OnRequest = func(in *wire.Incoming) (json.RawMessage, *wire.Error) {
		if in.Method == wire.MethodCall {
			return s.rt.HandleCall(conn, in)
		}
		return nil, &wire.Error{Code: -32601, Message: "method not found"}
	}
	conn.OnNotif = func(in *wire.Incoming) { s.rt.DispatchNotif(conn, in) }

	err = conn.Run(r.Context())
	log.Printf("[core] ws closed: %s (%s): %v", sess.Plugin.ID, sessionID, err)
	s.rt.DropConn(conn)
	s.reg.Remove(sessionID)
}
