package gateway

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func openTenantTestStore(t *testing.T) store.Driver {
	t.Helper()
	ctx := context.Background()
	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	if err := drv.Open(ctx, store.DriverConfig{Path: filepath.Join(t.TempDir(), "tenant_mw.db")}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}
	return drv
}

func TestExtractTenantSlug(t *testing.T) {
	cases := []struct {
		path    string
		want    string
		matched bool
	}{
		{"/api/v1/health", "", false},
		{"/api/v1/auth/login", "", false},
		{"/api/v1/t/", "", false},
		{"/api/v1/t/default", "default", true},
		{"/api/v1/t/default/services", "default", true},
		{"/api/v1/t/acme/dashboards/d_1/widgets", "acme", true},
		{"/api/v1/t//services", "", false},
		{"/some/other/path", "", false},
	}
	for _, c := range cases {
		got, ok := extractTenantSlug(c.path)
		if got != c.want || ok != c.matched {
			t.Errorf("extractTenantSlug(%q) = (%q, %t), want (%q, %t)", c.path, got, ok, c.want, c.matched)
		}
	}
}

func TestTenantMiddleware_PassthroughForNonTenantPaths(t *testing.T) {
	drv := openTenantTestStore(t)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if TenantFromContext(r.Context()) != nil {
			t.Error("non-tenant path should not have tenant attached")
		}
	})

	mw := TenantMiddleware(drv)(next)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)
	if !called {
		t.Error("middleware did not call next for non-tenant path")
	}
}

func TestTenantMiddleware_ResolvesDefaultTenant(t *testing.T) {
	drv := openTenantTestStore(t)

	var attached *store.Tenant
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attached = TenantFromContext(r.Context())
	})
	mw := TenantMiddleware(drv)(next)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/t/default/settings/tenant", nil)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if attached == nil {
		t.Fatal("tenant was not attached to context")
	}
	if attached.Slug != "default" {
		t.Errorf("attached tenant slug = %q, want default", attached.Slug)
	}
}

func TestTenantMiddleware_404OnUnknownSlug(t *testing.T) {
	drv := openTenantTestStore(t)

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("middleware should have rejected unknown tenant before reaching handler")
	})
	mw := TenantMiddleware(drv)(next)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/t/nonexistent/services", nil)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404 for unknown tenant slug, got %d", rec.Code)
	}
}

func TestWithTenant_RoundTrip(t *testing.T) {
	want := &store.Tenant{ID: "tenant_x", Slug: "x"}
	ctx := WithTenant(context.Background(), want)
	got := TenantFromContext(ctx)
	if got != want {
		t.Errorf("round-trip: got %+v, want %+v", got, want)
	}
}

// TestTenantMiddleware_PropagatesTenantIDToStoreContext asserts that
// resolving `/api/v1/t/{slug}/...` attaches the tenant id to the
// store-level context key so downstream storage methods automatically
// filter by that tenant.
func TestTenantMiddleware_PropagatesTenantIDToStoreContext(t *testing.T) {
	drv := openTenantTestStore(t)

	var observed string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observed = store.TenantIDFromContext(r.Context())
	})
	mw := TenantMiddleware(drv)(next)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/t/default/dashboards", nil)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	if observed != store.DefaultTenantID {
		t.Errorf("store.TenantIDFromContext = %q, want %q", observed, store.DefaultTenantID)
	}
}
