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

// Session の公開fieldは登録時に一度だけ書かれ、その後変更しないため
// lockなしで読んでよい。可変な3つ（channel・tools・lastPing）は
// 各method経由でsession-levelのlockを取って触れる。
type Session struct {
	ID             string
	RegistrationID string
	Plugin         wire.PluginInfo
	Endpoint       string
	CreatedAt      time.Time

	mu       sync.RWMutex
	channel  *rpc.Conn // Plugin→CoreのWebSocket channel（張られるまではnil）
	tools    []wire.ToolDecl
	lastPing time.Time
}

// Channel はPlugin→Coreのchannel（未接続ならnil）。
func (s *Session) Channel() *rpc.Conn {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.channel
}

func (s *Session) SetChannel(c *rpc.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.channel = c
}

// Tools は現行のTool宣言一覧（tools.setのたびに丸ごと差し替わる）。
func (s *Session) Tools() []wire.ToolDecl {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.tools
}

func (s *Session) SetTools(tools []wire.ToolDecl) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tools = tools
}

func (s *Session) Touch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastPing = time.Now()
}

func (s *Session) LastPingAt() time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastPing
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

// Add はSessionを登録する。同じEndpointの旧Session（plugin再起動・再hello）が
// 残っていれば失効させてから差し替える — 残すとtools.listに
// 死んだToolが並び、旧registrationIdへの呼出が死んだconnへforwardされる。
func (r *Registry) Add(s *Session) {
	r.mu.Lock()
	stale := r.byEndpoint[s.Endpoint]
	if stale != nil && stale.ID != s.ID {
		delete(r.sessions, stale.ID)
		delete(r.byReg, stale.RegistrationID)
	} else {
		stale = nil
	}
	r.sessions[s.ID] = s
	r.byReg[s.RegistrationID] = s
	r.byEndpoint[s.Endpoint] = s
	r.mu.Unlock()

	if stale != nil {
		r.teardown(stale)
	}
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
	r.mu.RLock()
	s, ok := r.sessions[sessionID]
	r.mu.RUnlock()
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
	s.SetTools(tools)
	return nil
}

func (r *Registry) Touch(sessionID string) error {
	s, ok := r.FindSession(sessionID)
	if !ok {
		return ErrNoSession
	}
	s.Touch()
	return nil
}

// SetChannel はSessionのchannelを張る。
func (r *Registry) SetChannel(sessionID string, c *rpc.Conn) error {
	s, ok := r.FindSession(sessionID)
	if !ok {
		return ErrNoSession
	}
	s.SetChannel(c)
	return nil
}

func (r *Registry) AllTools() []wire.ListedTool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []wire.ListedTool
	for _, s := range r.sessions {
		for _, t := range s.Tools() {
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
	r.teardown(s)
}

// RemoveChannel はSessionの現行channelがこのconnのときだけSessionを失効させる。
// WS切断後始末用 — pluginがchannelを張り直した直後に旧connの
// cleanupが走っても、新しいchannelのSessionを消さないためのguard。
func (r *Registry) RemoveChannel(id string, c *rpc.Conn) {
	r.mu.Lock()
	s, ok := r.sessions[id]
	matched := ok && s.Channel() == c
	if matched {
		delete(r.sessions, s.ID)
		delete(r.byReg, s.RegistrationID)
		delete(r.byEndpoint, s.Endpoint)
	}
	r.mu.Unlock()
	if matched {
		r.teardown(s)
	}
}

// teardown はSession失効の後始末（mapから外れた後に呼ぶ）。
func (r *Registry) teardown(s *Session) {
	if c := s.Channel(); c != nil {
		c.Close()
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
				if time.Since(s.LastPingAt()) > idleTimeout {
					r.Remove(s.ID)
				}
			}
		}
	}
}
