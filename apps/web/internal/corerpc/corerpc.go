// Package corerpc は呼び出し専用のWS接続（registrationIdを付けない
// /v1/rpc）でoperations.invokeを送る（contracts/00004）。
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
	socket  *websocket.Conn
	nextID  int
	pending map[string]chan callResult
}

// Execution はoperations.invokeの応答に含まれる実行record。
// terminal応答のoperationはstatusがsucceeded/failedでresultやerrorを持つ。
type Execution struct {
	ID        string          `json:"id"`
	Operation string          `json:"operation"`
	Status    string          `json:"status"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// Invoke はoperationを呼んで応答のExecutionを返す。JSON-RPC errorは*Errorで返す。
// operationはpathだけで解決し、登録先の指定やkindの概念はない（contracts/00004）。
// runningで返るstream系operationの終端追跡はこのClientでは行わない。
func (c *Client) Invoke(ctx context.Context, operation string, input json.RawMessage) (*Execution, *Error, error) {
	socket, err := c.connection(ctx)
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
		JSONRPC: "2.0", ID: id, Method: "operations.invoke",
		Params: map[string]any{
			"operation": operation,
			"input":     input,
		},
	})
	if err != nil {
		return nil, nil, err
	}
	if err := socket.Write(ctx, websocket.MessageText, request); err != nil {
		c.drop(socket)
		return nil, nil, err
	}
	select {
	case result := <-waiting:
		if result.err != nil {
			return nil, result.err, nil
		}
		var invocation struct {
			Execution *Execution `json:"execution"`
		}
		if err := json.Unmarshal(result.result, &invocation); err != nil || invocation.Execution == nil {
			return nil, nil, fmt.Errorf("invalid invoke response: %s", result.result)
		}
		return invocation.Execution, nil, nil
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	}
}

// connection は生きている接続を返す。なければ新規に張る。
func (c *Client) connection(ctx context.Context) (*websocket.Conn, error) {
	c.mu.Lock()
	if c.socket != nil {
		socket := c.socket
		c.mu.Unlock()
		return socket, nil
	}
	c.mu.Unlock()
	wsURL := "ws" + strings.TrimPrefix(c.coreURL, "http") + "/v1/rpc"
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	options := &websocket.DialOptions{}
	if c.token != "" {
		options.HTTPHeader = http.Header{"Authorization": {"Bearer " + c.token}}
	}
	socket, _, err := websocket.Dial(dialCtx, wsURL, options)
	if err != nil {
		return nil, err
	}
	// 既定の受信上限（32KiB）だと大きなTool結果で接続が切れるので、
	// Core側の受信上限（core/internal/server/http.go、1MiB）に合わせる。
	socket.SetReadLimit(1 << 20)
	c.mu.Lock()
	if c.socket != nil {
		// 並行して張られた方を使い、自分は閉じる。
		existing := c.socket
		c.mu.Unlock()
		_ = socket.Close(websocket.StatusNormalClosure, "superseded")
		return existing, nil
	}
	c.socket = socket
	c.mu.Unlock()
	go c.readLoop(socket)
	return socket, nil
}

// readLoop はResponseをpendingへ振り分ける。Notificationは呼び出し専用接続では
// 読み捨てる（executions.eventの自動pushはここでは使わない）。
// 切断時は待機中の呼び出しを全て失敗させる。
func (c *Client) readLoop(socket *websocket.Conn) {
	for {
		_, data, err := socket.Read(context.Background())
		if err != nil {
			c.drop(socket)
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
func (c *Client) drop(socket *websocket.Conn) {
	c.mu.Lock()
	if c.socket != socket {
		c.mu.Unlock()
		return
	}
	c.socket = nil
	pending := c.pending
	c.pending = map[string]chan callResult{}
	c.mu.Unlock()
	for _, waiting := range pending {
		waiting <- callResult{err: &Error{Code: -32000, Message: "RPC connection closed"}}
	}
	_ = socket.Close(websocket.StatusNormalClosure, "closed")
}
