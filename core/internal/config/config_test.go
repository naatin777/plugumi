package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadAcceptsOnlyCoreSettings(t *testing.T) {
	for _, test := range []struct {
		name     string
		contents string
		wantErr  string
	}{
		{"current settings", "{\"core\":{\"url\":\"http://localhost:7700\"}}\n", ""},
		{"removed plugins field", `{"core":{"url":"http://localhost:7700"},"plugins":[]}`, `unknown field "plugins"`},
		{"trailing data", `{"core":{"url":"http://localhost:7700"}} {}`, "unexpected data"},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "plugumi.json")
			if err := os.WriteFile(path, []byte(test.contents), 0o600); err != nil {
				t.Fatal(err)
			}
			settings, err := Load(path)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("expected %q, got %v", test.wantErr, err)
				}
			} else if err != nil || settings.Core.Listen != "localhost:7700" {
				t.Fatalf("unexpected settings: %+v (%v)", settings, err)
			}
		})
	}
}
