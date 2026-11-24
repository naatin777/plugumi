package projects

import (
	"encoding/json"
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

func TestValidOpaque(t *testing.T) {
	for _, ok := range []struct {
		body  string
		valid bool
	}{
		{`{"version":1}`, true}, {`null`, true}, {` { "a": 1 } `, true},
		{`[]`, false}, {`[1,2]`, false}, {`"x"`, false}, {`42`, false},
		{`true`, false}, {`{`, false}, {``, false},
	} {
		if ValidOpaque([]byte(ok.body)) != ok.valid {
			t.Errorf("ValidOpaque(%q) = %v, want %v", ok.body, !ok.valid, ok.valid)
		}
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
	project.FindArea([]string{"main"}).Workspace =
		Opaque(`{"version":1,"center":{"focusedLeaf":"leaf-1"}}`)
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
	// RawMessageはMarshalIndentで再整形されるため、比較はsemanticに行う。
	var workspace any
	if err := json.Unmarshal(area.Workspace, &workspace); err != nil {
		t.Fatal(err)
	}
	if workspace.(map[string]any)["version"].(float64) != 1 ||
		len(loaded.Trees()) != 1 || loaded.Trees()[0].Areas[0].Name != "main" {
		t.Fatalf("roundtrip: %+v", loaded.Trees())
	}
	if data, _ := os.ReadFile(other); string(data) != "{}" {
		t.Fatal("other files under ~/.plugumi were touched")
	}
}
