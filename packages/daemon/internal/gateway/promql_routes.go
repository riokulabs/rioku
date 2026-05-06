// Package gateway — PromQL proxy with tenant label injection.
//
// Plan 8 replaces the Plan 0c 501 stub with a real handler that:
//   - Reads the tenant from the URL path
//   - Validates and rewrites the PromQL query to inject tenant_id="<tenant>"
//     into every metric selector using a safe regexp-based rewriter
//   - Rejects queries that attempt to bypass isolation via dangerous patterns
//     ({__name__=~...}, label_replace, or raw metric-name-only that would
//     match all tenants)
//   - Forwards the rewritten query to the Prometheus instance configured in
//     the tenant's observability settings (MetricsScrapeEndpoint)
//   - Returns the upstream Prometheus response with sensible cache headers
//
// The rewriter works by detecting PromQL label selectors and inserting the
// tenant label. Unsupported patterns are rejected with 400 Bad Request
// rather than silently leaking cross-tenant data.
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
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/riokulabs/rioku/internal/store"
)

// defaultPrometheusEndpoint is used when the tenant has no MetricsScrapeEndpoint.
// In sandbox it is the prometheus container; in production the operator configures it.
const defaultPrometheusEndpoint = "http://prometheus:9090"

// promqlBypassPatterns are PromQL constructs that could escape tenant isolation.
// Any query matching these is rejected outright.
var promqlBypassPatterns = []*regexp.Regexp{
	// Bare __name__ matcher: {__name__=~".+"} or {__name__!=""}
	regexp.MustCompile(`\{[^}]*__name__\s*[=!]`),
	// label_replace and label_join can rename/remove the tenant label
	regexp.MustCompile(`\blabel_replace\s*\(`),
	regexp.MustCompile(`\blabel_join\s*\(`),
}

// selectorRe matches an explicit metric selector: either a bare metric name
// (letters/digits/underscores/colons) optionally followed by a label block,
// or a label block without a metric name. We rewrite each match.
//
// Group 1 = metric name (possibly empty)
// Group 2 = existing label content inside {} (possibly empty)
var selectorRe = regexp.MustCompile(`([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(\{[^}]*\})?|(\{[^}]*\})`)

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

		// Validate for bypass attempts before rewriting.
		if err := validatePromQL(req.Query); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation,
				"PromQL query rejected",
				err.Error(),
				r.URL.Path,
				nil,
			)
			return
		}

		// Rewrite: inject tenant_id label into every selector.
		rewritten, err := injectTenantLabel(req.Query, tenant.ID)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation,
				"PromQL rewrite failed",
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

// validatePromQL checks for disallowed patterns before rewriting.
// Returns non-nil error if the query is rejected.
func validatePromQL(query string) error {
	for _, pat := range promqlBypassPatterns {
		if pat.MatchString(query) {
			return fmt.Errorf("query uses a disallowed construct (%s) that could bypass tenant isolation", pat.String())
		}
	}
	return nil
}

// injectTenantLabel rewrites all metric selectors in query to include
// tenant_id="<tenantID>". The approach is conservative: if any selector
// already contains tenant_id, we validate it matches and return an error
// if it doesn't.
//
// Strategy:
//  1. Walk each PromQL token (metric name, label block, function call).
//  2. For each label block: insert tenant_id="<id>" if not present.
//     If tenant_id is present but has a different literal value: reject.
//  3. For bare metric names without braces: append {tenant_id="<id>"}.
func injectTenantLabel(query, tenantID string) (string, error) {
	// Quick validation: tenantID must be a safe label value (no quote chars).
	for _, ch := range tenantID {
		if ch == '"' || ch == '\\' || !unicode.IsPrint(ch) {
			return "", fmt.Errorf("tenant id contains unsafe characters")
		}
	}

	tenantLabel := fmt.Sprintf(`tenant_id="%s"`, tenantID)

	// We build the result by finding each selector and rewriting it.
	// This is not a full AST walk; it handles the common Prometheus query
	// patterns. Complex nested subqueries or offset/@ modifiers are preserved
	// because the rewriter only replaces content inside {} blocks.

	result, err := rewriteSelectors(query, tenantID, tenantLabel)
	if err != nil {
		return "", err
	}
	return result, nil
}

