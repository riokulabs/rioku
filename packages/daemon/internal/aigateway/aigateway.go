// Package aigateway implements the daemon-side AI gateway HTTP
// server (D7, #168). The gateway is the daemon's owned policy
// point for AI requests: it resolves the inbound virtual key,
// picks an upstream via the configured strategy, vault-resolves
// the upstream credential, reverse-proxies the request, and emits
// a spend-log entry.
//
// Why daemon-side and not Caddy: per D7, the routing strategies
// (#168), token counting (D10), and credential vault resolution
// (D12) all live in Go and need access to per-tenant state that
// Caddy modules can't easily reach. Caddy stays in the AI path
// only as a TLS/auth/rate-limit edge — it reverse_proxy's to the
// daemon's AI port for the routing-and-cost work.
//
// The server binds to a loopback address by default (127.0.0.1:7792)
// — operators must NOT expose it externally. Network isolation is
// the trust boundary; Caddy's auth plugins gate access at the edge.
package aigateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/ai/registry"
	"github.com/riokulabs/rioku/internal/ai/router/strategies"
	"github.com/riokulabs/rioku/internal/ai/tokens"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/vault"
)

// Server is the AI gateway HTTP server. Its lifecycle mirrors the
// keyvalidator package — call New, Listen, Serve; Shutdown when
// stopping.
type Server struct {
	addr      string
	listener  net.Listener
	srv       *http.Server
	store     store.Driver
	vault     *vault.Resolver
	registry  *strategies.Registry
	models    *registry.Registry // model price + capability registry; may be nil
	estimator tokens.Estimator
	log       *slog.Logger

	// HTTPClient backs the reverse-proxy. Overridable for tests.
	HTTPClient *http.Client

	// Now is the clock function. Overridable for tests so spend-log
	// timestamps are deterministic.
	Now func() time.Time
}

// New constructs an unbound Server. Pass a Resolver that is already
// wired up with the operator's vault backends; nil disables vault
// resolution (literal credential values still work). Pass a model
// registry to enable cost calculation + the x-rioku-response-cost
// header; nil disables both (cost stays zero on spend logs).
func New(st store.Driver, v *vault.Resolver, models *registry.Registry, log *slog.Logger) *Server {
	return &Server{
		store:     st,
		vault:     v,
		registry:  strategies.NewRegistry(),
		models:    models,
		estimator: tokens.NewHeuristic(),
		log:       log,
		HTTPClient: &http.Client{
			// Long timeout — streaming chat completions can run for
			// minutes. Per-request context cancellation is the real
			// timeout; this is a backstop.
			Timeout: 10 * time.Minute,
		},
		Now: time.Now,
	}
}

// Listen binds the server to addr. Callers should pass
// "127.0.0.1:7792" (the default) or another loopback address.
func (s *Server) Listen(addr string) error {
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("aigateway: listen %s: %w", addr, err)
	}
	s.listener = l
	s.addr = l.Addr().String()
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/chat/completions", s.handleProxy)
	mux.HandleFunc("/v1/completions", s.handleProxy)
	mux.HandleFunc("/v1/embeddings", s.handleProxy)
	mux.HandleFunc("/healthz", s.handleHealth)
	s.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout — streaming responses outlive any sane
		// HTTP timeout. Idle disconnect is governed by upstream.
	}
	return nil
}

// Addr returns the resolved listener address.
func (s *Server) Addr() string { return s.addr }

