package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAPIJSON_returns_canonical_spec(t *testing.T) {
	mux := http.NewServeMux()
	RegisterOpenAPIRoute(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var spec map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&spec); err != nil {
		t.Fatal(err)
	}
	if _, ok := spec["paths"]; !ok {
		t.Error("spec missing 'paths' key")
	}
	if _, ok := spec["info"]; !ok {
		t.Error("spec missing 'info' key")
	}
	// Plan 00a normalized api.full.json to OAS 3.0.3
	if spec["openapi"] == nil {
		t.Errorf("expected openapi 3.x, got: %v", spec["openapi"])
	}
}

func TestOpenAPIJSON_etag_caching(t *testing.T) {
	mux := http.NewServeMux()
	RegisterOpenAPIRoute(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	etag := resp.Header.Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}

	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/openapi.json", nil)
	req.Header.Set("If-None-Match", etag)
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusNotModified {
		t.Errorf("status = %d, want 304 on If-None-Match hit", resp2.StatusCode)
	}
}
