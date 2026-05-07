package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPluginMarketplace_ListReturnsAtLeastSixEntries(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/plugin-marketplace", "default", nil))
	if r.Code != http.StatusOK {
		t.Fatalf("marketplace list: %d (%s)", r.Code, r.Body.String())
	}

	var body struct {
		Items []struct {
			ID               string `json:"id"`
			Name             string `json:"name"`
			SignerFingerprint string `json:"signer_fingerprint"`
		} `json:"items"`
		Total int `json:"total"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Total < 6 {
		t.Errorf("marketplace list: total = %d, want >= 6", body.Total)
	}
	if len(body.Items) < 6 {
		t.Errorf("marketplace list: len(items) = %d, want >= 6", len(body.Items))
	}
	for i, item := range body.Items {
		if item.ID == "" {
			t.Errorf("items[%d].id is empty", i)
		}
		if item.Name == "" {
			t.Errorf("items[%d].name is empty", i)
		}
		if item.SignerFingerprint == "" {
			t.Errorf("items[%d].signer_fingerprint is empty", i)
		}
	}
}

func TestPluginMarketplace_GetByID(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	// Valid entry
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/plugin-marketplace/rioku_jwt", "default", nil))
	if r.Code != http.StatusOK {
		t.Fatalf("marketplace get: %d (%s)", r.Code, r.Body.String())
	}
	var entry struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if entry.ID != "rioku_jwt" {
		t.Errorf("id = %q, want rioku_jwt", entry.ID)
	}

	// Unknown entry → 404
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/plugin-marketplace/nonexistent", "default", nil))
	if r2.Code != http.StatusNotFound {
		t.Errorf("unknown entry: expected 404, got %d", r2.Code)
	}
}

func TestPluginManifestValidate_Valid(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	manifest := map[string]any{
		"id":           "com.example.myplugin",
		"name":         "My Plugin",
		"version":      "1.0.0",
		"permissions":  []string{"com.example.myplugin:read"},
		"capabilities": []string{"http-filter"},
		"hooks":        []string{"request-headers"},
	}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugins/manifest/validate", "default", manifest))
	if r.Code != http.StatusOK {
		t.Fatalf("validate valid manifest: %d (%s)", r.Code, r.Body.String())
	}
	var resp struct {
		Valid  bool `json:"valid"`
		Errors []struct {
			Path    string `json:"path"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(r.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Valid {
		t.Errorf("valid manifest reported invalid, errors: %+v", resp.Errors)
	}
	if len(resp.Errors) != 0 {
		t.Errorf("expected 0 errors, got %d: %+v", len(resp.Errors), resp.Errors)
	}
}

func TestPluginManifestValidate_MissingRequiredField(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	// Missing 'name' field
	manifest := map[string]any{
		"id":          "com.example.myplugin",
		"version":     "1.0.0",
		"permissions": []string{"com.example.myplugin:read"},
	}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugins/manifest/validate", "default", manifest))
	if r.Code != http.StatusOK {
		t.Fatalf("validate: %d (%s)", r.Code, r.Body.String())
	}
	var resp struct {
		Valid  bool `json:"valid"`
		Errors []struct {
			Path    string `json:"path"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(r.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Valid {
		t.Error("expected invalid=false for missing name field")
	}
	foundNameError := false
	for _, e := range resp.Errors {
		if e.Path == "name" {
			foundNameError = true
		}
	}
	if !foundNameError {
		t.Errorf("expected error on path 'name', got: %+v", resp.Errors)
	}
}

func TestPluginManifestValidate_UnknownPermissionKey(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	// Unknown top-level key should be flagged
	manifest := map[string]any{
		"id":               "com.example.myplugin",
		"name":             "My Plugin",
		"version":          "1.0.0",
		"permissions":      []string{"com.example.myplugin:read"},
		"unknown_field_xyz": "some-value",
	}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugins/manifest/validate", "default", manifest))
	if r.Code != http.StatusOK {
		t.Fatalf("validate: %d", r.Code)
	}
	var resp struct {
		Valid  bool `json:"valid"`
		Errors []struct {
			Path    string `json:"path"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(r.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Valid {
		t.Error("expected invalid=false for unknown field")
	}
	foundUnknown := false
	for _, e := range resp.Errors {
		if e.Path == "unknown_field_xyz" {
			foundUnknown = true
		}
	}
	if !foundUnknown {
		t.Errorf("expected error for 'unknown_field_xyz', got: %+v", resp.Errors)
	}
}
