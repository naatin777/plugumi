// Package projects はCoreごとのProject/Area/Workspaceの木構造を扱う。
// ファイルI/Oはstore.go。~/.plugumi/web/<Core名>.jsonの形に対応する。
// WorkspaceはShellが所有するJSONで、serverは中身を解釈せず
// そのまま保存・返却する（designs/00005「保存の形」）。
package projects

import (
	"bytes"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
)

var (
	ErrInvalidName     = errors.New("invalid name")
	ErrDuplicateName   = errors.New("name already exists among siblings")
	ErrProjectNotFound = errors.New("project not found")
	ErrAreaNotFound    = errors.New("area not found")
)

// core.nameと同じ形式。名前がそのままURLの識別子になるため。
var namePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ValidName はProject/Area名の検証（1〜63文字のslug）。
func ValidName(name string) bool {
	return len(name) >= 1 && len(name) <= 63 && namePattern.MatchString(name)
}

// Opaque はShell所有のJSONをそのまま保持する。未保存はnilで、
// シリアライズするとnullになる。
type Opaque = json.RawMessage

// Area は入れ子にできる領域。Workspaceと1対1。
type Area struct {
	Name      string `json:"name"`
	Workspace Opaque `json:"workspace"`
	Areas     []Area `json:"areas"`
}

// Project はAreaの木を持つ。
type Project struct {
	Name  string `json:"name"`
	Areas []Area `json:"areas"`
}

// Document は<Core名>.jsonの全体。
type Document struct {
	Projects []Project `json:"projects"`
}

// AreaTree はGET /projectsが返す名前だけの木。
type AreaTree struct {
	Name  string     `json:"name"`
	Areas []AreaTree `json:"areas"`
}

// ProjectTree はGET /projectsの1要素。
type ProjectTree struct {
	Name  string     `json:"name"`
	Areas []AreaTree `json:"areas"`
}

// Trees は名前ツリーに変換する。
func (document *Document) Trees() []ProjectTree {
	trees := make([]ProjectTree, 0, len(document.Projects))
	for _, project := range document.Projects {
		trees = append(trees, ProjectTree{Name: project.Name, Areas: areaTrees(project.Areas)})
	}
	return trees
}

func areaTrees(areas []Area) []AreaTree {
	trees := make([]AreaTree, 0, len(areas))
	for _, area := range areas {
		trees = append(trees, AreaTree{Name: area.Name, Areas: areaTrees(area.Areas)})
	}
	return trees
}

// FindProject は名前でProjectを指す。
func (document *Document) FindProject(name string) *Project {
	for index := range document.Projects {
		if document.Projects[index].Name == name {
			return &document.Projects[index]
		}
	}
	return nil
}

// AddProject は直下にProjectを作る。
func (document *Document) AddProject(name string) error {
	if !ValidName(name) {
		return ErrInvalidName
	}
	if document.FindProject(name) != nil {
		return ErrDuplicateName
	}
	document.Projects = append(document.Projects, Project{
		Name: name, Areas: []Area{},
	})
	return nil
}

// FindArea はpath（親からの名前列、空=直下不可でProject自身ではない）で
// Areaを指す。pathの各要素はその親の直下にあること。
func (project *Project) FindArea(path []string) *Area {
	if len(path) == 0 {
		return nil
	}
	areas := project.Areas
	var found *Area
	for _, name := range path {
		found = nil
		for index := range areas {
			if areas[index].Name == name {
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

// AddArea はparent（直下なら空）の下に子Areaを作る。
func (project *Project) AddArea(parent []string, name string) error {
	if !ValidName(name) {
		return ErrInvalidName
	}
	var siblings *[]Area
	if len(parent) == 0 {
		siblings = &project.Areas
	} else {
		owner := project.FindArea(parent)
		if owner == nil {
			return ErrAreaNotFound
		}
		siblings = &owner.Areas
	}
	for _, area := range *siblings {
		if area.Name == name {
			return ErrDuplicateName
		}
	}
	*siblings = append(*siblings, Area{Name: name, Areas: []Area{}})
	return nil
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
		return area.Name == path[len(path)-1]
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
