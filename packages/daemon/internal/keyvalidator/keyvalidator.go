// Package keyvalidator implements the daemon-side API-key
// validation endpoint that the rioku_apikey Caddy module POSTs
// to (#179, #189).
//
// The rioku_apikey plugin sends `{"key_hash": "<sha256-hex>"}`
// over HTTP. The endpoint runs ResolveAPIKeyChain — Sprint 4
// Phase 1c — against the live store and returns the
// ValidationResult shape the plugin already understands:
//
//	{
//	  "valid":     true|false,
//	  "principal": "<id>",
//	  "scopes":    ["..."],
//	  "reason":    "missing|expired|revoked|invalid"  // when valid=false
//	}
//
// This server binds to a loopback address and does not require
// admin auth — network-level isolation is the trust boundary.
// Operators must NOT expose this port externally; firewall rules
// + the loopback bind protect it.
package keyvalidator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/riokulabs/rioku/internal/observability"
	"github.com/riokulabs/rioku/internal/store"
)

// Server runs a tiny HTTP server that resolves API-key validation
// requests against the store.
type Server struct {
	addr     string
	listener net.Listener
	srv      *http.Server
	store    store.Driver
	log      *slog.Logger

	// QuotaWebhook is invoked when the data plane reports a
	// quota-exceeded event for an API key bound to a Subscription
	// (#202). Best-effort: nil disables the data-plane webhook.
	QuotaWebhook QuotaExceededHook

	// JWKS is the daemon-side observability registry for JWKS
	// refresh outcomes reported by the rioku_jwt plugin (#191).
	// Nil disables the /jwks-refresh ingress (the handler still
	// returns 200 so the plugin's fire-and-forget POSTs don't
	// generate noisy errors).
	JWKS *observability.JWKSRegistry

	// quotaCacheMu guards the dedupe cache below.
	quotaCacheMu sync.Mutex
	// quotaCache deduplicates `subscription.exceeded_quota` events
	// per (api_key_hash, plan_id, day) bucket so a sustained breach
	// fires one webhook per day, not one per blocked request.
	quotaCache map[string]time.Time

	// Now is the clock function. Overridable for tests.
	Now func() time.Time
}

// QuotaExceededHook is invoked on a quota-exceeded event. The
// concrete implementation lives in internal/notifications and is
// wired post-construction via SetQuotaWebhook so the keyvalidator
// package stays cycle-free.
type QuotaExceededHook func(ctx context.Context, ev QuotaExceededEvent)

// QuotaExceededEvent is the shape the data-plane plugin reports.
// Mirrors the rate-limit module's block-context: which key tripped
// the cap, what was the limit + the count, and at what time.
type QuotaExceededEvent struct {
	APIKeyHash string
	PlanID     string
	TenantID   string
	Limit      int
	Count      int
	At         time.Time
}

// New constructs an unbound Server. Call Listen, then Serve.
func New(st store.Driver, log *slog.Logger) *Server {
	return &Server{
		store:      st,
		log:        log,
		Now:        time.Now,
		quotaCache: map[string]time.Time{},
	}
}

// SetQuotaWebhook installs (or replaces) the data-plane quota-
// exceeded callback. Wired post-construction by daemon.Start so the
// notifications dispatcher can be created independently.
func (s *Server) SetQuotaWebhook(h QuotaExceededHook) {
	s.QuotaWebhook = h
}

// Listen binds the server to addr.
func (s *Server) Listen(addr string) error {
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("keyvalidator: listen %s: %w", addr, err)
	}
	s.listener = l
	s.addr = l.Addr().String()
	mux := http.NewServeMux()
	mux.HandleFunc("/validate-key", s.handleValidateKey)
	mux.HandleFunc("/quota-exceeded", s.handleQuotaExceeded)
	mux.HandleFunc("/mcp-validate", s.handleMCPValidate)
	mux.HandleFunc("/jwks-refresh", s.handleJWKSRefresh)
	s.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}
	return nil
}

// Addr returns the resolved listener address.
func (s *Server) Addr() string { return s.addr }

