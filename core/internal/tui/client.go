// Package tui は plugumi tui のTUI。Core管理RESTとcaller channel
// （GET /v1/call、contracts/00003のcaller側）を使い、Plugin・Toolの
// 一覧表示とTool呼び出しを行う。
package tui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

// Event はcaller channel経由で届く非同期イベント。TUIのUpdateが
// events channelから拾って画面に反映する。
type Event struct {
	Kind    string // "output" | "result" | "conn-closed"
	CallID  string // json.RawMessageの文字列表現（"\"tui-1\""等）
	Payload json.RawMessage
	Result  json.RawMessage
	Err     *wire.Error
}

// Client はCoreの管理RESTとcaller channelへの薄いクライアント。
// WS接続は最初のcall時にlazyに張り、以後使い回す。
type Client struct {
	baseURL string
	wsURL   string
	http    *http.Client

	mu     sync.Mutex
	conn   *rpc.Conn
	events chan Event
}

func NewClient(coreURL string) (*Client, error) {
	parsed, err := url.Parse(coreURL)
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("invalid core url: %q", coreURL)
	}
	wsScheme := "ws"
	if parsed.Scheme == "https" {
		wsScheme = "wss"
	}
	return &Client{
		baseURL: strings.TrimRight(coreURL, "/"),
		wsURL:   fmt.Sprintf("%s://%s/v1/call", wsScheme, parsed.Host),
		http:    &http.Client{Timeout: 10 * time.Second},
		events:  make(chan Event, 256),
	}, nil
}

// Events はcaller channelの非同期イベントを返す。
func (c *Client) Events() <-chan Event { return c.events }

// ---- 管理REST ----

func (c *Client) post(path string, req, res any) error {
	var body io.Reader
	if req != nil {
		payload, err := json.Marshal(req)
		if err != nil {
			return err
		}
		body = bytes.NewReader(payload)
	}
	httpReq, err := http.NewRequest(http.MethodPost, c.baseURL+path, body)
	if err != nil {
		return err
	}
	if req != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		var apiErr struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&apiErr)
		if apiErr.Error.Message != "" {
			return fmt.Errorf("%s", apiErr.Error.Message)
		}
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if res != nil {
		return json.NewDecoder(resp.Body).Decode(res)
	}
	return nil
}

func (c *Client) ListPlugins() ([]wire.RegisteredPlugin, error) {
	var result wire.PluginsListResult
	if err := c.post("/v1/plugins/list", struct{}{}, &result); err != nil {
		return nil, err
	}
	return result.Plugins, nil
}

func (c *Client) ListTools() ([]wire.ListedTool, error) {
	var result wire.ToolsListResult
	if err := c.post("/v1/tools/list", struct{}{}, &result); err != nil {
		return nil, err
	}
	return result.Tools, nil
}

func (c *Client) AddPlugin(endpoint string) error {
	return c.post("/v1/plugins", wire.PluginsAddRequest{Endpoint: endpoint}, nil)
}

func (c *Client) RemovePlugin(endpoint string) error {
	return c.post("/v1/plugins/remove", wire.PluginsRemoveRequest{Endpoint: endpoint}, nil)
}

// ---- caller channel（GET /v1/call） ----

// ensureConn はcaller channelのWS接続を確立する。切断済みなら張り直す。
func (c *Client) ensureConn(ctx context.Context) (*rpc.Conn, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		select {
		case <-c.conn.Done():
			c.conn = nil
		default:
			return c.conn, nil
		}
	}
	raw, _, err := websocket.Dial(ctx, c.wsURL, nil)
	if err != nil {
		return nil, err
	}
	conn := rpc.NewConn(raw, "tui-")
	conn.OnNotif = func(message *wire.Incoming) {
		c.dispatchNotif(message)
	}
	// caller側にrequestが来ることはない（Core→callerはnotificationのみ）。
	conn.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.Error) {
		return nil, &wire.Error{Code: -32601, Message: "method not found"}
	}
	c.conn = conn
	go func() {
		_ = conn.Run(context.Background())
		select {
		case c.events <- Event{Kind: "conn-closed"}:
		case <-time.After(2 * time.Second): // 満杯でもgoroutineを残さない
		}
	}()
	return conn, nil
}

