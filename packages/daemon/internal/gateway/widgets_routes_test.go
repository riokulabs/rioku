package gateway

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// TestWidgetQuery_unauthenticated_returns_401 verifies the route is wired
// behind RequirePermission.
func TestWidgetQuery_unauthenticated_returns_401(t *testing.T) {
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v1/t/acme/widgets/query",
		"application/json", strings.NewReader(`{"type":"instant","expr":"up"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "problem+json") {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
}

// TestWidgetQuery_invalid_json_returns_400 verifies the body parser surfaces
// 400 rather than panicking on malformed input.
func TestWidgetQuery_invalid_json_returns_400(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default", nil)
	req.Body = io.NopCloser(strings.NewReader(`{not json`))
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// TestWidgetQuery_unknown_type_returns_400 verifies type validation.
func TestWidgetQuery_unknown_type_returns_400(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default",
		map[string]any{"type": "wat", "expr": "up"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for unknown query type", rec.Code)
	}
}

// TestWidgetQuery_instant_empty_expr_returns_400 verifies expr validation.
func TestWidgetQuery_instant_empty_expr_returns_400(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default",
		map[string]any{"type": "instant", "expr": ""})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// TestWidgetQuery_series_empty_match_returns_400 verifies match[] validation.
func TestWidgetQuery_series_empty_match_returns_400(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default",
		map[string]any{"type": "series", "match": []string{}})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// ─── Tenant-isolation bypass attempts ─────────────────────────────────────────
//
// Each table entry asserts that the handler returns 400 (the request is
// malformed, not unauthorized — the user is allowed to query, just not
// across tenant boundaries). 403 would be wrong: from the auth layer's
// perspective, the user has dashboard:read; the rejection is a query-shape
// violation.

func TestWidgetQuery_rejects_bypass_attempts(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	cases := []struct {
		name string
		body map[string]any
	}{
		{
			name: "label_replace_targeting_tenant_id",
			body: map[string]any{
				"type": "instant",
				"expr": `label_replace(up, "tenant_id", "evil", "job", "(.*)")`,
			},
		},
		{
			name: "label_join_targeting_tenant_id",
			body: map[string]any{
				"type": "instant",
				"expr": `label_join(up, "tenant_id", ",", "job")`,
			},
		},
		{
			name: "on_clause_referencing_tenant_id",
			body: map[string]any{
				"type": "instant",
				"expr": `up * on(tenant_id) http_requests_total`,
			},
		},
		{
			name: "ignoring_clause_referencing_tenant_id",
			body: map[string]any{
				"type": "instant",
				"expr": `up * ignoring(tenant_id) http_requests_total`,
			},
		},
		{
			name: "group_left_referencing_tenant_id",
			body: map[string]any{
				"type": "instant",
				"expr": `up * on(job) group_left(tenant_id) http_requests_total`,
			},
		},
		{
			name: "regex_name_matcher_information_leak",
			body: map[string]any{
				"type": "instant",
				"expr": `{__name__=~".+"}`,
			},
		},
		{
			name: "negative_name_matcher",
			body: map[string]any{
				"type": "instant",
				"expr": `{__name__!="up"}`,
			},
		},
		{
			name: "cross_tenant_explicit_other_tenant_id",
			body: map[string]any{
				"type": "instant",
				"expr": `up{tenant_id="other-tenant"}`,
			},
		},
		{
			name: "range_query_with_label_replace_bypass",
			body: map[string]any{
				"type":  "range",
				"expr":  `label_replace(rate(http_requests_total[5m]), "tenant_id", "evil", "job", "(.*)")`,
				"start": "0",
				"end":   "60",
				"step":  "15s",
			},
		},
		{
			name: "series_match_cross_tenant",
			body: map[string]any{
				"type":  "series",
				"match": []string{`up{tenant_id="other-tenant"}`},
			},
		},
		{
			name: "series_match_regex_name",
			body: map[string]any{
				"type":  "series",
				"match": []string{`{__name__=~".+"}`},
			},
		},
		{
			name: "invalid_promql_syntax",
			body: map[string]any{
				"type": "instant",
				"expr": `up{`,
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default", tc.body)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%v)", rec.Code, rec.Body.String())
			}
			ct := rec.Header().Get("Content-Type")
			if !strings.Contains(ct, "problem+json") {
				t.Errorf("Content-Type = %q, want application/problem+json", ct)
			}
		})
	}
}

// TestWidgetQuery_forwards_instant_query verifies a happy-path instant query
// reaches the upstream Prometheus stub with the tenant-injected expression.
func TestWidgetQuery_forwards_instant_query(t *testing.T) {
	var got struct {
		path  string
		query string
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.path = r.URL.Path
		_ = r.ParseForm()
		got.query = r.FormValue("query")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer upstream.Close()

	drv := openTenantTestStore(t)
	setObservabilityEndpoint(t, drv, "default", upstream.URL)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default",
		map[string]any{"type": "instant", "expr": "up"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got.path != "/api/v1/query" {
		t.Errorf("upstream path = %q, want /api/v1/query", got.path)
	}
	if !strings.Contains(got.query, `tenant_id="tenant_default"`) {
		t.Errorf("upstream query = %q, expected tenant_id injection", got.query)
	}
}

// TestWidgetQuery_forwards_range_query verifies range queries route to
// /api/v1/query_range and the time window is forwarded.
func TestWidgetQuery_forwards_range_query(t *testing.T) {
	var got struct {
		path, query, start, end, step string
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.path = r.URL.Path
		_ = r.ParseForm()
		got.query = r.FormValue("query")
		got.start = r.FormValue("start")
		got.end = r.FormValue("end")
		got.step = r.FormValue("step")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[]}}`))
	}))
	defer upstream.Close()

	drv := openTenantTestStore(t)
	setObservabilityEndpoint(t, drv, "default", upstream.URL)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default",
		map[string]any{
			"type":  "range",
			"expr":  `rate(http_requests_total[5m])`,
			"start": "100",
			"end":   "200",
			"step":  "15s",
		})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got.path != "/api/v1/query_range" {
		t.Errorf("upstream path = %q, want /api/v1/query_range", got.path)
	}
	if got.start != "100" || got.end != "200" || got.step != "15s" {
		t.Errorf("range params = %+v, want start=100 end=200 step=15s", got)
	}
	if !strings.Contains(got.query, `tenant_id="tenant_default"`) {
		t.Errorf("upstream query = %q, expected tenant_id injection", got.query)
	}
}

