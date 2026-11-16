// Package connector はCore→Pluginへの接続（WS dial）とLink確立を担う。
// 全ての接続はCoreが開始し、Pluginは受け付けるだけ
// （docs/decisions/00010・contracts/00001）。
package connector

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

const CoreVersion = "0.1.0"

// Connector はPlugin EndpointへのWS接続を管理する。
// 静的configと動的登録（POST /v1/plugins・plugins.add）の両方から
// Watchを受け、Endpointごとに接続loopを1本だけ起動する。
// Endpointの集合はLinkとは別に持つ。Link未確立（到達不能）でも
// 再登録を防げるようにするため。
type Connector struct {
	ctx       context.Context // loopの寿命はCoreプロセス
	links     *registry.Registry
	coreID    string
	mu        sync.Mutex
	endpoints map[string]struct{}

	// transport上のPlugin→Coreメッセージの振り分け先。
	// serverがmessage semanticsを実装して設定する。
	OnRequest func(conn *rpc.Conn, message *wire.Incoming) (json.RawMessage, *wire.Error)
	OnNotif   func(conn *rpc.Conn, message *wire.Incoming)
	// Link確立・失効のたびにtools.catalogを全Linkへ送る契約のため、
	// catalogの変化時に呼ばれる（serverが設定）。
	OnCatalogChanged func()
}

func New(ctx context.Context, links *registry.Registry, coreID string) *Connector {
	return &Connector{ctx: ctx, links: links, coreID: coreID, endpoints: map[string]struct{}{}}
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
			if err := c.connect(endpoint); err != nil {
				if !failed {
					log.Printf("[core] plugin %s unreachable: %v (retrying)", endpoint, err)
					failed = true
				}
			} else {
				// connectはtransportが生きている間ブロックする。
				// 戻った=Link失効なので再試行に戻る。
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

// NewID はUUIDv4形式のランダムIDをprefix付きで発行する。
// 逐次カウンターにしない理由: 接続失敗でIDが消費されるのを避けるのと、
// LinkがCore再起動・複数Core間で実質一意であってほしいため。
func NewID(prefix string) string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	s := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s%s-%s-%s-%s-%s", prefix, s[0:8], s[8:12], s[12:16], s[16:20], s[20:32])
}

// connect はEndpointへのWS接続とlink.helloを行い、確立したLinkで
// transportが生きている間ブロックする。切断したらLinkを失効させて戻る。
func (c *Connector) connect(endpoint string) error {
	wsURL := endpoint + "/v1/transport"
	raw, _, err := websocket.Dial(c.ctx, wsURL, nil)
	if err != nil {
		return err
	}
	conn := rpc.NewConn(raw, "core-")
	conn.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.Error) {
		if c.OnRequest != nil {
			return c.OnRequest(conn, message)
		}
		return nil, &wire.Error{Code: -32601, Message: "method not found"}
	}
	conn.OnNotif = func(message *wire.Incoming) {
		if c.OnNotif != nil {
			c.OnNotif(conn, message)
		}
	}
	// 受信ループを先に動かす。RequestはRunが応答を配送しない限り
	// 完了しないため、hello送信の前に起動が必要。
	connDone := make(chan error, 1)
	go func() { connDone <- conn.Run(c.ctx) }()

	link := &registry.Link{
		ID:        NewID("link-"),
		Endpoint:  endpoint,
		CreatedAt: time.Now(),
	}
	conn.LinkID = link.ID
	link.BindTransport(conn)
	link.Touch() // 失効判定の基準時刻を接続直後に合わせる
	c.links.Add(link)

	// hello応答を待つ前にPluginが tools.set を送り得るため、
	// Linkは送信「前」に登録する（docs/contracts/00001）。
	var req wire.HelloRequest
	req.LinkID = link.ID
	req.Core.ID = c.coreID
	req.Core.Version = CoreVersion

	helloCtx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	defer cancel()
	res, err := conn.Request(helloCtx, wire.MethodLinkHello, req)
	if err != nil {
		c.links.Remove(link.ID)
		conn.Close()
		return fmt.Errorf("hello: %w", err)
	}
	if res.Error != nil {
		c.links.Remove(link.ID)
		conn.Close()
		return fmt.Errorf("hello: %s", res.Error.Message)
	}
	var helloResult wire.HelloResponse
	if err := wire.Unmarshal(res.Result, &helloResult); err != nil {
		c.links.Remove(link.ID)
		conn.Close()
		return err
	}
	link.SetPlugin(helloResult.Plugin)
	log.Printf("[core] link: %s (%s) → %s", link.Plugin().ID, link.ID, endpoint)
	if c.OnCatalogChanged != nil {
		c.OnCatalogChanged()
	}

	err = <-connDone
	log.Printf("[core] transport closed: %s (%s): %v", link.Plugin().ID, link.ID, err)
	// transport切断 = Link失効（contracts/00002）。Tool宣言・callはすべて消える。
	c.links.Remove(link.ID)
	return err
}

// BroadcastCatalog は登録中の全Toolを tools.catalog として全Linkへ送る。
// catalogの内容が変わる契機（Link確立・失効・tools.set受理）で呼ぶ。
func (c *Connector) BroadcastCatalog() {
	params := wire.ToolsCatalogParams{Tools: c.links.AllTools()}
	for _, l := range c.links.All() {
		if conn := l.Transport(); conn != nil {
			_ = conn.Notify(wire.MethodToolsCatalog, params)
		}
	}
}
