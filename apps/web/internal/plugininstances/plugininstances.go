// Package plugininstances はPluginのローカル実行記録を扱う
// （vocabularyのplugininstances。<cache dir>/plugumi/plugins/<id>.json。
// 各Pluginが時刻を更新し、Go側coreは読み取りだけ行う）。
package plugininstances

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"
)

// NewID はプロセスごとの識別子を返す（agentのnewInstanceIdと同じplugin-…形式）。
func NewID() string {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		panic(err)
	}
	data[6] = data[6]&0x0f | 0x40
	data[8] = data[8]&0x3f | 0x80
	return fmt.Sprintf("plugin-%x-%x-%x-%x-%x", data[0:4], data[4:6], data[6:8], data[8:10], data[10:16])
}

// record はplugins/<id>.jsonの内容。フィールド名はagent/standardの
// 実行記録と一致させる。urlはweb pluginの待受アドレスで、Electron等の
// viewerがhostを発見するために使う（待受を持たないPluginは書かない）。
type record struct {
	Name                 string `json:"name"`
	ID                   string `json:"id"`
	Version              string `json:"version"`
	PID                  int    `json:"pid"`
	HeartbeatUnixSeconds int64  `json:"heartbeatUnixSeconds"`
	Log                  string `json:"log,omitempty"`
	URL                  string `json:"url,omitempty"`
}

// Register は実行記録を書き、5秒ごとのheartbeat更新と終了時削除を行う。
// 記録先が使えない環境でもPlugin自体は動かすため、失敗時はnilとエラーを返す。
func Register(id, version, logPath, url string) (func(), error) {
	cacheDirectory, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	return register(filepath.Join(cacheDirectory, "plugumi", "plugins"), id, version, logPath, url)
}

func register(directory, id, version, logPath, url string) (func(), error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(directory, id+".json")
	// 読みかけの不完全ファイルを見せないよう、別名で書いてからrenameする。
	temp := filepath.Join(directory, fmt.Sprintf(".%d", os.Getpid()))
	entry := record{Name: "web", ID: id, Version: version, PID: os.Getpid(), Log: logPath, URL: url}
	var stopped atomic.Bool
	heartbeat := func() error {
		entry.HeartbeatUnixSeconds = time.Now().Unix()
		data, err := json.Marshal(entry)
		if err != nil {
			return err
		}
		if err := os.WriteFile(temp, data, 0o600); err != nil {
			return err
		}
		return os.Rename(temp, path)
	}
	if err := heartbeat(); err != nil {
		return nil, err
	}
	done := make(chan struct{})
	go func() {
		timer := time.NewTicker(5 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-done:
				return
			case <-timer.C:
				_ = heartbeat()
			}
		}
	}()
	return func() {
		if stopped.CompareAndSwap(false, true) {
			close(done)
			_ = os.Remove(path)
		}
	}, nil
}
