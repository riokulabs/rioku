package canary

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

const (
	primaryURL = "http://primary.test:8080"
	canaryURL  = "http://canary.test:8081"
	primaryHost = "primary.test:8080"
	canaryHost  = "canary.test:8081"
)

// recordingNext captures r.URL.Host so tests can assert which
// upstream was picked. The Canary handler rewrites Host before
// calling next; recording it here is the contract the routing
// tests rely on.
type recordingNext struct {
	host   string
	scheme string
	calls  int
}

func (rn *recordingNext) handler() caddyhttp.Handler {
	return caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		rn.host = r.URL.Host
		rn.scheme = r.URL.Scheme
		rn.calls++
		w.WriteHeader(http.StatusOK)
		return nil
	})
}

func provisioned(t *testing.T, c *Canary) {
	t.Helper()
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := c.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func newRequest() *http.Request {
	return httptest.NewRequest("GET", "http://gateway.test/", nil)
}

func TestCanary_ZeroWeight_AllPrimary(t *testing.T) {
	c := &Canary{
		PrimaryUpstream: primaryURL,
		CanaryUpstream:  canaryURL,
		CanaryWeight:    0.0,
	}
	provisioned(t, c)

	const trials = 1000
	primary, canary := tally(t, c, trials, "")
	if canary != 0 {
		t.Fatalf("zero-weight canary should never route to canary, got %d/%d", canary, trials)
	}
	if primary != trials {
		t.Fatalf("zero-weight expected all primary, got %d/%d", primary, trials)
	}
}

func TestCanary_FullWeight_AllCanary(t *testing.T) {
	c := &Canary{
		PrimaryUpstream: primaryURL,
		CanaryUpstream:  canaryURL,
		CanaryWeight:    1.0,
	}
	provisioned(t, c)

	const trials = 1000
	primary, canary := tally(t, c, trials, "")
	if primary != 0 {
		t.Fatalf("full-weight canary should never route to primary, got %d/%d", primary, trials)
	}
	if canary != trials {
		t.Fatalf("full-weight expected all canary, got %d/%d", canary, trials)
	}
}

func TestCanary_HalfWeight_RoughlyEven(t *testing.T) {
	c := &Canary{
		PrimaryUpstream: primaryURL,
		CanaryUpstream:  canaryURL,
		CanaryWeight:    0.5,
	}
	provisioned(t, c)

	const trials = 1000
	primary, canary := tally(t, c, trials, "")
	// Loose 400-600 band per spec — gives ~3.4 sigma either side
	// of the mean for p=0.5, n=1000 (sigma=~16) so the test is
	// effectively flake-free.
	if canary < 400 || canary > 600 {
		t.Fatalf("0.5 weight expected canary in [400, 600], got %d (primary=%d)", canary, primary)
	}
	if primary < 400 || primary > 600 {
		t.Fatalf("0.5 weight expected primary in [400, 600], got %d (canary=%d)", primary, canary)
	}
}

func TestCanary_StickyHeader_ConsistentForSameValue(t *testing.T) {
	c := &Canary{
		PrimaryUpstream: primaryURL,
		CanaryUpstream:  canaryURL,
		CanaryWeight:    0.5,
		StickyHeader:    "X-Session-Id",
	}
	provisioned(t, c)

	const sessions = 50
	const replays = 20
	for s := 0; s < sessions; s++ {
		sessionID := sessionIDFor(s)
		// First request fixes the choice.
		first := routeOnce(t, c, sessionID)
		// Subsequent requests with the same value must land on
		// the same upstream every time.
		for r := 0; r < replays; r++ {
			got := routeOnce(t, c, sessionID)
			if got != first {
				t.Fatalf("session %q replay %d: got host %q, want %q",
					sessionID, r, got, first)
			}
		}
	}
}

func TestCanary_StickyHeader_DifferentValuesCanSplit(t *testing.T) {
	c := &Canary{
		PrimaryUpstream: primaryURL,
		CanaryUpstream:  canaryURL,
		CanaryWeight:    0.5,
		StickyHeader:    "X-Session-Id",
	}
	provisioned(t, c)

	// With weight 0.5 across many distinct session IDs we expect
	// both upstreams to appear at least once. p(all-primary) over
	// 200 trials is 0.5^200 ≈ 0, so this is not flaky.
	sawPrimary := false
	sawCanary := false
	for i := 0; i < 200; i++ {
		host := routeOnce(t, c, sessionIDFor(i))
		switch host {
		case primaryHost:
			sawPrimary = true
		case canaryHost:
			sawCanary = true
		default:
			t.Fatalf("unexpected host %q", host)
		}
		if sawPrimary && sawCanary {
			return
		}
	}
	t.Fatalf("distinct session ids did not split across upstreams (primary=%v canary=%v)",
		sawPrimary, sawCanary)
}

func TestCanary_StickyTTL_Eviction(t *testing.T) {
	c := &Canary{
		PrimaryUpstream:  primaryURL,
		CanaryUpstream:   canaryURL,
		CanaryWeight:     0.5,
		StickyHeader:     "X-Session-Id",
		StickyTTLSeconds: 1, // floor of 1s — see provisioned-TTL override below
	}
	provisioned(t, c)
	// Override the TTL to a sub-second value for the test only.
	// Provision clamps StickyTTLSeconds to seconds, but the
	// internal stickyTTL field is a Duration we can set directly.
	c.stickyTTL = 50 * time.Millisecond

	const sessionID = "sticky-session"

	// Pin the first decision and capture it.
	first := routeOnce(t, c, sessionID)

	// Within the TTL the choice must hold.
	again := routeOnce(t, c, sessionID)
	if again != first {
		t.Fatalf("within TTL: got %q, want %q", again, first)
	}

	// Wait for the entry to expire and force a fresh sample
	// using a deterministic-extreme weight so we can assert the
	// eviction path actually runs.
	time.Sleep(100 * time.Millisecond)

	// The expired entry must be evicted on next lookup. Confirm
	// by reading directly from the affinity map after a load.
	if _, ok := c.affinity.Load(sessionID); !ok {
		t.Fatalf("expected entry present (lazily evicted on lookup), got missing pre-call")
	}
	// Trigger the load path — loadSticky is what evicts.
	if _, ok := c.loadSticky(sessionID); ok {
		t.Fatalf("loadSticky on expired entry should report miss")
	}
	if _, ok := c.affinity.Load(sessionID); ok {
		t.Fatalf("expired entry should be evicted from affinity map after loadSticky")
	}
}

func TestCanary_Provision_RejectsInvalidConfig(t *testing.T) {
	cases := []struct {
		name   string
		canary Canary
		want   string
	}{
		{
			name:   "missing primary",
			canary: Canary{CanaryUpstream: canaryURL},
			want:   "primary_upstream is required",
		},
		{
			name:   "missing canary",
			canary: Canary{PrimaryUpstream: primaryURL},
			want:   "canary_upstream is required",
		},
		{
			name: "primary lacks scheme",
			canary: Canary{
				PrimaryUpstream: "primary.test:8080",
				CanaryUpstream:  canaryURL,
			},
			want: "primary_upstream",
		},
		{
			name: "canary lacks host",
			canary: Canary{
				PrimaryUpstream: primaryURL,
				CanaryUpstream:  "http://",
			},
			want: "canary_upstream",
		},
		{
			name: "primary unparseable",
			canary: Canary{
				PrimaryUpstream: "://bad-url",
				CanaryUpstream:  canaryURL,
			},
			want: "primary_upstream",
		},
		{
			name: "weight negative",
			canary: Canary{
				PrimaryUpstream: primaryURL,
				CanaryUpstream:  canaryURL,
				CanaryWeight:    -0.1,
			},
			want: "out of range",
		},
		{
			name: "weight greater than one",
			canary: Canary{
				PrimaryUpstream: primaryURL,
				CanaryUpstream:  canaryURL,
				CanaryWeight:    1.5,
			},
			want: "out of range",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
			defer cancel()
			err := tc.canary.Provision(ctx)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.want)
			}
			if !contains(err.Error(), tc.want) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.want)
			}
		})
	}
}

