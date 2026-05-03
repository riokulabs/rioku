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
	Model    string               `json:"model"`
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

	// Build the upstream try-list. When the VK carries an explicit
	// list (#200), the configured strategy decides the order; for
	// single-upstream VKs the list is just the one provider in
	// declared order.
	candidates, strat, err := s.resolveCandidates(ctx, vk, provider)
	if err != nil {
		s.logErr("resolve candidates", err)
		writeJSONError(w, http.StatusBadGateway, "no candidate upstreams")
		return
	}

	inputTokens := s.estimateInputTokens(&pr)

	startedAt := s.Now()
	final := tokenAccounting{inputTokens: inputTokens}
	finalStatus := 0

	triggers := strategies.FallbackTriggers
	if ts, ok := strat.(strategies.TriggerSetter); ok && ts != nil {
		triggers = ts.Triggers()
	}

	for i, cand := range candidates {
		creds, cerr := s.resolveCredential(ctx, cand.provider, vk)
		if cerr != nil {
			s.logErr("resolve credential", cerr)
			if i == len(candidates)-1 {
				writeJSONError(w, http.StatusBadGateway, "upstream credential unavailable")
				return
			}
			continue
		}
		upURL, perr := url.Parse(cand.provider.BaseURL)
		if perr != nil || upURL.Scheme == "" {
			if i == len(candidates)-1 {
				writeJSONError(w, http.StatusBadGateway, "invalid provider base_url")
				return
			}
			continue
		}

		attemptStart := s.Now()
		resp, body, transportErr := s.fetchUpstream(r.Context(), upURL, creds, bodyBytes, r)
		latencyMS := time.Since(attemptStart).Milliseconds()
		outcome := strategies.Outcome{
			UpstreamID: cand.upstream.ID,
			LatencyMS:  latencyMS,
			Err:        transportErr,
		}
		if resp != nil {
			outcome.Status = resp.StatusCode
		}
		if strat != nil {
			strat.Observe(outcome)
		}

		// Decide whether to retry. Fallback triggers (or transport
		// errors) advance the chain; everything else commits.
		hasMore := i < len(candidates)-1
		if hasMore && strategies.ShouldFallback(outcome, triggers) {
			if resp != nil {
				_ = resp.Body.Close()
			}
			continue
		}

		// Commit to this attempt.
		finalStatus = outcome.Status
		s.copyResponse(w, resp, body, &final, pr.Model)
		break
	}

	s.recordSpend(context.Background(), &spendInput{
		tenantID:     tenantID,
		virtualKeyID: virtualKeyID,
		modelID:      pr.Model,
		requestID:    requestID,
		latencyMS:    time.Since(startedAt).Milliseconds(),
		status:       finalStatus,
		inputTokens:  int32(final.inputTokens),
		outputTokens: int32(final.outputTokens),
		costUSD:      final.costUSD,
	})
}

// candidate is one resolved (upstream, provider) pair from the
// VK's routing list, in the order the strategy picked.
type candidate struct {
	upstream strategies.Upstream
	provider *store.AIProvider
}

// resolveCandidates expands the VK's upstream list (or its single
// provider for legacy VKs) and orders it via the configured
// strategy. Returns the candidate list + the strategy instance so
// the caller can call Observe() on each attempt.
func (s *Server) resolveCandidates(ctx context.Context, vk *store.VirtualKey, fallbackProvider *store.AIProvider) ([]candidate, strategies.Strategy, error) {
	// Single-upstream legacy path — VK references one provider via
	// vk.ProviderID and no explicit list. Skip strategy entirely.
	if len(vk.Upstreams) == 0 {
		return []candidate{{
			upstream: strategies.Upstream{ID: vk.ProviderID},
			provider: fallbackProvider,
		}}, nil, nil
	}

	// Multi-upstream path. Build the strategy from VK config; the
	// strategy registry takes the routing_config JSON blob.
	strategyName := vk.RoutingStrategy
	if strategyName == "" {
		strategyName = "fallback"
	}
	cfg := map[string]any{}
	if vk.RoutingConfig != "" && vk.RoutingConfig != "{}" {
		_ = json.Unmarshal([]byte(vk.RoutingConfig), &cfg)
	}
	strat, err := s.registry.Build(strategyName, cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("strategy build: %w", err)
	}

	// Convert VK upstreams to the strategy interface shape.
	stratUps := make([]strategies.Upstream, len(vk.Upstreams))
	for i, u := range vk.Upstreams {
		stratUps[i] = strategies.Upstream{
			ID:       u.ProviderID,
			Weight:   u.Weight,
			Priority: u.Priority,
		}
	}
	picked := strat.Pick(stratUps)

	// Resolve providers in the picked order. Drop any upstream
	// whose provider lookup fails or whose provider is disabled.
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()
	tenantID := store.TenantIDFromContext(ctx)
	out := make([]candidate, 0, len(picked))
	for _, u := range picked {
		p, err := tx.GetAIProvider(ctx, tenantID, u.ID)
		if err != nil || !p.Enabled {
			continue
		}
		out = append(out, candidate{upstream: u, provider: p})
	}
	if len(out) == 0 {
		return nil, nil, fmt.Errorf("no enabled providers in vk upstream list")
	}
	return out, strat, nil
}

