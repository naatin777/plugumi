// Package view はview channelのinstance状態を管理する（designs/00011）。
// hostがinstanceを登録し、viewがticketで接続をbindする。
// instanceごとに1つのWS接続がbindされ、Coreはopaque payloadを
// view接続とruntime接続の間でroutingするだけである。
package view

import (
	"crypto/rand"
	"errors"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

var (
	ErrUnknownInstance = errors.New("unknown view instance")
	ErrUnknownTicket   = errors.New("unknown view ticket")
	ErrAlreadyBound    = errors.New("view instance already bound")
	ErrInstanceClosed  = errors.New("view instance closed")
)

type instance struct {
	wire.ViewInstance
	ticket     string
	connection *rpc.Connection
}

type Store struct {
	mu           sync.Mutex
	now          func() time.Time
	byID         map[string]*instance
	byTicket     map[string]*instance
	byConnection map[string]*instance
}

func NewStore() *Store {
	return &Store{
		now:          time.Now,
		byID:         make(map[string]*instance),
		byTicket:     make(map[string]*instance),
		byConnection: make(map[string]*instance),
	}
}

// Create はhostの登録でpending状態のinstanceを発行し、ticketを返す。
func (s *Store) Create(registrationID, panelID string) wire.ViewTicket {
	s.mu.Lock()
	defer s.mu.Unlock()
	// idはREST path parameter（DELETE /v1/views/{viewId}）に載るため
	// slashを含められない。execution/とは異なりハイフンで区切る。
	entry := &instance{
		ViewInstance: wire.ViewInstance{
			ID:             "view-" + rand.Text(),
			RegistrationID: registrationID,
			PanelID:        panelID,
			Status:         wire.ViewPending,
			CreatedAt:      s.now(),
		},
		ticket: rand.Text(),
	}
	s.byID[entry.ID] = entry
	s.byTicket[entry.ticket] = entry
	return wire.ViewTicket{ViewInstance: entry.ViewInstance, Ticket: entry.ticket}
}

func (s *Store) Get(id string) (*wire.ViewInstance, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.byID[id]
	if entry == nil {
		return nil, ErrUnknownInstance
	}
	result := entry.ViewInstance
	return &result, nil
}

// Bind はticketを検証して接続をinstanceへbindし、openへ進める。
func (s *Store) Bind(ticket string, connection *rpc.Connection) (*wire.ViewInstance, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.byTicket[ticket]
	if entry == nil {
		return nil, ErrUnknownTicket
	}
	if entry.Status == wire.ViewClosed {
		return nil, ErrInstanceClosed
	}
	if entry.connection != nil && entry.connection != connection {
		return nil, ErrAlreadyBound
	}
	entry.connection = connection
	entry.Status = wire.ViewOpen
	s.byConnection[connection.ID] = entry
	result := entry.ViewInstance
	return &result, nil
}

// ConnectionFor はinstanceにbindされたview接続を返す。
func (s *Store) ConnectionFor(instanceID string) *rpc.Connection {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry := s.byID[instanceID]; entry != nil && entry.Status == wire.ViewOpen {
		return entry.connection
	}
	return nil
}

// Close はinstanceをclosedにし、bindされていたview接続を返す。
// 既にclosedならnilを返す。
func (s *Store) Close(id string) (*wire.ViewInstance, *rpc.Connection) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.byID[id]
	if entry == nil || entry.Status == wire.ViewClosed {
		return nil, nil
	}
	entry.Status = wire.ViewClosed
	connection := entry.connection
	if connection != nil {
		delete(s.byConnection, connection.ID)
		entry.connection = nil
	}
	result := entry.ViewInstance
	return &result, connection
}

// CloseForConnection はview接続の切断でinstanceを閉じる。
// この接続にbindされたinstanceがあれば閉じて返す。
func (s *Store) CloseForConnection(connectionID string) *wire.ViewInstance {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.byConnection[connectionID]
	if entry == nil {
		return nil
	}
	entry.Status = wire.ViewClosed
	delete(s.byConnection, connectionID)
	entry.connection = nil
	result := entry.ViewInstance
	return &result
}

// ClosedView は閉じられたinstanceと、その時点でbindされていたview接続の組。
type ClosedView struct {
	Instance   wire.ViewInstance
	Connection *rpc.Connection
}

// CloseForRegistration はruntime切断でそのregistrationの開いている
// instanceを全て閉じる。閉じたinstanceとview接続の組を返す
// （接続は通知のために必要なので、外す前に返す）。
func (s *Store) CloseForRegistration(registrationID string) []ClosedView {
	s.mu.Lock()
	defer s.mu.Unlock()
	var closed []ClosedView
	for _, entry := range s.byID {
		if entry.RegistrationID != registrationID || entry.Status != wire.ViewOpen {
			continue
		}
		entry.Status = wire.ViewClosed
		connection := entry.connection
		if connection != nil {
			delete(s.byConnection, connection.ID)
			entry.connection = nil
		}
		closed = append(closed, ClosedView{Instance: entry.ViewInstance, Connection: connection})
	}
	return closed
}