func TestCanary_Provision_AcceptsValidWeights(t *testing.T) {
	for _, w := range []float64{0.0, 0.05, 0.5, 0.95, 1.0} {
		c := &Canary{
			PrimaryUpstream: primaryURL,
			CanaryUpstream:  canaryURL,
			CanaryWeight:    w,
		}
		ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
		if err := c.Provision(ctx); err != nil {
			t.Errorf("weight %v: unexpected error %v", w, err)
		}
		cancel()
	}
}

func TestCanary_UnmarshalCaddyfile_DefaultsWeight(t *testing.T) {
	d := caddyfile.NewTestDispenser(`rioku_canary {
	primary_upstream http://primary.test:8080
	canary_upstream http://canary.test:8081
}`)
	var c Canary
	if err := c.UnmarshalCaddyfile(d); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if c.CanaryWeight != defaultCanaryWeight {
		t.Errorf("CanaryWeight = %v, want default %v", c.CanaryWeight, defaultCanaryWeight)
	}
	if c.PrimaryUpstream != primaryURL {
		t.Errorf("PrimaryUpstream = %q, want %q", c.PrimaryUpstream, primaryURL)
	}
	if c.CanaryUpstream != canaryURL {
		t.Errorf("CanaryUpstream = %q, want %q", c.CanaryUpstream, canaryURL)
	}
}