// Serve blocks until the server stops.
func (s *Server) Serve() error {
	if s.srv == nil {
		return errors.New("keyvalidator: Listen must be called before Serve")
	}
	err := s.srv.Serve(s.listener)
	if err != nil && err != http.ErrServerClosed {
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

// handleValidateKey is the POST /validate-key handler. The plugin's
// httpValidator.Validate sends the SHA-256 hex of the inbound key.
func (s *Server) handleValidateKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		KeyHash string `json:"key_hash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	req.KeyHash = strings.TrimSpace(req.KeyHash)
	if req.KeyHash == "" {
		writeJSON(w, http.StatusOK, validationResponse{Valid: false, Reason: "missing"})
		return
	}

	tx, err := s.store.Begin(r.Context(), store.TxOptions{ReadOnly: true})
	if err != nil {
		s.logErr("begin tx", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer func() { _ = tx.Rollback() }()

	chain, err := store.ResolveAPIKeyChain(r.Context(), tx, req.KeyHash, s.Now())
	if err != nil {
		s.logErr("resolve chain", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	resp := validationResponse{
		Valid:     chain.Valid,
		Principal: chain.PrincipalID,
		Scopes:    chain.Scopes,
		Reason:    chain.Reason,
	}
	// When the chain resolved through a Plan, surface the
	// derived rate-limit + quota policy so the plugin can stamp
	// it on the request for downstream rate-limit handlers.
	if chain.Valid && chain.Plan != nil {
		resp.RateLimitPerMinute = int(chain.Plan.RateLimitPerMinute)
		resp.QuotaPerDay = int(chain.Plan.QuotaPerDay)
		resp.PlanID = chain.Plan.ID
	}

	writeJSON(w, http.StatusOK, resp)
}

type validationResponse struct {
	Valid              bool     `json:"valid"`
	Principal          string   `json:"principal,omitempty"`
	Scopes             []string `json:"scopes,omitempty"`
	Reason             string   `json:"reason,omitempty"`
	PlanID             string   `json:"plan_id,omitempty"`
	RateLimitPerMinute int      `json:"rate_limit_per_minute,omitempty"`
	QuotaPerDay        int      `json:"quota_per_day,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) logErr(msg string, err error) {
	if s.log != nil {
		s.log.Error("keyvalidator: "+msg, "error", err)
	}
}

// quotaDedupTTL is how long the (api_key_hash, plan_id, day) bucket
// suppresses repeat webhooks. 24h matches the most common
// QuotaPerDay window; sub-day windows still suppress within the
// day, which is the correct trade-off — operators do not want one
// webhook per blocked request during a sustained breach.
const quotaDedupTTL = 24 * time.Hour

// handleQuotaExceeded is the data-plane webhook ingress (#202). The
// rate-limit Caddy module POSTs the block context here when an API
// key bound to a Subscription trips its Plan-level RPM cap. The
// daemon then fan-outs `subscription.exceeded_quota` through the
// notifications dispatcher.
//
// Body shape:
//
//	{
//	  "api_key_hash": "<sha256-hex>",
//	  "plan_id":      "<plan id>",
//	  "tenant_id":    "<tenant id>",
//	  "limit":        N,
//	  "count":        N
//	}
//
// Best-effort: failures here are logged but never block the data
// plane (the rate-limit module fires-and-forgets). Loopback only;
// network isolation is the trust boundary.
func (s *Server) handleQuotaExceeded(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		APIKeyHash string `json:"api_key_hash"`
		PlanID     string `json:"plan_id"`
		TenantID   string `json:"tenant_id"`
		Limit      int    `json:"limit"`
		Count      int    `json:"count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	req.APIKeyHash = strings.TrimSpace(req.APIKeyHash)
	req.PlanID = strings.TrimSpace(req.PlanID)
	req.TenantID = strings.TrimSpace(req.TenantID)
	if req.APIKeyHash == "" || req.PlanID == "" || req.TenantID == "" {
		// Silently accept-and-skip — the data plane should not be
		// punished for a malformed event; the daemon won't fan
		// out the webhook.
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "skipped"})
		return
	}

	now := s.Now().UTC()
	day := now.Format("2006-01-02")
	dedupKey := req.APIKeyHash + "|" + req.PlanID + "|" + day
	s.quotaCacheMu.Lock()
	last, seen := s.quotaCache[dedupKey]
	if seen && now.Sub(last) < quotaDedupTTL {
		s.quotaCacheMu.Unlock()
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "deduped"})
		return
	}
	s.quotaCache[dedupKey] = now
	// Bound the cache: drop entries older than the TTL on every write.
	for k, t := range s.quotaCache {
		if now.Sub(t) >= quotaDedupTTL {
			delete(s.quotaCache, k)
		}
	}
	s.quotaCacheMu.Unlock()

	if s.QuotaWebhook != nil {
		s.QuotaWebhook(r.Context(), QuotaExceededEvent{
			APIKeyHash: req.APIKeyHash,
			PlanID:     req.PlanID,
			TenantID:   req.TenantID,
			Limit:      req.Limit,
			Count:      req.Count,
			At:         now,
		})
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "fired"})
}

// handleMCPValidate is the rioku_mcp_auth Caddy module's tool-
// authorization endpoint (#201, D9). The plugin POSTs:
//
//   { "api_key_hash": "<sha256-hex>",
//     "mcp_server_id": "<server id>",
//     "tool_name":     "<tool name>" }
//
// The endpoint resolves the API key chain, looks up the bound
// mcp_team's permissions, and reports whether the team is allowed
// to invoke the requested tool on the named MCP server.
//
// Response shape:
//
//   { "allow": true|false,
//     "reason": "...",         // when !allow
//     "no_team": true,         // key resolved but is not bound to an MCP team
//     "team_id": "..." }
//
// Loopback only; network isolation is the trust boundary.
func (s *Server) handleMCPValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		APIKeyHash  string `json:"api_key_hash"`
		MCPServerID string `json:"mcp_server_id"`
		ToolName    string `json:"tool_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	req.APIKeyHash = strings.TrimSpace(req.APIKeyHash)
	req.ToolName = strings.TrimSpace(req.ToolName)
	if req.APIKeyHash == "" || req.ToolName == "" {
		writeJSON(w, http.StatusOK, map[string]any{"allow": false, "reason": "missing api_key_hash or tool_name"})
		return
	}

	tx, err := s.store.Begin(r.Context(), store.TxOptions{ReadOnly: true})
	if err != nil {
		s.logErr("begin tx", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer func() { _ = tx.Rollback() }()

	key, err := tx.GetAPIKeyByHash(r.Context(), req.APIKeyHash)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"allow": false, "reason": "api key not found"})
		return
	}
	if key.MCPTeamID == nil || *key.MCPTeamID == "" {
		// Key resolved but isn't bound to an MCP team. The plugin
		// rejects this with 403; the daemon surfaces "no_team" so
		// the operator log is unambiguous.
		writeJSON(w, http.StatusOK, map[string]any{"allow": false, "no_team": true, "reason": "api key not bound to mcp team"})
		return
	}
	teamID := *key.MCPTeamID

	// Tenant-scoped lookup of the team's permissions.
	teamCtx := store.WithTenantID(r.Context(), key.TenantID)
	team, err := tx.GetMCPTeam(teamCtx, teamID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"allow": false, "team_id": teamID, "reason": "team not found"})
		return
	}
	if team.Status != store.MCPTeamStatusActive {
		writeJSON(w, http.StatusOK, map[string]any{
			"allow":   false,
			"team_id": teamID,
			"reason":  "team " + string(team.Status),
		})
		return
	}
	perms, err := tx.ListMCPTeamPermissions(teamCtx, teamID)
	if err != nil {
		s.logErr("list mcp team permissions", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	allowed := store.AllowsTool(perms, req.MCPServerID, req.ToolName)
	out := map[string]any{
		"allow":   allowed,
		"team_id": teamID,
	}
	if !allowed {
		out["reason"] = "tool not in team allow-list"
	}
	writeJSON(w, http.StatusOK, out)
}

// handleJWKSRefresh is the data-plane ingress for rioku_jwt JWKS
// refresh outcomes (#191). The plugin POSTs `{url, status, error,
// at}` after each refresh attempt; the daemon stamps the event into
// the in-process observability.JWKSRegistry which the admin REST
// endpoint surfaces. Loopback only — network isolation is the
// trust boundary, same as the other keyvalidator endpoints.
func (s *Server) handleJWKSRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var ev observability.JWKSEvent
	if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	ev.URL = strings.TrimSpace(ev.URL)
	if ev.URL == "" {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if s.JWKS != nil {
		if ev.At.IsZero() {
			ev.At = s.Now()
		}
		s.JWKS.Record(ev)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
