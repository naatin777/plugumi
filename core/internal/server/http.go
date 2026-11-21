// Package server はPlugin起点のREST、Registry SSE、双方向WSを受け付ける（contracts/00004）。
package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/router"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

const prefix = "/v1"

var versionPath = regexp.MustCompile(`^/v[0-9]+(?:/|$)`)

type Server struct {
	ctx      context.Context
	registry *registry.Registry
	router   *router.Router
	token    string
}

func New(ctx context.Context, coreID, token string) *Server {
	pluginRegistry := registry.New(coreID)
	s := &Server{ctx: ctx, router: router.New(pluginRegistry), registry: pluginRegistry, token: token}
	go pluginRegistry.Expire(ctx)
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.registerREST(mux)
	mux.HandleFunc("GET "+prefix+"/events", s.events)
	mux.HandleFunc("GET "+prefix+"/rpc", s.websocket)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeAPIError(w, http.StatusNotFound, "unknown_endpoint", "unknown endpoint")
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !loopbackHost(r.Host) || r.Header.Get("Origin") != "" {
			writeAPIError(w, http.StatusForbidden, "forbidden", "local native clients only")
			return
		}
		if versionPath.MatchString(r.URL.Path) && !strings.HasPrefix(r.URL.Path+"/", prefix+"/") {
			writeAPIError(w, http.StatusUpgradeRequired, "protocol_mismatch", "unsupported protocol version")
			return
		}
		if s.token != "" && !isDocsPath(r.URL.Path) && subtle.ConstantTimeCompare(
			[]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.token),
		) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "missing or invalid Core token")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}

func isDocsPath(path string) bool {
	return path == "/docs" || path == "/openapi.json" || path == "/openapi.yaml"
}

func loopbackHost(host string) bool {
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	return strings.EqualFold(host, "localhost") || net.ParseIP(strings.Trim(host, "[]")).IsLoopback()
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	stream := http.NewResponseController(w)
	events, unsubscribe := s.registry.Subscribe()
	defer unsubscribe()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		var frame string
		select {
		case <-s.ctx.Done():
			return
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			frame = ": keep-alive\n\n"
		case event, ok := <-events:
			if !ok {
				return
			}
			frame = fmt.Sprintf("id: %s\nevent: %s\ndata: {\"revision\":%q}\n\n", event.Revision, event.Name, event.Revision)
		}
		_ = stream.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if _, err := io.WriteString(w, frame); err != nil || stream.Flush() != nil {
			return
		}
	}
}

func (s *Server) websocket(w http.ResponseWriter, request *http.Request) {
	if !strings.EqualFold(request.Header.Get("Upgrade"), "websocket") {
		writeAPIError(w, http.StatusBadRequest, "invalid_params", "websocket upgrade required")
		return
	}
	registrationID := request.URL.Query().Get("registrationId")
	var reservation *registry.ConnectionReservation
	if registrationID != "" {
		var err error
		reservation, err = s.registry.ReserveConnection(registrationID)
		if err == registry.ErrUnknownRegistration {
			writeAPIError(w, http.StatusNotFound, "unknown_registration", err.Error())
			return
		}
		if err != nil {
			writeAPIError(w, http.StatusConflict, "rpc_already_connected", err.Error())
			return
		}
		defer reservation.Complete(nil)
	}
	raw, err := websocket.Accept(w, request, nil)
	if err != nil {
		return
	}
	raw.SetReadLimit(1 << 20)
	connection := rpc.NewConnection(raw, "core-")
	connection.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.RpcError) {
		if message.Method == wire.MethodCall {
			return s.router.HandleCall(connection, message)
		}
		return nil, &wire.RpcError{Code: -32601, Message: "method not found"}
	}
	connection.OnNotification = func(message *wire.Incoming) {
		s.router.DispatchNotification(connection, message)
	}
	connection.OnResponded = func(id json.RawMessage) { s.router.NotifyResponded(connection, id) }
	if reservation != nil && !reservation.Complete(connection) {
		connection.CloseNow()
		return
	}
	defer connection.Close()
	heartbeatContext, stopHeartbeat := context.WithCancel(s.ctx)
	defer stopHeartbeat()
	go func() {
		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()
		for {
			select {
			case <-heartbeatContext.Done():
				return
			case <-heartbeat.C:
				pingContext, cancel := context.WithTimeout(heartbeatContext, 5*time.Second)
				err := raw.Ping(pingContext)
				cancel()
				if err != nil {
					connection.CloseNow()
					return
				}
			}
		}
	}()
	_ = connection.Run(s.ctx)
	if reservation != nil {
		s.registry.Detach(registrationID, connection)
	}
	s.router.DropConnection(connection)
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(newAPIError(status, code, message))
}
