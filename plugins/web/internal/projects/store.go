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
	document.normalize()
	return document, nil
}

// normalize はclientが配列を必須とするフィールドを非nilに揃える。
// 省略・nullで保存されたDockは、レスポンスで "panels": null になると
// client側の配列操作が落ちるため、読み込み時にだけ補正する。
func (document *Document) normalize() {
	for index := range document.Projects {
		project := &document.Projects[index]
		project.Shelf.normalize()
		normalizeAreas(project.Areas)
	}
}

func normalizeAreas(areas []Area) {
	for index := range areas {
		workspace := &areas[index].Workspace
		workspace.Left.normalize()
		workspace.Center.normalize()
		workspace.Right.normalize()
		workspace.Bottom.normalize()
		normalizeAreas(areas[index].Areas)
	}
}

func (dock *Dock) normalize() {
	if dock.Panels == nil {
		dock.Panels = []PanelRef{}
	}
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
