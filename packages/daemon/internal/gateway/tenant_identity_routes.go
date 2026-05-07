// Package gateway: tenant identity resolver (stage-2 plan-17a).
//
// `GET /api/v1/t/{tenant}/identity` returns the minimum tenant
// metadata SPA surfaces need when they hold only a tenant id (or
// slug) and want a human-friendly slug/name for display. It does
// not require any special permission — being authenticated within
// the tenant via TenantMiddleware + AuthMiddleware is sufficient.
//
// Closes #239.
package gateway

import (
	"net/http"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterTenantIdentityRoutes wires the lightweight identity resolver.
// The route is not gated by RequirePermission because:
//   - AuthMiddleware has already established a valid session/bearer.
//   - TenantMiddleware has already verified the tenant slug resolves.
//
// Returning {id, slug, name, parentDomain?} for a tenant the caller
// is already inside reveals nothing they can't infer from their own
// session. This avoids the chicken-and-egg of needing tenant:read
// just to render the slug next to a tenant id everywhere.
func RegisterTenantIdentityRoutes(mux *http.ServeMux, _ store.Driver) {
	mux.HandleFunc("GET /api/v1/t/{tenant}/identity", handleTenantIdentity)
}

// tenantIdentityResponse is the lean DTO returned by the resolver.
// It deliberately omits sensitive fields like plan, urlMode, accent,
// and timestamps. ParentDomain is included because the SPA uses it
// for cookie-domain hints when constructing cross-subdomain links.
type tenantIdentityResponse struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	ParentDomain string `json:"parentDomain,omitempty"`
}

func handleTenantIdentity(w http.ResponseWriter, r *http.Request) {
	// AuthMiddleware ran before this handler; if the caller wasn't
	// authenticated they would have been rejected at /api/v1/* already.
	// Belt-and-braces: re-check claims so the resolver can never leak
	// even minimal metadata to an unauthenticated request that somehow
	// slipped past skipAuthPaths.
	sc := auth.SessionClaimsFromContext(r.Context())
	bc := auth.ClaimsFromContext(r.Context())
	if sc == nil && bc == nil {
		writeProblem(w, http.StatusUnauthorized, errTypeUnauth,
			"Authentication required",
			"Tenant identity is only resolvable inside an authenticated session",
			r.URL.Path, nil)
		return
	}

	tenant, ok := tenantOrError(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, tenantIdentityResponse{
		ID:           tenant.ID,
		Slug:         tenant.Slug,
		Name:         tenant.Name,
		ParentDomain: tenant.ParentDomain,
	})
}
