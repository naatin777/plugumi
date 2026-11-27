// Package server はPlugin起点のREST、Registry SSE、双方向WSを受け付ける（contracts/00004）。
package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/execution"
	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/router"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/view"
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
	views    *view.Manager
	token    string

	execMu   sync.Mutex
	execSubs map[chan wire.OperationsEventParams]struct{}
}

func New(ctx context.Context, coreID, name, token, cacheDir string) *Server {
	pluginRegistry := registry.New(coreID, cacheDir)
	s := &Server{ctx: ctx, coreID: coreID, name: name, router: router.New(pluginRegistry, execution.NewStore()), registry: pluginRegistry, token: token, execSubs: make(map[chan wire.OperationsEventParams]struct{})}
	s.views = view.NewManager(view.NewStore(), pluginRegistry)
	s.router.OnExecutionEvent = s.broadcastExecutionEvent
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
	execEvents, unsubscribeExec := s.subscribeExecutions()
	defer unsubscribeExec()
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
		case params := <-execEvents:
			// execution eventはidを持たない。再開はRegistry系列だけに意味を持ち、
			// execution系列はlive限定（contracts/00004）。
			data, err := json.Marshal(params)
			if err != nil {
				continue
			}
			frame = fmt.Sprintf("event: executions.event\ndata: %s\n\n", data)
		}
		_ = stream.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if _, err := io.WriteString(w, frame); err != nil || stream.Flush() != nil {
			return
		}
	}
}

// subscribeExecutions はSSE clientごとのexecution event受信口を作る。
// バッファを超えた分は落とす。outputなどの途中経過はrecordに残らず
// live限定なので、遅いclientへの追いつき配信はしない（contracts/00004）。
func (s *Server) subscribeExecutions() (chan wire.OperationsEventParams, func()) {
	ch := make(chan wire.OperationsEventParams, 256)
	s.execMu.Lock()
	s.execSubs[ch] = struct{}{}
	s.execMu.Unlock()
	return ch, func() {
		s.execMu.Lock()
		delete(s.execSubs, ch)
		s.execMu.Unlock()
	}
}

func (s *Server) broadcastExecutionEvent(params wire.OperationsEventParams) {
	s.execMu.Lock()
	defer s.execMu.Unlock()
	for ch := range s.execSubs {
		select {
		case ch <- params:
		default:
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
	socket, err := websocket.Accept(w, request, nil)
	if err != nil {
		return
	}
	socket.SetReadLimit(1 << 20)
	connection := rpc.NewConnection(socket, "core-")
	connection.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.RPCError) {
		switch message.Method {
		case wire.MethodOperationsInvoke:
			return s.router.HandleInvoke(connection, message)
		case wire.MethodOperationsList:
			return s.router.HandleOperationsList(connection, message)
		case wire.MethodExecutionsGet:
			return s.router.HandleExecutionsGet(connection, message)
		case wire.MethodExecutionsList:
			return s.router.HandleExecutionsList(connection, message)
		case wire.MethodExecutionsCancel:
			return s.router.HandleExecutionsCancel(connection, message)
		case wire.MethodViewsConnect:
			return s.views.HandleConnect(connection, message)
		}
		return nil, &wire.RPCError{Code: -32601, Message: "method not found"}
	}
	connection.OnNotification = func(message *wire.Incoming) {
		switch message.Method {
		case wire.MethodViewsMessage:
			s.views.HandleMessage(connection, message)
		case wire.MethodViewsClose:
			s.views.HandleClose(connection, message)
		default:
			s.router.DispatchNotification(connection, message)
		}
	}
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
				err := socket.Ping(pingContext)
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
		s.views.DropRuntime(registrationID)
	}
	s.views.DropViewConnection(connection)
	s.router.DropConnection(connection)
}

// uiAsset はUI manifestに登録されたファイルを配信する。
// cacheに無ければproviderからlazy fetchしてから返す（pull model）。
// 内容はsha256照合済みなのでETagにそのハッシュをそのまま使う。
func (s *Server) uiAsset(w http.ResponseWriter, r *http.Request) {
	registrationID := r.PathValue("registrationId")
	filePath := r.PathValue("path")
	hash, declared := s.registry.UIAssetRef(registrationID, filePath)
	if !declared {
		writeAPIError(w, http.StatusNotFound, "not_found", "no such UI asset")
		return
	}
	data, cached := s.registry.ReadAsset(hash)
	if !cached {
		if err := s.registry.FetchAsset(r.Context(), registrationID, filePath); err != nil {
			writeAPIError(w, http.StatusServiceUnavailable, "asset_unavailable", "asset could not be fetched from the provider")
			return
		}
		data, cached = s.registry.ReadAsset(hash)
		if !cached {
			writeAPIError(w, http.StatusServiceUnavailable, "asset_unavailable", "asset could not be read from the cache")
			return
		}
	}
	etag := `"` + hash + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	contentType := mime.TypeByExtension(path.Ext(filePath))
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
