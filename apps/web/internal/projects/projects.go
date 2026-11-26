// Package projects はCoreごとのProject/Area/Workspaceの木構造を扱う。
// ファイルI/Oはstore.go。~/.plugumi/web/<Core名>.jsonの形に対応する。
// WorkspaceはShellが所有するJSONで、serverは中身を解釈せず
// そのまま保存・返却する（designs/00005「保存の形」）。
package projects

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"slices"
)

var (
	ErrInvalidTitle    = errors.New("invalid title")
	ErrProjectNotFound = errors.New("project not found")
	ErrAreaNotFound    = errors.New("area not found")
)

// 表示名。URLには出ないため文字種は自由（日本語・大文字・記号OK）。
// 空・長過ぎ・制御文字だけを弾く。
func ValidTitle(title string) bool {
	if title == "" || utf8.RuneCountInString(title) > 63 {
		return false
	}
	return !strings.ContainsFunc(title, unicode.IsControl)
}

// keyはURLの識別子。利用者が決めるものではなく生成される。
const keyAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// newKey は8文字のランダムkeyを生成する。
func newKey() (string, error) {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	key := make([]byte, len(raw))
	for i, b := range raw {
		key[i] = keyAlphabet[int(b)%len(keyAlphabet)]
	}
	return string(key), nil
}

// Opaque はShell所有のJSONをそのまま保持する。未保存はnilで、
// シリアライズするとnullになる。
type Opaque = json.RawMessage

// Area は入れ子にできる領域。Workspaceと1対1。
// KeyはURL path segmentとして兄弟内で一意、Titleは自由な表示名。
type Area struct {
	Key       string `json:"key"`
	Title     string `json:"title"`
	Workspace Opaque `json:"workspace"`
	Areas     []Area `json:"areas"`
}

// Project はAreaの木を持つ。
type Project struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	Areas []Area `json:"areas"`
}

// Document は<Core名>.jsonの全体。
type Document struct {
	Projects []Project `json:"projects"`
}

// AreaTree はGET /projectsが返すkey+titleの木。
type AreaTree struct {
	Key   string     `json:"key"`
	Title string     `json:"title"`
	Areas []AreaTree `json:"areas"`
}

// ProjectTree はGET /projectsの1要素。
type ProjectTree struct {
	Key   string     `json:"key"`
	Title string     `json:"title"`
	Areas []AreaTree `json:"areas"`
}

// Trees はkey+titleのツリーに変換する。
func (document *Document) Trees() []ProjectTree {
	trees := make([]ProjectTree, 0, len(document.Projects))
	for _, project := range document.Projects {
		trees = append(trees, ProjectTree{Key: project.Key, Title: project.Title, Areas: areaTrees(project.Areas)})
	}
	return trees
}

func areaTrees(areas []Area) []AreaTree {
	trees := make([]AreaTree, 0, len(areas))
	for _, area := range areas {
		trees = append(trees, AreaTree{Key: area.Key, Title: area.Title, Areas: areaTrees(area.Areas)})
	}
	return trees
}

// FindProject はkeyでProjectを指す。
func (document *Document) FindProject(key string) *Project {
	for index := range document.Projects {
		if document.Projects[index].Key == key {
			return &document.Projects[index]
		}
	}
	return nil
}

// AddProject は直下にProjectを作り、発行したkeyを返す。
// titleは識別子ではないため重複を許す。
func (document *Document) AddProject(title string) (string, error) {
	if !ValidTitle(title) {
		return "", ErrInvalidTitle
	}
	for {
		key, err := newKey()
		if err != nil {
			return "", err
		}
		if document.FindProject(key) == nil {
			document.Projects = append(document.Projects, Project{
				Key: key, Title: title, Areas: []Area{},
			})
			return key, nil
		}
	}
}

// FindArea はpath（親からのkey列、空=直下不可でProject自身ではない）で
// Areaを指す。pathの各要素はその親の直下にあること。
func (project *Project) FindArea(path []string) *Area {
	if len(path) == 0 {
		return nil
	}
	areas := project.Areas
	var found *Area
	for _, key := range path {
		found = nil
		for index := range areas {
			if areas[index].Key == key {
				found = &areas[index]
				break
			}
		}
		if found == nil {
			return nil
		}
		areas = found.Areas
	}
	return found
}

// AddArea はparent（直下なら空）の下に子Areaを作り、発行したkeyを返す。
func (project *Project) AddArea(parent []string, title string) (string, error) {
	if !ValidTitle(title) {
		return "", ErrInvalidTitle
	}
	var siblings *[]Area
	if len(parent) == 0 {
		siblings = &project.Areas
	} else {
		owner := project.FindArea(parent)
		if owner == nil {
			return "", ErrAreaNotFound
		}
		siblings = &owner.Areas
	}
	for {
		key, err := newKey()
		if err != nil {
			return "", err
		}
		if slices.IndexFunc(*siblings, func(area Area) bool {
			return area.Key == key
		}) < 0 {
			*siblings = append(*siblings, Area{Key: key, Title: title, Areas: []Area{}})
			return key, nil
		}
	}
}

// RemoveArea はpathのAreaを子ごと削除する。
func (project *Project) RemoveArea(path []string) bool {
	if len(path) == 0 {
		return false
	}
	siblings := project.Areas
	if len(path) > 1 {
		parent := project.FindArea(path[:len(path)-1])
		if parent == nil {
			return false
		}
		siblings = parent.Areas
	}
	index := slices.IndexFunc(siblings, func(area Area) bool {
		return area.Key == path[len(path)-1]
	})
	if index < 0 {
		return false
	}
	areas := slices.Delete(siblings, index, index+1)
	if len(path) > 1 {
		project.FindArea(path[:len(path)-1]).Areas = areas
	} else {
		project.Areas = areas
	}
	return true
}

// ValidOpaque はPUTで受け付ける形。JSONのobjectかnullだけ。
// 配列・文字列・数値などは400で拒否する（Shellのstateは常にobject）。
func ValidOpaque(data []byte) bool {
	trimmed := bytes.TrimSpace(data)
	if bytes.Equal(trimmed, []byte("null")) {
		return true
	}
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return false
	}
	return json.Valid(trimmed)
}
