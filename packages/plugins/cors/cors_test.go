package cors

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

// nextNoOp is the trailing handler for ServeHTTP; it sets a marker
// header and a 200 so tests can confirm the CORS module forwarded the
// request rather than short-circuiting it.
var nextNoOp = caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("X-Test-Forwarded", "yes")
	w.WriteHeader(http.StatusOK)
	return nil
})

func provisioned(t *testing.T, c *CORS) {
	t.Helper()
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := c.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func TestCORS_SimpleGET_AllowedOrigin(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{"https://app.example.com"}}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("X-Test-Forwarded") != "yes" {
		t.Fatal("next handler was not invoked")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("Allow-Origin = %q, want exact echo", got)
	}
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Origin") {
		t.Fatalf("Vary = %q, want it to include Origin", got)
	}
}

func TestCORS_SimpleGET_DisallowedOrigin(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{"https://app.example.com"}}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (request should still pass through)", rec.Code)
	}
	if rec.Header().Get("X-Test-Forwarded") != "yes" {
		t.Fatal("next handler was not invoked for non-matching origin")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin = %q, want empty for non-matching origin", got)
	}
}

func TestCORS_NoOriginHeader_PassesThroughWithoutCORS(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{"https://app.example.com"}}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("Allow-Origin should be unset when no Origin header present")
	}
	if rec.Header().Get("X-Test-Forwarded") != "yes" {
		t.Fatal("next handler was not invoked")
	}
}

func TestCORS_Wildcard_AllowsAnyOrigin(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{"*"}}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Header.Set("Origin", "https://random.example.com")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Allow-Origin = %q, want * when wildcard configured", got)
	}
}

func TestCORS_Preflight_AllowedOrigin(t *testing.T) {
	c := &CORS{
		AllowedOrigins: []string{"https://app.example.com"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		MaxAgeSeconds:  3600,
	}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodOptions, "http://x/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "PUT")
	req.Header.Set("Access-Control-Request-Headers", "X-Custom, Authorization")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if rec.Header().Get("X-Test-Forwarded") != "" {
		t.Fatal("next handler was invoked on preflight; expected short-circuit")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("Allow-Origin = %q, want exact echo", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got != "PUT" {
		t.Fatalf("Allow-Methods = %q, want PUT (echoed when allowed)", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got != "X-Custom, Authorization" {
		t.Fatalf("Allow-Headers = %q, want reflected request headers", got)
	}
	if got := rec.Header().Get("Access-Control-Max-Age"); got != "3600" {
		t.Fatalf("Max-Age = %q, want 3600", got)
	}
}

func TestCORS_Preflight_RejectedMethod_StillReturns204(t *testing.T) {
	// When the requested method is not in the allow-list the
	// handler emits the configured Allow-Methods list rather than
	// echoing the requested method. The browser then sees the
	// mismatch and blocks the actual request.
	c := &CORS{
		AllowedOrigins: []string{"https://app.example.com"},
		AllowedMethods: []string{"GET", "POST"},
	}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodOptions, "http://x/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "DELETE")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	got := rec.Header().Get("Access-Control-Allow-Methods")
	if got != "GET, POST" {
		t.Fatalf("Allow-Methods = %q, want configured list when requested method not allowed", got)
	}
	if strings.Contains(got, "DELETE") {
		t.Fatalf("Allow-Methods = %q, must not advertise the rejected DELETE method", got)
	}
}

func TestCORS_Preflight_DisallowedOrigin_NoCORSHeaders(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{"https://app.example.com"}}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodOptions, "http://x/", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	req.Header.Set("Access-Control-Request-Method", "GET")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 even for non-matching origin", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("Allow-Origin should not be set for non-matching origin on preflight")
	}
	if rec.Header().Get("Access-Control-Allow-Methods") != "" {
		t.Fatal("Allow-Methods should not be set for non-matching origin on preflight")
	}
}

func TestCORS_Preflight_MaxAgeDefault(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{"https://app.example.com"}}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodOptions, "http://x/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "GET")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if got := rec.Header().Get("Access-Control-Max-Age"); got != "600" {
		t.Fatalf("Max-Age = %q, want 600 (default)", got)
	}
}

func TestCORS_Preflight_AllowedHeadersConfigured_OverridesRequest(t *testing.T) {
	c := &CORS{
		AllowedOrigins: []string{"https://app.example.com"},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
	}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodOptions, "http://x/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "X-Sneaky-Header")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	got := rec.Header().Get("Access-Control-Allow-Headers")
	if got != "Authorization, Content-Type" {
		t.Fatalf("Allow-Headers = %q, want configured list (not request reflection)", got)
	}
}

func TestCORS_Provision_DefaultMethods(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{"https://app.example.com"}}
	provisioned(t, c)

	want := []string{"GET", "HEAD", "POST", "OPTIONS"}
	if len(c.AllowedMethods) != len(want) {
		t.Fatalf("AllowedMethods len = %d, want %d", len(c.AllowedMethods), len(want))
	}
	for i, m := range want {
		if c.AllowedMethods[i] != m {
			t.Fatalf("AllowedMethods[%d] = %q, want %q", i, c.AllowedMethods[i], m)
		}
	}
}

