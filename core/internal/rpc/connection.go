// Package rpc はJSON-RPC 2.0 over WebSocketの接続層。
package rpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/naatin777/plugumi/core/internal/wire"
)

var connectionCounter atomic.Int64

// Connection はJSON-RPC 2.0を流すWS接続。request/responseのid相関と、
// 相手からのrequest・notificationの配送を担う。
// 同一connection上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
// （contracts/00004「id / callId」）。
type Connection struct {
	ID         string
	IDPrefix   string
	socket     *websocket.Conn
	writeMu    sync.Mutex
	pendingMu  sync.Mutex
	counter    atomic.Int64
	pending    map[string]chan *wire.Incoming
	notifQueue chan notificationWork

	OnRequest      func(*wire.Incoming) (json.RawMessage, *wire.RPCError)
	OnNotification func(*wire.Incoming)

	done      chan struct{}
	closeOnce sync.Once
}

type notificationWork struct {
	message *wire.Incoming
}

func NewConnection(socket *websocket.Conn, idPrefix string) *Connection {
	connection := &Connection{
		ID:         fmt.Sprintf("connection-%d", connectionCounter.Add(1)),
		IDPrefix:   idPrefix,
		socket:     socket,
		pending:    map[string]chan *wire.Incoming{},
		notifQueue: make(chan notificationWork, 256),
		done:       make(chan struct{}),
	}
	// notificationは単一goroutineでFIFO配送する。messageごとにgoroutineを
	// 起こすとevent列が逆転する。WSの受信順を守るため単一goroutineにする。
	go connection.dispatchNotifications()
	return connection
}

// dispatchNotifications はnotifQueueを受信順に捌く。operations.eventのような
// 順序を持つevent列が逆転しないよう単一goroutineで配送する。
// 接続終了時に残りの通知は破棄する。
func (c *Connection) dispatchNotifications() {
	for {
		select {
		case <-c.done:
			return
		case work := <-c.notifQueue:
			if c.OnNotification != nil {
				c.OnNotification(work.message)
			}
		}
	}
}

// NextID はこのconnectionのid空間から次のidを発行する（中継時のforward id用途）。
func (c *Connection) NextID() json.RawMessage {
	return wire.Marshal(c.IDPrefix + fmt.Sprint(c.counter.Add(1)))
}

// Run は受信ループ。ctx終了または切断までブロックする。
func (c *Connection) Run(ctx context.Context) error {
	defer c.closeOnce.Do(func() { close(c.done) })
	for {
		messageType, data, err := c.socket.Read(ctx)
		if err != nil {
			return err
		}
		if messageType != websocket.MessageText {
			continue
		}
		var message wire.Incoming
		if err := json.Unmarshal(data, &message); err != nil || message.JSONRPC != "2.0" {
			continue
		}
		switch {
		case message.IsRequest():
			go c.handleRequest(&message)
		case message.IsNotification():
			// キューが満杯ならReadが止まり背圧として働く
			// （dropしない。messageを無言で捨てると出力の欠損になる）。
			select {
			case c.notifQueue <- notificationWork{message: &message}:
			case <-ctx.Done():
				return ctx.Err()
			case <-c.done:
				return errors.New("connection closed")
			}
		case message.IsResponse():
			key := string(message.ID)
			c.pendingMu.Lock()
			ch, ok := c.pending[key]
			delete(c.pending, key)
			c.pendingMu.Unlock()
			if ok {
				ch <- &message
			}
		}
	}
}

func (c *Connection) handleRequest(message *wire.Incoming) {
	var result json.RawMessage
	var rpcErr *wire.RPCError
	if c.OnRequest != nil {
		result, rpcErr = c.OnRequest(message)
	}
	_ = c.write(wire.Response{JSONRPC: "2.0", ID: message.ID, Result: result, Error: rpcErr})
}

func (c *Connection) Request(ctx context.Context, method string, params any) (*wire.Incoming, error) {
	return c.RequestWithID(ctx, c.NextID(), method, params, nil)
}

// RequestWithID はidを指定してrequestを送る。中継でforward idを自空間から発行する用途。
// onWritten はrequestの書き込みが完了した直後に1度だけ呼ばれる。
// call→closeの順序を同一接続上で保つために後続送信をここへ繋ぐ。
func (c *Connection) RequestWithID(ctx context.Context, id json.RawMessage, method string, params any, onWritten func()) (*wire.Incoming, error) {
	var rawParams json.RawMessage
	if params != nil {
		rawParams = wire.Marshal(params)
	}
	ch := make(chan *wire.Incoming, 1)
	key := string(id)
	c.pendingMu.Lock()
	c.pending[key] = ch
	c.pendingMu.Unlock()
	// 正常応答・timeout・切断のどの経路でもpendingを残さない。
	defer func() {
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
	}()

	if err := c.write(wire.Request{JSONRPC: "2.0", ID: id, Method: method, Params: rawParams}); err != nil {
		return nil, err
	}
	if onWritten != nil {
		onWritten()
	}
	select {
	case res := <-ch:
		return res, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.done:
		return nil, errors.New("connection closed")
	}
}

func (c *Connection) Notify(method string, params any) error {
	var rawParams json.RawMessage
	if params != nil {
		rawParams = wire.Marshal(params)
	}
	return c.write(wire.Notification{JSONRPC: "2.0", Method: method, Params: rawParams})
}

func (c *Connection) write(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	// 相手が読みを止めるとWriteは無期限にブロックし、writeMuを握ったまま
	// connectionがゾンビ化する。上限を設け、失敗時はconnectionごと畳んで
	// 呼び出し側（DropConnection等）にrouteを清算させる。
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := c.socket.Write(ctx, websocket.MessageText, data); err != nil {
		c.Close()
		return err
	}
	return nil
}

// Close はWSを閉じ、doneも閉じる。Run未開始のconnection（connect途中の
// 中断等）でもdispatchNotifications等のgoroutineが残らないようにするため、
// doneのcloseはこちらでも行う（Run側とはcloseOnceで排他）。
func (c *Connection) Close() {
	c.closeOnce.Do(func() { close(c.done) })
	_ = c.socket.Close(websocket.StatusNormalClosure, "bye")
}

func (c *Connection) CloseNow() {
	c.closeOnce.Do(func() { close(c.done) })
	_ = c.socket.CloseNow()
}
func (c *Connection) Done() <-chan struct{} { return c.done }