func TestCanary_UnmarshalCaddyfile_RespectsExplicitWeight(t *testing.T) {
	d := caddyfile.NewTestDispenser(`rioku_canary {
	primary_upstream http://primary.test:8080
	canary_upstream http://canary.test:8081
	canary_weight 0.25
	sticky_header X-Session-Id
	sticky_ttl_seconds 600
}`)
	var c Canary
	if err := c.UnmarshalCaddyfile(d); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if c.CanaryWeight != 0.25 {
		t.Errorf("CanaryWeight = %v, want 0.25", c.CanaryWeight)
	}
	if c.StickyHeader != "X-Session-Id" {
		t.Errorf("StickyHeader = %q, want X-Session-Id", c.StickyHeader)
	}
	if c.StickyTTLSeconds != 600 {
		t.Errorf("StickyTTLSeconds = %d, want 600", c.StickyTTLSeconds)
	}
}

func TestCanary_UnmarshalCaddyfile_UnknownDirective(t *testing.T) {
	d := caddyfile.NewTestDispenser(`rioku_canary {
	bogus value
}`)
	var c Canary
	if err := c.UnmarshalCaddyfile(d); err == nil {
		t.Fatalf("expected error on unknown directive")
	}
}

// tally drives n requests through the handler and returns the count
// landing on each upstream. A fixed sticky value, when supplied,
// pins every request to the same affinity bucket.
func tally(t *testing.T, c *Canary, n int, fixedSticky string) (primary, canary int) {
	t.Helper()
	for i := 0; i < n; i++ {
		host := routeOnce(t, c, fixedSticky)
		switch host {
		case primaryHost:
			primary++
		case canaryHost:
			canary++
		default:
			t.Fatalf("trial %d: unexpected host %q", i, host)
		}
	}
	return primary, canary
}

// routeOnce executes a single request and returns the host the
// handler routed it to. When stickyValue is non-empty it is
// stamped on the configured StickyHeader.
func routeOnce(t *testing.T, c *Canary, stickyValue string) string {
	t.Helper()
	rec := &recordingNext{}
	req := newRequest()
	if stickyValue != "" && c.StickyHeader != "" {
		req.Header.Set(c.StickyHeader, stickyValue)
	}
	w := httptest.NewRecorder()
	if err := c.ServeHTTP(w, req, rec.handler()); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.calls != 1 {
		t.Fatalf("next called %d times, want 1", rec.calls)
	}
	return rec.host
}

func sessionIDFor(i int) string {
	// Stable per-index session ids; fmt.Sprintf would be fine but
	// avoiding the import keeps the helper allocation-free.
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	if i == 0 {
		return "sess-0"
	}
	out := []byte("sess-")
	for i > 0 {
		out = append(out, digits[i%len(digits)])
		i /= len(digits)
	}
	return string(out)
}

func contains(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
