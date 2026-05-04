package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPKI_CAsCRUD(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPKIRoutes(mux, drv)

	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/pki/cas", "default",
		map[string]any{"name": "internal-root", "kind": "internal", "subject": "CN=Internal Root"}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", r.Code, r.Body.String())
	}
	var ca caResponse
	_ = json.NewDecoder(r.Body).Decode(&ca)

	// Duplicate name → 409
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/pki/cas", "default",
		map[string]any{"name": "internal-root", "kind": "external", "subject": "x"}))
	if r2.Code != http.StatusConflict {
		t.Errorf("dup ca: expected 409, got %d", r2.Code)
	}

	// Delete
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/settings/pki/cas/"+ca.ID, "default", nil))
	if r3.Code != http.StatusNoContent {
		t.Errorf("delete: %d", r3.Code)
	}
}

func TestPKI_EnrollmentCreateAndRevoke(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPKIRoutes(mux, drv)

	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/pki/enrollments", "default",
		map[string]any{"subject": "CN=svc.example.com", "dnsSans": []string{"svc.example.com"}}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d", r.Code)
	}
	var e enrollmentResponse
	_ = json.NewDecoder(r.Body).Decode(&e)
	if e.State != "pending" {
		t.Errorf("initial state = %q, want pending", e.State)
	}

	// Revoke
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/pki/enrollments/"+e.ID+"/revoke", "default",
		map[string]any{"reason": "compromised"}))
	if r2.Code != http.StatusOK {
		t.Fatalf("revoke: %d", r2.Code)
	}
	var revoked enrollmentResponse
	_ = json.NewDecoder(r2.Body).Decode(&revoked)
	if revoked.State != "revoked" {
		t.Errorf("state = %q, want revoked", revoked.State)
	}
	if revoked.RevocationReason == nil || *revoked.RevocationReason != "compromised" {
		t.Errorf("reason = %v, want compromised", revoked.RevocationReason)
	}
}

func TestTLS_CertCRUDAndAutoRenew(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPKIRoutes(mux, drv)

	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/tls/certificates", "default",
		map[string]any{"domain": "api.example.com", "issuer": "Let's Encrypt", "source": "acme"}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", r.Code, r.Body.String())
	}
	var c tlsCertResponse
	_ = json.NewDecoder(r.Body).Decode(&c)
	if !c.AutoRenew {
		t.Error("default AutoRenew should be true")
	}

	// Toggle off
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPatch,
		"/api/v1/t/default/settings/tls/certificates/"+c.ID+"/auto-renew", "default",
		map[string]any{"autoRenew": false}))
	if r2.Code != http.StatusOK {
		t.Fatalf("toggle: %d", r2.Code)
	}
	var toggled tlsCertResponse
	_ = json.NewDecoder(r2.Body).Decode(&toggled)
	if toggled.AutoRenew {
		t.Error("AutoRenew should be false after toggle")
	}

	// Domain conflict
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/tls/certificates", "default",
		map[string]any{"domain": "api.example.com"}))
	if r3.Code != http.StatusConflict {
		t.Errorf("dup domain: expected 409, got %d", r3.Code)
	}
}

func TestTLS_ConfigGetUpdate(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPKIRoutes(mux, drv)

	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/settings/tls/config", "default", nil))
	if r.Code != http.StatusOK {
		t.Fatalf("get: %d", r.Code)
	}
	var c tlsConfigResponse
	_ = json.NewDecoder(r.Body).Decode(&c)
	if c.ACMEProvider != "lets-encrypt" {
		t.Errorf("default provider = %q", c.ACMEProvider)
	}

	// Update ACME
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/settings/tls/config/acme", "default",
		map[string]any{"provider": "zerossl", "email": "ops@example.com"}))
	if r2.Code != http.StatusOK {
		t.Fatalf("acme: %d", r2.Code)
	}
	var c2 tlsConfigResponse
	_ = json.NewDecoder(r2.Body).Decode(&c2)
	if c2.ACMEProvider != "zerossl" || c2.ACMEEmail != "ops@example.com" {
		t.Errorf("update didn't stick: %+v", c2)
	}
}
