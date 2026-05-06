// Package gateway — PromQL proxy with tenant label injection.
//
// Plan 8 replaces the Plan 0c 501 stub with a real handler that:
//   - Reads the tenant from the URL path
//   - Parses the PromQL query into an AST using github.com/prometheus/prometheus
//     and walks every VectorSelector to inject tenant_id="<tenant>"
//   - Rejects queries that:
//   - Already contain a tenant_id matcher with a different value or operator
//   - Use label_replace/label_join with tenant_id as the destination label
//   - Use on(...) / ignoring(...) referring to tenant_id (cross-tenant join)
//   - Use bare {__name__=~...} matchers without an explicit metric name
//   - Forwards the rewritten query to the Prometheus instance configured in
//     the tenant's observability settings (MetricsScrapeEndpoint)
//   - Returns the upstream Prometheus response with sensible cache headers
//
// Using the official parser eliminates string-rewriting hazards (comments,
// nested string literals, vector matching clauses, etc.) that a regex-based
// implementation can miss.
package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql/parser"
	"github.com/riokulabs/rioku/internal/store"
)

// defaultPrometheusEndpoint is used when the tenant has no MetricsScrapeEndpoint.
// In sandbox it is the prometheus container; in production the operator configures it.
const defaultPrometheusEndpoint = "http://prometheus:9090"

// tenantLabelName is the reserved label that scopes a metric to a tenant.
const tenantLabelName = "tenant_id"

// RegisterPromQLRoutes registers the PromQL query proxy.
func RegisterPromQLRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("POST /api/v1/t/{tenant}/promql/query",
		RequirePermission("metrics:read")(http.HandlerFunc(handlePromQLQuery(st))))
	mux.Handle("GET /api/v1/t/{tenant}/promql/query",
		RequirePermission("metrics:read")(http.HandlerFunc(handlePromQLQuery(st))))
}

// promqlRequest is the JSON body accepted by our proxy endpoint.
type promqlRequest struct {
	Query string `json:"query"`
	// Optional Prometheus instant/range query parameters forwarded verbatim.
	Time  string `json:"time,omitempty"`
	Start string `json:"start,omitempty"`
	End   string `json:"end,omitempty"`
	Step  string `json:"step,omitempty"`
}

func handlePromQLQuery(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}

		// Parse request body.
		var req promqlRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body: "+err.Error())
			return
		}
		if strings.TrimSpace(req.Query) == "" {
			writeBadRequest(w, r, "query is required")
			return
		}

		// Validate + inject in a single AST walk.
		rewritten, err := injectTenantLabel(req.Query, tenant.ID)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation,
				"PromQL query rejected",
				err.Error(),
				r.URL.Path,
				nil,
			)
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

		// Forward to Prometheus query API.
		promResult, status, headers, err := forwardToPrometheus(r.Context(), prometheusURL, rewritten, req)
		if err != nil {
			slog.Error("promql proxy: upstream error", "err", err, "tenant", tenant.ID)
			writeProblem(w, http.StatusBadGateway, errTypeBadGateway,
				"Prometheus upstream error",
				fmt.Sprintf("Failed to reach Prometheus: %v", err),
				r.URL.Path,
				nil,
			)
			return
		}

		// Forward useful headers from Prometheus response.
		for _, key := range []string{"Content-Type", "X-Prometheus-Total-Samples", "X-Prometheus-Query-Stats"} {
			if v := headers.Get(key); v != "" {
				w.Header().Set(key, v)
			}
		}

		// Cache: metrics data is fine to cache briefly.
		w.Header().Set("Cache-Control", "private, max-age=15")
		w.WriteHeader(status)
		_, _ = io.Copy(w, promResult)
	}
}

// promqlParser is a process-wide PromQL parser. parser.NewParser is cheap and
// stateless after construction, so we share a single instance.
var promqlParser = parser.NewParser(parser.Options{})

// validatePromQL is a thin wrapper that runs the AST validator on a query
// without performing injection. Used for tests and pre-flight checks.
func validatePromQL(query string) error {
	expr, err := promqlParser.ParseExpr(query)
	if err != nil {
		return fmt.Errorf("invalid PromQL: %w", err)
	}
	return validateAST(expr)
}

// injectTenantLabel parses the query into an AST, validates it for cross-tenant
// bypass attempts, injects tenant_id="<tenantID>" into every VectorSelector,
// and serializes the rewritten AST back to a query string.
func injectTenantLabel(query, tenantID string) (string, error) {
	// Quick validation: tenantID must be a safe label value.
	for _, ch := range tenantID {
		if ch == '"' || ch == '\\' || !unicode.IsPrint(ch) {
			return "", fmt.Errorf("tenant id contains unsafe characters")
		}
	}
	if tenantID == "" {
		return "", fmt.Errorf("tenant id is empty")
	}

	expr, err := promqlParser.ParseExpr(query)
	if err != nil {
		return "", fmt.Errorf("invalid PromQL: %w", err)
	}

	if err := validateAST(expr); err != nil {
		return "", err
	}

	if err := injectAST(expr, tenantID); err != nil {
		return "", err
	}

	return expr.String(), nil
}

