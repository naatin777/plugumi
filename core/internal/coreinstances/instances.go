// Package coreinstances は同じOSユーザーが起動したCoreの検出・停止に使う内部I/F。
package coreinstances

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/config"
)

const (
	StatusPath = "/_plugumi/instance"
	IDHeader   = "Plugumi-Core-Instance"
	StopPath   = "/_plugumi/stop"
	StopHeader = "Plugumi-Core-Stop-Token"
)

type Registry struct {
	directory string
}

type Instance struct {
	URL string `json:"url"`
	ID  string `json:"id"`
	// ps・logs・restartで使う。ログや明示的な起動オプションがなければ空になる。
	PID        int    `json:"pid,omitempty"`
	LogPath    string `json:"logPath,omitempty"`
	ConfigPath string `json:"configPath,omitempty"`
	Port       string `json:"port,omitempty"`
}

type instanceRecord struct {
	Instance
	// 同じOSユーザーにのみ読めるファイルに保管し、状態確認APIには出さない。
	StopToken string `json:"stopToken"`
}

func Local() (Registry, error) {
	cacheDirectory, err := os.UserCacheDir()
	if err != nil {
		return Registry{}, err
	}
	return Registry{directory: filepath.Join(cacheDirectory, "plugumi", "cores")}, nil
}

// Register は待受開始後に呼ぶ。返した解除関数は待受を閉じる前に呼ぶ。
func (r Registry) Register(instance Instance, stopToken string) (func() error, error) {
	if err := os.MkdirAll(r.directory, 0700); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(r.directory, ".core-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	err = json.NewEncoder(file).Encode(instanceRecord{Instance: instance, StopToken: stopToken})
	closeErr := file.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	// 同じURLで再起動した場合、前のプロセスが残した記録を上書きする。
	path := r.recordPath(instance.URL)
	if err := os.Rename(file.Name(), path); err != nil {
		return nil, err
	}
	return func() error { return os.Remove(path) }, nil
}

func (r Registry) recordPath(coreURL string) string {
	return filepath.Join(r.directory, fmt.Sprintf("%x.json", sha256.Sum256([]byte(coreURL))))
}

var localClient = &http.Client{
	Timeout:       800 * time.Millisecond,
	Transport:     &http.Transport{DisableKeepAlives: true},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func (r Registry) Running(ctx context.Context) ([]Instance, error) {
	entries, err := os.ReadDir(r.directory)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var probes sync.WaitGroup
	running := make([]Instance, len(entries))
	for index, entry := range entries {
		if !entry.Type().IsRegular() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(r.directory, entry.Name()))
		var record Instance
		if err != nil || json.Unmarshal(data, &record) != nil || record.ID == "" {
			continue
		}
		coreURL, err := config.NormalizeCoreURL(record.URL)
		if err != nil {
			continue
		}
		probes.Go(func() {
			// 異常終了で記録が残っても、同じインスタンスが応答した場合だけ一覧に出す。
			request, err := http.NewRequestWithContext(ctx, http.MethodHead, coreURL+StatusPath, nil)
			if err != nil {
				return
			}
			response, err := localClient.Do(request)
			if err != nil {
				return
			}
			defer response.Body.Close()
			if response.StatusCode == http.StatusNoContent && response.Header.Get(IDHeader) == record.ID {
				record.URL = coreURL
				running[index] = record
			}
		})
	}
	probes.Wait()
	running = slices.DeleteFunc(running, func(instance Instance) bool { return instance.URL == "" })
	slices.SortFunc(running, func(first, second Instance) int { return cmp.Compare(first.URL, second.URL) })
	return slices.Compact(running), nil
}

// Stop はURLを再利用した別のCoreを止めないよう、選択時のIDと照合する。
func (r Registry) Stop(ctx context.Context, target Instance) error {
	coreURL, err := config.NormalizeCoreURL(target.URL)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(r.recordPath(coreURL))
	if os.IsNotExist(err) {
		return fmt.Errorf("Core at %s is no longer registered", coreURL)
	}
	if err != nil {
		return err
	}
	var record instanceRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return err
	}
	if target.ID == "" || record.ID != target.ID || record.URL != coreURL {
		return fmt.Errorf("Core at %s has changed; select it again", coreURL)
	}
	if record.StopToken == "" {
		return fmt.Errorf("local instance record for Core at %s has no stop token", coreURL)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, coreURL+StopPath, nil)
	if err != nil {
		return err
	}
	request.Header.Set(StopHeader, record.StopToken)
	response, err := localClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("Core at %s rejected stop (HTTP %d)", coreURL, response.StatusCode)
	}
	return nil
}
