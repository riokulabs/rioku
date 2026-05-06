package gateway_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/gateway"
)

// TestPromQLQuery_returns_401_on_unauthenticated verifies that the PromQL
// stub route is registered and that RequirePermission gates unauthenticated
// requests with a 401 + RFC-7807 problem+json response.
//
// RequirePermission checks auth.SessionClaimsFromContext then
// auth.ClaimsFromContext. Both are nil on a plain httptest request
// (no AuthMiddleware in this unit-test mux), so the middleware calls
// writeAuthError → 401 Unauthorized with Content-Type: application/problem+json.
// The stub handler (501) is never reached in this path.
func TestPromQLQuery_returns_401_on_unauthenticated(t *testing.T) {
	mux := http.NewServeMux()
	gateway.RegisterPromQLRoutes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v1/t/acme/promql/query",
		"application/json", strings.NewReader(`{"query":"up"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	// RequirePermission short-circuits with 401 because the test request
	// has no session context. The route IS wired — if it were missing,
	// the mux would return 405 (wrong method) or 404.
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (RequirePermission blocks unauthenticated)", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "problem+json") {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
}
