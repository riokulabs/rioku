// Package caddy: upstream health poller (#122).
//
// Caddy's admin API exposes the live state of every upstream the
// running config knows about at GET /reverse_proxy/upstreams. The
// returned shape is a JSON array of objects:
//
//	[
//	  { "address": "10.0.0.1:8080", "num_requests": 42, "fails": 1 },
//	  ...
//	]
//
// `fails` is the rolling failure count Caddy maintains for the
// passive-health-check window. `num_requests` is the in-flight
// request count.
//
// We poll this endpoint on a fixed interval, cache the latest
// snapshot in an atomic.Pointer, and expose accessor methods to
// REST/gRPC callers — the admin panel renders the cached data
// instead of round-tripping through Caddy on every page view.
//
// The cache contains a timestamp so callers can decide whether the
// data is stale enough to warrant a forced refresh.
package caddy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"
)

// UpstreamHealth mirrors a single object from Caddy's
// /reverse_proxy/upstreams endpoint.
type UpstreamHealth struct {
	Address     string `json:"address"`
	NumRequests int    `json:"num_requests"`
	Fails       int    `json:"fails"`
}

// UpstreamHealthSnapshot is the cached result of one poll cycle.
// PolledAt is the wall-clock time the cache was last refreshed; an
// empty Upstreams slice + zero PolledAt means "never polled".
type UpstreamHealthSnapshot struct {
	PolledAt  time.Time        `json:"polled_at"`
	Upstreams []UpstreamHealth `json:"upstreams"`
}

// UpstreamHealthPoller queries Caddy's /reverse_proxy/upstreams on
// an interval and caches the result. It is safe for concurrent
// reads via the Snapshot method.
type UpstreamHealthPoller struct {
	adminAddr string
	interval  time.Duration
	client    *http.Client
	log       *slog.Logger
	snapshot  atomic.Pointer[UpstreamHealthSnapshot]
	stopCh    chan struct{}
	doneCh    chan struct{}
}

// NewUpstreamHealthPoller creates a poller that hits the supplied
// Caddy admin address (e.g. "127.0.0.1:2019"). The interval is
// clamped to at least 1s — sub-second polling would just hammer
// the admin API for no benefit since Caddy aggregates fail counts
// over much longer windows.
func NewUpstreamHealthPoller(adminAddr string, interval time.Duration, logger *slog.Logger) *UpstreamHealthPoller {
	if interval < time.Second {
		interval = time.Second
	}
	p := &UpstreamHealthPoller{
		adminAddr: adminAddr,
		interval:  interval,
		client:    &http.Client{Timeout: 5 * time.Second},
		log:       logger,
		stopCh:    make(chan struct{}),
		doneCh:    make(chan struct{}),
	}
	// Seed with an empty snapshot so callers can always read a non-nil
	// pointer even before the first poll completes.
	p.snapshot.Store(&UpstreamHealthSnapshot{Upstreams: []UpstreamHealth{}})
	return p
}

// Start begins polling. Performs an immediate poll so callers don't
// see an empty cache for the first interval.
func (p *UpstreamHealthPoller) Start(ctx context.Context) {
	go p.run(ctx)
}

// Stop signals the poller to stop and waits for it to drain.
func (p *UpstreamHealthPoller) Stop() {
	close(p.stopCh)
	<-p.doneCh
}

// Snapshot returns the most recently cached snapshot. Never nil.
func (p *UpstreamHealthPoller) Snapshot() *UpstreamHealthSnapshot {
	return p.snapshot.Load()
}

func (p *UpstreamHealthPoller) run(ctx context.Context) {
	defer close(p.doneCh)

	// Initial poll so the cache is populated immediately.
	if err := p.pollOnce(ctx); err != nil {
		p.log.Debug("initial poll failed", "error", err)
	}

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-p.stopCh:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := p.pollOnce(ctx); err != nil {
				// Log at debug — the admin API is allowed to be
				// briefly unreachable (Caddy restart, etc) and
				// repeated warnings would spam logs.
				p.log.Debug("poll failed", "error", err)
			}
		}
	}
}

// pollOnce queries the admin API and atomically swaps in the new
// snapshot. On failure the previous snapshot is preserved — callers
// see stale-but-not-empty data rather than a sudden zero state.
func (p *UpstreamHealthPoller) pollOnce(ctx context.Context) error {
	url := fmt.Sprintf("http://%s/reverse_proxy/upstreams", p.adminAddr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("call admin API: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("admin API returned %d: %s", resp.StatusCode, body)
	}

	var ups []UpstreamHealth
	if err := json.NewDecoder(resp.Body).Decode(&ups); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	if ups == nil {
		// Defensive: ensure callers always see a non-nil slice.
		ups = []UpstreamHealth{}
	}

	p.snapshot.Store(&UpstreamHealthSnapshot{
		PolledAt:  time.Now().UTC(),
		Upstreams: ups,
	})
	return nil
}