// Serve blocks until the server stops.
func (s *Server) Serve() error {
	if s.srv == nil {
		return errors.New("aigateway: Listen must be called before Serve")
	}
	if err := s.srv.Serve(s.listener); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Shutdown drains in-flight requests and stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.srv == nil {
		return nil
	}
	return s.srv.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// proxyRequest is the parsed inbound shape. We pull just enough out
// of the body to estimate input tokens (chat-completions messages
// array) and to surface routing/cost; the rest stays opaque and
// streams to the upstream verbatim.
type proxyRequest struct {
	Model    string              `json:"model"`
	Messages []tokens.ChatMessage `json:"messages"`
	// /v1/completions style — single prompt string.
	Prompt any `json:"prompt"`
}

// handleProxy is the single AI proxy handler. It expects two
// headers from the Caddy edge:
//
//	X-Rioku-Tenant-Id      — resolved tenant id
//	X-Rioku-Virtual-Key    — virtual key id (from auth plugin)
//
// The body is buffered up to a small limit so we can extract the
// model name; for streaming requests we pass the buffered body
// through to the upstream verbatim.
func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	tenantID := r.Header.Get("X-Rioku-Tenant-Id")
	virtualKeyID := r.Header.Get("X-Rioku-Virtual-Key")
	if tenantID == "" || virtualKeyID == "" {
		http.Error(w, "missing tenant or virtual-key header", http.StatusUnauthorized)
		return
	}
	requestID := r.Header.Get("X-Request-Id")
	if requestID == "" {
		requestID = uuid.NewString()
	}

	// Buffer body so we can both inspect (model name) and forward.
	bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 8<<20)) // 8 MiB cap
	if err != nil {
		http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
		return
	}
	var pr proxyRequest
	if err := json.Unmarshal(bodyBytes, &pr); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}
	if pr.Model == "" {
		http.Error(w, "missing model field", http.StatusBadRequest)
		return
	}

	ctx := store.WithTenantID(r.Context(), tenantID)
	vk, provider, err := s.resolveKey(ctx, virtualKeyID, pr.Model)
	if err != nil {
		s.logErr("resolve virtual key", err)
		writeJSONError(w, statusForKeyError(err), err.Error())
		return
	}

	// Pre-call budget enforcement — the rollup table aggregates
	// per-(vk, model) spend per day; for sub-day windows we sum
	// the live spend logs. RFC 7807-shaped error per the Phase 2
	// definition of done. Best-effort: if the check itself errors
	// out (e.g. db hiccup) we LOG and let the request through —
	// the operator's budget is advisory, not a hard kill switch.
	if vk.BudgetUSD > 0 {
		spent, berr := s.spentInWindow(ctx, vk)
		if berr != nil {
			s.logErr("budget lookup", berr)
		} else if spent >= vk.BudgetUSD {
			writeBudgetExceeded(w, vk, spent)
			return
		}
	}

	// v1: a virtual key maps 1:1 to a provider. Strategy registry is
	// constructed but not yet driving multi-upstream routing — that
	// arrives when the AIAgent surface ships an explicit upstream
	// list per agent. For now the strategy choice on the agent
	// influences observability only.
	creds, err := s.resolveCredential(ctx, provider, vk)
	if err != nil {
		s.logErr("resolve credential", err)
		writeJSONError(w, http.StatusBadGateway, "upstream credential unavailable")
		return
	}

	upstreamURL, err := url.Parse(provider.BaseURL)
	if err != nil || upstreamURL.Scheme == "" {
		writeJSONError(w, http.StatusBadGateway, "invalid provider base_url")
		return
	}

	// Estimate input tokens up-front. Used to seed the spend log
	// when the upstream's `usage` block isn't available (streaming
	// without final usage delta, or non-OpenAI-shaped responses).
	inputTokens := s.estimateInputTokens(&pr)

	startedAt := s.Now()
	cw := &countingResponseWriter{ResponseWriter: w}
	// finalTokens captures the per-request usage values that the
	// ModifyResponse hook resolved (when the upstream is non-
	// streaming + emits a usage block). Default to the heuristic.
	final := tokenAccounting{
		inputTokens:  inputTokens,
		outputTokens: 0, // computed below from cw.bytesWritten
	}
	proxy := s.newReverseProxy(upstreamURL, creds, bodyBytes)
	proxy.ModifyResponse = func(resp *http.Response) error {
		// Try to peek at a non-streaming JSON body. Buffered
		// reads let us parse + restore the body for the writer
		// without breaking SSE — for SSE this branch falls through
		// because Content-Type is text/event-stream.
		if !isJSONResponse(resp.Header.Get("Content-Type")) {
			return nil
		}
		buf, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			return nil
		}
		_ = resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(buf))
		resp.ContentLength = int64(len(buf))
		resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(buf)))

		usage := parseUsageFromJSON(buf)
		if usage != nil {
			final.inputTokens = usage.PromptTokens
			final.outputTokens = usage.CompletionTokens
		} else {
			final.outputTokens = tokens.EstimateOutputFromBytes(len(buf))
		}
		// Set the cost header on the upstream response so the
		// reverse-proxy copies it through to the client.
		if s.models != nil {
			c, cerr := s.models.CalculateRequestCost(pr.Model, final.inputTokens, final.outputTokens)
			if cerr == nil {
				final.costUSD = c
				resp.Header.Set("X-Rioku-Response-Cost", registry.FormatCost(c))
			}
		}
		return nil
	}
	proxy.ServeHTTP(cw, r)

	// Streaming branch: ModifyResponse skipped, output_tokens stays
	// zero; estimate from the byte stream the response writer saw.
	if final.outputTokens == 0 {
		final.outputTokens = tokens.EstimateOutputFromBytes(cw.bytesWritten)
		if s.models != nil && final.outputTokens > 0 {
			if c, err := s.models.CalculateRequestCost(pr.Model, final.inputTokens, final.outputTokens); err == nil {
				final.costUSD = c
			}
		}
	}

	s.recordSpend(context.Background(), &spendInput{
		tenantID:     tenantID,
		virtualKeyID: virtualKeyID,
		modelID:      pr.Model,
		requestID:    requestID,
		latencyMS:    time.Since(startedAt).Milliseconds(),
		status:       cw.status,
		inputTokens:  int32(final.inputTokens),
		outputTokens: int32(final.outputTokens),
		costUSD:      final.costUSD,
	})
}

