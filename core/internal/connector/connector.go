// Package connector はCore→Pluginへの接続とLink確立を担う。
// 共通規格はREST（hello・tools pull・ping・catalog push）、
// Tool呼び出し路だけWS dialする。全ての接続はCoreが開始し、
// Pluginは受け付けるだけ（docs/decisions/00010・contracts/00001）。
package connector

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
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
	OnRequest   func(conn *rpc.Conn, message *wire.Incoming) (json.RawMessage, *wire.Error)
	OnNotif     func(conn *rpc.Conn, message *wire.Incoming)
	OnResponded func(conn *rpc.Conn, id json.RawMessage)
	// Link確立・失効のたびにtools.catalogを全Linkへ送る契約のため、
	// catalogの変化時に呼ばれる（serverが設定）。
	OnCatalogChanged func()

	catalogCh chan struct{} // catalog push依頼（cap1。連続変更はcoalesce）
}

func New(ctx context.Context, links *registry.Registry, coreID string) *Connector {
	c := &Connector{
		ctx: ctx, links: links, coreID: coreID,
		endpoints: map[string]struct{}{}, catalogCh: make(chan struct{}, 1),
	}
	go c.catalogLoop()
	return c
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

// Watched はEndpointが登録対象かを返す。
func (c *Connector) Watched(endpoint string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.endpoints[endpoint]
	return ok
}

// Unwatch はEndpointの登録を解除する。接続loopは次の反復で自死し、
// 確立済みLinkがあれば失効させる（transport切断相当。catalogも更新される）。
// 戻り値は「登録が存在したか」。
func (c *Connector) Unwatch(endpoint string) bool {
	c.mu.Lock()
	if _, ok := c.endpoints[endpoint]; !ok {
		c.mu.Unlock()
		return false
	}
	delete(c.endpoints, endpoint)
	c.mu.Unlock()
	if link, ok := c.links.FindEndpoint(endpoint); ok {
		c.links.Remove(link.ID)
	}
	return true
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
		// Unwatch済みならloopを終える。connectがブロック中にUnwatchされても
		// Link失効→transport切断でconnectが戻り、ここで検出される。
		if !c.Watched(endpoint) {
			return
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

// httpJSON はCore→Plugin REST呼び出し。GETはbodyを送らず、
// POSTはreqをJSONで送る。resが非nilなら応答bodyをunmarshalする。
// REST呼び出しがLink確立の入口なので、エラー応答は契約の
// `{error:{code,message}}` 形からmessageだけ拾って返す。
func httpJSON(ctx context.Context, method, url string, req, res any) error {
	var body io.Reader
	if req != nil {
		payload, err := json.Marshal(req)
		if err != nil {
			return err
		}
		body = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return err
	}
	if req != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		var apiError struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(response.Body).Decode(&apiError)
		if apiError.Error.Message != "" {
			return fmt.Errorf("%s %s: %s", method, url, apiError.Error.Message)
		}
		return fmt.Errorf("%s %s: HTTP %d", method, url, response.StatusCode)
	}
	if res != nil {
		return json.NewDecoder(response.Body).Decode(res)
	}
	return nil
}

// connect はEndpointへのLink確立（REST hello→tools pull→WS upgrade）を行い、
// transportが生きている間ブロックする。切断したらLinkを失効させて戻る。
func (c *Connector) connect(endpoint string) error {
	link := &registry.Link{
		ID:        NewID("link-"),
		Endpoint:  endpoint,
		CreatedAt: time.Now(),
	}
	link.Touch() // 失効判定の基準時刻を接続直後に合わせる

	fail := func(err error) error {
		c.links.Remove(link.ID)
		return err
	}

	var req wire.HelloRequest
	req.LinkID = link.ID
	req.Core.ID = c.coreID
	req.Core.Version = CoreVersion

	// Linkはhello+tools pull+transportまで揃ってから登録する。
	// 中途半端なLinkをregistryに置くと、catalog pushが
	// plugin側に未登録のlinkIdへ飛んで失敗する。
	helloCtx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	var helloResult wire.HelloResponse
	err := httpJSON(helloCtx, http.MethodPost, endpoint+"/v1/link/hello", req, &helloResult)
	cancel()
	if err != nil {
		return fail(fmt.Errorf("hello: %w", err))
	}
	link.SetPlugin(helloResult.Plugin)

	// Tool宣言はREST pullで取る（POST /v1/tools/catalog の内容を変える
	// ため、登録「前」に揃える）。
	toolsCtx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	var toolsResult wire.ToolsGetResponse
	err = httpJSON(toolsCtx, http.MethodGet, endpoint+"/v1/tools", nil, &toolsResult)
	cancel()
	if err != nil {
		return fail(fmt.Errorf("tools: %w", err))
	}
	seen := map[string]struct{}{}
	for _, tool := range toolsResult.Tools {
		if _, dup := seen[tool.ToolPath]; dup {
			return fail(fmt.Errorf("tools: duplicate toolPath %q", tool.ToolPath))
		}
		seen[tool.ToolPath] = struct{}{}
	}
	link.SetTools(toolsResult.Tools)

	// tools.call用のtransportだけWS。schemeはendpointのhttp→ws対応で導く。
	wsURL := "ws" + strings.TrimPrefix(endpoint, "http") + "/v1/transport?linkId=" + link.ID
	raw, _, err := websocket.Dial(c.ctx, wsURL, nil)
	if err != nil {
		return fail(err)
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
	conn.OnResponded = func(id json.RawMessage) {
		if c.OnResponded != nil {
			c.OnResponded(conn, id)
		}
	}
	conn.LinkID = link.ID
	link.BindTransport(conn)
	c.links.Add(link)
	// connect中にUnwatchされた場合、ここでLinkを残さない
	// （残すと誰も監視しないLinkが生き続ける）。
	if !c.Watched(endpoint) {
		c.links.Remove(link.ID)
		return errors.New("endpoint unwatched during connect")
	}
	connDone := make(chan error, 1)
	go func() { connDone <- conn.Run(c.ctx) }()

	log.Printf("[core] link: %s (%s) → %s", link.Plugin().ID, link.ID, endpoint)

	// pingはCore→PluginのREST probe。応答成功が生存証拠になる。
	pingDone := make(chan struct{})
	defer close(pingDone)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-pingDone:
				return
			case <-ticker.C:
				pingCtx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
				err := httpJSON(pingCtx, http.MethodPost, endpoint+"/v1/link/ping",
					wire.LinkPingParams{LinkID: link.ID}, nil)
				cancel()
				if err == nil {
					link.Touch()
				}
			}
		}
	}()

	// 新Linkが入るとcatalogの内容が変わるため全Linkへpushし直す契約。
	if c.OnCatalogChanged != nil {
		c.OnCatalogChanged()
	}

	err = <-connDone
	log.Printf("[core] transport closed: %s (%s): %v", link.Plugin().ID, link.ID, err)
	// transport切断 = Link失効（contracts/00002）。Tool宣言・callはすべて消える。
	c.links.Remove(link.ID)
	return err
}

// BroadcastCatalog はcatalog pushを依頼する。実際の送信はcatalogLoopが
// 直列に行う。Linkごとに並列POSTすると到着順が逆転して古いcatalogで
// 上書きされ得るため、pushは単一workerに集約する。workerは実行時の
// 最新状態を読むので世代管理は要らない。
func (c *Connector) BroadcastCatalog() {
	select {
	case c.catalogCh <- struct{}{}:
	default: // 既に依頼が溜まっていればcoalesce（workerが最新状態を送る）
	}
}

func (c *Connector) catalogLoop() {
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-c.catalogCh:
		}
		// nilだと `"tools": null` になり受け手のserdeが落ちるため必ず配列にする。
		tools := c.links.AllTools()
		if tools == nil {
			tools = []wire.ListedTool{}
		}
		for _, l := range c.links.All() {
			body := wire.ToolsCatalogParams{LinkID: l.ID, Tools: tools}
			pushCtx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
			err := httpJSON(pushCtx, http.MethodPost, l.Endpoint+"/v1/tools/catalog", body, nil)
			cancel()
			if err != nil {
				log.Printf("[core] catalog push to %s failed: %v", l.Endpoint, err)
			}
		}
	}
}
