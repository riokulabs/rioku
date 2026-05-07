package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

// TestTenantIdentity_ReturnsExpectedFields verifies the resolver returns
// id/slug/name and omits sensitive metadata (plan, urlMode, accent, etc.).
func TestTenantIdentity_ReturnsExpectedFields(t *testing.T) {
	t.Parallel()
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantIdentityRoutes(mux, drv)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/identity", "default", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	var resp tenantIdentityResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ID == "" {
		t.Errorf("missing id")
	}
	if resp.Slug != "default" {
		t.Errorf("slug = %q, want %q", resp.Slug, "default")
	}
	if resp.Name == "" {
		t.Errorf("missing name")
	}

	// Sensitive fields must not leak. Re-decode raw to verify.
	var raw map[string]any
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/identity", "default", nil))
	_ = json.NewDecoder(rec2.Body).Decode(&raw)
	for _, banned := range []string{"plan", "urlMode", "accent", "logoUrl", "defaultDashboardId", "createdAt", "updatedAt"} {
		if _, present := raw[banned]; present {
			t.Errorf("identity response leaked field %q: %+v", banned, raw)
		}
	}
}

// TestTenantIdentity_IncludesParentDomainWhenSet asserts that ParentDomain
// is surfaced when the tenant has one, and omitted (omitempty) when empty.
func TestTenantIdentity_IncludesParentDomainWhenSet(t *testing.T) {
	t.Parallel()
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantIdentityRoutes(mux, drv)

	// Create a tenant with a parent domain via the store directly.
	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	tn, err := tx.CreateTenant(ctx, &store.Tenant{
		Slug: "subby", Name: "Subby Co", Plan: "community",
		URLMode: "subdomain", ParentDomain: "example.com",
	})
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	_ = tn

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/subby/identity", "subby", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var resp tenantIdentityResponse
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	if resp.ParentDomain != "example.com" {
		t.Errorf("parentDomain = %q, want %q", resp.ParentDomain, "example.com")
	}
	if resp.Slug != "subby" || resp.Name != "Subby Co" {
		t.Errorf("identity = %+v", resp)
	}

	// And confirm omitempty semantics: a tenant with no parent_domain
	// must serialise without the field.
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/identity", "default", nil))
	var raw map[string]any
	_ = json.NewDecoder(rec2.Body).Decode(&raw)
	if _, present := raw["parentDomain"]; present {
		t.Errorf("expected parentDomain omitted when empty, got: %+v", raw)
	}
}

// TestTenantIdentity_RejectsUnauthenticated asserts the handler refuses
// to leak metadata when no SessionClaims / Bearer claims are attached.
// In production AuthMiddleware would already have rejected the request;
// this test exercises the belt-and-braces 401 inside the handler.
func TestTenantIdentity_RejectsUnauthenticated(t *testing.T) {
	t.Parallel()
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantIdentityRoutes(mux, drv)

	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	tn, err := tx.GetTenantBySlug(ctx, "default")
	_ = tx.Rollback()
	if err != nil {
		t.Fatalf("resolve default tenant: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/t/default/identity", nil)
	// Attach the resolved tenant but NO auth claims.
	req = req.WithContext(WithTenant(req.Context(), tn))

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without auth claims, got %d", rec.Code)
	}
}

// TestTenantIdentity_BearerClaimsAccepted ensures that a bearer-token
// authenticated caller (no SessionClaims, only legacy Claims) is also
// allowed through — the handler must not require session cookie auth.
func TestTenantIdentity_BearerClaimsAccepted(t *testing.T) {
	t.Parallel()
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantIdentityRoutes(mux, drv)

	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	tn, err := tx.GetTenantBySlug(ctx, "default")
	_ = tx.Rollback()
	if err != nil {
		t.Fatalf("resolve default tenant: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/t/default/identity", nil)
	rctx := WithTenant(req.Context(), tn)
	rctx = auth.WithClaims(rctx, &auth.Claims{Subject: "api-key-user", TokenType: auth.TokenTypeAccess})
	req = req.WithContext(rctx)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 with bearer claims, got %d (%s)", rec.Code, rec.Body.String())
	}
}
