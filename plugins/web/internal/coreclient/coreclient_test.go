package coreclient

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchCoreInfo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/core" || r.Method != http.MethodGet {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"coreId": "core-1", "name": "local"})
	}))
	defer server.Close()

	info, err := FetchCoreInfo(t.Context(), server.Client(), "test-token", server.URL)
	if err != nil || info.CoreID != "core-1" || info.Name != "local" {
		t.Fatalf("got %+v, %v", info, err)
	}

	var httpErr *StatusError
	_, err = FetchCoreInfo(t.Context(), server.Client(), "wrong", server.URL)
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusUnauthorized {
		t.Fatalf("got %v, want StatusError 401", err)
	}
}
