package gateway

import (
	"encoding/json"
	"net/http"
	"testing"
)

// TestListPermissions_includes_source_field verifies that GET /api/v1/permissions
// returns a non-empty list of permissions and that every entry carries a valid
// "source" field ("built-in", "plugin-manifest", or "plugin-dynamic").
// It also asserts that at least one entry has source="built-in", confirming the
// migration 000049 backfill is visible through the API.
func TestListPermissions_includes_source_field(t *testing.T) {
	srv, _, rootPassword := setupRBACTestServer(t)

	client := loginAsRoot(t, srv.URL, rootPassword)

	resp, err := client.Get(srv.URL + "/api/v1/permissions")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/v1/permissions: expected 200, got %d", resp.StatusCode)
	}

	var perms []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&perms); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(perms) == 0 {
		t.Fatal("expected non-empty permissions list")
	}

	validSources := map[string]bool{
		"built-in":        true,
		"plugin-manifest": true,
		"plugin-dynamic":  true,
	}

	for _, p := range perms {
		id, _ := p["id"].(string)
		src, ok := p["source"]
		if !ok {
			t.Errorf("permission %q missing 'source' field", id)
			continue
		}
		s, _ := src.(string)
		if !validSources[s] {
			t.Errorf("permission %q has invalid source %q (must be built-in, plugin-manifest, or plugin-dynamic)", id, s)
		}
	}

	hasBuiltIn := false
	for _, p := range perms {
		if p["source"] == "built-in" {
			hasBuiltIn = true
			break
		}
	}
	if !hasBuiltIn {
		t.Error("no permissions have source='built-in' — migration 000049 backfill not visible")
	}
}
