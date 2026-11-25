// Package corerpc は呼び出し専用のWS接続（registrationIdを付けない
// /v1/rpc）でtools.callを送る（contracts/00004）。
// 接続はCoreごとに1本を使い回し、切れたら次の呼び出しで張り直す。
package corerpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Error はJSON-RPCのerror object。HTTPの502として呼び出し側へ返す。
type Error struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *Error) Error() string { return e.Message }

// Pool はCoreのURLごとに呼び出し専用Clientを保持する。
type Pool struct {
	token   string
	mu      sync.Mutex
	clients map[string]*Client
}

func NewPool(token string) *Pool {
	return &Pool{token: token, clients: map[string]*Client{}}
}

func (p *Pool) For(coreURL string) *Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	client, exists := p.clients[coreURL]
	if !exists {
		client = &Client{coreURL: coreURL, token: p.token, pending: map[string]chan callResult{}}
		p.clients[coreURL] = client
	}
	return client
}

type callResult struct {
	result json.RawMessage
	err    *Error
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      string `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

// incoming は受信メッセージの判別用。Responseにはidだけがあり、
// Notificationにはmethodがある。
type incoming struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Result json.RawMessage `json:"result"`
	Error  *Error          `json:"error"`
}

// Client は1つのCoreへの呼び出し専用接続。
type Client struct {
	coreURL string
	token   string

	mu      sync.Mutex
	conn    *websocket.Conn
	nextID  int
	pending map[string]chan callResult
}

// Call はsync Toolを呼んでresultを返す。JSON-RPC errorは*Errorで返す。
func (c *Client) Call(ctx context.Context, registrationID, toolPath string, input json.RawMessage) (json.RawMessage, *Error, error) {
	conn, err := c.connection(ctx)
	if err != nil {
		return nil, nil, err
	}
	c.mu.Lock()
	c.nextID++
	id := fmt.Sprintf("web-%d", c.nextID)
	waiting := make(chan callResult, 1)
	c.pending[id] = waiting
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
	}()
	request, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0", ID: id, Method: "tools.call",
		Params: map[string]any{
			"target": map[string]string{"registrationId": registrationID, "toolPath": toolPath},
			"input":  input,
		},
	})
	if err != nil {
		return nil, nil, err
	}
	if err := conn.Write(ctx, websocket.MessageText, request); err != nil {
		c.drop(conn)
		return nil, nil, err
	}
	select {
	case result := <-waiting:
		return result.result, result.err, nil
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	}
}

// connection は生きている接続を返す。なければ新規に張る。
func (c *Client) connection(ctx context.Context) (*websocket.Conn, error) {
	c.mu.Lock()
	if c.conn != nil {
		conn := c.conn
		c.mu.Unlock()
		return conn, nil
	}
	c.mu.Unlock()
	wsURL := "ws" + strings.TrimPrefix(c.coreURL, "http") + "/v1/rpc"
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	options := &websocket.DialOptions{}
	if c.token != "" {
		options.HTTPHeader = http.Header{"Authorization": {"Bearer " + c.token}}
	}
	conn, _, err := websocket.Dial(dialCtx, wsURL, options)
	if err != nil {
		return nil, err
	}
	// 既定の受信上限（32KiB）だと大きなTool結果で接続が切れるので、
	// Core側の受信上限（core/internal/server/http.go、1MiB）に合わせる。
	conn.SetReadLimit(1 << 20)
	c.mu.Lock()
	if c.conn != nil {
		// 並行して張られた方を使い、自分は閉じる。
		existing := c.conn
		c.mu.Unlock()
		_ = conn.Close(websocket.StatusNormalClosure, "superseded")
		return existing, nil
	}
	c.conn = conn
	c.mu.Unlock()
	go c.readLoop(conn)
	return conn, nil
}

// readLoop はResponseをpendingへ振り分ける。Notificationは呼び出し専用接続では
// 読み捨てる（async ToolはWeb UIから呼ばない）。切断時は待機中の呼び出しを全て失敗させる。
func (c *Client) readLoop(conn *websocket.Conn) {
	for {
		_, data, err := conn.Read(context.Background())
		if err != nil {
			c.drop(conn)
			return
		}
		var message incoming
		if err := json.Unmarshal(data, &message); err != nil || len(message.ID) == 0 || message.Method != "" {
			continue
		}
		var id string
		if err := json.Unmarshal(message.ID, &id); err != nil {
			continue
		}
		c.mu.Lock()
		waiting, exists := c.pending[id]
		c.mu.Unlock()
		if exists {
			waiting <- callResult{result: message.Result, err: message.Error}
		}
	}
}

// drop は切断した接続を手放し、待機中の呼び出しにエラーを返す。
func (c *Client) drop(conn *websocket.Conn) {
	c.mu.Lock()
	if c.conn != conn {
		c.mu.Unlock()
		return
	}
	c.conn = nil
	pending := c.pending
	c.pending = map[string]chan callResult{}
	c.mu.Unlock()
	for _, waiting := range pending {
		waiting <- callResult{err: &Error{Code: -32000, Message: "RPC connection closed"}}
	}
	_ = conn.Close(websocket.StatusNormalClosure, "closed")
}
