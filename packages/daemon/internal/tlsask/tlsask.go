// Package tlsask implements the localhost-only `/tls/ask` endpoint that
// Caddy's on-demand TLS automation calls into to validate a domain
// before issuing an ACME certificate (#66).
//
// The handler answers "is this domain known to the daemon?" by checking
// every enabled Route's host matchers against the requested domain.
// Without this gate an attacker can DoS our ACME issuance allowance by
// triggering cert provisioning for arbitrary domains during the TLS
// handshake.
//
// Design:
//
//   - Matcher is a precompiled snapshot of enabled-route hosts: a
//     hash-set of exact hostnames + a slice of wildcard suffixes. Lookup
//     is O(1) + O(W) where W is the wildcard count — typically tiny.
//
//   - Server holds an atomic.Pointer[Matcher]. The daemon calls
//     SetSnapshot whenever config changes; readers (the HTTP handler)
//     atomically load the current pointer with no locking.
//
//   - The HTTP handler binds to a loopback-only listener (the daemon
//     refuses to start it on any non-loopback address). The endpoint
//     responds in microseconds — no I/O on the request path.
//
// Wildcard semantics match Caddy + DNS conventions:
//   - "*.example.com" matches one DNS label below example.com
//     (e.g. "foo.example.com", "bar.example.com") but NOT
//     "example.com" itself.
//   - "*.foo.example.com" matches "x.foo.example.com" but not
//     "foo.example.com".
//   - Bare wildcards ("*") are ignored — that would defeat the gate.
package tlsask

