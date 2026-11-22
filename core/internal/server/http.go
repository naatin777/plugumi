// Package server はPlugin起点のREST、Registry SSE、双方向WSを受け付ける（contracts/00004）。
package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"path"
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
	coreID   string
	name     string
	registry *registry.Registry
	router   *router.Router
	token    string
}

func New(ctx context.Context, coreID, name, token string) *Server {
	pluginRegistry := registry.New(coreID)
	s := &Server{ctx: ctx, coreID: coreID, name: name, router: router.New(pluginRegistry), registry: pluginRegistry, token: token}
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

// assetMaxSize はPUT /v1/assets/{sha256}が受け付ける1ファイルの上限。
const assetMaxSize = 16 << 20

// putAsset は生バイトのassetを受け取る。sha256はURLで宣言したものと
// 内容が一致しなければならない（内容アドレスなので配送時に再照合しない）。
func (s *Server) putAsset(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("sha256")
	if len(hash) != 64 || strings.ToLower(hash) != hash {
		writeAPIError(w, http.StatusBadRequest, "invalid_params", "sha256 must be 64 lowercase hex characters")
		return
	}
	if _, err := hex.DecodeString(hash); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_params", "sha256 must be 64 lowercase hex characters")
		return
	}
	body := http.MaxBytesReader(w, r.Body, assetMaxSize+1)
	data, err := io.ReadAll(body)
	if err != nil || len(data) > assetMaxSize {
		writeAPIError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "asset exceeds 16 MiB")
		return
	}
	if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != hash {
		writeAPIError(w, http.StatusBadRequest, "invalid_params", "body does not match the declared sha256")
		return
	}
	s.registry.PutAsset(hash, data)
	w.WriteHeader(http.StatusNoContent)
}

// uiAsset はUI manifestに登録されたファイルを配信する。
// 内容はsha256照合済みなのでETagにそのハッシュをそのまま使う。
func (s *Server) uiAsset(w http.ResponseWriter, r *http.Request) {
	hash, data, found := s.registry.UIAsset(r.PathValue("registrationId"), r.PathValue("path"))
	if !found {
		writeAPIError(w, http.StatusNotFound, "not_found", "no such UI asset")
		return
	}
	etag := `"` + hash + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	contentType := mime.TypeByExtension(path.Ext(r.PathValue("path")))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	_, _ = w.Write(data)
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(newAPIError(status, code, message))
}
