// Package registry はSession Registry（docs/designs/00002）。
// SessionはCore↔Pluginの接続・登録単位で、失効時に
// Registration・Tool・進行中callがすべて消える（session-scoped）。
package registry

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

type Session struct {
	ID             string
	RegistrationID string
	Plugin         wire.PluginInfo
	Endpoint       string
	CreatedAt      time.Time
	LastPing       time.Time
	Tools          []wire.ToolDecl
	WebSocket      *rpc.Conn // Plugin→CoreのWebSocket channel（張られるまではnil）
}

var ErrNoSession = errors.New("unknown session")

type Registry struct {
	mu         sync.RWMutex
	sessions   map[string]*Session // sessionID →
	byReg      map[string]*Session // registrationID →
	byEndpoint map[string]*Session // endpoint → （1 Endpoint = 1 Session想定のMVP）
	OnExpired  func(*Session)
}

func New() *Registry {
	return &Registry{
		sessions:   map[string]*Session{},
		byReg:      map[string]*Session{},
		byEndpoint: map[string]*Session{},
	}
}

func (r *Registry) Add(s *Session) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[s.ID] = s
	r.byReg[s.RegistrationID] = s
	r.byEndpoint[s.Endpoint] = s
}

func (r *Registry) FindSession(id string) (*Session, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.sessions[id]
	return s, ok
}

func (r *Registry) FindRegistration(id string) (*Session, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.byReg[id]
	return s, ok
}

func (r *Registry) FindEndpoint(endpoint string) (*Session, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.byEndpoint[endpoint]
	return s, ok
}

// SetTools は tools.set を反映する（アトミック置換）。toolPath重複は409相当。
func (r *Registry) SetTools(sessionID string, tools []wire.ToolDecl) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[sessionID]
	if !ok {
		return ErrNoSession
	}
	seen := map[string]bool{}
	for i := range tools {
		if seen[tools[i].ToolPath] {
			return errors.New("duplicate toolPath: " + tools[i].ToolPath)
		}
		seen[tools[i].ToolPath] = true
		if tools[i].Kind == "" {
			tools[i].Kind = "sync"
		}
	}
	s.Tools = tools
	return nil
}

func (r *Registry) Touch(sessionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[sessionID]
	if !ok {
		return ErrNoSession
	}
	s.LastPing = time.Now()
	return nil
}

func (r *Registry) SetWebSocket(sessionID string, c *rpc.Conn) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[sessionID]
	if !ok {
		return ErrNoSession
	}
	s.WebSocket = c
	return nil
}

func (r *Registry) AllTools() []wire.ListedTool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []wire.ListedTool
	for _, s := range r.sessions {
		for _, t := range s.Tools {
			out = append(out, wire.ListedTool{RegistrationID: s.RegistrationID, ToolDecl: t})
		}
	}
	return out
}

func (r *Registry) All() []*Session {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Session, 0, len(r.sessions))
	for _, s := range r.sessions {
		out = append(out, s)
	}
	return out
}

// Remove はSessionを失効させる（ping期限切れ・WebSocket切断・再起動hello時の張替え）。
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	s, ok := r.sessions[id]
	if !ok {
		r.mu.Unlock()
		return
	}
	delete(r.sessions, s.ID)
	delete(r.byReg, s.RegistrationID)
	delete(r.byEndpoint, s.Endpoint)
	r.mu.Unlock()

	if s.WebSocket != nil {
		s.WebSocket.Close()
	}
	if r.OnExpired != nil {
		r.OnExpired(s)
	}
}

// ExpireLoop はLastPingがidleTimeoutを超えたSessionを失効させる。
func (r *Registry) ExpireLoop(ctx context.Context, idleTimeout, tick time.Duration) {
	t := time.NewTicker(tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			for _, s := range r.All() {
				if time.Since(s.LastPing) > idleTimeout {
					r.Remove(s.ID)
				}
			}
		}
	}
}
