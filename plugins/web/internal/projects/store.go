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

// fileArea/fileProject は読み取り形。旧形式はnameがkeyを兼ねていたため、
// keyが無い項目はnameからkeyとtitleを移す。
type fileArea struct {
	Key       string     `json:"key"`
	Title     string     `json:"title"`
	Name      string     `json:"name"`
	Workspace Opaque     `json:"workspace"`
	Areas     []fileArea `json:"areas"`
}

type fileProject struct {
	Key   string     `json:"key"`
	Title string     `json:"title"`
	Name  string     `json:"name"`
	Areas []fileArea `json:"areas"`
}

type fileDocument struct {
	Projects []fileProject `json:"projects"`
}

// Load はcoreNameのDocumentを読む。ファイルが無ければ空を返す。
func Load(directory, coreName string) (*Document, error) {
	data, err := os.ReadFile(filepath.Join(directory, coreName+".json"))
	if errors.Is(err, fs.ErrNotExist) {
		return &Document{Projects: []Project{}}, nil
	}
	if err != nil {
		return nil, err
	}
	stored := &fileDocument{Projects: []fileProject{}}
	if err := json.Unmarshal(data, stored); err != nil {
		return nil, err
	}
	document := &Document{Projects: make([]Project, 0, len(stored.Projects))}
	for _, project := range stored.Projects {
		document.Projects = append(document.Projects, project.project())
	}
	return document, nil
}

func (stored fileProject) project() Project {
	project := Project{
		Key: stored.Key, Title: stored.Title, Areas: make([]Area, 0, len(stored.Areas)),
	}
	if project.Key == "" {
		project.Key = stored.Name
	}
	if project.Title == "" {
		project.Title = stored.Name
	}
	for _, area := range stored.Areas {
		project.Areas = append(project.Areas, area.area())
	}
	return project
}

func (stored fileArea) area() Area {
	area := Area{
		Key: stored.Key, Title: stored.Title, Workspace: stored.Workspace,
		Areas: make([]Area, 0, len(stored.Areas)),
	}
	if area.Key == "" {
		area.Key = stored.Name
	}
	if area.Title == "" {
		area.Title = stored.Name
	}
	for _, child := range stored.Areas {
		area.Areas = append(area.Areas, child.area())
	}
	return area
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
