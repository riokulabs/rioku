// Package gateway: tenant resolution middleware (stage-2).
//
// Every tenant-scoped endpoint lives under `/api/v1/t/{tenant}/...`.
// The middleware below extracts the `{tenant}` path segment, resolves
// it against the tenants table by slug, attaches the resolved Tenant
// to the request context, and writes a typed RFC 7807 error when the
// slug doesn't exist.
//
// Handlers downstream pull the tenant via TenantFromContext.
//
// Routes that don't match `/api/v1/t/{tenant}/...` (auth, super-admin,
// SPA assets, etc.) pass through untouched — the middleware is
// purely additive and never blocks unrelated traffic.
package gateway

import (
	"context"
	"net/http"
	"strings"

	"github.com/riokulabs/rioku/internal/store"
)

// tenantContextKey is the typed key used to attach a *store.Tenant to
// the request context. Defining a private type prevents collision
// with any other context key in the codebase.
type tenantContextKey struct{}

// TenantFromContext returns the resolved tenant for the current request,
// or nil if the route is not tenant-scoped.
func TenantFromContext(ctx context.Context) *store.Tenant {
	v, _ := ctx.Value(tenantContextKey{}).(*store.Tenant)
	return v
}

// WithTenant attaches a tenant to the context. Used by tests and the
// middleware itself.
func WithTenant(ctx context.Context, t *store.Tenant) context.Context {
	return context.WithValue(ctx, tenantContextKey{}, t)
}

// TenantMiddleware extracts `{tenant}` from `/api/v1/t/{tenant}/...`,
// resolves it via the store, and attaches it to the context. When the
// slug doesn't resolve, the middleware writes a 404 RFC 7807 problem
// — the route effectively doesn't exist for that caller.
//
// Routes that don't start with `/api/v1/t/` pass through with no
// resolution attempt. This means single-tenant legacy endpoints
// (`/api/v1/health`, `/api/v1/auth/login`, etc.) keep working
// unmodified during the transition window.
func TenantMiddleware(st store.Driver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			slug, ok := extractTenantSlug(r.URL.Path)
			if !ok {
				next.ServeHTTP(w, r)
				return
			}

			tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
			if err != nil {
				writeProblem(w, http.StatusInternalServerError, errTypeInternal,
					"Internal error", "Failed to resolve tenant", r.URL.Path, nil)
				return
			}
			tenant, err := tx.GetTenantBySlug(r.Context(), slug)
			_ = tx.Rollback()
			if err != nil {
				if err == store.ErrTenantNotFound {
					writeProblem(w, http.StatusNotFound, errTypeNotFound,
						"Tenant not found",
						"No tenant exists with slug "+slug,
						r.URL.Path, nil)
					return
				}
				writeProblem(w, http.StatusInternalServerError, errTypeInternal,
					"Internal error", "Failed to resolve tenant", r.URL.Path, nil)
				return
			}

			ctx := WithTenant(r.Context(), tenant)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// extractTenantSlug returns the `{tenant}` segment of paths shaped like
// `/api/v1/t/{tenant}/...`. Returns ("", false) for any other path.
//
// Trailing-slash and short-path edge cases (`/api/v1/t`, `/api/v1/t/`)
// also return false — those are malformed and the request will 404
// from the mux.
func extractTenantSlug(path string) (string, bool) {
	const prefix = "/api/v1/t/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	rest := path[len(prefix):]
	// Slug is the substring up to the next '/' (or end of string).
	slash := strings.IndexByte(rest, '/')
	if slash < 0 {
		// `/api/v1/t/{slug}` with no trailing slash and no further path.
		// Still resolve so callers can target tenant-level endpoints.
		if rest == "" {
			return "", false
		}
		return rest, true
	}
	if slash == 0 {
		return "", false
	}
	return rest[:slash], true
}
