// Package gateway — Widget query engine (#236).
//
// Dashboard widgets execute PromQL expressions against the tenant's metrics
// backend. This file implements POST /api/v1/t/{tenant}/widgets/query, which:
//
//   - Reads the tenant from the URL path
//   - Reuses the same AST-level tenant_id injection pipeline that backs
//     /promql/query (see promql_routes.go) so cross-tenant label leakage is
//     impossible
//   - Forwards instant / range / series queries to the tenant's configured
//     Prometheus instance
//   - Applies a per-tenant token-bucket rate limit (default 60 queries per
//     minute, configurable per #237)
//
// The handler does NOT introduce a parallel rewriter — it calls
// injectTenantLabel directly. Adding a second AST walker is the kind of
// duplication that historically leaks tenants (a fix in one path missed in
// the other), so security-critical logic stays in one place.
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// Widget query types accepted by the handler.
const (
	widgetQueryInstant = "instant"
	widgetQueryRange   = "range"
	widgetQuerySeries  = "series"
)

// widgetQueryRateBudget is the default per-tenant query budget.
// Currently a hardcoded sensible default; #237 will surface this in
// settings:write so operators can tune it per tenant.
const (
	widgetQueryRateBudget   = 60
	widgetQueryRateInterval = time.Minute
)

// RegisterWidgetQueryRoutes wires the widget query endpoint.
func RegisterWidgetQueryRoutes(mux *http.ServeMux, st store.Driver) {
	limiter := newTenantRateLimiter(widgetQueryRateBudget, widgetQueryRateInterval)
	mux.Handle("POST /api/v1/t/{tenant}/widgets/query",
		RequirePermission("dashboard:read")(http.HandlerFunc(handleWidgetQuery(st, limiter))))
}

// widgetQueryRequest is the JSON body accepted by the widget query endpoint.
//
// Type semantics:
//
//	"instant" → Prometheus /api/v1/query at `time`
//	"range"   → Prometheus /api/v1/query_range across [start,end] step `step`
//	"series"  → Prometheus /api/v1/series with `match[]` selectors
type widgetQueryRequest struct {
	Type  string   `json:"type"`
	Expr  string   `json:"expr,omitempty"`
	Time  string   `json:"time,omitempty"`
	Start string   `json:"start,omitempty"`
	End   string   `json:"end,omitempty"`
	Step  string   `json:"step,omitempty"`
	Match []string `json:"match,omitempty"`
}

func handleWidgetQuery(st store.Driver, limiter *tenantRateLimiter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}

		// Per-tenant rate limit. Returns RFC-7807 429 on exhaustion.
		if !limiter.allow(tenant.ID) {
			writeProblem(w, http.StatusTooManyRequests, errTypeRateLimit,
				"Widget query rate limit exceeded",
				fmt.Sprintf("Tenant %q exceeded the widget query rate limit of %d queries per %s. Retry shortly.",
					tenant.ID, widgetQueryRateBudget, widgetQueryRateInterval),
				r.URL.Path,
				nil,
			)
			return
		}

		var req widgetQueryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body: "+err.Error())
			return
		}

		switch req.Type {
		case widgetQueryInstant, widgetQueryRange:
			if strings.TrimSpace(req.Expr) == "" {
				writeBadRequest(w, r, "expr is required for instant/range queries")
				return
			}
			rewritten, err := injectTenantLabel(req.Expr, tenant.ID)
			if err != nil {
				writeProblem(w, http.StatusBadRequest, errTypeValidation,
					"Widget query rejected",
					err.Error(),
					r.URL.Path,
					nil,
				)
				return
			}
			req.Expr = rewritten
		case widgetQuerySeries:
			if len(req.Match) == 0 {
				writeBadRequest(w, r, "match[] is required for series queries")
				return
			}
			rewritten := make([]string, 0, len(req.Match))
			for _, m := range req.Match {
				if strings.TrimSpace(m) == "" {
					writeBadRequest(w, r, "match[] entries must be non-empty")
					return
				}
				out, err := injectTenantLabel(m, tenant.ID)
				if err != nil {
					writeProblem(w, http.StatusBadRequest, errTypeValidation,
						"Widget query rejected",
						err.Error(),
						r.URL.Path,
						nil,
					)
					return
				}
				rewritten = append(rewritten, out)
			}
			req.Match = rewritten
		default:
			writeBadRequest(w, r, fmt.Sprintf("unknown query type %q (want instant|range|series)", req.Type))
			return
		}

		// Look up Prometheus endpoint from tenant observability config.
		prometheusURL := defaultPrometheusEndpoint
		if st != nil {
			tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
			if err == nil {
				if cfg, err := tx.GetObservabilityConfig(r.Context(), tenant.ID); err == nil && cfg.MetricsScrapeEndpoint != "" {
					prometheusURL = cfg.MetricsScrapeEndpoint
				}
				_ = tx.Rollback()
			}
		}

		body, status, headers, err := forwardWidgetQuery(r.Context(), prometheusURL, req)
		if err != nil {
			slog.Error("widget query: upstream error", "err", err, "tenant", tenant.ID, "type", req.Type)
			writeProblem(w, http.StatusBadGateway, errTypeBadGateway,
				"Prometheus upstream error",
				fmt.Sprintf("Failed to reach Prometheus: %v", err),
				r.URL.Path,
				nil,
			)
			return
		}

		for _, key := range []string{"Content-Type", "X-Prometheus-Total-Samples", "X-Prometheus-Query-Stats"} {
			if v := headers.Get(key); v != "" {
				w.Header().Set(key, v)
			}
		}
		w.Header().Set("Cache-Control", "private, max-age=15")
		w.WriteHeader(status)
		_, _ = io.Copy(w, body)
	}
}

