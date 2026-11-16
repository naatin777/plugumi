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

var connSeq atomic.Int64

// Conn はJSON-RPC 2.0を流すWS接続。request/responseのid相関と、
// 相手からのrequest・notificationの配送を担う。
// 同一conn上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
// （docs/contracts/00003「idの一意性」）。
type Conn struct {
	UID      string
	IDPrefix string

	c       *websocket.Conn
	wmu     sync.Mutex
	seq     atomic.Int64
	pending map[string]chan *wire.Incoming

	OnRequest func(*wire.Incoming) (json.RawMessage, *wire.Error)
	OnNotif   func(*wire.Incoming)

	done chan struct{}
}

func NewConn(c *websocket.Conn, idPrefix string) *Conn {
	return &Conn{
		UID:      fmt.Sprintf("conn-%d", connSeq.Add(1)),
		IDPrefix: idPrefix,
		c:        c,
		pending:  map[string]chan *wire.Incoming{},
		done:     make(chan struct{}),
	}
}

// NextID はこのconnのid空間から次のidを発行する（中継時のforward id用途）。
func (c *Conn) NextID() json.RawMessage {
	return wire.Marshal(c.IDPrefix + fmt.Sprint(c.seq.Add(1)))
}

// Run は受信ループ。ctx終了または切断までブロックする。
func (c *Conn) Run(ctx context.Context) error {
	defer close(c.done)
	for {
		_, data, err := c.c.Read(ctx)
		if err != nil {
			return err
		}
		var in wire.Incoming
		if err := json.Unmarshal(data, &in); err != nil {
			continue
		}
		switch {
		case in.IsRequest():
			go c.handleRequest(&in)
		case in.IsNotif():
			if c.OnNotif != nil {
				go c.OnNotif(&in)
			}
		case in.IsResponse():
			key := string(in.ID)
			c.wmu.Lock()
			ch, ok := c.pending[key]
			delete(c.pending, key)
			c.wmu.Unlock()
			if ok {
				ch <- &in
			}
		}
	}
}

func (c *Conn) handleRequest(in *wire.Incoming) {
	var result json.RawMessage
	var rpcErr *wire.Error
	if c.OnRequest != nil {
		result, rpcErr = c.OnRequest(in)
	}
	_ = c.write(wire.Response{JSONRPC: "2.0", ID: in.ID, Result: result, Error: rpcErr})
}

func (c *Conn) Request(ctx context.Context, method string, params any) (*wire.Incoming, error) {
	return c.RequestWithID(ctx, c.NextID(), method, params)
}

// RequestWithID はidを指定してrequestを送る。中継でforward idを自空間から発行する用途。
func (c *Conn) RequestWithID(ctx context.Context, id json.RawMessage, method string, params any) (*wire.Incoming, error) {
	var pm json.RawMessage
	if params != nil {
		pm = wire.Marshal(params)
	}
	ch := make(chan *wire.Incoming, 1)
	c.wmu.Lock()
	c.pending[string(id)] = ch
	c.wmu.Unlock()

	if err := c.write(wire.Request{JSONRPC: "2.0", ID: id, Method: method, Params: pm}); err != nil {
		c.wmu.Lock()
		delete(c.pending, string(id))
		c.wmu.Unlock()
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
	var pm json.RawMessage
	if params != nil {
		pm = wire.Marshal(params)
	}
	return c.write(wire.Notification{JSONRPC: "2.0", Method: method, Params: pm})
}

func (c *Conn) write(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	return c.c.Write(context.Background(), websocket.MessageText, data)
}

func (c *Conn) Close()                { _ = c.c.Close(websocket.StatusNormalClosure, "bye") }
func (c *Conn) Done() <-chan struct{} { return c.done }
