package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpaqueHandles_register_then_resolve(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterOpaqueRoutes(mux, drv)

	// Register a value.
	req := authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/opaque-handles", "default",
		map[string]string{"value": "user-secret@example.com"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var reg struct {
		Handle string `json:"handle"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&reg); err != nil {
		t.Fatalf("decode register response: %v", err)
	}
	if !strings.HasPrefix(reg.Handle, "oh_") {
		t.Errorf("handle = %q, want oh_ prefix", reg.Handle)
	}

	// Idempotent re-register: same value → same handle.
	req2 := authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/opaque-handles", "default",
		map[string]string{"value": "user-secret@example.com"})
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("idempotent register: status = %d", rec2.Code)
	}
	var reg2 struct {
		Handle string `json:"handle"`
	}
	if err := json.NewDecoder(rec2.Body).Decode(&reg2); err != nil {
		t.Fatalf("decode reg2: %v", err)
	}
	if reg.Handle != reg2.Handle {
		t.Errorf("idempotency broken: %q != %q", reg.Handle, reg2.Handle)
	}

	// Resolve.
	req3 := authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/opaque-handles/"+reg.Handle, "default", nil)
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("resolve: status = %d, body = %s", rec3.Code, rec3.Body.String())
	}
	var resolved map[string]any
	if err := json.NewDecoder(rec3.Body).Decode(&resolved); err != nil {
		t.Fatalf("decode resolved: %v", err)
	}
	if resolved["handle"] != reg.Handle {
		t.Errorf("resolved handle = %v, want %q", resolved["handle"], reg.Handle)
	}
	// The default tenant's ID is "tenant_default" (seeded by migration).
	if resolved["tenantId"] == "" {
		t.Errorf("resolved tenantId is empty")
	}
	// CRITICAL: must NOT return the original value.
	if _, hasValue := resolved["value"]; hasValue {
		t.Error("resolve response leaked the original value!")
	}
}

func TestOpaqueHandles_validation_400_on_empty_value(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterOpaqueRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/opaque-handles", "default",
		map[string]string{"value": ""})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestOpaqueHandles_resolve_404_on_unknown(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterOpaqueRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/opaque-handles/oh_doesnotexist", "default", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