// forwardWidgetQuery routes to the appropriate Prometheus endpoint based on
// the request type and returns the upstream response.
func forwardWidgetQuery(ctx context.Context, prometheusBase string, req widgetQueryRequest) (io.Reader, int, http.Header, error) {
	form := url.Values{}
	var promPath string

	switch req.Type {
	case widgetQueryInstant:
		promPath = "/api/v1/query"
		form.Set("query", req.Expr)
		if req.Time != "" {
			form.Set("time", req.Time)
		}
	case widgetQueryRange:
		promPath = "/api/v1/query_range"
		form.Set("query", req.Expr)
		if req.Start != "" {
			form.Set("start", req.Start)
		}
		if req.End != "" {
			form.Set("end", req.End)
		}
		if req.Step != "" {
			form.Set("step", req.Step)
		}
	case widgetQuerySeries:
		promPath = "/api/v1/series"
		for _, m := range req.Match {
			form.Add("match[]", m)
		}
		if req.Start != "" {
			form.Set("start", req.Start)
		}
		if req.End != "" {
			form.Set("end", req.End)
		}
	default:
		return nil, 0, nil, fmt.Errorf("unsupported query type %q", req.Type)
	}

	targetURL := strings.TrimRight(prometheusBase, "/") + promPath

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("upstream request: %w", err)
	}

	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return nil, 0, nil, fmt.Errorf("read upstream body: %w", err)
	}

	return strings.NewReader(string(body)), resp.StatusCode, resp.Header, nil
}

// ─── tenantRateLimiter ────────────────────────────────────────────────────────

// tenantRateLimiter is a simple per-tenant token bucket implemented with the
// stdlib only (no golang.org/x/time/rate dependency, in keeping with the
// project's "stdlib preferred" rule). Tokens regenerate at a constant rate
// up to budget; allow() decrements one token and returns whether it was
// available.
type tenantRateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*tenantBucket
	budget   int
	interval time.Duration
	now      func() time.Time // injectable for tests
}

type tenantBucket struct {
	tokens   float64
	lastFill time.Time
}

func newTenantRateLimiter(budget int, interval time.Duration) *tenantRateLimiter {
	return &tenantRateLimiter{
		buckets:  make(map[string]*tenantBucket),
		budget:   budget,
		interval: interval,
		now:      time.Now,
	}
}

// allow returns true if the tenant has at least one token available, and
// consumes it. Refill rate is budget/interval per second.
func (l *tenantRateLimiter) allow(tenantID string) bool {
	if l.budget <= 0 {
		// budget <=0 disables the limiter (sentinel for tests).
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	b, ok := l.buckets[tenantID]
	if !ok {
		b = &tenantBucket{tokens: float64(l.budget), lastFill: now}
		l.buckets[tenantID] = b
	}

	// Refill since last access.
	elapsed := now.Sub(b.lastFill).Seconds()
	if elapsed > 0 {
		ratePerSec := float64(l.budget) / l.interval.Seconds()
		b.tokens += elapsed * ratePerSec
		if b.tokens > float64(l.budget) {
			b.tokens = float64(l.budget)
		}
		b.lastFill = now
	}

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
