package plugininstances

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewID(t *testing.T) {
	if id := NewID(); !strings.HasPrefix(id, "plugin-") {
		t.Fatalf("unexpected instance ID %q", id)
	}
	if NewID() == NewID() {
		t.Fatal("instance IDs are not unique")
	}
}

func TestRegisterWritesAndRemovesRecord(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "plugins")
	unregister, err := register(directory, "plugin-test", "0.1.0", "/tmp/web-1.log", "http://127.0.0.1:7800")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "plugin-test.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var entry record
	if err := json.Unmarshal(data, &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Name != "web" || entry.ID != "plugin-test" || entry.Version != "0.1.0" ||
		entry.PID != os.Getpid() || entry.Log != "/tmp/web-1.log" ||
		entry.URL != "http://127.0.0.1:7800" {
		t.Fatalf("unexpected record: %+v", entry)
	}
	if entry.HeartbeatUnixSeconds <= 0 || entry.HeartbeatUnixSeconds > time.Now().Unix() {
		t.Fatalf("unexpected heartbeat: %d", entry.HeartbeatUnixSeconds)
	}
	unregister()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("record still exists after unregister: %v", err)
	}
	// 二度呼んでもよい。
	unregister()
}
