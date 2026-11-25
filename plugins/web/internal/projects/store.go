// 保存ファイルの読み書き。<dir>/<Core名>.json、未知フィールドは読み捨てる。
// ~/.plugumi直下には他ツールのファイルがあるため、渡されたdir以外は触れない。
package projects

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Load はcoreNameのDocumentを読む。ファイルが無ければ空を返す。
// 未知フィールドは読み捨てるが、旧形式（key以前のname時代）は扱わない。
func Load(directory, coreName string) (*Document, error) {
	data, err := os.ReadFile(filepath.Join(directory, coreName+".json"))
	if errors.Is(err, fs.ErrNotExist) {
		return &Document{Projects: []Project{}}, nil
	}
	if err != nil {
		return nil, err
	}
	document := &Document{Projects: []Project{}}
	if err := json.Unmarshal(data, document); err != nil {
		return nil, err
	}
	if document.Projects == nil {
		document.Projects = []Project{}
	}
	return document, nil
}

// Save は一時ファイルへ書いてからrenameで置き換える。
// ディレクトリは0700、ファイルは0600。
func Save(directory, coreName string, document *Document) error {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".tmp-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporary.Name(), filepath.Join(directory, coreName+".json"))
}
