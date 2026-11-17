package tui

import (
	"bufio"
	"bytes"
	"io"
	"sync"
)

// LogBuffer はcoreのlog出力をTUI内に取り込むio.Writer。
// plugumi tuiではTUIが端末を占有するため、標準エラーへ直接書くと
// 表示が壊れる。ここで行単位に溜め、TUIがポーリングで画面へ反映する。
// channel配信にしないのは、満杯時のdropや配信隙間でログが
// 永久欠落するのを避けるため（coreのログ出力をブロックしてもいけない）。
type LogBuffer struct {
	mu    sync.Mutex
	lines []string
	limit int
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
	defer l.mu.Unlock()
	l.lines = append(l.lines, line)
	if len(l.lines) > l.limit {
		l.lines = l.lines[len(l.lines)-l.limit:]
	}
}

// Tail は末尾n行を返す（TUIのログ画面がポーリングで読む）。
// 内部sliceをそのまま返すと呼び出し側の変更でbufferが壊れるためコピーする。
func (l *LogBuffer) Tail(n int) []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.lines) > n {
		return append([]string(nil), l.lines[len(l.lines)-n:]...)
	}
	return append([]string(nil), l.lines...)
}

var _ io.Writer = (*LogBuffer)(nil)
