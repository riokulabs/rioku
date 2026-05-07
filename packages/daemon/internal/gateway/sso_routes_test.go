package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/store"
)

// helper: POST a create body and return the parsed response.
func ssoCreate(t *testing.T, mux *http.ServeMux, drv store.Driver, slug string, body map[string]any) (int, ssoProviderResponse) {
	t.Helper()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/"+slug+"/sso/providers", slug, body))
	var resp ssoProviderResponse
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	return rec.Code, resp
}

func TestSsoProviders_CreateValidationsAndDefaults(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSsoRoutes(mux, drv)

	cases := []struct {
		name string
		body map[string]any
		want int
	}{
		{"missing-name", map[string]any{"kind": "oidc"}, http.StatusBadRequest},
		{"missing-kind", map[string]any{"name": "okta"}, http.StatusBadRequest},
		{"unknown-kind", map[string]any{"name": "okta", "kind": "wat"}, http.StatusBadRequest},
		{"oidc-missing-issuer", map[string]any{"name": "okta", "kind": "oidc",
			"oidcClientId": "abc"}, http.StatusBadRequest},
		{"oidc-missing-client-id", map[string]any{"name": "okta", "kind": "oidc",
			"oidcIssuer": "https://idp.example.com"}, http.StatusBadRequest},
		{"saml-without-oidc-fields-allowed", map[string]any{"name": "ent", "kind": "saml"}, http.StatusCreated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, _ := ssoCreate(t, mux, drv, "default", tc.body)
			if code != tc.want {
				t.Errorf("status = %d, want %d", code, tc.want)
			}
		})
	}
}

