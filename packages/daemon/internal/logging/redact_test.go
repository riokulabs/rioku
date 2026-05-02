package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/config"
)

// newTestLogger returns a slog.Logger writing JSON into buf, wrapped in
// a RedactingHandler that applies rules.
func newTestLogger(buf *bytes.Buffer, rules []config.FilterRule) *slog.Logger {
	inner := slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	return slog.New(NewRedactingHandler(inner, rules))
}

// decode unmarshals a single JSON record from buf and returns it.
func decode(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(buf.Bytes(), &m); err != nil {
		t.Fatalf("decode log line %q: %v", buf.String(), err)
	}
	return m
}

// ─── ip_mask ────────────────────────────────────────────────────────────────

func TestRedact_IPMask_IPv4String(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindIPMask, Target: "client_ip"},
	})
	log.Info("req", "client_ip", "192.168.1.42")
	got := decode(t, &buf)
	if got["client_ip"] != "192.168.1.0" {
		t.Errorf("client_ip = %q, want 192.168.1.0", got["client_ip"])
	}
}

func TestRedact_IPMask_IPv4NetIPValue(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindIPMask, Target: "client_ip"},
	})
	log.Info("req", "client_ip", net.ParseIP("10.0.0.99"))
	got := decode(t, &buf)
	if got["client_ip"] != "10.0.0.0" {
		t.Errorf("client_ip = %q, want 10.0.0.0", got["client_ip"])
	}
}

func TestRedact_IPMask_IPv6(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindIPMask, Target: "client_ip"},
	})
	log.Info("req", "client_ip", "2001:db8:abcd:0012:1234:5678:9abc:def0")
	got := decode(t, &buf)
	masked, ok := got["client_ip"].(string)
	if !ok {
		t.Fatalf("client_ip not a string: %#v", got["client_ip"])
	}
	parsed := net.ParseIP(masked)
	if parsed == nil {
		t.Fatalf("masked client_ip %q is not a valid IP", masked)
	}
	v6 := parsed.To16()
	if v6 == nil || parsed.To4() != nil {
		t.Fatalf("expected IPv6, got %q", masked)
	}
	for i := 8; i < 16; i++ {
		if v6[i] != 0 {
			t.Errorf("byte %d not zeroed: %v", i, v6)
		}
	}
	// And the prefix must be retained.
	want := net.ParseIP("2001:db8:abcd:12::").To16()
	if !bytes.Equal(v6, want) {
		t.Errorf("masked = %v, want %v", v6, want)
	}
}

func TestRedact_IPMask_NonIPStringPassesThrough(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindIPMask, Target: "client_ip"},
	})
	log.Info("req", "client_ip", "not-an-ip")
	got := decode(t, &buf)
	if got["client_ip"] != "not-an-ip" {
		t.Errorf("client_ip = %q, want unchanged", got["client_ip"])
	}
}

// ─── hash ───────────────────────────────────────────────────────────────────

func TestRedact_Hash_Deterministic(t *testing.T) {
	rules := []config.FilterRule{{Kind: FilterKindHash, Target: "user_id"}}

	var buf1, buf2 bytes.Buffer
	newTestLogger(&buf1, rules).Info("a", "user_id", "alice@example.com")
	newTestLogger(&buf2, rules).Info("b", "user_id", "alice@example.com")

	g1 := decode(t, &buf1)["user_id"].(string)
	g2 := decode(t, &buf2)["user_id"].(string)
	if g1 != g2 {
		t.Errorf("hash not deterministic: %q vs %q", g1, g2)
	}
	if !strings.HasPrefix(g1, "sha256:") {
		t.Errorf("missing sha256: prefix: %q", g1)
	}
	// "sha256:" + 8 hex chars
	if len(g1) != len("sha256:")+8 {
		t.Errorf("unexpected hash length: %q (len=%d)", g1, len(g1))
	}
}

