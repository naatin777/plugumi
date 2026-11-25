package projects

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTitles(t *testing.T) {
	for _, ok := range []struct {
		title string
		valid bool
	}{
		{"plugumi", true}, {"a", true}, {"作業エリア", true},
		{"My Area!", true}, {"UPPER", true}, {"全角・半角 Mixed", true},
		{"", false}, {strings.Repeat("a", 64), false}, {strings.Repeat("あ", 63), true},
		{"a\nb", false}, {"tab\tname", false},
	} {
		if ValidTitle(ok.title) != ok.valid {
			t.Errorf("ValidTitle(%q) = %v, want %v", ok.title, !ok.valid, ok.valid)
		}
	}
}

func TestAddProject(t *testing.T) {
	document := &Document{Projects: []Project{}}
	key, err := document.AddProject("plugumi")
	if err != nil {
		t.Fatal(err)
	}
	if len(key) != 8 || document.FindProject(key) == nil {
		t.Fatalf("key: %q", key)
	}
	// titleは識別子ではないため重複を許し、keyが分かれる。
	other, err := document.AddProject("plugumi")
	if err != nil || other == key {
		t.Fatalf("duplicate title: key=%q err=%v", other, err)
	}
	if _, err := document.AddProject(""); err != ErrInvalidTitle {
		t.Fatalf("invalid: %v", err)
	}
}

func TestNestedAreas(t *testing.T) {
	document := &Document{Projects: []Project{}}
	projectKey, err := document.AddProject("p")
	if err != nil {
		t.Fatal(err)
	}
	project := document.FindProject(projectKey)
	main, err := project.AddArea(nil, "main")
	if err != nil {
		t.Fatal(err)
	}
	// titleは識別子ではないため兄弟で重複してもよい。
	again, err := project.AddArea(nil, "main")
	if err != nil || again == main {
		t.Fatalf("sibling duplicate title: key=%q err=%v", again, err)
	}
	feature, err := project.AddArea([]string{main}, "feature-a")
	if err != nil {
		t.Fatal(err)
	}
	// 別枝なら同じtitleでもよい。
	other, err := project.AddArea(nil, "other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := project.AddArea([]string{other}, "feature-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := project.AddArea([]string{"nope"}, "x"); err != ErrAreaNotFound {
		t.Fatalf("missing parent: %v", err)
	}
	if project.FindArea([]string{main, feature}) == nil {
		t.Fatal("nested area not found")
	}
	// 削除は子ごと。
	if !project.RemoveArea([]string{main}) {
		t.Fatal("remove")
	}
	if project.FindArea([]string{main}) != nil || project.FindArea([]string{other}) == nil {
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
	projectKey, err := document.AddProject("テスト")
	if err != nil {
		t.Fatal(err)
	}
	project := document.FindProject(projectKey)
	areaKey, err := project.AddArea(nil, "main")
	if err != nil {
		t.Fatal(err)
	}
	project.FindArea([]string{areaKey}).Workspace =
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
	area := loaded.FindProject(projectKey).FindArea([]string{areaKey})
	// RawMessageはMarshalIndentで再整形されるため、比較はsemanticに行う。
	var workspace any
	if err := json.Unmarshal(area.Workspace, &workspace); err != nil {
		t.Fatal(err)
	}
	if workspace.(map[string]any)["version"].(float64) != 1 ||
		len(loaded.Trees()) != 1 ||
		loaded.Trees()[0].Title != "テスト" ||
		loaded.Trees()[0].Areas[0].Key != areaKey {
		t.Fatalf("roundtrip: %+v", loaded.Trees())
	}
	if data, _ := os.ReadFile(other); string(data) != "{}" {
		t.Fatal("other files under ~/.plugumi were touched")
	}
}
