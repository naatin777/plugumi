// Package rpc はJSON-RPC 2.0 over WebSocketの接続層。
package rpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/wire"
)

var connCounter atomic.Int64

// Conn はJSON-RPC 2.0を流すWS接続。request/responseのid相関と、
// 相手からのrequest・notificationの配送を担う。
// 同一conn上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
// （docs/contracts/00003「idの一意性」）。
type Conn struct {
	ID       string
	IDPrefix string

	c       *websocket.Conn
	writeMu sync.Mutex
	counter atomic.Int64
	pending map[string]chan *wire.Incoming

	OnRequest func(*wire.Incoming) (json.RawMessage, *wire.Error)
	OnNotif   func(*wire.Incoming)

	done chan struct{}
}

func NewConn(c *websocket.Conn, idPrefix string) *Conn {
	return &Conn{
		ID:       fmt.Sprintf("conn-%d", connCounter.Add(1)),
		IDPrefix: idPrefix,
		c:        c,
		pending:  map[string]chan *wire.Incoming{},
		done:     make(chan struct{}),
	}
}

// NextID はこのconnのid空間から次のidを発行する（中継時のforward id用途）。
func (c *Conn) NextID() json.RawMessage {
	return wire.Marshal(c.IDPrefix + fmt.Sprint(c.counter.Add(1)))
}

// Run は受信ループ。ctx終了または切断までブロックする。
func (c *Conn) Run(ctx context.Context) error {
	defer close(c.done)
	for {
		_, data, err := c.c.Read(ctx)
		if err != nil {
			return err
		}
		var message wire.Incoming
		if err := json.Unmarshal(data, &message); err != nil {
			continue
		}
		switch {
		case message.IsRequest():
			go c.handleRequest(&message)
		case message.IsNotif():
			if c.OnNotif != nil {
				go c.OnNotif(&message)
			}
		case message.IsResponse():
			key := string(message.ID)
			c.writeMu.Lock()
			ch, ok := c.pending[key]
			delete(c.pending, key)
			c.writeMu.Unlock()
			if ok {
				ch <- &message
			}
		}
	}
}

func (c *Conn) handleRequest(message *wire.Incoming) {
	var result json.RawMessage
	var rpcErr *wire.Error
	if c.OnRequest != nil {
		result, rpcErr = c.OnRequest(message)
	}
	_ = c.write(wire.Response{JSONRPC: "2.0", ID: message.ID, Result: result, Error: rpcErr})
}

func (c *Conn) Request(ctx context.Context, method string, params any) (*wire.Incoming, error) {
	return c.RequestWithID(ctx, c.NextID(), method, params)
}

// RequestWithID はidを指定してrequestを送る。中継でforward idを自空間から発行する用途。
func (c *Conn) RequestWithID(ctx context.Context, id json.RawMessage, method string, params any) (*wire.Incoming, error) {
	var rawParams json.RawMessage
	if params != nil {
		rawParams = wire.Marshal(params)
	}
	ch := make(chan *wire.Incoming, 1)
	key := string(id)
	c.writeMu.Lock()
	c.pending[key] = ch
	c.writeMu.Unlock()
	// 正常応答・timeout・切断のどの経路でもpendingを残さない。
	defer func() {
		c.writeMu.Lock()
		delete(c.pending, key)
		c.writeMu.Unlock()
	}()

	if err := c.write(wire.Request{JSONRPC: "2.0", ID: id, Method: method, Params: rawParams}); err != nil {
		return nil, err
	}
	select {
	case res := <-ch:
		return res, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.done:
		return nil, errors.New("conn closed")
	}
}

func (c *Conn) Notify(method string, params any) error {
	var rawParams json.RawMessage
	if params != nil {
		rawParams = wire.Marshal(params)
	}
	return c.write(wire.Notification{JSONRPC: "2.0", Method: method, Params: rawParams})
}

func (c *Conn) write(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.c.Write(context.Background(), websocket.MessageText, data)
}

func (c *Conn) Close()                { _ = c.c.Close(websocket.StatusNormalClosure, "bye") }
func (c *Conn) Done() <-chan struct{} { return c.done }
