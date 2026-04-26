package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPlugins_InstallEnableDisableUninstall(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	// Install
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugins/install", "default",
		map[string]any{"slug": "rate-limit", "name": "Rate Limit", "version": "1.0.0"}))
	if r.Code != http.StatusAccepted {
		t.Fatalf("install: %d (%s)", r.Code, r.Body.String())
	}
	var installed pluginResponse
	_ = json.NewDecoder(r.Body).Decode(&installed)
	if installed.BuildState != "building" {
		t.Errorf("BuildState = %q, want building", installed.BuildState)
	}

	// Duplicate install → 409.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugins/install", "default",
		map[string]any{"slug": "rate-limit", "name": "x", "version": "1.0.0"}))
	if r2.Code != http.StatusConflict {
		t.Errorf("dup install: expected 409, got %d", r2.Code)
	}

	// Enable
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugins/"+installed.ID+"/enable", "default", nil))
	if r3.Code != http.StatusOK {
		t.Errorf("enable: %d", r3.Code)
	}
	var enabled pluginResponse
	_ = json.NewDecoder(r3.Body).Decode(&enabled)
	if !enabled.Enabled {
		t.Error("plugin should be enabled after /enable")
	}

	// Disable
	r4 := httptest.NewRecorder()
	mux.ServeHTTP(r4, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugins/"+installed.ID+"/disable", "default", nil))
	if r4.Code != http.StatusOK {
		t.Errorf("disable: %d", r4.Code)
	}

	// Build log
	r5 := httptest.NewRecorder()
	mux.ServeHTTP(r5, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/plugins/"+installed.ID+"/build-log", "default", nil))
	if r5.Code != http.StatusOK {
		t.Errorf("build-log: %d", r5.Code)
	}

	// Uninstall
	r6 := httptest.NewRecorder()
	mux.ServeHTTP(r6, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/plugins/"+installed.ID, "default", nil))
	if r6.Code != http.StatusNoContent {
		t.Errorf("uninstall: %d", r6.Code)
	}
}

func TestPluginSigners_VerifyRevoke(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	// Create
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugin-signers", "default",
		map[string]any{"name": "rioku-team", "fingerprint": "fp:abc123"}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create signer: %d (%s)", r.Code, r.Body.String())
	}
	var signer signerResponse
	_ = json.NewDecoder(r.Body).Decode(&signer)
	if signer.Status != "pending" {
		t.Errorf("initial status = %q, want pending", signer.Status)
	}

	// Verify
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugin-signers/"+signer.ID+"/verify", "default", nil))
	if r2.Code != http.StatusOK {
		t.Fatalf("verify: %d", r2.Code)
	}
	var verified signerResponse
	_ = json.NewDecoder(r2.Body).Decode(&verified)
	if verified.Status != "verified" {
		t.Errorf("after verify: status = %q", verified.Status)
	}

	// Revoke
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugin-signers/"+signer.ID+"/revoke", "default", nil))
	if r3.Code != http.StatusOK {
		t.Errorf("revoke: %d", r3.Code)
	}
	var revoked signerResponse
	_ = json.NewDecoder(r3.Body).Decode(&revoked)
	if revoked.Status != "revoked" {
		t.Errorf("after revoke: status = %q", revoked.Status)
	}
}

func TestPluginSigners_FingerprintConflict(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	body := map[string]any{"name": "team", "fingerprint": "fp:dup"}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugin-signers", "default", body))
	if r.Code != http.StatusCreated {
		t.Fatalf("first: %d", r.Code)
	}
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/plugin-signers", "default",
		map[string]any{"name": "different", "fingerprint": "fp:dup"}))
	if r2.Code != http.StatusConflict {
		t.Errorf("dup fingerprint: expected 409, got %d", r2.Code)
	}
}

func TestPluginSigners_GlobalScope(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPluginRoutes(mux, drv)

	// Global signer via /admin/...
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/admin/plugin-signers", "",
		map[string]any{"name": "rioku-global", "fingerprint": "fp:global"}))
	if r.Code != http.StatusCreated {
		t.Fatalf("global create: %d (%s)", r.Code, r.Body.String())
	}
	var s signerResponse
	_ = json.NewDecoder(r.Body).Decode(&s)
	if s.TenantScope != nil {
		t.Errorf("global signer should have nil TenantScope, got %v", s.TenantScope)
	}

	// Tenant-scoped GET shouldn't see global signer.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/plugin-signers/"+s.ID, "default", nil))
	if r2.Code != http.StatusNotFound {
		t.Errorf("tenant scope shouldn't find global signer, got %d", r2.Code)
	}
}
