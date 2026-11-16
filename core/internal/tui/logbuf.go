package tui

import (
	"bufio"
	"bytes"
	"io"
	"sync"
)

// LogBuffer はcoreのlog出力をTUI内に取り込むio.Writer。
// plugumi startではTUIが端末を占有するため、標準エラーへ直接書くと
// 表示が壊れる。ここで行単位に溜め、TUIのログ画面へ流す。
type LogBuffer struct {
	mu     sync.Mutex
	lines  []string
	limit  int
	sink   chan<- string
	closed bool
}

func NewLogBuffer(limit int) *LogBuffer {
	return &LogBuffer{limit: limit}
}

func (l *LogBuffer) Write(p []byte) (int, error) {
	// 行の途中で分割されても繋げるため、残りは次回に持ち越す単純実装に
	// せず、log出力は行単位で来る前提でScanする。
	scanner := bufio.NewScanner(bytes.NewReader(p))
	for scanner.Scan() {
		l.append(scanner.Text())
	}
	return len(p), nil
}

func (l *LogBuffer) append(line string) {
	if line == "" {
		return
	}
	l.mu.Lock()
	l.lines = append(l.lines, line)
	if len(l.lines) > l.limit {
		l.lines = l.lines[len(l.lines)-l.limit:]
	}
	sink := l.sink
	l.mu.Unlock()
	if sink != nil {
		select {
		case sink <- line:
		default: // TUIが詰まっていてもlog出力をブロックしない
		}
	}
}

// SetSink は以後の行をchannelへも流す。TUI起動時に呼ぶ。
func (l *LogBuffer) SetSink(sink chan<- string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sink = sink
}

// Drain は溜まった行を全て取り出して空にする（TUI初期表示用）。
func (l *LogBuffer) Drain() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := l.lines
	l.lines = nil
	return out
}

var _ io.Writer = (*LogBuffer)(nil)