// tokenAccounting is the running tally the proxy hook fills in.
type tokenAccounting struct {
	inputTokens  int
	outputTokens int
	costUSD      float64
}

// isJSONResponse returns true when the Content-Type matches a JSON
// shape (application/json + variants). SSE / event-stream / binary
// short-circuit through.
func isJSONResponse(contentType string) bool {
	if contentType == "" {
		return false
	}
	ct := strings.ToLower(contentType)
	return strings.HasPrefix(ct, "application/json") ||
		strings.HasPrefix(ct, "application/problem+json")
}

// estimateInputTokens routes between chat-completions (messages)
// and completions (prompt) shapes. Returns 0 when no shape matches —
// the upstream's usage block, when present, supersedes anyway.
func (s *Server) estimateInputTokens(pr *proxyRequest) int {
	if len(pr.Messages) > 0 {
		return tokens.EstimateMessages(pr.Messages, pr.Model)
	}
	if pr.Prompt == nil {
		return 0
	}
	switch p := pr.Prompt.(type) {
	case string:
		return s.estimator.EstimateText(p, pr.Model)
	case []any:
		total := 0
		for _, item := range p {
			if str, ok := item.(string); ok {
				total += s.estimator.EstimateText(str, pr.Model)
			}
		}
		return total
	}
	return 0
}