func TestCORS_Provision_RejectsCredentialsWithWildcard(t *testing.T) {
	c := &CORS{
		AllowedOrigins:   []string{"*"},
		AllowCredentials: true,
	}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	defer cancel()
	if err := c.Provision(ctx); err == nil {
		t.Fatal("expected provision error for wildcard + credentials")
	}
}

func TestCORS_Provision_RejectsEmptyOrigins(t *testing.T) {
	c := &CORS{}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	defer cancel()
	if err := c.Provision(ctx); err == nil {
		t.Fatal("expected provision error for empty allowed_origins")
	}
}

func TestCORS_Provision_RejectsBlankOnlyOrigins(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{"", "   "}}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	defer cancel()
	if err := c.Provision(ctx); err == nil {
		t.Fatal("expected provision error when allowed_origins is only blanks")
	}
}

func TestCORS_Provision_RejectsNegativeMaxAge(t *testing.T) {
	c := &CORS{
		AllowedOrigins: []string{"https://app.example.com"},
		MaxAgeSeconds:  -1,
	}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	defer cancel()
	if err := c.Provision(ctx); err == nil {
		t.Fatal("expected provision error for negative max_age_seconds")
	}
}

func TestCORS_ExposeHeaders_PassedThrough(t *testing.T) {
	c := &CORS{
		AllowedOrigins: []string{"https://app.example.com"},
		ExposeHeaders:  []string{"X-Request-ID", "X-Rioku-Trace"},
	}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	got := rec.Header().Get("Access-Control-Expose-Headers")
	if got != "X-Request-ID, X-Rioku-Trace" {
		t.Fatalf("Expose-Headers = %q, want configured list", got)
	}
}

func TestCORS_ExposeHeaders_NotSentWhenOriginRejected(t *testing.T) {
	c := &CORS{
		AllowedOrigins: []string{"https://app.example.com"},
		ExposeHeaders:  []string{"X-Request-ID"},
	}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Header().Get("Access-Control-Expose-Headers") != "" {
		t.Fatal("Expose-Headers must not be set for non-matching origin")
	}
}

func TestCORS_AllowCredentials_EchoesOriginNotWildcard(t *testing.T) {
	c := &CORS{
		AllowedOrigins:   []string{"https://app.example.com"},
		AllowCredentials: true,
	}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("Allow-Origin = %q, want exact echo", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Allow-Credentials = %q, want true", got)
	}
}

func TestCORS_OptionsWithoutRequestMethod_TreatedAsSimpleRequest(t *testing.T) {
	// An OPTIONS request without Access-Control-Request-Method is
	// not a CORS preflight (e.g., a tooling probe). It should fall
	// through to the next handler like any other request.
	c := &CORS{AllowedOrigins: []string{"https://app.example.com"}}
	provisioned(t, c)

	req := httptest.NewRequest(http.MethodOptions, "http://x/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rec := httptest.NewRecorder()

	if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Header().Get("X-Test-Forwarded") != "yes" {
		t.Fatal("next handler should be invoked for non-preflight OPTIONS")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (next handler set it)", rec.Code)
	}
}

func TestCORS_MultipleAllowedOrigins_MatchesEach(t *testing.T) {
	c := &CORS{AllowedOrigins: []string{
		"https://a.example.com",
		"https://b.example.com",
	}}
	provisioned(t, c)

	for _, origin := range []string{"https://a.example.com", "https://b.example.com"} {
		req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		if err := c.ServeHTTP(rec, req, nextNoOp); err != nil {
			t.Fatalf("ServeHTTP(%s): %v", origin, err)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Fatalf("Allow-Origin for %s = %q, want exact echo", origin, got)
		}
	}
}
