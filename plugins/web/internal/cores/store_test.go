package cores

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestStoreRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plugumi", "web.json")
	store := NewStore(path)
	if urls, err := store.Load(); err != nil || len(urls) != 0 {
		t.Fatalf("empty store returned %v, %v", urls, err)
	}
	if err := store.Add("http://127.0.0.1:7700"); err != nil {
		t.Fatal(err)
	}
	// 重複は追加しない。
	if err := store.Add("http://127.0.0.1:7700"); err != nil {
		t.Fatal(err)
	}
	if err := store.Add("http://127.0.0.1:7701"); err != nil {
		t.Fatal(err)
	}
	urls, err := NewStore(path).Load()
	if err != nil || !slices.Equal(urls, []string{"http://127.0.0.1:7700", "http://127.0.0.1:7701"}) {
		t.Fatalf("got %v, %v", urls, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "{\"cores\":[\"http://127.0.0.1:7700\",\"http://127.0.0.1:7701\"]}\n" {
		t.Fatalf("unexpected file contents: %s", data)
	}
	if err := store.Remove("http://127.0.0.1:7700"); err != nil {
		t.Fatal(err)
	}
	urls, err = store.Load()
	if err != nil || !slices.Equal(urls, []string{"http://127.0.0.1:7701"}) {
		t.Fatalf("got %v, %v", urls, err)
	}
	if err := NewStore(filepath.Join(t.TempDir(), "bad", "web.json")).Remove("missing"); err != nil {
		t.Fatalf("removing from a missing file should be a no-op: %v", err)
	}
}
