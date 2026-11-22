// Package projects はCoreごとのProject/Area/Workspaceの木構造を扱う。
// ファイルI/Oはstore.go。~/.plugumi/web/<Core名>.jsonの形に対応する。
package projects

import (
	"errors"
	"regexp"
	"slices"
	"strings"
)

var (
	ErrInvalidName      = errors.New("invalid name")
	ErrDuplicateName    = errors.New("name already exists among siblings")
	ErrProjectNotFound  = errors.New("project not found")
	ErrAreaNotFound     = errors.New("area not found")
	ErrInvalidDock      = errors.New("invalid dock layout")
	ErrInvalidWorkspace = errors.New("workspace must contain left/center/right/bottom docks")
)

// core.nameと同じ形式。名前がそのままURLの識別子になるため。
var namePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ValidName はProject/Area名の検証（1〜63文字のslug）。
func ValidName(name string) bool {
	return len(name) >= 1 && len(name) <= 63 && namePattern.MatchString(name)
}

// PanelRef は保存されるPanel Instanceへの参照。registrationIdは
// Plugin再起動で変わるため持たず、pluginId+panelIdでその時点の登録を探す。
type PanelRef struct {
	InstanceID string `json:"instanceId"`
	PluginID   string `json:"pluginId"`
	PanelID    string `json:"panelId"`
}

// Dock は1つのDockの状態。selectedはpanels内のinstanceIdか空。
type Dock struct {
	Panels   []PanelRef `json:"panels"`
	Selected string     `json:"selected"`
}

// Workspace はAreaが持つ4 Dockの配置。
type Workspace struct {
	Left   Dock `json:"left"`
	Center Dock `json:"center"`
	Right  Dock `json:"right"`
	Bottom Dock `json:"bottom"`
}

// Area は入れ子にできる領域。Workspaceと1対1。
type Area struct {
	Name      string    `json:"name"`
	Workspace Workspace `json:"workspace"`
	Areas     []Area    `json:"areas"`
}

// Project はpinned DockとAreaの木を持つ。
type Project struct {
	Name   string `json:"name"`
	Pinned Dock   `json:"pinned"`
	Areas  []Area `json:"areas"`
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
		Name: name, Pinned: Dock{Panels: []PanelRef{}}, Areas: []Area{},
	})
	return nil
}

// RemoveProject はProjectを削除する。
func (document *Document) RemoveProject(name string) bool {
	index := slices.IndexFunc(document.Projects, func(project Project) bool {
		return project.Name == name
	})
	if index < 0 {
		return false
	}
	document.Projects = slices.Delete(document.Projects, index, index+1)
	return true
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
	*siblings = append(*siblings, Area{
		Name: name, Workspace: Workspace{
			Left: Dock{Panels: []PanelRef{}}, Center: Dock{Panels: []PanelRef{}},
			Right: Dock{Panels: []PanelRef{}}, Bottom: Dock{Panels: []PanelRef{}},
		}, Areas: []Area{},
	})
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

// ValidateDock はPUTの検証。instanceIdは"panel-"始まり、
// selectedは空かpanels内のinstanceId。
func ValidateDock(dock Dock) error {
	for _, panel := range dock.Panels {
		if !strings.HasPrefix(panel.InstanceID, "panel-") {
			return ErrInvalidDock
		}
	}
	if dock.Selected != "" {
		valid := false
		for _, panel := range dock.Panels {
			if panel.InstanceID == dock.Selected {
				valid = true
				break
			}
		}
		if !valid {
			return ErrInvalidDock
		}
	}
	return nil
}
