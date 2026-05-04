package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/riokulabs/rioku/internal/store"
)

// seedTestRole creates a custom role visible to the default tenant so
// the rbac-policies tests have a real role_id to point at.
func seedTestRole(t *testing.T, drv store.Driver, id, name string) string {
	t.Helper()
	tx, err := drv.Begin(context.Background(), store.TxOptions{})
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	role, err := tx.CreateRole(context.Background(), store.CreateRoleParams{
		ID:          id,
		Name:        name,
		Description: "test role",
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("seed role: %v", err)
	}
	_ = tx.Commit()
	return role.ID
}

func TestRbacPolicyRoutes_FullCRUDPlusTest(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterRbacPolicyRoutes(mux, drv)

	roleID := seedTestRole(t, drv, "role_test_rbac", "RBAC Test Role")

	// Create
	createReq := authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/rbac-policies", "default",
		map[string]any{
			"name":        "alice gets test role",
			"subjectType": "user",
			"subjectId":   "u_alice",
			"roleId":      roleID,
		})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, createReq)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d body=%s", rec.Code, rec.Body.String())
	}
	var created map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&created)
	id := created["id"].(string)
	if l, _ := created["_links"].(map[string]any); l["role"] == nil || l["test"] == nil || l["subject"] == nil {
		t.Errorf("missing _links: %v", created["_links"])
	}

	// Duplicate -> 409
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/rbac-policies", "default",
		map[string]any{
			"name":        "alice gets test role (again)",
			"subjectType": "user",
			"subjectId":   "u_alice",
			"roleId":      roleID,
		}))
	if rec.Code != http.StatusConflict {
		t.Errorf("duplicate: expected 409, got %d", rec.Code)
	}

	// Get
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/rbac-policies/"+id, "default", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get: %d", rec.Code)
	}

	// List
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/rbac-policies", "default", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}

	// PATCH disable
	disabled := false
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPatch,
		"/api/v1/t/default/rbac-policies/"+id, "default",
		map[string]any{"enabled": disabled}))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch: %d body=%s", rec.Code, rec.Body.String())
	}
	var patched map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&patched)
	if patched["enabled"] != false {
		t.Errorf("enabled = %v, want false", patched["enabled"])
	}

	// Test action — disabled policy returns matched=false even for the
	// configured subject.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/rbac-policies/"+id+"/test", "default",
		map[string]any{"subjectId": "u_alice", "subjectType": "user"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("test (disabled): %d", rec.Code)
	}
	var testRes map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&testRes)
	if testRes["matched"] != false {
		t.Errorf("disabled policy should not match, got %v", testRes)
	}

	// Re-enable + test should match.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPatch,
		"/api/v1/t/default/rbac-policies/"+id, "default",
		map[string]any{"enabled": true}))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch enable: %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/rbac-policies/"+id+"/test", "default",
		map[string]any{"subjectId": "u_alice", "subjectType": "user"}))
	_ = json.NewDecoder(rec.Body).Decode(&testRes)
	if testRes["matched"] != true || testRes["roleId"] != roleID {
		t.Errorf("enabled policy should match: %v", testRes)
	}

	// Test with non-matching subject → matched=false.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/rbac-policies/"+id+"/test", "default",
		map[string]any{"subjectId": "u_bob", "subjectType": "user"}))
	_ = json.NewDecoder(rec.Body).Decode(&testRes)
	if testRes["matched"] != false {
		t.Errorf("different subject should not match: %v", testRes)
	}

	// Delete
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/rbac-policies/"+id, "default", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/rbac-policies/"+id, "default", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("get-after-delete: %d", rec.Code)
	}
}

func TestRbacPolicyRoutes_OPTIONSCoverage(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterRbacPolicyRoutes(mux, drv)

	cases := []struct {
		path    string
		methods string
	}{
		{"/api/v1/t/default/rbac-policies", "GET, OPTIONS, POST"},
		{"/api/v1/t/default/rbac-policies/abc", "DELETE, GET, OPTIONS, PATCH, PUT"},
		{"/api/v1/t/default/rbac-policies/abc/test", "OPTIONS, POST"},
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