// CallOutcome はtools.call requestのresponseを分類したもの。
// async受理（{accepted:true}）とsync終端を区別する。
type CallOutcome int

const (
	CallSyncDone CallOutcome = iota // responseが終端（sync結果 or 受理失敗error）
	CallAsync                       // {accepted:true}。以後output/result通知が届く
	CallFailed                      // request自体の失敗（JSON-RPC error response）
)

// CallTicket は1回のcallに必要なidとconnの組。
// idをcall送信「前」に確定させるのは、responseより先に届くoutput通知を
// callIDで照合できるようにするため（client側の処理順は保証されない）。
// connを保持するのは、切断→再接続でconnが差し替わってもidの発行元と
// 送信先がずれないようにするため。
type CallTicket struct {
	conn *rpc.Conn
	ID   json.RawMessage
}

// NewCallTicket はcaller channelの接続を確保し、次のcallに使うticketを発行する。
func (c *Client) NewCallTicket(ctx context.Context) (*CallTicket, error) {
	conn, err := c.ensureConn(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	return &CallTicket{conn: conn, ID: conn.NextID()}, nil
}

// CallIDString はticketのidをnotification相関・表示用の文字列で返す。
func CallIDString(ticket *CallTicket) string { return string(ticket.ID) }

// Call はticketのidでtools.callを送り、responseまで待つ。
// async受理ならacceptedが返った時点で戻り、output/resultはEvents()経由。
// kindは宣言ラベル（contract 00003）。宣言がsyncのtoolが{accepted:true}を
// resultとして返しても終端として扱う — shapeだけで判定すると
// 終端済みのcallをasync受理と誤認して通知待ちになる。
func (c *Client) Call(ctx context.Context, ticket *CallTicket, linkID, toolPath string, input json.RawMessage, kind string) (CallOutcome, json.RawMessage, *wire.Error, error) {
	params := wire.CallParams{
		Target: wire.CallTarget{LinkID: linkID, ToolPath: toolPath},
		Input:  input,
	}
	res, err := ticket.conn.RequestWithID(ctx, ticket.ID, wire.MethodCall, params)
	if err != nil {
		return CallFailed, nil, nil, err
	}
	if res.Error != nil {
		return CallFailed, nil, res.Error, nil
	}
	if kind == "async" {
		var accepted struct {
			Accepted bool `json:"accepted"`
		}
		_ = json.Unmarshal(res.Result, &accepted)
		if accepted.Accepted {
			return CallAsync, res.Result, nil, nil
		}
	}
	return CallSyncDone, res.Result, nil, nil
}

// Close は実行中callへtools.call.closeを送る。
func (c *Client) Close(ticket *CallTicket) {
	if ticket == nil || ticket.conn == nil {
		return
	}
	_ = ticket.conn.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: ticket.ID})
}

func (c *Client) dispatchNotif(message *wire.Incoming) {
	event := Event{Kind: "output"}
	switch message.Method {
	case wire.MethodCallOutput:
		var params wire.CallOutputParams
		if err := wire.Unmarshal(message.Params, &params); err != nil {
			return
		}
		event.CallID = string(params.CallID)
		event.Payload = params.Payload
	case wire.MethodCallResult:
		var params wire.CallResultParams
		if err := wire.Unmarshal(message.Params, &params); err != nil {
			return
		}
		event.Kind = "result"
		event.CallID = string(params.CallID)
		event.Result = params.Result
		event.Err = params.Error
	default:
		return
	}
	select {
	case c.events <- event:
	case <-time.After(2 * time.Second): // UIが詰まってもconnを詰まらせない
	}
}
