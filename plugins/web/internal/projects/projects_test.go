package projects

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNames(t *testing.T) {
	for _, ok := range []struct {
		name  string
		valid bool
	}{
		{"plugumi", true}, {"a", true}, {"feature-a", true},
		{"", false}, {"A", false}, {"-a", false}, {"a-", false}, {"a--b", false},
		{"a_b", false}, {strings.Repeat("a", 64), false}, {strings.Repeat("a", 63), true},
	} {
		if ValidName(ok.name) != ok.valid {
			t.Errorf("ValidName(%q) = %v, want %v", ok.name, !ok.valid, ok.valid)
		}
	}
}

func TestAddProject(t *testing.T) {
	document := &Document{Projects: []Project{}}
	if err := document.AddProject("plugumi"); err != nil {
		t.Fatal(err)
	}
	if err := document.AddProject("plugumi"); err != ErrDuplicateName {
		t.Fatalf("duplicate: %v", err)
	}
	if err := document.AddProject("Bad Name"); err != ErrInvalidName {
		t.Fatalf("invalid: %v", err)
	}
	if !document.RemoveProject("plugumi") || document.RemoveProject("plugumi") {
		t.Fatal("remove")
	}
}

func TestNestedAreas(t *testing.T) {
	document := &Document{Projects: []Project{}}
	if err := document.AddProject("p"); err != nil {
		t.Fatal(err)
	}
	project := document.FindProject("p")
	if err := project.AddArea(nil, "main"); err != nil {
		t.Fatal(err)
	}
	if err := project.AddArea(nil, "main"); err != ErrDuplicateName {
		t.Fatalf("sibling duplicate: %v", err)
	}
	if err := project.AddArea([]string{"main"}, "feature-a"); err != nil {
		t.Fatal(err)
	}
	// 兄弟が違えば同名でよい。
	if err := project.AddArea(nil, "other"); err != nil {
		t.Fatal(err)
	}
	if err := project.AddArea([]string{"other"}, "feature-a"); err != nil {
		t.Fatal(err)
	}
	if err := project.AddArea([]string{"nope"}, "x"); err != ErrAreaNotFound {
		t.Fatalf("missing parent: %v", err)
	}
	if project.FindArea([]string{"main", "feature-a"}) == nil {
		t.Fatal("nested area not found")
	}
	// 削除は子ごと。
	if !project.RemoveArea([]string{"main"}) {
		t.Fatal("remove")
	}
	if project.FindArea([]string{"main"}) != nil || project.FindArea([]string{"other", "feature-a"}) == nil {
		t.Fatal("remove should take children, keep other branches")
	}
}

func TestValidateDock(t *testing.T) {
	ref := PanelRef{InstanceID: "panel-1", PluginID: "standard", PanelID: "files"}
	if err := ValidateDock(Dock{Panels: []PanelRef{ref}, Selected: "panel-1"}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateDock(Dock{Panels: []PanelRef{{InstanceID: "x-1"}}}); err != ErrInvalidDock {
		t.Fatalf("bad instanceId: %v", err)
	}
	if err := ValidateDock(Dock{Panels: []PanelRef{ref}, Selected: "panel-2"}); err != ErrInvalidDock {
		t.Fatalf("selected not in panels: %v", err)
	}
}

func TestSaveLoad(t *testing.T) {
	dir := t.TempDir()
	// 他ファイルがあっても触れない。
	other := filepath.Join(dir, "registrations.json")
	if err := os.WriteFile(other, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	document, err := Load(dir, "missing")
	if err != nil || len(document.Projects) != 0 {
		t.Fatalf("missing file: %v %v", document, err)
	}
	if err := document.AddProject("plugumi"); err != nil {
		t.Fatal(err)
	}
	project := document.FindProject("plugumi")
	if err := project.AddArea(nil, "main"); err != nil {
		t.Fatal(err)
	}
	project.FindArea([]string{"main"}).Workspace.Center = Dock{
		Panels:   []PanelRef{{InstanceID: "panel-a1", PluginID: "standard", PanelID: "files"}},
		Selected: "panel-a1",
	}
	if err := Save(dir, "local", document); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "local.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode: %v %v", info, err)
	}
	loaded, err := Load(dir, "local")
	if err != nil {
		t.Fatal(err)
	}
	area := loaded.FindProject("plugumi").FindArea([]string{"main"})
	if area.Workspace.Center.Selected != "panel-a1" || len(loaded.Trees()) != 1 ||
		loaded.Trees()[0].Areas[0].Name != "main" {
		t.Fatalf("roundtrip: %+v", loaded.Trees())
	}
	if data, _ := os.ReadFile(other); string(data) != "{}" {
		t.Fatal("other files under ~/.plugumi were touched")
	}
}