import (
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync/atomic"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// Matcher is a precompiled, immutable view of enabled-route hosts.
//
// Construct via BuildMatcher. Look up via Allow.
type Matcher struct {
	// exact maps lowercased hostnames to a sentinel struct.
	exact map[string]struct{}
	// wildcards stores suffixes (no leading dot or asterisk). E.g. the
	// matcher token "*.example.com" is stored as "example.com" — Allow
	// matches "<label>.example.com" with no further dots.
	wildcards []string
}

// emptyMatcher returns a matcher that rejects everything. Used as the
// initial value before SetSnapshot has been called so we fail safe.
func emptyMatcher() *Matcher { return &Matcher{exact: map[string]struct{}{}} }

// BuildMatcher walks the snapshot and indexes every host on every
// enabled route. Disabled routes are ignored.
//
// Bare-wildcard tokens ("*") and empty hostnames are silently dropped.
// Hostnames are lowercased so lookups are case-insensitive.
func BuildMatcher(snapshot *riokuv1.ConfigSnapshot) *Matcher {
	if snapshot == nil {
		return emptyMatcher()
	}
	exact := map[string]struct{}{}
	wildcards := []string{}
	for _, route := range snapshot.GetRoutes() {
		if !route.GetEnabled() {
			continue
		}
		for _, m := range route.GetMatchers() {
			for _, h := range m.GetHosts() {
				h = strings.TrimSpace(strings.ToLower(h))
				if h == "" || h == "*" {
					continue
				}
				if strings.HasPrefix(h, "*.") {
					suffix := h[2:]
					if suffix != "" {
						wildcards = append(wildcards, suffix)
					}
					continue
				}
				exact[h] = struct{}{}
			}
		}
	}
	return &Matcher{exact: exact, wildcards: wildcards}
}

// Allow returns true if `domain` matches an enabled route's host matcher.
//
// Wildcard semantics: "*.example.com" matches a single DNS label below
// example.com (e.g. "x.example.com") but NOT "example.com" itself or
// nested labels ("a.b.example.com").
func (m *Matcher) Allow(domain string) bool {
	if m == nil {
		return false
	}
	domain = strings.TrimSpace(strings.ToLower(domain))
	if domain == "" {
		return false
	}
	if _, ok := m.exact[domain]; ok {
		return true
	}
	// Wildcard check: domain == "<label>." + suffix, where label has no
	// further dots.
	for _, suffix := range m.wildcards {
		if !strings.HasSuffix(domain, "."+suffix) {
			continue
		}
		labelLen := len(domain) - len(suffix) - 1 // - len(".")
		if labelLen <= 0 {
			continue
		}
		// Reject nested subdomains: the "label" portion must contain no '.'.
		label := domain[:labelLen]
		if strings.IndexByte(label, '.') >= 0 {
			continue
		}
		return true
	}
	return false
}

// Stats reports the number of indexed exact + wildcard hosts. Useful for
// /healthz-style probes.
func (m *Matcher) Stats() (exact int, wildcards int) {
	if m == nil {
		return 0, 0
	}
	return len(m.exact), len(m.wildcards)
}

// ─── Server ─────────────────────────────────────────────────────────────────

// Server owns the atomic Matcher pointer and the loopback-only HTTP
// listener.
type Server struct {
	matcher atomic.Pointer[Matcher]
	srv     *http.Server
	ln      net.Listener
	addr    string
}

// New creates a Server with an empty (deny-all) initial matcher. The
// daemon must call SetSnapshot before the listener is useful.
func New() *Server {
	s := &Server{}
	s.matcher.Store(emptyMatcher())
	mux := http.NewServeMux()
	mux.HandleFunc("/tls/ask", s.handleAsk)
	s.srv = &http.Server{Handler: mux}
	return s
}

// Listen starts the HTTP listener on the supplied loopback address and
// returns immediately. The caller must subsequently call Serve in a
// goroutine.
//
// `addr` MUST resolve to a loopback (127.0.0.0/8 or ::1) — Listen
// returns an error otherwise. This is the security boundary that keeps
// the ask endpoint unreachable from the public internet.
func (s *Server) Listen(addr string) error {
	if err := assertLoopback(addr); err != nil {
		return err
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("tlsask: listen %s: %w", addr, err)
	}
	s.ln = ln
	s.addr = ln.Addr().String()
	return nil
}

// Serve blocks until the server is shut down via Shutdown(). Returns
// http.ErrServerClosed under normal shutdown.
func (s *Server) Serve() error {
	if s.ln == nil {
		return fmt.Errorf("tlsask: Listen must be called before Serve")
	}
	return s.srv.Serve(s.ln)
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown() error {
	if s.srv == nil {
		return nil
	}
	return s.srv.Close()
}

// Addr returns the resolved listening address (host:port). Empty until
// Listen succeeds.
func (s *Server) Addr() string { return s.addr }

// SetSnapshot rebuilds the Matcher from the supplied config snapshot
// and atomically swaps it in. Safe to call concurrently with Serve().
func (s *Server) SetSnapshot(snapshot *riokuv1.ConfigSnapshot) {
	s.matcher.Store(BuildMatcher(snapshot))
}

// SetMatcher allows callers to inject a precompiled Matcher directly
// (used by tests).
func (s *Server) SetMatcher(m *Matcher) { s.matcher.Store(m) }

// CurrentMatcher returns the active Matcher. Snapshot pointer — safe
// to read but do NOT mutate.
func (s *Server) CurrentMatcher() *Matcher { return s.matcher.Load() }

// ─── HTTP handler ───────────────────────────────────────────────────────────

func (s *Server) handleAsk(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		// Per the Caddy on-demand spec, missing `domain` is a client
		// error from misconfiguration, not a denial of a real cert
		// request — return 400 so it surfaces in logs.
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing domain query parameter"))
		return
	}
	if s.matcher.Load().Allow(domain) {
		w.WriteHeader(http.StatusOK)
		return
	}
	// Per Caddy convention any non-2xx is treated as "deny" — 403 is the
	// most semantically accurate.
	w.WriteHeader(http.StatusForbidden)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// assertLoopback returns nil iff `addr` resolves to a loopback IP. A
// purely-textual check is used (no DNS resolution) so we never trust an
// external host file; addr must be either "127.x.x.x:port", "[::1]:port",
// or "localhost:port".
func assertLoopback(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("tlsask: invalid addr %q: %w", addr, err)
	}
	if port == "" {
		return fmt.Errorf("tlsask: addr %q must include a port", addr)
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		return fmt.Errorf("tlsask: addr %q binds to all interfaces — must be loopback only", addr)
	}
	if host == "localhost" {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("tlsask: addr %q has non-IP host %q (must be a loopback IP or 'localhost')", addr, host)
	}
	if !ip.IsLoopback() {
		return fmt.Errorf("tlsask: addr %q has non-loopback IP %s", addr, host)
	}
	return nil
}
