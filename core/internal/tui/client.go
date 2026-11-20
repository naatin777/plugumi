// Package tui は plugumi tui のTUI。CoreのRegistryと呼び出し専用RPC接続
// （contracts/00004）を使い、Plugin・Toolの
// 一覧表示とTool呼び出しを行う。
package tui

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

// EventKind は呼び出し側のWS接続経由で届く非同期イベントの種別。
type EventKind string

const (
	EventOutput     EventKind = "output"
	EventResult     EventKind = "result"
	EventConnClosed EventKind = "connection-closed"
)

// Event は呼び出し側のWS接続経由で届く非同期イベント。TUIのUpdateが
// events channelから拾って画面に反映する。
type Event struct {
	Kind    EventKind // EventOutput | EventResult | EventConnClosed
	CallID  string    // json.RawMessageの文字列表現（"\"tui-1\""等）
	Payload json.RawMessage
	Result  json.RawMessage
	Err     *wire.RpcError
}

// Client はCoreの管理RESTと呼び出し側のWSへの薄いクライアント。
// WS接続は最初のcall時にlazyに張り、以後使い回す。
type Client struct {
	baseURL string
	wsURL   string
	http    *http.Client
	token   string
	ctx     context.Context
	cancel  context.CancelFunc

	mu              sync.Mutex
	connection      *rpc.Connection
	events          chan Event
	registryChanges chan struct{}
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
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{
		baseURL:         strings.TrimRight(coreURL, "/"),
		wsURL:           fmt.Sprintf("%s://%s/v1/rpc", wsScheme, parsed.Host),
		http:            &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		token:           os.Getenv("PLUGUMI_TOKEN"),
		ctx:             ctx,
		cancel:          cancel,
		events:          make(chan Event, 256),
		registryChanges: make(chan struct{}, 1),
	}, nil
}

func (c *Client) disconnect() {
	c.cancel()
	c.http.CloseIdleConnections()
}

// ---- Registry REST ----

func (c *Client) request(method, path string, res any) error {
	httpReq, err := http.NewRequestWithContext(c.ctx, method, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	if c.token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiError struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&apiError)
		if apiError.Error.Message != "" {
			return fmt.Errorf("%s", apiError.Error.Message)
		}
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if res != nil {
		return json.NewDecoder(resp.Body).Decode(res)
	}
	return nil
}

func (c *Client) Registry() (wire.RegistrySnapshot, error) {
	var result wire.RegistrySnapshot
	err := c.request(http.MethodGet, "/v1/registry", &result)
	return result, err
}

func (c *Client) RemovePlugin(registrationID string) error {
	return c.request(http.MethodDelete, "/v1/registrations/"+url.PathEscape(registrationID), nil)
}

