// Package connector はCore→Pluginへの接続試行（link.hello）。
// Link確立は起動と分離する — 到達不能なPluginは再試行を続けるだけ
// （docs/contracts/00001「Plugin Endpointの解決」）。
package connector

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/wire"
)

const CoreVersion = "0.1.0"

// Connector はPlugin Endpointへの接続試行を管理する。
// 静的configと動的登録（POST /v1/plugins）の両方からWatchを受け、
// Endpointごとに接続loopを1本だけ張る。
// Endpointの集合はLinkとは別に持つ — Link未確立（到達不能）でも
// 再登録を防げるようにするため。
type Connector struct {
	ctx       context.Context // loopの寿命はCoreプロセス
	links     *registry.Registry
	coreURL   string
	mu        sync.Mutex
	endpoints map[string]struct{}
}

func New(ctx context.Context, links *registry.Registry, coreURL string) *Connector {
	return &Connector{ctx: ctx, links: links, coreURL: coreURL, endpoints: map[string]struct{}{}}
}

// Watch はEndpointへの接続loopを開始する。既知のEndpointならfalse。
func (c *Connector) Watch(endpoint string) bool {
	c.mu.Lock()
	if _, ok := c.endpoints[endpoint]; ok {
		c.mu.Unlock()
		return false
	}
	c.endpoints[endpoint] = struct{}{}
	c.mu.Unlock()
	go c.loop(endpoint)
	return true
}

// Known は既知のEndpoint一覧を返す（登録順ではなくソート済み）。
func (c *Connector) Known() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.endpoints))
	for endpoint := range c.endpoints {
		out = append(out, endpoint)
	}
	sort.Strings(out)
	return out
}

// loop は1つのPlugin Endpointへの接続試行。Link確立まで再試行を続ける。
func (c *Connector) loop(endpoint string) {
	failed := false
	for {
		select {
		case <-c.ctx.Done():
			return
		default:
		}
		if _, ok := c.links.FindEndpoint(endpoint); !ok {
			if err := hello(c.links, endpoint, c.coreURL); err != nil {
				if !failed {
					log.Printf("[core] plugin %s unreachable: %v (retrying)", endpoint, err)
					failed = true
				}
			} else {
				failed = false
			}
		}
		select {
		case <-c.ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

// newID はUUIDv4形式のランダムIDをprefix付きで発行する。
// 逐次カウンターにしない理由: hello失敗でIDが消費されるのを避けるのと、
// LinkがCore再起動・複数Core間で実質一意であってほしいため。
func newID(prefix string) string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	s := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s%s-%s-%s-%s-%s", prefix, s[0:8], s[8:12], s[12:16], s[16:20], s[20:32])
}

// hello は link.hello（Core → Plugin）。IDを払い出してLinkを登録する。
// Linkはhello送信「前」に登録する — Pluginはhello応答と並行して
// tools.set・transport接続を開始し得るため、応答を受けてから登録すると
// tools.set が unknown_link で落ちる競合になる（contracts/00002）。
func hello(links *registry.Registry, endpoint, coreURL string) error {
	link := &registry.Link{
		ID:        newID("link-"),
		Endpoint:  endpoint,
		CreatedAt: time.Now(),
	}
	link.Touch() // 失効判定の基準時刻を登録直後に合わせる
	links.Add(link)

	var req wire.HelloRequest
	req.LinkID = link.ID
	req.Core.URL = coreURL
	req.Core.Version = CoreVersion

	body, _ := json.Marshal(req)
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Post(endpoint+"/v1/link/hello", "application/json", bytes.NewReader(body))
	if err != nil {
		links.Remove(link.ID)
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		links.Remove(link.ID)
		return fmt.Errorf("hello: %s", res.Status)
	}
	var helloResponse wire.HelloResponse
	if err := json.NewDecoder(res.Body).Decode(&helloResponse); err != nil {
		links.Remove(link.ID)
		return err
	}
	link.SetPlugin(helloResponse.Plugin)
	log.Printf("[core] link: %s (%s) → %s", link.Plugin().ID, link.ID, endpoint)
	return nil
}
