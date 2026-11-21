package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
)

// 末尾読みで読み上げる最大量。これより古いログは -n の対象外にする。
const logTailLimit = 512 * 1024

func runLogs(ctx context.Context, output io.Writer, args []string, follow bool, lineCount int) error {
	instances, err := coreinstances.Local()
	if err != nil {
		return err
	}
	running, err := instances.Running(ctx)
	if err != nil {
		return err
	}
	target, err := resolveRunningCore(running, args, "logs")
	if err != nil {
		return err
	}
	if target.LogPath == "" {
		return fmt.Errorf("Core at %s has no log file (it was not started with `plugumi start`)", target.URL)
	}
	file, err := os.Open(target.LogPath)
	if err != nil {
		return err
	}
	defer file.Close()

	offset, err := copyLogTail(file, output, lineCount)
	if err != nil || !follow {
		return err
	}

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			info, err := file.Stat()
			if err != nil {
				return err
			}
			// サイズが縮んだ場合はログが作り直されたとみなして先頭から読む。
			if info.Size() < offset {
				offset = 0
			}
			if info.Size() == offset {
				continue
			}
			if _, err := file.Seek(offset, io.SeekStart); err != nil {
				return err
			}
			written, err := io.Copy(output, file)
			offset += written
			if err != nil {
				return err
			}
		}
	}
}

// 末尾最大logTailLimitから最後のlineCount行を出力し、次に読むoffsetを返す。
func copyLogTail(file *os.File, output io.Writer, lineCount int) (int64, error) {
	info, err := file.Stat()
	if err != nil {
		return 0, err
	}
	start := max(0, info.Size()-logTailLimit)
	data, err := io.ReadAll(io.NewSectionReader(file, start, info.Size()-start))
	if err != nil {
		return 0, err
	}
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(lines) > lineCount {
		lines = lines[len(lines)-lineCount:]
	}
	for _, line := range lines {
		if _, err := fmt.Fprintln(output, line); err != nil {
			return 0, err
		}
	}
	return info.Size(), nil
}
