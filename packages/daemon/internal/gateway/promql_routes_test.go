package gateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestPromQLQuery_returns_401_on_unauthenticated verifies that the PromQL
// proxy route is registered and that RequirePermission gates unauthenticated
// requests with a 401 + RFC-7807 problem+json response.
func TestPromQLQuery_returns_401_on_unauthenticated(t *testing.T) {
	mux := http.NewServeMux()
	RegisterPromQLRoutes(mux, nil)
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

// ─── Label injection unit tests ───────────────────────────────────────────────

func TestInjectTenantLabel_bare_metric(t *testing.T) {
	got, err := injectTenantLabel("up", "acme")
	if err != nil {
		t.Fatal(err)
	}
	want := `up{tenant_id="acme"}`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestInjectTenantLabel_metric_with_labels(t *testing.T) {
	got, err := injectTenantLabel(`http_requests_total{job="api"}`, "acme")
	if err != nil {
		t.Fatal(err)
	}
	want := `http_requests_total{job="api",tenant_id="acme"}`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestInjectTenantLabel_empty_selector(t *testing.T) {
	got, err := injectTenantLabel(`http_requests_total{}`, "acme")
	if err != nil {
		t.Fatal(err)
	}
	want := `http_requests_total{tenant_id="acme"}`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestInjectTenantLabel_standalone_selector(t *testing.T) {
	got, err := injectTenantLabel(`{job="api"}`, "acme")
	if err != nil {
		t.Fatal(err)
	}
	want := `{job="api",tenant_id="acme"}`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestInjectTenantLabel_aggregate_function(t *testing.T) {
	got, err := injectTenantLabel(`sum(up) by (job)`, "acme")
	if err != nil {
		t.Fatal(err)
	}
	// 'up' gets injected; 'sum', 'by' are keywords and skipped
	if !strings.Contains(got, `up{tenant_id="acme"}`) {
		t.Errorf("expected 'up' to be rewritten, got %q", got)
	}
}

func TestInjectTenantLabel_existing_correct_tenant(t *testing.T) {
	// Pre-existing tenant_id with correct value is allowed unchanged.
	query := `up{tenant_id="acme"}`
	got, err := injectTenantLabel(query, "acme")
	if err != nil {
		t.Fatal(err)
	}
	// Should not double-inject.
	count := strings.Count(got, `tenant_id=`)
	if count != 1 {
		t.Errorf("expected exactly one tenant_id, got %d in %q", count, got)
	}
}

func TestInjectTenantLabel_existing_wrong_tenant_rejected(t *testing.T) {
	// Cross-tenant attempt: tenant_id with a different value must be rejected.
	query := `up{tenant_id="other-tenant"}`
	_, err := injectTenantLabel(query, "acme")
	if err == nil {
		t.Error("expected error for mismatched tenant_id, got nil")
	}
}

func TestInjectTenantLabel_rate_function(t *testing.T) {
	got, err := injectTenantLabel(`rate(http_requests_total{job="api"}[5m])`, "acme")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `tenant_id="acme"`) {
		t.Errorf("expected tenant_id injection, got %q", got)
	}
	if !strings.Contains(got, "rate(") {
		t.Errorf("expected rate( to be preserved, got %q", got)
	}
}

func TestInjectTenantLabel_multiple_metrics(t *testing.T) {
	got, err := injectTenantLabel(`up + http_requests_total`, "acme")
	if err != nil {
		t.Fatal(err)
	}
	count := strings.Count(got, `tenant_id="acme"`)
	if count != 2 {
		t.Errorf("expected 2 tenant_id injections, got %d in %q", count, got)
	}
}

// ─── Bypass validation tests ──────────────────────────────────────────────────

func TestValidatePromQL_rejects_name_matcher(t *testing.T) {
	err := validatePromQL(`{__name__=~".+"}`)
	if err == nil {
		t.Error("expected rejection of __name__ matcher, got nil")
	}
}

func TestValidatePromQL_rejects_label_replace(t *testing.T) {
	err := validatePromQL(`label_replace(up, "tenant_id", "evil", "job", "(.*)")`)
	if err == nil {
		t.Error("expected rejection of label_replace, got nil")
	}
}

func TestValidatePromQL_rejects_label_join(t *testing.T) {
	err := validatePromQL(`label_join(up, "tenant_id", ",", "job")`)
	if err == nil {
		t.Error("expected rejection of label_join, got nil")
	}
}

func TestValidatePromQL_allows_normal_query(t *testing.T) {
	if err := validatePromQL(`rate(http_requests_total{job="api"}[5m])`); err != nil {
		t.Errorf("expected nil error for valid query, got %v", err)
	}
}

func TestValidatePromQL_allows_aggregate(t *testing.T) {
	if err := validatePromQL(`sum(up) by (job)`); err != nil {
		t.Errorf("expected nil error for aggregate query, got %v", err)
	}
}

// TestPromQLQuery_rejects_bypass verifies the HTTP handler returns 400
// for bypass-pattern queries when called with a valid session.
func TestPromQLQuery_rejects_bypass(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPromQLRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/promql/query", "default",
		map[string]any{"query": `{__name__=~".+"}`})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for bypass query", rec.Code)
	}
}

// ─── AST-based edge cases (label_replace, on/ignoring, string literals) ─────

// TestInjectTenantLabel_label_replace_targeting_tenant_id_rejected verifies
// that label_replace cannot rewrite the tenant_id label even if used as
// destination.
func TestInjectTenantLabel_label_replace_targeting_tenant_id_rejected(t *testing.T) {
	queries := []string{
		`label_replace(up, "tenant_id", "$1", "tenant_id", "(.*)")`,
		`label_replace(up, "tenant_id", "evil", "job", "(.*)")`,
		// As source label too — escaping the tenant constraint.
		`label_replace(up, "leaked", "$1", "tenant_id", "(.*)")`,
	}
	for _, q := range queries {
		_, err := injectTenantLabel(q, "acme")
		if err == nil {
			t.Errorf("expected rejection for %q, got nil", q)
		}
	}
}

// TestInjectTenantLabel_label_join_targeting_tenant_id_rejected verifies
// label_join cannot use tenant_id as destination/source label.
func TestInjectTenantLabel_label_join_targeting_tenant_id_rejected(t *testing.T) {
	queries := []string{
		`label_join(up, "tenant_id", ",", "job")`,
		`label_join(up, "merged", ",", "tenant_id", "job")`,
	}
	for _, q := range queries {
		_, err := injectTenantLabel(q, "acme")
		if err == nil {
			t.Errorf("expected rejection for %q, got nil", q)
		}
	}
}

// TestInjectTenantLabel_vector_matching_on_tenant_id_rejected verifies
// `on(tenant_id)` and `ignoring(tenant_id)` are rejected to prevent
// cross-tenant joins.
func TestInjectTenantLabel_vector_matching_on_tenant_id_rejected(t *testing.T) {
	queries := []string{
		`up * on(tenant_id) http_requests_total`,
		`up * ignoring(tenant_id) http_requests_total`,
		`up * on(job) group_left(tenant_id) http_requests_total`,
	}
	for _, q := range queries {
		_, err := injectTenantLabel(q, "acme")
		if err == nil {
			t.Errorf("expected rejection for %q, got nil", q)
		}
	}
}

// TestInjectTenantLabel_string_literal_with_fake_matcher verifies that a
// string literal containing the substring `tenant_id="other"` does not fool
// the rewriter — the AST is structural so a quoted string can't escape.
func TestInjectTenantLabel_string_literal_with_fake_matcher(t *testing.T) {
	// label_replace uses string literal arguments. Since label_replace itself
	// is rejected when targeting tenant_id, we confirm a non-tenant-targeted
	// label_replace is still allowed AND that tenant_id is correctly injected
	// into the inner VectorSelector.
	q := `label_replace(up, "renamed", "$1", "job", "(.*)")`
	got, err := injectTenantLabel(q, "acme")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !strings.Contains(got, `tenant_id="acme"`) {
		t.Errorf("expected tenant_id injection, got %q", got)
	}
}

// TestInjectTenantLabel_subquery verifies tenant injection traverses into
// subquery expressions.
func TestInjectTenantLabel_subquery(t *testing.T) {
	got, err := injectTenantLabel(`max_over_time(rate(http_requests_total[5m])[10m:1m])`, "acme")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !strings.Contains(got, `tenant_id="acme"`) {
		t.Errorf("expected tenant_id injection inside subquery, got %q", got)
	}
}

// TestInjectTenantLabel_negative_name_matcher_rejected verifies regex-based
// __name__ matchers are rejected (a label-only selector with __name__=~"..."
// would otherwise sidestep the per-metric tenant rewrite).
func TestInjectTenantLabel_negative_name_matcher_rejected(t *testing.T) {
	queries := []string{
		`{__name__=~".+"}`,
		`{__name__!="up"}`,
		`{__name__!~"foo.*"}`,
	}
	for _, q := range queries {
		_, err := injectTenantLabel(q, "acme")
		if err == nil {
			t.Errorf("expected rejection for %q, got nil", q)
		}
	}
}

// TestInjectTenantLabel_invalid_promql_rejected verifies syntactically
// invalid PromQL queries are rejected with a clear error rather than being
// passed through unchanged.
func TestInjectTenantLabel_invalid_promql_rejected(t *testing.T) {
	_, err := injectTenantLabel(`up{`, "acme")
	if err == nil {
		t.Error("expected rejection of invalid PromQL, got nil")
	}
}

// TestPromQLQuery_rejects_empty_query verifies 400 for missing query field.
func TestPromQLQuery_rejects_empty_query(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterPromQLRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/promql/query", "default",
		map[string]any{"query": ""})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for empty query", rec.Code)
	}
}