func TestRedact_Hash_DifferentInputsDiffer(t *testing.T) {
	rules := []config.FilterRule{{Kind: FilterKindHash, Target: "user_id"}}
	var bufA, bufB bytes.Buffer
	newTestLogger(&bufA, rules).Info("a", "user_id", "alice@example.com")
	newTestLogger(&bufB, rules).Info("b", "user_id", "bob@example.com")
	a := decode(t, &bufA)["user_id"].(string)
	b := decode(t, &bufB)["user_id"].(string)
	if a == b {
		t.Errorf("expected distinct hashes, both = %q", a)
	}
}

func TestRedact_Hash_StringAttr(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindHash, Target: "token"},
	})
	log.Info("auth", "token", "secret-bearer-xyz")
	got := decode(t, &buf)
	tok, _ := got["token"].(string)
	if !strings.HasPrefix(tok, "sha256:") || len(tok) != len("sha256:")+8 {
		t.Errorf("token not hashed: %q", tok)
	}
}

// ─── cookie_redact ──────────────────────────────────────────────────────────

func TestRedact_Cookie_PreservesNamesRedactsValues(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindCookieRedact, Target: "cookie"},
	})
	log.Info("req", "cookie", "sid=abc123")
	got := decode(t, &buf)
	if got["cookie"] != "sid=[redacted]" {
		t.Errorf("cookie = %q, want sid=[redacted]", got["cookie"])
	}
}

func TestRedact_Cookie_MultiValue(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindCookieRedact, Target: "cookie"},
	})
	log.Info("req", "cookie", "sid=abc123; theme=dark; csrf=tokenvalue")
	got := decode(t, &buf)
	want := "sid=[redacted]; theme=[redacted]; csrf=[redacted]"
	if got["cookie"] != want {
		t.Errorf("cookie = %q, want %q", got["cookie"], want)
	}
}

func TestRedact_SetCookie_PreservesAttributes(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindCookieRedact, Target: "set-cookie"},
	})
	log.Info("resp", "set-cookie", "sid=abc123; Path=/; HttpOnly; SameSite=Strict")
	got := decode(t, &buf)
	val, _ := got["set-cookie"].(string)
	if !strings.HasPrefix(val, "sid=[redacted]") {
		t.Errorf("set-cookie did not redact value: %q", val)
	}
	for _, attr := range []string{"Path=/", "HttpOnly", "SameSite=Strict"} {
		if !strings.Contains(val, attr) {
			t.Errorf("set-cookie lost attribute %q: %q", attr, val)
		}
	}
}

func TestRedact_Cookie_NonCookieKeyUntouched(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindCookieRedact, Target: "authorization"},
	})
	// cookie_redact is documented to operate only on cookie / set-cookie
	// keys; binding it elsewhere is a no-op.
	log.Info("req", "authorization", "Bearer xyz")
	got := decode(t, &buf)
	if got["authorization"] != "Bearer xyz" {
		t.Errorf("authorization = %q, want unchanged", got["authorization"])
	}
}

// ─── exact-key match (no glob in v1) ────────────────────────────────────────

func TestRedact_ExactKeyMatchOnly(t *testing.T) {
	var buf bytes.Buffer
	// Glob-like target should NOT match arbitrary keys — v1 is exact match
	// only. The rule should simply do nothing.
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindHash, Target: "request.headers.*"},
	})
	log.Info("req", "request.headers.authorization", "Bearer secret")
	got := decode(t, &buf)
	if got["request.headers.authorization"] != "Bearer secret" {
		t.Errorf("expected glob NOT to match in v1, got %q", got["request.headers.authorization"])
	}
}

func TestRedact_NonMatchingKeyUntouched(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindIPMask, Target: "client_ip"},
	})
	log.Info("req", "server_ip", "10.0.0.5")
	got := decode(t, &buf)
	if got["server_ip"] != "10.0.0.5" {
		t.Errorf("server_ip = %q, want unchanged", got["server_ip"])
	}
}