func (c *Client) watchRegistry() {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 10 * time.Second
	client := &http.Client{Transport: transport, CheckRedirect: c.http.CheckRedirect}
	defer client.CloseIdleConnections()
	for c.ctx.Err() == nil {
		c.readRegistryEvents(client)
		select {
		case <-c.ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
}

func (c *Client) readRegistryEvents(client *http.Client) {
	request, err := http.NewRequestWithContext(c.ctx, http.MethodGet, c.baseURL+"/v1/events", nil)
	if err != nil {
		return
	}
	if c.token != "" {
		request.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := client.Do(request)
	if err != nil {
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "text/event-stream" {
		return
	}
	scanner := bufio.NewScanner(response.Body)
	var changed bool
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			changed = true
		} else if line == "" && changed {
			changed = false
			c.signalRegistryChange()
		}
	}
	if err := scanner.Err(); err != nil && c.ctx.Err() == nil {
		// 読み取りに失敗したら、SSEの再接続を待たずにSnapshotで状態を確認する。
		c.signalRegistryChange()
	}
}

func (c *Client) signalRegistryChange() {
	// 通知は差分ではないため、未処理の通知はまとめてよい。
	select {
	case c.registryChanges <- struct{}{}:
	default:
	}
}

// ---- 呼び出し専用のWS（GET /v1/rpc） ----

// ensureConnection は呼び出し側のWS接続を確立する。切断済みなら張り直す。
func (c *Client) ensureConnection(ctx context.Context) (*rpc.Connection, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.ctx.Err(); err != nil {
		return nil, err
	}
	if c.connection != nil {
		select {
		case <-c.connection.Done():
			c.connection = nil
		default:
			return c.connection, nil
		}
	}
	dialContext, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(c.ctx, cancel)
	defer stop()
	headers := make(http.Header)
	if c.token != "" {
		headers.Set("Authorization", "Bearer "+c.token)
	}
	raw, _, err := websocket.Dial(dialContext, c.wsURL, &websocket.DialOptions{
		HTTPClient: c.http,
		HTTPHeader: headers,
	})
	if err != nil {
		return nil, err
	}
	connection := rpc.NewConnection(raw, "tui-")
	connection.OnNotification = func(message *wire.Incoming) {
		c.dispatchNotification(message)
	}
	// caller側にrequestが来ることはない（Core→callerはnotificationのみ）。
	connection.OnRequest = func(message *wire.Incoming) (json.RawMessage, *wire.RpcError) {
		return nil, &wire.RpcError{Code: -32601, Message: "method not found"}
	}
	c.connection = connection
	go func() {
		defer raw.CloseNow()
		_ = connection.Run(c.ctx)
		select {
		case c.events <- Event{Kind: EventConnClosed}:
		case <-c.ctx.Done():
		case <-time.After(2 * time.Second): // 満杯でもgoroutineを残さない
		}
	}()
	return connection, nil
}

// CallOutcome はtools.call requestのresponseを分類したもの。
// async受理（{accepted:true}）とsync終端を区別する。
type CallOutcome int

const (
	CallSyncDone      CallOutcome = iota // responseが終端（sync結果 or 受理失敗error）
	CallAsyncAccepted                    // {accepted:true}。以後output/result通知が届く
	CallFailed                           // request自体の失敗（JSON-RPC error response）
)

// CallTicket は1回のcallに必要なidとconnectionの組。
// idをcall送信「前」に確定させるのは、responseより先に届くoutput通知を
// callIDで照合できるようにするため（client側の処理順は保証されない）。
// connectionを保持するのは、切断→再接続でconnectionが差し替わってもidの発行元と
// 送信先がずれないようにするため。
type CallTicket struct {
	connection *rpc.Connection
	ID         json.RawMessage
}

// NewCallTicket は呼び出し側のWS接続を確保し、次のcallに使うticketを発行する。
func (c *Client) NewCallTicket(ctx context.Context) (*CallTicket, error) {
	connection, err := c.ensureConnection(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	return &CallTicket{connection: connection, ID: connection.NextID()}, nil
}

// CallID はticketのidをnotification相関・表示用の文字列で返す。
func (t *CallTicket) CallID() string { return string(t.ID) }

// Call はticketのidでtools.callを送り、responseまで待つ。
// async受理ならacceptedが返った時点で戻り、output/resultはevents経由。
// kindは宣言ラベル（contract 00003）。宣言がsyncのtoolが{accepted:true}を
// resultとして返しても終端として扱う — shapeだけで判定すると
// 終端済みのcallをasync受理と誤認して通知待ちになる。
func (c *Client) Call(ctx context.Context, ticket *CallTicket, params wire.CallParams, kind string) (CallOutcome, json.RawMessage, *wire.RpcError, error) {
	res, err := ticket.connection.RequestWithID(ctx, ticket.ID, wire.MethodCall, params)
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
			return CallAsyncAccepted, res.Result, nil, nil
		}
	}
	return CallSyncDone, res.Result, nil, nil
}

// Close は実行中callへtools.call.closeを送る。
func (c *Client) Close(ticket *CallTicket) error {
	if ticket == nil || ticket.connection == nil {
		return fmt.Errorf("no connection for this call")
	}
	return ticket.connection.Notify(wire.MethodCallClose, wire.CallCloseParams{CallID: ticket.ID})
}

func (c *Client) dispatchNotification(message *wire.Incoming) {
	event := Event{Kind: EventOutput}
	switch message.Method {
	case wire.MethodCallChunk:
		var params wire.CallChunkParams
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
		event.Kind = EventResult
		event.CallID = string(params.CallID)
		event.Result = params.Result
		event.Err = params.Error
	default:
		return
	}
	select {
	case c.events <- event:
	case <-c.ctx.Done():
	case <-time.After(2 * time.Second): // UIが詰まってもconnectionを詰まらせない
	}
}
