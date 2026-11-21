// Package plugininstances は同じOSユーザーが起動したPluginの検出に使う内部I/F。
// Pluginが更新するローカル記録を読む。生存確認のために接続しない。
package plugininstances

import (
	"cmp"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"time"
)

type Registry struct {
	directory string
}

type Instance struct {
	Name                 string `json:"name"`
	ID                   string `json:"id"`
	Version              string `json:"version,omitempty"`
	PID                  int    `json:"pid,omitempty"`
	HeartbeatUnixSeconds int64  `json:"heartbeatUnixSeconds"`
	// 1プロセスが複数Coreに繋がり得るため、logはCore側でなく
	// Plugin自身がregistryの記録に書く。
	Log string `json:"log,omitempty"`
}

func Local() (Registry, error) {
	cacheDirectory, err := os.UserCacheDir()
	if err != nil {
		return Registry{}, err
	}
	return Registry{directory: filepath.Join(cacheDirectory, "plugumi", "plugins")}, nil
}

// Running は直近に時刻を更新した実行記録を返す。
func (r Registry) Running(ctx context.Context) ([]Instance, error) {
	entries, err := os.ReadDir(r.directory)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	recencyLimit := time.Now().Add(-20 * time.Second).Unix()
	var running []Instance
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !entry.Type().IsRegular() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(r.directory, entry.Name()))
		var record Instance
		if err != nil || json.Unmarshal(data, &record) != nil || record.ID == "" {
			continue
		}
		if record.HeartbeatUnixSeconds < recencyLimit || entry.Name() != record.ID+".json" {
			continue
		}
		running = append(running, record)
	}
	slices.SortFunc(running, func(first, second Instance) int { return cmp.Compare(first.ID, second.ID) })
	return running, nil
}
