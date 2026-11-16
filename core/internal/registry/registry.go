// Package registry はLink Registry（docs/designs/00002）。
// LinkはCore↔Pluginの接続・登録単位で、失効時に
// Tool宣言・進行中callがすべて消える（link-scoped）。
package registry

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

// Link の公開field（ID・Endpoint・CreatedAt）は
// 登録時に一度だけ書かれ、その後変更しないためlockなしで読んでよい。
// 可変な4つ（plugin・transport・tools・lastPing）は各method経由で
// link-levelのlockを取って触れる（pluginはhello応答受取時に設定される）。
type Link struct {
	ID        string
	Endpoint  string
	CreatedAt time.Time

	mu        sync.RWMutex
	plugin    wire.PluginInfo
	transport *rpc.Conn // Plugin→Coreのtransport（接続されるまではnil）
	tools     []wire.ToolDecl
	lastPing  time.Time
}

// Plugin はhello応答で受け取ったPlugin情報（未確立時はzero）。
func (l *Link) Plugin() wire.PluginInfo {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.plugin
}

func (l *Link) SetPlugin(info wire.PluginInfo) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.plugin = info
}

// Transport はPlugin→Coreのtransport（未接続ならnil）。
func (l *Link) Transport() *rpc.Conn {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.transport
}

func (l *Link) SetTransport(c *rpc.Conn) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.transport = c
}

// Tools は現行のTool宣言一覧（tools.setのたびに丸ごと差し替わる）。
func (l *Link) Tools() []wire.ToolDecl {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.tools
}

func (l *Link) SetTools(tools []wire.ToolDecl) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.tools = tools
}

func (l *Link) Touch() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lastPing = time.Now()
}

func (l *Link) LastPingAt() time.Time {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.lastPing
}

var ErrNoLink = errors.New("unknown link")

type Registry struct {
	mu         sync.RWMutex
	links      map[string]*Link // linkID →
	byEndpoint map[string]*Link // endpoint → （1 Endpoint = 1 Link想定のMVP）
	OnExpired  func(*Link)
}

func New() *Registry {
	return &Registry{
		links:      map[string]*Link{},
		byEndpoint: map[string]*Link{},
	}
}

// Add はLinkを登録する。同じEndpointの旧Link（plugin再起動・再hello）が
// 残っていれば失効させてから差し替える。残すとtools.listに
// 死んだToolが並び、旧linkIdへの呼び出しが死んだconnへforwardされる。
func (r *Registry) Add(l *Link) {
	r.mu.Lock()
	stale := r.byEndpoint[l.Endpoint]
	if stale != nil && stale.ID != l.ID {
		delete(r.links, stale.ID)
	} else {
		stale = nil
	}
	r.links[l.ID] = l
	r.byEndpoint[l.Endpoint] = l
	r.mu.Unlock()

	if stale != nil {
		r.teardown(stale)
	}
}

func (r *Registry) Find(id string) (*Link, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	l, ok := r.links[id]
	return l, ok
}

func (r *Registry) FindEndpoint(endpoint string) (*Link, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	l, ok := r.byEndpoint[endpoint]
	return l, ok
}

// SetTools は tools.set を反映する（アトミック置換）。toolPath重複は409相当。
func (r *Registry) SetTools(linkID string, tools []wire.ToolDecl) error {
	r.mu.RLock()
	l, ok := r.links[linkID]
	r.mu.RUnlock()
	if !ok {
		return ErrNoLink
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
	l.SetTools(tools)
	return nil
}

func (r *Registry) Touch(linkID string) error {
	l, ok := r.Find(linkID)
	if !ok {
		return ErrNoLink
	}
	l.Touch()
	return nil
}

// SetTransport はLinkのtransportを接続する。
func (r *Registry) SetTransport(linkID string, c *rpc.Conn) error {
	l, ok := r.Find(linkID)
	if !ok {
		return ErrNoLink
	}
	l.SetTransport(c)
	return nil
}

func (r *Registry) AllTools() []wire.ListedTool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []wire.ListedTool
	for _, l := range r.links {
		for _, t := range l.Tools() {
			out = append(out, wire.ListedTool{LinkID: l.ID, ToolDecl: t})
		}
	}
	return out
}

func (r *Registry) All() []*Link {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Link, 0, len(r.links))
	for _, l := range r.links {
		out = append(out, l)
	}
	return out
}

// Remove はLinkを失効させる（ping期限切れ・再起動hello時の再接続）。
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	l, ok := r.links[id]
	if !ok {
		r.mu.Unlock()
		return
	}
	delete(r.links, l.ID)
	delete(r.byEndpoint, l.Endpoint)
	r.mu.Unlock()
	r.teardown(l)
}

// ClearTransport はLinkの現行transportがこのconnのとき、transportだけを外す。
// Link自体は消さない。transportの切断とLink失効は別
// （docs/contracts/00002。Link寿命はlink.pingが管理する）。
// Pluginは同じlinkIdでtransportを接続し直せる。
func (r *Registry) ClearTransport(id string, c *rpc.Conn) {
	l, ok := r.Find(id)
	if !ok {
		return
	}
	l.mu.Lock()
	if l.transport == c {
		l.transport = nil
	}
	l.mu.Unlock()
}

// teardown はLink失効の後始末（mapから外れた後に呼ぶ）。
func (r *Registry) teardown(l *Link) {
	if c := l.Transport(); c != nil {
		c.Close()
	}
	if r.OnExpired != nil {
		r.OnExpired(l)
	}
}

// ExpireLoop はLastPingがidleTimeoutを超えたLinkを失効させる。
func (r *Registry) ExpireLoop(ctx context.Context, idleTimeout, tick time.Duration) {
	t := time.NewTicker(tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			for _, l := range r.All() {
				if time.Since(l.LastPingAt()) > idleTimeout {
					r.Remove(l.ID)
				}
			}
		}
	}
}
