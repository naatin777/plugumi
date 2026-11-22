// UIから追加したCoreの永続化。<config dir>/plugumi/web.jsonに保存する。
package cores

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

type storeFile struct {
	Cores []string `json:"cores"`
}

// Store はsavedなCoreのURL一覧をweb.jsonに読み書きする。
type Store struct {
	path string
	mu   sync.Mutex
}

func NewStore(path string) *Store {
	return &Store{path: path}
}

// DefaultStore はos.UserConfigDir基準の保存先を返す。
func DefaultStore() (*Store, error) {
	configDirectory, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	return NewStore(filepath.Join(configDirectory, "plugumi", "web.json")), nil
}

// Load は保存済みURLを返す。ファイルが無ければ空。
func (s *Store) Load() ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *Store) load() ([]string, error) {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var saved storeFile
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&saved); err != nil {
		return nil, fmt.Errorf("%s: %w", s.path, err)
	}
	return saved.Cores, nil
}

// Add はURLを保存済み一覧に足す。重複は追加しない。
func (s *Store) Add(normalizedURL string) error {
	return s.update(func(urls []string) ([]string, bool) {
		if slices.Contains(urls, normalizedURL) {
			return urls, false
		}
		return append(urls, normalizedURL), true
	})
}

func (s *Store) Remove(normalizedURL string) error {
	return s.update(func(urls []string) ([]string, bool) {
		next := slices.DeleteFunc(slices.Clone(urls), func(entry string) bool { return entry == normalizedURL })
		return next, len(next) != len(urls)
	})
}

func (s *Store) update(change func([]string) ([]string, bool)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	urls, err := s.load()
	if err != nil {
		return err
	}
	urls, changed := change(urls)
	if !changed {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(storeFile{Cores: urls})
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, append(data, '\n'), 0o600)
}
