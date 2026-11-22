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
		wantName string
		wantErr  string
	}{
		{"current settings", "{\"core\":{\"url\":\"http://localhost:7700\"}}\n", "", ""},
		{"core name", `{"core":{"url":"http://localhost:7700","name":"my-core-1"}}`, "my-core-1", ""},
		{"empty core name", `{"core":{"url":"http://localhost:7700","name":""}}`, "", ""},
		{"uppercase core name", `{"core":{"url":"http://localhost:7700","name":"My-Core"}}`, "", "core.name"},
		{"core name with underscore", `{"core":{"url":"http://localhost:7700","name":"my_core"}}`, "", "core.name"},
		{"core name with leading hyphen", `{"core":{"url":"http://localhost:7700","name":"-core"}}`, "", "core.name"},
		{"core name with consecutive hyphens", `{"core":{"url":"http://localhost:7700","name":"my--core"}}`, "", "core.name"},
		{"too long core name", `{"core":{"url":"http://localhost:7700","name":"` + strings.Repeat("a", 64) + `"}}`, "", "core.name"},
		{"removed plugins field", `{"core":{"url":"http://localhost:7700"},"plugins":[]}`, "", `unknown field "plugins"`},
		{"trailing data", `{"core":{"url":"http://localhost:7700"}} {}`, "", "unexpected data"},
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
			} else if err != nil || settings.Core.Listen != "localhost:7700" || settings.Core.Name != test.wantName {
				t.Fatalf("unexpected settings: %+v (%v)", settings, err)
			}
		})
	}
}
