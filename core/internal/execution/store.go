// Package execution はCoreが記録するoperation invocationの実行状態を管理する。
// contracts/00004: 全てのoperation invocationはExecutionとして記録する。
package execution

import (
	"crypto/rand"
	"errors"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/wire"
)

var ErrUnknownExecution = errors.New("unknown execution")

type Store struct {
	mu     sync.Mutex
	now    func() time.Time
	byID   map[string]*wire.Execution
	seqs   map[string]uint64
}

func NewStore() *Store {
	return &Store{
		now:  time.Now,
		byID: make(map[string]*wire.Execution),
		seqs: make(map[string]uint64),
	}
}

// Create はrunning状態のExecutionを発行する。
func (s *Store) Create(operation string, input, contextRaw []byte) *wire.Execution {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	execution := &wire.Execution{
		ID:        "execution/" + rand.Text(),
		Operation: operation,
		Status:    wire.ExecutionRunning,
		CreatedAt: now,
		UpdatedAt: now,
		Input:     input,
		Context:   contextRaw,
	}
	s.byID[execution.ID] = execution
	return clone(execution)
}

func (s *Store) Get(id string) (*wire.Execution, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	execution := s.byID[id]
	if execution == nil {
		return nil, ErrUnknownExecution
	}
	return clone(execution), nil
}

func (s *Store) List() []*wire.Execution {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]*wire.Execution, 0, len(s.byID))
	for _, execution := range s.byID {
		result = append(result, clone(execution))
	}
	return result
}

// NextSeq はExecutionのevent採番を進める。providerからのeventは
// この採番と一致しなければならない（初期実装では厳密検査しない）。
func (s *Store) NextSeq(id string) uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seqs[id]++
	return s.seqs[id]
}

// ApplyEvent はproviderからのeventをExecutionへ反映する。
// terminal event（result / error）で終端へ進める。
func (s *Store) ApplyEvent(id, eventType string, payload []byte) (*wire.Execution, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	execution := s.byID[id]
	if execution == nil {
		return nil, ErrUnknownExecution
	}
	if isTerminal(execution.Status) {
		return clone(execution), nil
	}
	execution.UpdatedAt = s.now()
	switch eventType {
	case "status":
		// payloadのstatus文字列は信用せず進行状態の更新だけ許可する
	case "progress":
		execution.Progress = payload
	case "output":
		// 初期実装ではoutputはrecordに保持しない
	case "presentation":
		execution.Presentation = payload
	case "result":
		execution.Status = wire.ExecutionSucceeded
		execution.Result = payload
	case "error":
		execution.Status = wire.ExecutionFailed
		var executionError wire.ExecutionError
		if err := wire.Unmarshal(payload, &executionError); err == nil && executionError.Code != "" {
			if executionError.Kind == "" {
				executionError.Kind = wire.ErrorKindExecutionFailed
			}
			execution.Error = &executionError
		} else {
			execution.Error = &wire.ExecutionError{
				Code:    "execution_failed",
				Message: "execution failed",
				Kind:    wire.ErrorKindExecutionFailed,
			}
		}
	}
	return clone(execution), nil
}

// Complete はproviderのinvoke応答（terminalまたはrunningの初期状態）を反映する。
func (s *Store) Complete(id string, result *wire.ProviderInvokeResult) *wire.Execution {
	s.mu.Lock()
	defer s.mu.Unlock()
	execution := s.byID[id]
	if execution == nil {
		return nil
	}
	execution.UpdatedAt = s.now()
	execution.Progress = result.Progress
	execution.Accept = result.Accept
	switch result.Status {
	case wire.ExecutionSucceeded:
		execution.Status = wire.ExecutionSucceeded
		execution.Result = result.Result
	case wire.ExecutionFailed:
		execution.Status = wire.ExecutionFailed
		if result.Error != nil {
			if result.Error.Kind == "" {
				result.Error.Kind = wire.ErrorKindExecutionFailed
			}
			execution.Error = result.Error
		}
	case wire.ExecutionCancelled:
		execution.Status = wire.ExecutionCancelled
	default:
		// runningのまま
	}
	return clone(execution)
}

// FailDisconnected はprovider切断時にin-flightのExecutionをfailedへ進める。
func (s *Store) FailDisconnected(ids []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for _, id := range ids {
		execution := s.byID[id]
		if execution == nil || isTerminal(execution.Status) {
			continue
		}
		execution.Status = wire.ExecutionFailed
		execution.UpdatedAt = now
		execution.Error = &wire.ExecutionError{
			Code:    "provider_disconnected",
			Message: "provider disconnected before terminal event",
			Kind:    wire.ErrorKindProviderDisconnected,
		}
	}
}

func isTerminal(status string) bool {
	return status == wire.ExecutionSucceeded || status == wire.ExecutionFailed || status == wire.ExecutionCancelled
}

func clone(execution *wire.Execution) *wire.Execution {
	copy := *execution
	return &copy
}