// ─── nested groups ──────────────────────────────────────────────────────────

func TestRedact_NestedGroupsWalkedRecursively(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: FilterKindIPMask, Target: "client_ip"},
		{Kind: FilterKindHash, Target: "token"},
	})
	log.Info("req",
		slog.Group("request",
			slog.String("client_ip", "172.16.5.9"),
			slog.Group("auth", slog.String("token", "topsecret")),
		),
	)
	got := decode(t, &buf)
	req, ok := got["request"].(map[string]any)
	if !ok {
		t.Fatalf("request group missing: %#v", got)
	}
	if req["client_ip"] != "172.16.5.0" {
		t.Errorf("nested client_ip = %q, want 172.16.5.0", req["client_ip"])
	}
	auth, ok := req["auth"].(map[string]any)
	if !ok {
		t.Fatalf("auth group missing: %#v", req)
	}
	tok, _ := auth["token"].(string)
	if !strings.HasPrefix(tok, "sha256:") {
		t.Errorf("nested token not hashed: %q", tok)
	}
}

// ─── handler plumbing ───────────────────────────────────────────────────────

func TestRedact_WithAttrsScrubsBoundAttrs(t *testing.T) {
	// Attributes pre-bound via WithAttrs (logger.With(...)) bypass the
	// per-record path and travel with the handler. Verify they are
	// still redacted before reaching the inner handler.
	var buf bytes.Buffer
	inner := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	red := NewRedactingHandler(inner, []config.FilterRule{
		{Kind: FilterKindIPMask, Target: "client_ip"},
	})
	log := slog.New(red).With("client_ip", "192.168.1.99")
	log.Info("req")
	got := decode(t, &buf)
	if got["client_ip"] != "192.168.1.0" {
		t.Errorf("bound client_ip = %q, want masked", got["client_ip"])
	}
}

func TestRedact_EmptyRulesIsPassthrough(t *testing.T) {
	var buf bytes.Buffer
	log := newTestLogger(&buf, nil)
	log.Info("hello", "client_ip", "1.2.3.4")
	got := decode(t, &buf)
	if got["client_ip"] != "1.2.3.4" {
		t.Errorf("client_ip = %q, want passthrough", got["client_ip"])
	}
	if got["msg"] != "hello" {
		t.Errorf("msg = %q, want hello", got["msg"])
	}
}

func TestRedact_EnabledDelegates(t *testing.T) {
	var buf bytes.Buffer
	inner := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})
	red := NewRedactingHandler(inner, []config.FilterRule{
		{Kind: FilterKindHash, Target: "x"},
	})
	if red.Enabled(context.Background(), slog.LevelDebug) {
		t.Error("debug should be disabled")
	}
	if !red.Enabled(context.Background(), slog.LevelError) {
		t.Error("error should be enabled")
	}
}

func TestRedact_UnknownKindIsNoop(t *testing.T) {
	// Forward-compat: a config that names a rule kind we don't
	// understand must not crash and must not corrupt the value.
	var buf bytes.Buffer
	log := newTestLogger(&buf, []config.FilterRule{
		{Kind: "future_kind_we_dont_know", Target: "client_ip"},
	})
	log.Info("req", "client_ip", "1.2.3.4")
	got := decode(t, &buf)
	if got["client_ip"] != "1.2.3.4" {
		t.Errorf("unknown kind mutated value: %q", got["client_ip"])
	}
}

func TestRedact_SetupWiresHandler(t *testing.T) {
	// Smoke-test the Setup wiring path: a config carrying redact rules
	// produces a default logger that scrubs records as expected.
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "json",
		Output: "stderr",
		RedactRules: []config.FilterRule{
			{Kind: FilterKindIPMask, Target: "client_ip"},
		},
	}
	if _, _, err := Setup(cfg, nil); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	// Setup installs the global default logger; the only check we
	// can perform without piping our own writer is that Setup
	// succeeded with the new field populated.
}