// validateAST walks the AST and rejects constructs that could escape tenant
// isolation. It does NOT mutate the tree.
func validateAST(root parser.Node) error {
	var rejectErr error
	parser.Inspect(root, func(node parser.Node, _ []parser.Node) error {
		switch n := node.(type) {
		case *parser.VectorSelector:
			// A bare {__name__=~...} or {__name__!=...} matcher with no
			// concrete metric name lets a caller select arbitrary metrics
			// and is rejected. A regular `metric{...}` selector also
			// surfaces __name__ as an internal matcher with MatchEqual,
			// so we only reject regex/negative __name__ matchers.
			for _, m := range n.LabelMatchers {
				if m.Name == labels.MetricName {
					if m.Type == labels.MatchRegexp || m.Type == labels.MatchNotRegexp || m.Type == labels.MatchNotEqual {
						rejectErr = fmt.Errorf("query uses a %s matcher on __name__ which can bypass tenant isolation", m.Type.String())
						return rejectErr
					}
				}
			}
		case *parser.Call:
			if n.Func != nil {
				switch n.Func.Name {
				case "label_replace":
					// label_replace(v, dst_label, replacement, src_label, regex)
					// Reject if dst_label or src_label is tenant_id.
					if callTargetsTenantLabel(n) {
						rejectErr = fmt.Errorf("label_replace targeting %s is not permitted", tenantLabelName)
						return rejectErr
					}
				case "label_join":
					// label_join(v, dst_label, separator, src_label_1, ...)
					if callTargetsTenantLabel(n) {
						rejectErr = fmt.Errorf("label_join targeting %s is not permitted", tenantLabelName)
						return rejectErr
					}
				}
			}
		case *parser.BinaryExpr:
			if n.VectorMatching != nil {
				// on(tenant_id) / ignoring(tenant_id) / group_left/right(tenant_id)
				for _, lbl := range n.VectorMatching.MatchingLabels {
					if lbl == tenantLabelName {
						rejectErr = fmt.Errorf("vector matching clause referencing %s is not permitted", tenantLabelName)
						return rejectErr
					}
				}
				for _, lbl := range n.VectorMatching.Include {
					if lbl == tenantLabelName {
						rejectErr = fmt.Errorf("group_left/right clause referencing %s is not permitted", tenantLabelName)
						return rejectErr
					}
				}
			}
		case *parser.AggregateExpr:
			// by(tenant_id) / without(tenant_id) — by(tenant_id) is benign
			// (just preserves the label) but without(tenant_id) drops it,
			// which we don't want to expose as it could mix tenants in
			// downstream label_replace. The label is already constrained
			// upstream though — so without() is safe; we don't reject it.
			_ = n
		}
		return nil
	})
	return rejectErr
}

// callTargetsTenantLabel checks if a label_replace/label_join Call references
// tenant_id as its destination or source label argument.
func callTargetsTenantLabel(c *parser.Call) bool {
	for _, arg := range c.Args {
		s, ok := arg.(*parser.StringLiteral)
		if !ok {
			continue
		}
		if s.Val == tenantLabelName {
			return true
		}
	}
	return false
}

// injectAST walks the AST and, for every VectorSelector, ensures a tenant_id
// matcher is present with the expected value. Mutates the tree in place.
func injectAST(root parser.Node, tenantID string) error {
	var injectErr error
	parser.Inspect(root, func(node parser.Node, _ []parser.Node) error {
		vs, ok := node.(*parser.VectorSelector)
		if !ok {
			return nil
		}

		// Look for an existing tenant_id matcher.
		for _, m := range vs.LabelMatchers {
			if m.Name != tenantLabelName {
				continue
			}
			// Existing tenant_id matcher: only accept exact-equality with
			// the bound tenantID.
			if m.Type != labels.MatchEqual || m.Value != tenantID {
				injectErr = fmt.Errorf("query attempts to set %s=%q with operator %s; cross-tenant queries are not permitted",
					tenantLabelName, m.Value, m.Type.String())
				return injectErr
			}
			return nil // already correct, no injection needed
		}

		// No tenant_id matcher present — append one.
		matcher, err := labels.NewMatcher(labels.MatchEqual, tenantLabelName, tenantID)
		if err != nil {
			injectErr = fmt.Errorf("build tenant matcher: %w", err)
			return injectErr
		}
		vs.LabelMatchers = append(vs.LabelMatchers, matcher)
		return nil
	})
	return injectErr
}

// forwardToPrometheus POSTs the rewritten query to Prometheus and returns
// the body reader, status code, and response headers.
func forwardToPrometheus(ctx context.Context, prometheusBase, query string, req promqlRequest) (io.Reader, int, http.Header, error) {
	// Determine endpoint: instant query vs range query.
	var promPath string
	if req.Start != "" || req.End != "" {
		promPath = "/api/v1/query_range"
	} else {
		promPath = "/api/v1/query"
	}

	// Build form-encoded body for Prometheus API.
	form := url.Values{}
	form.Set("query", query)
	if req.Time != "" {
		form.Set("time", req.Time)
	}
	if req.Start != "" {
		form.Set("start", req.Start)
	}
	if req.End != "" {
		form.Set("end", req.End)
	}
	if req.Step != "" {
		form.Set("step", req.Step)
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

	return bytes.NewReader(body), resp.StatusCode, resp.Header, nil
}