// usageBlock mirrors the OpenAI `usage` shape that most providers
// (and reasonable proxies) surface in non-streaming responses.
type usageBlock struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// parseUsageFromJSON tries to pull a top-level `usage` object out
// of a JSON response body. Returns nil when the body isn't JSON,
// when usage is missing, or when both token counters are zero
// (treat all-zero as "not surfaced" rather than "actually zero").
func parseUsageFromJSON(body []byte) *usageBlock {
	if len(body) == 0 {
		return nil
	}
	var probe struct {
		Usage *usageBlock `json:"usage"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return nil
	}
	if probe.Usage == nil {
		return nil
	}
	if probe.Usage.PromptTokens == 0 && probe.Usage.CompletionTokens == 0 {
		return nil
	}
	return probe.Usage
}

// spentInWindow returns the sum of spend-log cost_usd for the
// virtual key inside the configured budget_window, looking at
// the live spend_logs table (rollups update once a day; sub-day
// windows must read spend_logs directly).
func (s *Server) spentInWindow(ctx context.Context, vk *store.VirtualKey) (float64, error) {
	since := windowStart(s.Now(), vk.BudgetWindow)
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	logs, err := tx.QueryAISpendLogs(ctx, store.AISpendQuery{
		VirtualKeyID: vk.ID,
		Since:        &since,
	})
	if err != nil {
		return 0, err
	}
	total := 0.0
	for _, l := range logs {
		total += l.CostUSD
	}
	return total, nil
}

// windowStart returns the start instant of the budget window the
// given moment falls in. Aligned to the natural boundary
// (top-of-minute / hour / day / month, UTC).
func windowStart(now time.Time, w store.BudgetWindow) time.Time {
	now = now.UTC()
	switch w {
	case store.BudgetWindowMinute:
		return now.Truncate(time.Minute)
	case store.BudgetWindowHour:
		return now.Truncate(time.Hour)
	case store.BudgetWindowDay:
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	case store.BudgetWindowMonth, "":
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	return now.Add(-24 * time.Hour) // unknown window: be conservative
}

// writeBudgetExceeded emits an RFC 7807-shaped error response.
func writeBudgetExceeded(w http.ResponseWriter, vk *store.VirtualKey, spent float64) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusForbidden)
	body := map[string]any{
		"type":            "https://rioku.dev/errors/budget-exceeded",
		"title":           "Budget exceeded",
		"status":          http.StatusForbidden,
		"detail":          "virtual key budget exceeded for current window",
		"virtual_key_id":  vk.ID,
		"budget_usd":      vk.BudgetUSD,
		"spent_usd":       spent,
		"budget_window":   string(vk.BudgetWindow),
	}
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) resolveKey(ctx context.Context, vkID, modelID string) (*store.VirtualKey, *store.AIProvider, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	vk, err := tx.GetVirtualKey(ctx, vkID)
	if err != nil {
		return nil, nil, err
	}
	if !vk.IsActive() {
		return nil, nil, errVirtualKeyRevoked
	}
	if !vk.AllowsModel(modelID) {
		return nil, nil, errModelNotAllowed
	}
	tenantID := store.TenantIDFromContext(ctx)
	provider, err := tx.GetAIProvider(ctx, tenantID, vk.ProviderID)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve provider: %w", err)
	}
	if !provider.Enabled {
		return nil, nil, errProviderDisabled
	}
	return vk, provider, nil
}

// resolveCredential pulls the upstream credential from the vault.
// VirtualKey.CredentialRef takes precedence over the provider's
// own credential — the operator can scope a vk to a different
// provider account (e.g., dev vs prod OpenAI org).
func (s *Server) resolveCredential(ctx context.Context, p *store.AIProvider, vk *store.VirtualKey) (string, error) {
	ref := vk.CredentialRef
	if ref == "" && p.Credential != nil {
		ref = *p.Credential
	}
	if ref == "" {
		return "", nil // anonymous upstream (rare; ollama local)
	}
	if s.vault == nil {
		return ref, nil
	}
	return s.vault.ResolveString(ctx, ref)
}

// newReverseProxy builds a single-shot reverse proxy. We do not
// reuse a global proxy because Director needs the per-request
// upstream URL + creds.
func (s *Server) newReverseProxy(upstream *url.URL, creds string, body []byte) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Director: func(r *http.Request) {
			r.URL.Scheme = upstream.Scheme
			r.URL.Host = upstream.Host
			// Preserve the inbound path (`/v1/chat/completions` etc.)
			// — providers' OpenAI-shaped APIs are path-compatible.
			if upstream.Path != "" && upstream.Path != "/" {
				r.URL.Path = strings.TrimRight(upstream.Path, "/") + r.URL.Path
			}
			r.Host = upstream.Host
			r.Body = io.NopCloser(bytes.NewReader(body))
			r.ContentLength = int64(len(body))
			// Strip any inbound creds; we set fresh ones from vault.
			r.Header.Del("Authorization")
			r.Header.Del("X-Api-Key")
			r.Header.Del("X-Rioku-Virtual-Key")
			r.Header.Del("X-Rioku-Tenant-Id")
			if creds != "" {
				r.Header.Set("Authorization", "Bearer "+creds)
			}
		},
		Transport: s.HTTPClient.Transport,
		// FlushInterval -1 disables buffering — required for SSE /
		// streaming chat completions where the upstream emits chunks
		// over a long-lived connection.
		FlushInterval: -1,
	}
}

// countingResponseWriter captures the response status code, total
// bytes written, and a small head of the body (for non-streaming
// JSON usage parsing). The reverse proxy writes via WriteHeader +
// Write; we intercept both.
type countingResponseWriter struct {
	http.ResponseWriter
	status       int
	bytesWritten int
	// bodyBuf caches up to bodyBufCap bytes of the response. We use
	// it to extract the OpenAI-shape `usage` block on non-streaming
	// JSON responses. Streaming responses overflow this cap and we
	// fall back to the byte-based output-token estimate.
	bodyBuf bytes.Buffer
}

const bodyBufCap = 64 << 10 // 64 KiB; enough to find {"usage":...} in any sane response

func (c *countingResponseWriter) WriteHeader(code int) {
	c.status = code
	c.ResponseWriter.WriteHeader(code)
}

func (c *countingResponseWriter) Write(p []byte) (int, error) {
	n, err := c.ResponseWriter.Write(p)
	c.bytesWritten += n
	if c.bodyBuf.Len() < bodyBufCap {
		room := bodyBufCap - c.bodyBuf.Len()
		if room > n {
			room = n
		}
		c.bodyBuf.Write(p[:room])
	}
	return n, err
}

// Flush is the http.Flusher pass-through used by the reverse-proxy
// for streaming chunks. Implementing it here ensures wrapping does
// not break SSE.
func (c *countingResponseWriter) Flush() {
	if f, ok := c.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

type spendInput struct {
	tenantID     string
	virtualKeyID string
	modelID      string
	requestID    string
	latencyMS    int64
	status       int
	inputTokens  int32
	outputTokens int32
	costUSD      float64
}

// recordSpend persists a minimal spend-log entry. v1 does not yet
// run tokenization (that's #d10) so input/output tokens are zero;
// the row is still useful for request-count rollups + status code
// distribution.
func (s *Server) recordSpend(ctx context.Context, in *spendInput) {
	ctx = store.WithTenantID(ctx, in.tenantID)
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		s.logErr("begin spend tx", err)
		return
	}
	defer func() { _ = tx.Rollback() }()
	statusStr := "ok"
	if in.status >= 400 || in.status == 0 {
		statusStr = "error"
	}
	vk := in.virtualKeyID
	err = tx.AppendAISpendLog(ctx, &store.AISpendLog{
		ID:           "spend_" + uuid.NewString(),
		TenantID:     in.tenantID,
		VirtualKeyID: &vk,
		ModelID:      in.modelID,
		InputTokens:  in.inputTokens,
		OutputTokens: in.outputTokens,
		CostUSD:      in.costUSD,
		LatencyMS:    int32(in.latencyMS),
		Status:       statusStr,
		RequestID:    in.requestID,
	})
	if err != nil {
		s.logErr("append spend log", err)
		return
	}
	if err := tx.Commit(); err != nil {
		s.logErr("commit spend tx", err)
	}
}

// Sentinels for resolveKey error mapping to HTTP status.
var (
	errVirtualKeyRevoked = errors.New("aigateway: virtual key revoked")
	errModelNotAllowed   = errors.New("aigateway: model not in virtual key allow-list")
	errProviderDisabled  = errors.New("aigateway: provider disabled")
)

func statusForKeyError(err error) int {
	switch {
	case errors.Is(err, store.ErrVirtualKeyNotFound):
		return http.StatusUnauthorized
	case errors.Is(err, errVirtualKeyRevoked):
		return http.StatusUnauthorized
	case errors.Is(err, errModelNotAllowed):
		return http.StatusForbidden
	case errors.Is(err, errProviderDisabled):
		return http.StatusServiceUnavailable
	}
	return http.StatusInternalServerError
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (s *Server) logErr(msg string, err error) {
	if s.log != nil {
		s.log.Error("aigateway: "+msg, "error", err)
	}
}
