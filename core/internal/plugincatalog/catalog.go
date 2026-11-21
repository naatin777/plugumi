// Package plugincatalog はユーザーが登録したPlugin定義の一覧を管理する。
// plugininstances（起動中Pluginの自己登録・実行時検出）とは別物で、
// こちらは「まだ起動していなくても存在を知っているPlugin」のカタログ。
// 各定義はplugumiがローカルで実行する起動コマンドを持つ。
package plugincatalog

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Entry はローカルで実行するPluginの起動コマンド。
type Entry struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

// file は永続化の形。将来フィールドを増やせるよう配列直下ではなく
// オブジェクトで包む。
type file struct {
	Plugins []Entry `json:"plugins"`
}

type Catalog struct {
	path string
}

// Local はユーザーconfigディレクトリのcatalogを返す。
// registry（cache）と違い、消去されて困るユーザー入力なのでconfig側に置く。
func Local() (Catalog, error) {
	configDirectory, err := os.UserConfigDir()
	if err != nil {
		return Catalog{}, err
	}
	return Catalog{path: filepath.Join(configDirectory, "plugumi", "plugins.json")}, nil
}

// Path はテストと案内表示用。
func (c Catalog) Path() string {
	return c.path
}

func validate(entry Entry) error {
	if strings.TrimSpace(entry.Name) == "" {
		return fmt.Errorf("plugin name is required")
	}
	if strings.TrimSpace(entry.Command) == "" {
		return fmt.Errorf("plugin %q needs a launch command", entry.Name)
	}
	return nil
}

// List は登録順を名前順に整えて返す。
func (c Catalog) List() ([]Entry, error) {
	data, err := os.ReadFile(c.path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var stored file
	// 定義を追加・削除するときに、読み込めないフィールドを黙って消さない。
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&stored); err != nil {
		return nil, fmt.Errorf("read plugin catalog %s: %w", c.path, err)
	}
	if len(bytes.Trim(data[decoder.InputOffset():], " \t\r\n")) != 0 {
		return nil, fmt.Errorf("read plugin catalog %s: unexpected data after the catalog", c.path)
	}
	for _, entry := range stored.Plugins {
		if err := validate(entry); err != nil {
			return nil, fmt.Errorf("read plugin catalog %s: %w", c.path, err)
		}
	}
	slices.SortFunc(stored.Plugins, func(first, second Entry) int {
		return cmp.Compare(first.Name, second.Name)
	})
	return stored.Plugins, nil
}

// Find は名前で定義を引く。
func (c Catalog) Find(name string) (Entry, bool, error) {
	entries, err := c.List()
	if err != nil {
		return Entry{}, false, err
	}
	for _, entry := range entries {
		if entry.Name == name {
			return entry, true, nil
		}
	}
	return Entry{}, false, nil
}

// Add は同名なら上書きして定義を登録する。
func (c Catalog) Add(entry Entry) error {
	if err := validate(entry); err != nil {
		return err
	}
	entries, err := c.List()
	if err != nil {
		return err
	}
	replaced := false
	for index, existing := range entries {
		if existing.Name == entry.Name {
			entries[index] = entry
			replaced = true
		}
	}
	if !replaced {
		entries = append(entries, entry)
	}
	return c.write(file{Plugins: entries})
}

// Remove は起動コマンドの定義だけを消す。プロセスとCore上の登録は残す。
func (c Catalog) Remove(name string) (bool, error) {
	entries, err := c.List()
	if err != nil {
		return false, err
	}
	kept := slices.DeleteFunc(slices.Clone(entries), func(entry Entry) bool {
		return entry.Name == name
	})
	if len(kept) == len(entries) {
		return false, nil
	}
	return true, c.write(file{Plugins: kept})
}

func (c Catalog) write(stored file) error {
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return err
	}
	// 読みかけの不完全ファイルを見せないよう、別名で書いてからrenameする。
	temp := c.path + ".tmp"
	if err := os.WriteFile(temp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temp, c.path)
}
