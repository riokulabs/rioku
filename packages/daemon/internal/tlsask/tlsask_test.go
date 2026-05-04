package tlsask

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// helper — build a snapshot with the supplied (host, enabled) tuples.
// Each element becomes a Route with one Matcher carrying that single host.
func snapshot(routes ...routeSpec) *riokuv1.ConfigSnapshot {
	snap := &riokuv1.ConfigSnapshot{}
	for i, r := range routes {
		snap.Routes = append(snap.Routes, &riokuv1.Route{
			Id:       routeID(i),
			Enabled:  r.enabled,
			Matchers: []*riokuv1.Matcher{{Hosts: r.hosts}},
		})
	}
	return snap
}

func routeID(i int) string {
	return string(rune('a' + i))
}

type routeSpec struct {
	hosts   []string
	enabled bool
}

// ─── Matcher tests ──────────────────────────────────────────────────────────

func TestMatcher_ExactHostMatch(t *testing.T) {
	m := BuildMatcher(snapshot(routeSpec{hosts: []string{"example.com"}, enabled: true}))
	if !m.Allow("example.com") {
		t.Error("expected exact host to match")
	}
	if m.Allow("EXAMPLE.COM") == false {
		t.Error("expected case-insensitive match")
	}
	if m.Allow("other.com") {
		t.Error("expected unrelated host to not match")
	}
}

func TestMatcher_DisabledRouteIgnored(t *testing.T) {
	m := BuildMatcher(snapshot(routeSpec{hosts: []string{"example.com"}, enabled: false}))
	if m.Allow("example.com") {
		t.Error("disabled route should not contribute hosts")
	}
}

func TestMatcher_WildcardSingleLabel(t *testing.T) {
	m := BuildMatcher(snapshot(routeSpec{hosts: []string{"*.example.com"}, enabled: true}))

	if !m.Allow("foo.example.com") {
		t.Error("expected single-label wildcard match")
	}
	if !m.Allow("bar.example.com") {
		t.Error("expected sibling label match")
	}
	// Per Caddy convention "*.example.com" does NOT match the apex.
	if m.Allow("example.com") {
		t.Error("wildcard must not match apex")
	}
	// Nested labels also must not match a single-label wildcard.
	if m.Allow("a.b.example.com") {
		t.Error("wildcard must not match nested labels")
	}
	// Different domain entirely.
	if m.Allow("foo.other.com") {
		t.Error("wildcard must not match unrelated domain")
	}
}

func TestMatcher_NestedWildcard(t *testing.T) {
	m := BuildMatcher(snapshot(routeSpec{hosts: []string{"*.foo.example.com"}, enabled: true}))

	if !m.Allow("a.foo.example.com") {
		t.Error("expected nested wildcard to match one label below foo.example.com")
	}
	if m.Allow("foo.example.com") {
		t.Error("nested wildcard must not match its own apex")
	}
	if m.Allow("a.b.foo.example.com") {
		t.Error("nested wildcard must not match double label below")
	}
}

func TestMatcher_BareWildcardIgnored(t *testing.T) {
	m := BuildMatcher(snapshot(routeSpec{hosts: []string{"*"}, enabled: true}))
	if m.Allow("anything.com") {
		t.Error("bare '*' must NEVER allow a domain — would defeat the gate")
	}
}

func TestMatcher_EmptyAndWhitespaceIgnored(t *testing.T) {
	m := BuildMatcher(snapshot(routeSpec{hosts: []string{"", "  ", "real.com"}, enabled: true}))
	if !m.Allow("real.com") {
		t.Error("real host should still match alongside empties")
	}
	if m.Allow("") {
		t.Error("empty domain query must not match")
	}
}

func TestMatcher_MultipleRoutesOverlap(t *testing.T) {
	m := BuildMatcher(snapshot(
		routeSpec{hosts: []string{"a.example.com"}, enabled: true},
		routeSpec{hosts: []string{"b.example.com"}, enabled: true},
		routeSpec{hosts: []string{"*.example.com"}, enabled: true},
	))
	if !m.Allow("a.example.com") {
		t.Error("exact match should win")
	}
	if !m.Allow("c.example.com") {
		t.Error("wildcard fallback should match")
	}
	if m.Allow("example.com") {
		t.Error("apex still rejected")
	}
}

func TestMatcher_NilSnapshotReturnsEmpty(t *testing.T) {
	m := BuildMatcher(nil)
	if m == nil {
		t.Fatal("BuildMatcher(nil) must return a non-nil matcher")
	}
	if m.Allow("anything.com") {
		t.Error("nil-snapshot matcher must reject everything")
	}
}

func TestMatcher_StatsCount(t *testing.T) {
	m := BuildMatcher(snapshot(
		routeSpec{hosts: []string{"a.com", "b.com", "*.x.com"}, enabled: true},
		routeSpec{hosts: []string{"*.y.com"}, enabled: true},
	))
	exact, wild := m.Stats()
	if exact != 2 {
		t.Errorf("exact = %d, want 2", exact)
	}
	if wild != 2 {
		t.Errorf("wildcards = %d, want 2", wild)
	}
}

// ─── Handler / Server tests ─────────────────────────────────────────────────

