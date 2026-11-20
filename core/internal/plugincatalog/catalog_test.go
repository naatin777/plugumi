package plugincatalog

import (
	"os"
	"path/filepath"
	"testing"
)

func testCatalog(t *testing.T) Catalog {
	t.Helper()
	return Catalog{path: filepath.Join(t.TempDir(), "plugumi", "plugins.json")}
}

func TestAddListRemove(t *testing.T) {
	catalog := testCatalog(t)
	if entries, err := catalog.List(); err != nil || len(entries) != 0 {
		t.Fatalf("empty catalog should list nothing: %v", err)
	}
	if err := catalog.Add(Entry{Name: "agent", Command: "node dist/cli.js"}); err != nil {
		t.Fatal(err)
	}
	if err := catalog.Add(Entry{Name: "standard", Command: "plugumi-standard"}); err != nil {
		t.Fatal(err)
	}
	entries, err := catalog.List()
	if err != nil || len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %v (%v)", entries, err)
	}
	// 名前順で返す
	if entries[0].Name != "agent" || entries[1].Name != "standard" {
		t.Fatalf("entries not sorted by name: %v", entries)
	}
	// 同名は上書き
	if err := catalog.Add(Entry{Name: "agent", Command: "plugumi-agent"}); err != nil {
		t.Fatal(err)
	}
	entry, found, err := catalog.Find("agent")
	if err != nil || !found || entry.Command != "plugumi-agent" {
		t.Fatalf("overwrite failed: %+v", entry)
	}
	removed, err := catalog.Remove("agent")
	if err != nil || !removed {
		t.Fatal("remove should report the entry existed")
	}
	if removed, _ := catalog.Remove("agent"); removed {
		t.Fatal("second remove should report nothing removed")
	}
}

func TestValidate(t *testing.T) {
	catalog := testCatalog(t)
	for _, entry := range []Entry{
		{},
		{Name: "x"},
		{Name: "x", Command: "   "},
	} {
		if err := catalog.Add(entry); err == nil {
			t.Fatalf("entry %+v should be rejected", entry)
		}
	}
}

func TestInvalidCatalogCannotBeOverwrittenByAdd(t *testing.T) {
	for name, contents := range map[string]string{
		"unknown field":   `{"plugins":[{"name":"standard","command":"plugumi-standard","endpoint":"http://localhost:7700"}]}`,
		"missing command": `{"plugins":[{"name":"standard"}]}`,
		"trailing data":   `{"plugins":[]} {}`,
		"invalid JSON":    `{broken`,
	} {
		t.Run(name, func(t *testing.T) {
			catalog := testCatalog(t)
			if err := os.MkdirAll(filepath.Dir(catalog.path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(catalog.path, []byte(contents), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := catalog.Add(Entry{Name: "agent", Command: "plugumi-agent"}); err == nil {
				t.Fatal("add should reject an invalid catalog")
			}
			data, err := os.ReadFile(catalog.path)
			if err != nil || string(data) != contents {
				t.Fatalf("catalog should be unchanged: %q (%v)", data, err)
			}
		})
	}
}
