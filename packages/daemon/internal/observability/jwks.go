// Package observability holds in-memory daemon-side state surfaced
// by the admin REST API as observability snapshots. The state lives
// in this package because it is read by the gateway HTTP layer and
// written by both the gateway (initial registration) and the
// keyvalidator HTTP ingress (data-plane plugin reports).
package observability

import (
	"sort"
	"sync"
	"time"
)

// JWKSStatus is the resolved state for a JWKS source URL.
type JWKSStatus string

const (
	// JWKSStatusRegistered indicates the source is configured but no
	// refresh outcome has been reported yet.
	JWKSStatusRegistered JWKSStatus = "registered"

	// JWKSStatusOK indicates the most recent refresh succeeded.
	// Reported by the data-plane plugin on a successful re-fetch
	// (or kept on registration when the plugin's initial fetch
	// completed without a paired error report).
	JWKSStatusOK JWKSStatus = "ok"

	// JWKSStatusError indicates the most recent refresh failed.
	// keyfunc/v3 surfaces refresh errors via RefreshErrorHandlerFunc;
	// the plugin forwards them here so operators can detect a
	// silently-stale cached JWKS.
	JWKSStatusError JWKSStatus = "error"
)

// JWKSEvent is the shape an auth-jwt plugin instance reports to
// the daemon's keyvalidator ingress (#191).
type JWKSEvent struct {
	URL    string     `json:"url"`
	Status JWKSStatus `json:"status"`
	Error  string     `json:"error,omitempty"`
	At     time.Time  `json:"at"`
}

// JWKSEntry is a single registry row surfaced by the REST snapshot.
type JWKSEntry struct {
	URL             string     `json:"url"`
	Status          JWKSStatus `json:"status"`
	LastRefreshAt   time.Time  `json:"last_refresh_at"`
	LastError       string     `json:"last_error,omitempty"`
	RefreshCount    int        `json:"refresh_count"`
	FailureCount    int        `json:"failure_count"`
	RegisteredAt    time.Time  `json:"registered_at"`
	LastSuccessAt   *time.Time `json:"last_success_at,omitempty"`
	LastFailureAt   *time.Time `json:"last_failure_at,omitempty"`
	ConsecutiveFail int        `json:"consecutive_failures"`
}

// JWKSRegistry tracks JWKS refresh state per source URL. The
// registry is process-scoped: when the daemon restarts it loses
// history, which is acceptable because the source-of-truth state
// (the cached keys themselves) lives inside the data-plane Caddy
// process and the registry is repopulated on the next refresh.
type JWKSRegistry struct {
	mu      sync.RWMutex
	entries map[string]*JWKSEntry
	now     func() time.Time
}

// NewJWKSRegistry builds an empty registry with time.Now as the
// clock. Tests substitute the clock via SetClock.
func NewJWKSRegistry() *JWKSRegistry {
	return &JWKSRegistry{
		entries: make(map[string]*JWKSEntry),
		now:     time.Now,
	}
}

// SetClock overrides the registry's clock. Test-only.
func (r *JWKSRegistry) SetClock(now func() time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.now = now
}

// Register marks a JWKS URL as configured. Called from the gateway
// when it discovers the configured upstream JWKS endpoint(s) (e.g.,
// at compiler emit time or daemon startup). Idempotent — a re-
// registration only updates RegisteredAt the first time.
func (r *JWKSRegistry) Register(url string) {
	if url == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.entries[url]; ok {
		return
	}
	now := r.now()
	r.entries[url] = &JWKSEntry{
		URL:           url,
		Status:        JWKSStatusRegistered,
		RegisteredAt:  now,
		LastRefreshAt: time.Time{},
	}
}

// Record applies an event to the registry. URLs not yet registered
// are auto-registered first so a plugin reporting on an out-of-band
// URL still produces a row.
func (r *JWKSRegistry) Record(ev JWKSEvent) {
	if ev.URL == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := ev.At
	if now.IsZero() {
		now = r.now()
	}
	entry, ok := r.entries[ev.URL]
	if !ok {
		entry = &JWKSEntry{URL: ev.URL, RegisteredAt: now}
		r.entries[ev.URL] = entry
	}
	entry.Status = ev.Status
	entry.LastRefreshAt = now
	entry.RefreshCount++
	switch ev.Status {
	case JWKSStatusOK:
		s := now
		entry.LastSuccessAt = &s
		entry.ConsecutiveFail = 0
		entry.LastError = ""
	case JWKSStatusError:
		f := now
		entry.LastFailureAt = &f
		entry.LastError = ev.Error
		entry.FailureCount++
		entry.ConsecutiveFail++
	case JWKSStatusRegistered:
		// no-op aside from the registration timestamp recorded above
	}
}

// Snapshot returns a sorted-by-URL copy of every tracked entry.
// Callers may mutate the returned slice freely.
func (r *JWKSRegistry) Snapshot() []JWKSEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]JWKSEntry, 0, len(r.entries))
	for _, e := range r.entries {
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].URL < out[j].URL })
	return out
}
