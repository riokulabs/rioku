package gateway

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// doJSONRaw is like doJSON but accepts arbitrary marshalled values
// (for tests where the body shape doesn't fit the existing helpers).
func doJSONRaw(t *testing.T, client *http.Client, method, url string, body any) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// TestKeyRoutes_TenantScopedFullSurface walks the new tenant-scoped
// CRUD + PUT + PATCH + revoke + rotate surface end-to-end against
// the full daemon stack (auth + handlers) so the FK to users(id)
// passes naturally with the seeded root user.
//
// The setupKeyTestServer chain doesn't include TenantMiddleware, so
// the new `/api/v1/t/{tenant}/api-keys/...` endpoints execute with
// `tenant=nil` in context — the handler falls back to a root link
// builder via tenantBuilderOrRoot.
func TestKeyRoutes_TenantScopedFullSurface(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	id, originalKey := createKeyViaAPI(t, client, server.URL, map[string]string{
		"name":   "ci-key",
		"scopes": "read,write",
	})
	if !strings.HasPrefix(originalKey, "rku_tok_") {
		t.Errorf("created key should start with rku_tok_, got %q", originalKey)
	}

	// 2. GET the key detail (tenant-scoped).
	resp := doJSONRaw(t, client, http.MethodGet, server.URL+"/api/v1/t/default/api-keys/"+id, nil)
	if resp.StatusCode != http.StatusOK {
		body, _ := readAll(resp)
		t.Fatalf("get: %d body=%s", resp.StatusCode, body)
	}
	var got map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&got)
	_ = resp.Body.Close()
	if got["name"] != "ci-key" {
		t.Errorf("get.name = %v", got["name"])
	}
	if l, _ := got["_links"].(map[string]any); l["self"] == nil || l["rotate"] == nil {
		t.Errorf("missing _links: %v", got["_links"])
	}

	// 3. PATCH the name.
	resp = doJSONRaw(t, client, http.MethodPatch, server.URL+"/api/v1/t/default/api-keys/"+id,
		map[string]any{"name": "ci-key-renamed"})
	if resp.StatusCode != http.StatusOK {
		body, _ := readAll(resp)
		t.Fatalf("patch: %d body=%s", resp.StatusCode, body)
	}
	var patched map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&patched)
	_ = resp.Body.Close()
	if patched["name"] != "ci-key-renamed" {
		t.Errorf("patched.name = %v", patched["name"])
	}

	// 4. PUT (replace scope set).
	resp = doJSONRaw(t, client, http.MethodPut, server.URL+"/api/v1/t/default/api-keys/"+id,
		map[string]any{"scopes": []string{"admin"}})
	if resp.StatusCode != http.StatusOK {
		body, _ := readAll(resp)
		t.Fatalf("put: %d body=%s", resp.StatusCode, body)
	}
	var puted map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&puted)
	_ = resp.Body.Close()
	scopes, _ := puted["scopes"].([]any)
	if len(scopes) != 1 || scopes[0] != "admin" {
		t.Errorf("scopes after put = %v", scopes)
	}

	// 5. Rotate. New key issued; old id should be revoked.
	resp = doJSONRaw(t, client, http.MethodPost, server.URL+"/api/v1/t/default/api-keys/"+id+"/rotate", nil)
	if resp.StatusCode != http.StatusOK {
		body, _ := readAll(resp)
		t.Fatalf("rotate: %d body=%s", resp.StatusCode, body)
	}
	var rotated map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&rotated)
	_ = resp.Body.Close()
	newID, _ := rotated["id"].(string)
	newKey, _ := rotated["key"].(string)
	if newID == id {
		t.Errorf("rotate should mint a new id, got same %q", newID)
	}
	if newKey == originalKey {
		t.Errorf("rotate should mint a new secret")
	}
	if !strings.HasPrefix(newKey, "rku_tok_") {
		t.Errorf("rotated secret should start with rku_tok_, got %q", newKey)
	}

	// 6. POST .../revoke alias should 204.
	resp = doJSONRaw(t, client, http.MethodPost, server.URL+"/api/v1/t/default/api-keys/"+newID+"/revoke", nil)
	if resp.StatusCode != http.StatusNoContent {
		body, _ := readAll(resp)
		t.Fatalf("revoke: %d body=%s", resp.StatusCode, body)
	}
	_ = resp.Body.Close()

	// 7. PATCH on the revoked key should 404 (UpdateAPIKey rejects revoked rows).
	resp = doJSONRaw(t, client, http.MethodPatch, server.URL+"/api/v1/t/default/api-keys/"+newID,
		map[string]any{"name": "after-revoke"})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("patch-after-revoke: expected 404, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestKeyRoutes_OPTIONSCoverage(t *testing.T) {
	_, drv, _, _ := setupKeyTestServer(t)

	mux := http.NewServeMux()
	RegisterKeyRoutes(mux, drv)

	cases := []struct {
		path    string
		methods string
	}{
		{"/api/v1/keys", "GET, OPTIONS, POST"},
		{"/api/v1/keys/abc", "DELETE, OPTIONS"},
		{"/api/v1/keys/abc/usage", "GET, OPTIONS"},
		{"/api/v1/t/default/api-keys", "GET, OPTIONS, POST"},
		{"/api/v1/t/default/api-keys/abc", "DELETE, GET, OPTIONS, PATCH, PUT"},
		{"/api/v1/t/default/api-keys/abc/revoke", "OPTIONS, POST"},
		{"/api/v1/t/default/api-keys/abc/rotate", "OPTIONS, POST"},
		{"/api/v1/t/default/api-keys/abc/usage", "GET, OPTIONS"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodOptions, c.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Errorf("%s: expected 204, got %d", c.path, rec.Code)
		}
		if got := rec.Header().Get("Allow"); got != c.methods {
			t.Errorf("%s: Allow = %q, want %q", c.path, got, c.methods)
		}
	}
}

// readAll reads and closes the response body, returning the bytes.
func readAll(resp *http.Response) ([]byte, error) {
	defer func() { _ = resp.Body.Close() }()
	var buf bytes.Buffer
	_, err := buf.ReadFrom(resp.Body)
	return buf.Bytes(), err
}
