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
	"time"

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

	// Now is the clock function. Overridable for tests.
	Now func() time.Time
}

// New constructs an unbound Server. Call Listen, then Serve.
func New(st store.Driver, log *slog.Logger) *Server {
	return &Server{
		store: st,
		log:   log,
		Now:   time.Now,
	}
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
