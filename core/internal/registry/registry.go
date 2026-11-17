// Package registry はLink Registry（docs/designs/00002）。
// LinkはCore↔Pluginの接続・登録単位で、失効時に
// Tool宣言・進行中callがすべて消える（link-scoped）。
package registry

import (
	"context"
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
	tools     []wire.ToolDeclaration
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

// Tools は現行のTool宣言一覧（connect時のGET /v1/tools pullで丸ごと差し替わる）。
func (l *Link) Tools() []wire.ToolDeclaration {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.tools
}

func (l *Link) SetTools(tools []wire.ToolDeclaration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	// kind省略時はsync（contracts/00001 GET /v1/tools）。
	// Tool宣言の入口はここだけなので、正規化もここで行う。
	for i := range tools {
		if tools[i].Kind == "" {
			tools[i].Kind = "sync"
		}
	}
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

// SetTransport はLink生成時にtransportを結び付ける（Add前に呼ぶ）。
// transport=Linkで1対1のため、後から差し替える用途はない。
func (l *Link) BindTransport(c *rpc.Conn) {
	l.SetTransport(c)
}

func (r *Registry) AllTools() []wire.ListedTool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []wire.ListedTool
	for _, l := range r.links {
		for _, t := range l.Tools() {
			out = append(out, wire.ListedTool{LinkID: l.ID, ToolDeclaration: t})
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

// transportとLinkの寿命は一致する（docs/contracts/00002）ため、
// transportだけを外す操作は存在しない。切断時はLinkごと失効させる（Remove）。

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