func TestSsoProviders_FullCRUDLifecycle(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSsoRoutes(mux, drv)

	// Create
	code, p := ssoCreate(t, mux, drv, "default", map[string]any{
		"name":         "okta-prod",
		"kind":         "oidc",
		"oidcIssuer":   "https://riokulabs.okta.com",
		"oidcClientId": "0oa-rioku-prod",
		"oidcScopes":   []string{"openid", "profile", "email"},
		"claimsMapping": map[string]string{
			"sub":   "preferred_username",
			"email": "email",
		},
	})
	if code != http.StatusCreated {
		t.Fatalf("create: status = %d", code)
	}
	if p.ID == "" || p.Name != "okta-prod" || p.Kind != "oidc" || !p.Enabled {
		t.Fatalf("create: unexpected response %+v", p)
	}
	// JSON columns round-trip
	if string(p.OIDCScopes) == "" || string(p.OIDCScopes) == "null" {
		t.Errorf("oidcScopes empty: %s", string(p.OIDCScopes))
	}
	if p.OIDCIssuer == nil || *p.OIDCIssuer != "https://riokulabs.okta.com" {
		t.Errorf("oidcIssuer: got %v", p.OIDCIssuer)
	}

	// Duplicate name → 409
	code2, _ := ssoCreate(t, mux, drv, "default", map[string]any{
		"name": "okta-prod", "kind": "oidc",
		"oidcIssuer": "https://x", "oidcClientId": "y",
	})
	if code2 != http.StatusConflict {
		t.Errorf("dup name: got %d, want 409", code2)
	}

	// List → 1 item
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/sso/providers", "default", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}
	var list struct {
		Items []ssoProviderResponse `json:"items"`
		Total int                   `json:"total"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&list)
	if list.Total != 1 || len(list.Items) != 1 {
		t.Errorf("list: total=%d items=%d, want 1/1", list.Total, len(list.Items))
	}

	// Get one
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/sso/providers/"+p.ID, "default", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("get: %d", rec.Code)
	}

	// Patch: rename + disable
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPatch,
		"/api/v1/t/default/sso/providers/"+p.ID, "default",
		map[string]any{"name": "okta-prod-v2", "enabled": false}))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch: %d (%s)", rec.Code, rec.Body.String())
	}
	var updated ssoProviderResponse
	_ = json.NewDecoder(rec.Body).Decode(&updated)
	if updated.Name != "okta-prod-v2" || updated.Enabled {
		t.Errorf("patch: name=%q enabled=%v, want okta-prod-v2/false", updated.Name, updated.Enabled)
	}

	// Patch with bad kind → 400
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPatch,
		"/api/v1/t/default/sso/providers/"+p.ID, "default",
		map[string]any{"kind": "carrier-pigeon"}))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("patch bad kind: %d, want 400", rec.Code)
	}

	// Patch unknown id → 404
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPatch,
		"/api/v1/t/default/sso/providers/sso_nope", "default",
		map[string]any{"enabled": true}))
	if rec.Code != http.StatusNotFound {
		t.Errorf("patch unknown: %d, want 404", rec.Code)
	}

	// Delete
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/sso/providers/"+p.ID, "default", nil))
	if rec.Code != http.StatusNoContent {
		t.Errorf("delete: %d", rec.Code)
	}
	// Delete again → 404
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/sso/providers/"+p.ID, "default", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("delete-twice: %d, want 404", rec.Code)
	}
}

func TestSsoProviders_AuditEmittedOnMutations(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSsoRoutes(mux, drv)

	code, p := ssoCreate(t, mux, drv, "default", map[string]any{
		"name": "audited", "kind": "oidc",
		"oidcIssuer": "https://idp.example.com", "oidcClientId": "abc",
	})
	if code != http.StatusCreated {
		t.Fatalf("create: %d", code)
	}

	// Update + delete to push three audit rows total.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPatch,
		"/api/v1/t/default/sso/providers/"+p.ID, "default",
		map[string]any{"enabled": false}))
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/sso/providers/"+p.ID, "default", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}

	// Audit rows present
	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryAuditLog(ctx, store.AuditQuery{Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog: %v", err)
	}
	ops := map[string]int{}
	for _, e := range rows {
		if e.GetPayloadSchema() == "auth.sso_provider_changed.v1" && e.GetEntityId() == p.ID {
			ops[e.GetOperation()]++
		}
	}
	for _, op := range []string{"create", "update", "delete"} {
		if ops[op] != 1 {
			t.Errorf("audit op %q: got %d, want 1 (all=%v)", op, ops[op], ops)
		}
	}
}

func TestSsoProviders_RBACDenialWithoutPermission(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSsoRoutes(mux, drv)

	// Issue an unauthenticated request → 401/403.
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet,
		"/api/v1/t/default/sso/providers", strings.NewReader(""))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
		t.Errorf("unauth list: got %d, want 401/403", rec.Code)
	}
}

func TestSsoProviders_CrossTenantIsolation(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSsoRoutes(mux, drv)

	// Seed a second tenant directly via the store so we can exercise
	// the cross-tenant lookup boundary.
	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	other, err := tx.CreateTenant(ctx, &store.Tenant{Slug: "other", Name: "Other"})
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit tenant: %v", err)
	}

	// Create a provider in the default tenant.
	code, p := ssoCreate(t, mux, drv, "default", map[string]any{
		"name": "isolated", "kind": "oidc",
		"oidcIssuer": "https://idp.example.com", "oidcClientId": "abc",
	})
	if code != http.StatusCreated {
		t.Fatalf("create default: %d", code)
	}

	// Listing the *other* tenant must NOT include the default's row.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/other/sso/providers", "other", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list other: %d (%s)", rec.Code, rec.Body.String())
	}
	var list struct {
		Items []ssoProviderResponse `json:"items"`
		Total int                   `json:"total"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&list)
	if list.Total != 0 {
		t.Errorf("cross-tenant leak: other tenant sees %d items, want 0", list.Total)
	}

	// Direct GET of the default-tenant provider id under the other
	// tenant must 404 — must not return the row.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/other/sso/providers/"+p.ID, "other", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("cross-tenant get: got %d, want 404", rec.Code)
	}

	// Same for delete.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/other/sso/providers/"+p.ID, "other", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("cross-tenant delete: got %d, want 404", rec.Code)
	}

	_ = other // referenced for clarity; the slug arg drives tenant resolution.
}