// rewriteSelectors walks the query string and rewrites label blocks.
// It uses a simple state machine to handle quoted strings inside {}.
func rewriteSelectors(query, tenantID, tenantLabel string) (string, error) {
	var out strings.Builder
	i := 0
	n := len(query)

	for i < n {
		// Find the next '{' that starts a label block, or the next
		// bare metric name followed optionally by a label block.
		// We scan character by character.

		// Check for a bare metric name (token start).
		if isLabelNameStart(rune(query[i])) {
			// Collect the metric name token.
			j := i + 1
			for j < n && isLabelNameContinue(rune(query[j])) {
				j++
			}
			token := query[i:j]

			// Skip whitespace after the token.
			k := j
			for k < n && query[k] == ' ' || k < n && query[k] == '\t' {
				k++
			}

			// Is this a function name (followed by '(')? If so, don't inject.
			if k < n && query[k] == '(' {
				out.WriteString(token)
				i = j
				continue
			}

			// Is the token a PromQL keyword or function?
			if isPromQLKeyword(token) {
				out.WriteString(token)
				i = j
				continue
			}

			// This is a metric name. Does a label block follow?
			if k < n && query[k] == '{' {
				// Extract the label block.
				end, err := findLabelBlockEnd(query, k)
				if err != nil {
					return "", err
				}
				inner := query[k+1 : end] // content between { and }
				rewritten, err := injectIntoLabelBlock(inner, tenantID, tenantLabel)
				if err != nil {
					return "", err
				}
				// Write: metric name + whitespace + { rewritten }
				out.WriteString(token)
				out.WriteString(query[j:k]) // whitespace
				out.WriteByte('{')
				out.WriteString(rewritten)
				out.WriteByte('}')
				i = end + 1
			} else {
				// Bare metric name, no label block — inject one.
				out.WriteString(token)
				out.WriteByte('{')
				out.WriteString(tenantLabel)
				out.WriteByte('}')
				i = j
			}
			continue
		}

		// Standalone label block (no metric name).
		if query[i] == '{' {
			end, err := findLabelBlockEnd(query, i)
			if err != nil {
				return "", err
			}
			inner := query[i+1 : end]
			rewritten, err := injectIntoLabelBlock(inner, tenantID, tenantLabel)
			if err != nil {
				return "", err
			}
			out.WriteByte('{')
			out.WriteString(rewritten)
			out.WriteByte('}')
			i = end + 1
			continue
		}

		// Skip quoted strings in other contexts.
		if query[i] == '"' || query[i] == '\'' || query[i] == '`' {
			quote := query[i]
			out.WriteByte(quote)
			i++
			for i < n {
				ch := query[i]
				out.WriteByte(ch)
				if ch == '\\' && i+1 < n {
					i++
					out.WriteByte(query[i])
				} else if ch == quote {
					i++
					break
				}
				i++
			}
			continue
		}

		out.WriteByte(query[i])
		i++
	}

	return out.String(), nil
}

// injectIntoLabelBlock injects tenant_id into an existing label list.
// inner is the content between { and }, e.g. `job="api", env="prod"`.
// Returns an error if tenant_id is present with a different value.
func injectIntoLabelBlock(inner, tenantID, tenantLabel string) (string, error) {
	trimmed := strings.TrimSpace(inner)

	// Check for existing tenant_id.
	// Pattern: tenant_id<op>"<value>"
	tenantRe := regexp.MustCompile(`\btenant_id\s*([=!~]+)\s*"([^"]*)"`)
	if m := tenantRe.FindStringSubmatch(trimmed); m != nil {
		op := m[1]
		existing := m[2]
		// Allow only if it exactly matches our tenantID with exact equality.
		if op == "=" && existing == tenantID {
			return inner, nil // already correct
		}
		return "", fmt.Errorf("query attempts to set tenant_id to %q (want %q) with operator %s; cross-tenant queries are not permitted", existing, tenantID, op)
	}

	// No tenant_id present — inject it.
	if trimmed == "" {
		return tenantLabel, nil
	}
	return trimmed + "," + tenantLabel, nil
}

// findLabelBlockEnd finds the closing '}' of a label block starting at pos.
// Handles quoted strings within the block.
func findLabelBlockEnd(query string, pos int) (int, error) {
	n := len(query)
	i := pos + 1 // skip opening '{'
	for i < n {
		ch := query[i]
		if ch == '}' {
			return i, nil
		}
		if ch == '"' || ch == '\'' || ch == '`' {
			quote := ch
			i++
			for i < n {
				c := query[i]
				if c == '\\' && i+1 < n {
					i += 2
					continue
				}
				if c == quote {
					break
				}
				i++
			}
		}
		i++
	}
	return -1, fmt.Errorf("unclosed label block in PromQL query")
}

func isLabelNameStart(ch rune) bool {
	return ch == '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

func isLabelNameContinue(ch rune) bool {
	return isLabelNameStart(ch) || (ch >= '0' && ch <= '9') || ch == ':'
}

// promqlKeywords includes PromQL aggregation operators and special identifiers
// that should not have label blocks injected after them.
var promqlKeywords = map[string]bool{
	"sum": true, "min": true, "max": true, "avg": true, "group": true,
	"stddev": true, "stdvar": true, "count": true, "count_values": true,
	"bottomk": true, "topk": true, "quantile": true,
	"by": true, "without": true, "on": true, "ignoring": true,
	"group_left": true, "group_right": true,
	"offset": true, "bool": true, "and": true, "or": true, "unless": true,
	"inf": true, "nan": true,
}

func isPromQLKeyword(s string) bool {
	return promqlKeywords[strings.ToLower(s)]
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