// fetchUpstream issues one upstream call and waits for the
// response headers. Returns the response (caller closes body),
// a small body buffer for non-streaming JSON responses, and any
// transport-level error. The body buffer is empty for streaming
// responses so the caller knows to copy directly.
func (s *Server) fetchUpstream(ctx context.Context, upstream *url.URL, creds string, body []byte, src *http.Request) (*http.Response, []byte, error) {
	target := *upstream
	if target.Path == "" || target.Path == "/" {
		target.Path = src.URL.Path
	} else {
		target.Path = strings.TrimRight(target.Path, "/") + src.URL.Path
	}
	target.RawQuery = src.URL.RawQuery

	req, err := http.NewRequestWithContext(ctx, src.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	// Copy inbound headers minus Rioku-internal ones.
	for k, vs := range src.Header {
		switch k {
		case "Authorization", "X-Api-Key", "X-Rioku-Virtual-Key", "X-Rioku-Tenant-Id", "Host":
			continue
		}
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	if creds != "" {
		req.Header.Set("Authorization", "Bearer "+creds)
	}
	req.ContentLength = int64(len(body))

	resp, err := s.HTTPClient.Do(req)
	return resp, nil, err
}

// copyResponse writes the upstream response to the client. For a
// non-streaming JSON response we buffer fully so we can parse the
// usage block + set the cost header before flushing. For SSE /
// streaming we stream chunks through and use the byte heuristic
// for output tokens.
func (s *Server) copyResponse(w http.ResponseWriter, resp *http.Response, _ []byte, final *tokenAccounting, modelID string) {
	if resp == nil {
		writeJSONError(w, http.StatusBadGateway, "upstream unreachable")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	contentType := resp.Header.Get("Content-Type")
	if isJSONResponse(contentType) {
		buf, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			writeJSONError(w, http.StatusBadGateway, "read upstream body: "+err.Error())
			return
		}
		usage := parseUsageFromJSON(buf)
		if usage != nil {
			final.inputTokens = usage.PromptTokens
			final.outputTokens = usage.CompletionTokens
		} else {
			final.outputTokens = tokens.EstimateOutputFromBytes(len(buf))
		}
		if s.models != nil {
			if c, cerr := s.models.CalculateRequestCost(modelID, final.inputTokens, final.outputTokens); cerr == nil {
				final.costUSD = c
				w.Header().Set("X-Rioku-Response-Cost", registry.FormatCost(c))
			}
		}
		copyResponseHeaders(w.Header(), resp.Header)
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(buf)))
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(buf)
		return
	}

	// Streaming path — copy through with periodic flush.
	copyResponseHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	flusher, _ := w.(http.Flusher)
	written, _ := streamCopy(w, resp.Body, flusher)
	final.outputTokens = tokens.EstimateOutputFromBytes(written)
	if s.models != nil && final.outputTokens > 0 {
		if c, cerr := s.models.CalculateRequestCost(modelID, final.inputTokens, final.outputTokens); cerr == nil {
			final.costUSD = c
		}
	}
}

// streamCopy is io.Copy with a periodic Flush so SSE chunks reach
// the client as they land.
func streamCopy(dst io.Writer, src io.Reader, flusher http.Flusher) (int, error) {
	buf := make([]byte, 32<<10)
	total := 0
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return total, werr
			}
			total += n
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			if err == io.EOF {
				return total, nil
			}
			return total, err
		}
	}
}

// copyResponseHeaders copies the upstream response headers to the
// client response, dropping hop-by-hop entries.
func copyResponseHeaders(dst, src http.Header) {
	for k, vs := range src {
		switch k {
		case "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
			"Te", "Trailer", "Transfer-Encoding", "Upgrade", "Content-Length":
			continue
		}
		for _, v := range vs {
			dst.Add(k, v)
		}
	}
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
		"type":           "https://rioku.dev/errors/budget-exceeded",
		"title":          "Budget exceeded",
		"status":         http.StatusForbidden,
		"detail":         "virtual key budget exceeded for current window",
		"virtual_key_id": vk.ID,
		"budget_usd":     vk.BudgetUSD,
		"spent_usd":      spent,
		"budget_window":  string(vk.BudgetWindow),
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