func TestHandler_KnownDomainReturns200(t *testing.T) {
	s := New()
	s.SetSnapshot(snapshot(routeSpec{hosts: []string{"known.example.com"}, enabled: true}))

	req := httptest.NewRequest(http.MethodGet, "/tls/ask?domain=known.example.com", nil)
	rec := httptest.NewRecorder()
	s.handleAsk(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestHandler_UnknownDomainReturns403(t *testing.T) {
	s := New()
	s.SetSnapshot(snapshot(routeSpec{hosts: []string{"known.example.com"}, enabled: true}))

	req := httptest.NewRequest(http.MethodGet, "/tls/ask?domain=stranger.example.com", nil)
	rec := httptest.NewRecorder()
	s.handleAsk(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 for unknown domain, got %d", rec.Code)
	}
}

func TestHandler_DisabledRouteReturns403(t *testing.T) {
	s := New()
	s.SetSnapshot(snapshot(routeSpec{hosts: []string{"shut.example.com"}, enabled: false}))

	req := httptest.NewRequest(http.MethodGet, "/tls/ask?domain=shut.example.com", nil)
	rec := httptest.NewRecorder()
	s.handleAsk(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 for disabled-route domain, got %d", rec.Code)
	}
}

func TestHandler_WildcardMatchReturns200(t *testing.T) {
	s := New()
	s.SetSnapshot(snapshot(routeSpec{hosts: []string{"*.example.com"}, enabled: true}))

	req := httptest.NewRequest(http.MethodGet, "/tls/ask?domain=sub.example.com", nil)
	rec := httptest.NewRecorder()
	s.handleAsk(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for wildcard match, got %d", rec.Code)
	}
}

func TestHandler_MissingDomainReturns400(t *testing.T) {
	s := New()
	req := httptest.NewRequest(http.MethodGet, "/tls/ask", nil)
	rec := httptest.NewRecorder()
	s.handleAsk(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing domain param, got %d", rec.Code)
	}
}

func TestHandler_InitialMatcherIsDenyAll(t *testing.T) {
	// Newly constructed Server should reject everything until SetSnapshot
	// is called — fail-safe default.
	s := New()
	req := httptest.NewRequest(http.MethodGet, "/tls/ask?domain=anything.com", nil)
	rec := httptest.NewRecorder()
	s.handleAsk(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("fresh server should deny all, got %d", rec.Code)
	}
}

func TestHandler_AtomicSnapshotSwap(t *testing.T) {
	// Verify SetSnapshot atomically swaps in a new matcher visible to
	// concurrent readers without locking.
	s := New()
	s.SetSnapshot(snapshot(routeSpec{hosts: []string{"a.com"}, enabled: true}))

	// Sanity check.
	if !s.matcher.Load().Allow("a.com") {
		t.Fatal("first snapshot should allow a.com")
	}

	s.SetSnapshot(snapshot(routeSpec{hosts: []string{"b.com"}, enabled: true}))

	if s.matcher.Load().Allow("a.com") {
		t.Error("after swap, a.com should no longer match")
	}
	if !s.matcher.Load().Allow("b.com") {
		t.Error("after swap, b.com should match")
	}
}

// ─── Listen loopback enforcement ────────────────────────────────────────────

func TestListen_RejectsAllInterfaces(t *testing.T) {
	s := New()
	if err := s.Listen("0.0.0.0:0"); err == nil {
		t.Error("Listen on 0.0.0.0 must fail — security boundary")
	}
}

func TestListen_RejectsBareIPv6(t *testing.T) {
	s := New()
	if err := s.Listen("[::]:0"); err == nil {
		t.Error("Listen on [::] must fail")
	}
}

func TestListen_RejectsPublicIP(t *testing.T) {
	s := New()
	// Use a documented-only address that won't actually bind, but the
	// loopback check should reject it before bind anyway.
	if err := s.Listen("8.8.8.8:7780"); err == nil {
		t.Error("Listen on a non-loopback IP must fail")
	}
}

func TestListen_RejectsNonIPHost(t *testing.T) {
	s := New()
	if err := s.Listen("evil.example.com:7780"); err == nil {
		t.Error("Listen on a non-IP host (other than 'localhost') must fail")
	}
}

func TestListen_AcceptsLoopback127(t *testing.T) {
	s := New()
	if err := s.Listen("127.0.0.1:0"); err != nil {
		t.Errorf("Listen on 127.0.0.1 should succeed, got %v", err)
	}
	defer func() { _ = s.Shutdown() }()
}

func TestListen_AcceptsLoopbackLocalhost(t *testing.T) {
	s := New()
	if err := s.Listen("localhost:0"); err != nil {
		t.Errorf("Listen on localhost should succeed, got %v", err)
	}
	defer func() { _ = s.Shutdown() }()
}

func TestListen_RejectsMissingPort(t *testing.T) {
	s := New()
	if err := s.Listen("127.0.0.1"); err == nil {
		t.Error("Listen without port must fail")
	}
}

// ─── End-to-end through net/http ────────────────────────────────────────────

func TestServer_EndToEnd(t *testing.T) {
	s := New()
	s.SetSnapshot(snapshot(routeSpec{hosts: []string{"end.example.com"}, enabled: true}))

	if err := s.Listen("127.0.0.1:0"); err != nil {
		t.Fatalf("Listen: %v", err)
	}
	go func() { _ = s.Serve() }()
	defer func() { _ = s.Shutdown() }()

	resp, err := http.Get("http://" + s.Addr() + "/tls/ask?domain=end.example.com")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Errorf("expected 200, got %d (body: %s)", resp.StatusCode, body)
	}
}