// TestWidgetQuery_forwards_series_query verifies series queries route to
// /api/v1/series and each match[] entry has tenant_id injected.
func TestWidgetQuery_forwards_series_query(t *testing.T) {
	var got struct {
		path    string
		matches []string
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.path = r.URL.Path
		_ = r.ParseForm()
		got.matches = r.Form["match[]"]
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":[]}`))
	}))
	defer upstream.Close()

	drv := openTenantTestStore(t)
	setObservabilityEndpoint(t, drv, "default", upstream.URL)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default",
		map[string]any{
			"type":  "series",
			"match": []string{`up`, `http_requests_total{job="api"}`},
		})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got.path != "/api/v1/series" {
		t.Errorf("upstream path = %q, want /api/v1/series", got.path)
	}
	if len(got.matches) != 2 {
		t.Fatalf("len(matches) = %d, want 2", len(got.matches))
	}
	for _, m := range got.matches {
		if !strings.Contains(m, `tenant_id="tenant_default"`) {
			t.Errorf("match %q missing tenant_id injection", m)
		}
	}
}

// TestWidgetQuery_rate_limit returns 429 once the bucket drains.
func TestWidgetQuery_rate_limit(t *testing.T) {
	drv := openTenantTestStore(t)

	// Build a handler with a 2-token, very long interval limiter so the
	// third request is guaranteed to drop without races against refill.
	limiter := &tenantRateLimiter{
		buckets:  make(map[string]*tenantBucket),
		budget:   2,
		interval: time.Hour,
		now:      time.Now,
	}
	mux := http.NewServeMux()
	mux.Handle("POST /api/v1/t/{tenant}/widgets/query",
		RequirePermission("dashboard:read")(http.HandlerFunc(handleWidgetQuery(drv, limiter))))

	statuses := make([]int, 0, 3)
	for i := 0; i < 3; i++ {
		req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default",
			map[string]any{"type": "instant", "expr": "up"})
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		statuses = append(statuses, rec.Code)
	}

	// First two are not 429; third is. We accept either 200 (if upstream
	// happens to be reachable) or 502 (if not) for the first two — the
	// invariant we test is that the limiter trips on the third call.
	if statuses[2] != http.StatusTooManyRequests {
		t.Errorf("third call status = %d, want 429 (statuses=%v)", statuses[2], statuses)
	}
	if statuses[0] == http.StatusTooManyRequests || statuses[1] == http.StatusTooManyRequests {
		t.Errorf("first two calls should not be rate-limited (statuses=%v)", statuses)
	}
}

// TestTenantRateLimiter_refills verifies tokens regenerate over time.
func TestTenantRateLimiter_refills(t *testing.T) {
	now := time.Unix(0, 0)
	l := &tenantRateLimiter{
		buckets:  make(map[string]*tenantBucket),
		budget:   2,
		interval: time.Second,
		now:      func() time.Time { return now },
	}

	// Drain.
	if !l.allow("a") {
		t.Fatal("first call should allow")
	}
	if !l.allow("a") {
		t.Fatal("second call should allow")
	}
	if l.allow("a") {
		t.Fatal("third call should be rate-limited")
	}

	// Advance time by half an interval — should refill 1 token.
	now = now.Add(500 * time.Millisecond)
	if !l.allow("a") {
		t.Fatal("after half-interval refill, allow should succeed")
	}
	if l.allow("a") {
		t.Fatal("only one token refilled, second allow should fail")
	}

	// Different tenant has its own bucket.
	if !l.allow("b") {
		t.Fatal("different tenant should have full bucket")
	}
}

// TestWidgetQuery_response_cache_header verifies the handler tags responses
// for short-lived browser caching.
func TestWidgetQuery_response_cache_header(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer upstream.Close()

	drv := openTenantTestStore(t)
	setObservabilityEndpoint(t, drv, "default", upstream.URL)
	mux := http.NewServeMux()
	RegisterWidgetQueryRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/query", "default",
		map[string]any{"type": "instant", "expr": "up"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "max-age") {
		t.Errorf("Cache-Control = %q, want a max-age directive", cc)
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// setObservabilityEndpoint upserts the metrics scrape endpoint into the test
// store so the handler points at our httptest upstream rather than the
// hardcoded prometheus default.
func setObservabilityEndpoint(t *testing.T, drv store.Driver, tenantSlug, endpoint string) {
	t.Helper()
	ctx := context.Background()

	tx, err := drv.Begin(ctx, store.TxOptions{ReadOnly: false})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	tn, err := tx.GetTenantBySlug(ctx, tenantSlug)
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("resolve tenant %s: %v", tenantSlug, err)
	}
	if _, err := tx.UpsertObservabilityConfig(ctx, &store.ObservabilityConfig{
		TenantID:              tn.ID,
		MetricsScrapeEndpoint: endpoint,
	}); err != nil {
		_ = tx.Rollback()
		t.Fatalf("upsert observability config: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
}
