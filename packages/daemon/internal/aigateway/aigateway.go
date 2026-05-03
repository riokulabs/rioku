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

	"github.com/riokulabs/rioku/internal/ai/router/strategies"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/vault"
)

// Server is the AI gateway HTTP server. Its lifecycle mirrors the
// keyvalidator package — call New, Listen, Serve; Shutdown when
// stopping.
type Server struct {
	addr     string
	listener net.Listener
	srv      *http.Server
	store    store.Driver
	vault    *vault.Resolver
	registry *strategies.Registry
	log      *slog.Logger

	// HTTPClient backs the reverse-proxy. Overridable for tests.
	HTTPClient *http.Client

	// Now is the clock function. Overridable for tests so spend-log
	// timestamps are deterministic.
	Now func() time.Time
}

// New constructs an unbound Server. Pass a Resolver that is already
// wired up with the operator's vault backends; nil disables vault
// resolution (literal credential values still work).
func New(st store.Driver, v *vault.Resolver, log *slog.Logger) *Server {
	return &Server{
		store:    st,
		vault:    v,
		registry: strategies.NewRegistry(),
		log:      log,
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

// proxyRequest is the parsed inbound shape. The gateway only needs
// model + tenant resolution; the body is otherwise opaque and
// streamed verbatim to the upstream.
type proxyRequest struct {
	Model string `json:"model"`
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

	startedAt := s.Now()
	proxy := s.newReverseProxy(upstreamURL, creds, bodyBytes)
	cw := &countingResponseWriter{ResponseWriter: w}
	proxy.ServeHTTP(cw, r)

	// Best-effort spend log. We don't have token counts in v1
	// (that's D10 — tiktoken approximation) so the log captures
	// status + latency only; tokens stay zero until the counter
	// lands. Errors here do NOT block the response; the response
	// has already streamed by the time we log.
	s.recordSpend(context.Background(), &spendInput{
		tenantID:     tenantID,
		virtualKeyID: virtualKeyID,
		modelID:      pr.Model,
		requestID:    requestID,
		latencyMS:    time.Since(startedAt).Milliseconds(),
		status:       cw.status,
	})
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

// countingResponseWriter captures the response status code so we
// can log it. http.ReverseProxy writes the upstream status code via
// WriteHeader; we intercept and record.
type countingResponseWriter struct {
	http.ResponseWriter
	status int
}

func (c *countingResponseWriter) WriteHeader(code int) {
	c.status = code
	c.ResponseWriter.WriteHeader(code)
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
