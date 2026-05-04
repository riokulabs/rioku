// Package logging — PII redaction handler.
//
// RedactingHandler decorates an slog.Handler with a configurable set of
// FilterRules that rewrite attribute values before they reach the inner
// handler. It sits at the outermost layer of the daemon's logging chain
// (after ContextHandler and any MultiHandler fan-out) so every record —
// including those produced by deferred grouping or pre-bound attributes —
// is scrubbed exactly once before emission.
//
// v1 supports three rule kinds:
//
//   - ip_mask       — IPv4: last octet → 0; IPv6: low 64 bits → 0. Accepts
//     either net.IP / *net.IP values or strings parseable via
//     net.ParseIP. Non-IP strings pass through untouched.
//   - hash          — sha256(value) truncated to 8 hex chars, prefixed with
//     "sha256:". Deterministic so correlation across log
//     lines is preserved.
//   - cookie_redact — parses Cookie / Set-Cookie style values and replaces
//     each value portion with "[redacted]" while leaving
//     names visible.
//
// Rules apply on exact attribute-key match (FilterRule.Target == attr.Key).
// Glob matching (e.g. "request.headers.*") is a planned follow-up; for v1
// callers must list each redacted key explicitly.
package logging

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"strings"

	"github.com/riokulabs/rioku/internal/config"
)

// Filter rule kinds. Keep in sync with the YAML surface documented on
// config.FilterRule.
const (
	FilterKindIPMask       = "ip_mask"
	FilterKindHash         = "hash"
	FilterKindCookieRedact = "cookie_redact"
)

// RedactingHandler wraps an slog.Handler and rewrites attribute values
// per a list of FilterRules before delegating to the inner handler.
//
// The handler is safe for concurrent use provided the inner handler is.
type RedactingHandler struct {
	inner slog.Handler
	rules map[string][]config.FilterRule // key → rules (exact match)
}

// NewRedactingHandler returns a handler that applies rules to record
// attributes before forwarding to inner. If rules is empty, the
// returned handler is functionally a passthrough but still wraps
// inner so callers do not need to special-case the empty list.
//
// TODO(#74 follow-up): support glob targets like "request.headers.*"
// so callers can scrub whole subtrees without enumerating every key.
func NewRedactingHandler(inner slog.Handler, rules []config.FilterRule) *RedactingHandler {
	idx := make(map[string][]config.FilterRule, len(rules))
	for _, r := range rules {
		if r.Target == "" || r.Kind == "" {
			continue
		}
		idx[r.Target] = append(idx[r.Target], r)
	}
	return &RedactingHandler{inner: inner, rules: idx}
}

// Enabled delegates to the inner handler.
func (h *RedactingHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

// Handle rebuilds the record with redacted attributes and forwards it.
//
// We can't mutate slog.Attrs in place via Record.Attrs (the iterator
// surfaces value copies), so we copy the record's metadata, walk the
// originals, and re-add a possibly-rewritten version. Groups are walked
// recursively so nested attributes get the same treatment as top-level
// ones.
func (h *RedactingHandler) Handle(ctx context.Context, r slog.Record) error {
	if len(h.rules) == 0 {
		return h.inner.Handle(ctx, r)
	}
	out := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
	r.Attrs(func(a slog.Attr) bool {
		out.AddAttrs(h.redactAttr(a))
		return true
	})
	return h.inner.Handle(ctx, out)
}

// WithAttrs forwards bound attributes to the inner handler after
// redacting any that match a configured rule. Pre-bound attributes
// would otherwise bypass Handle entirely.
func (h *RedactingHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(h.rules) == 0 {
		return &RedactingHandler{inner: h.inner.WithAttrs(attrs), rules: h.rules}
	}
	scrubbed := make([]slog.Attr, len(attrs))
	for i, a := range attrs {
		scrubbed[i] = h.redactAttr(a)
	}
	return &RedactingHandler{inner: h.inner.WithAttrs(scrubbed), rules: h.rules}
}

// WithGroup forwards to the inner handler. Group names themselves are
// not redacted (they are structural, not user data).
func (h *RedactingHandler) WithGroup(name string) slog.Handler {
	return &RedactingHandler{inner: h.inner.WithGroup(name), rules: h.rules}
}

// redactAttr returns a possibly-rewritten copy of a. For group-typed
// attributes the redaction is applied recursively to every child.
func (h *RedactingHandler) redactAttr(a slog.Attr) slog.Attr {
	if a.Value.Kind() == slog.KindGroup {
		children := a.Value.Group()
		out := make([]any, 0, len(children))
		for _, c := range children {
			out = append(out, h.redactAttr(c))
		}
		return slog.Group(a.Key, out...)
	}
	rules := h.rules[a.Key]
	if len(rules) == 0 {
		return a
	}
	for _, rule := range rules {
		a = applyRule(rule, a)
	}
	return a
}

// applyRule executes a single rule against the supplied attribute and
// returns the rewritten attribute. Unknown rule kinds are a no-op so
// forward-compatible configs (e.g. a rule kind added in a newer
// daemon) don't fail loudly on older binaries.
func applyRule(rule config.FilterRule, a slog.Attr) slog.Attr {
	switch rule.Kind {
	case FilterKindIPMask:
		return slog.Attr{Key: a.Key, Value: maskIPValue(a.Value)}
	case FilterKindHash:
		return slog.Attr{Key: a.Key, Value: hashValue(a.Value)}
	case FilterKindCookieRedact:
		return slog.Attr{Key: a.Key, Value: redactCookieValue(a.Key, a.Value)}
	default:
		return a
	}
}

// ─── ip_mask ────────────────────────────────────────────────────────────────

// maskIPValue returns a redacted slog.Value for IPv4 / IPv6 inputs.
// Non-IP strings pass through unchanged so that misconfigured rules
// (e.g. ip_mask applied to a method name) don't silently destroy
// useful diagnostic data.
func maskIPValue(v slog.Value) slog.Value {
	switch v.Kind() {
	case slog.KindString:
		s := v.String()
		ip := net.ParseIP(s)
		if ip == nil {
			return v
		}
		return slog.StringValue(maskIP(ip).String())
	case slog.KindAny:
		switch ipv := v.Any().(type) {
		case net.IP:
			if ipv == nil {
				return v
			}
			return slog.StringValue(maskIP(ipv).String())
		case *net.IP:
			if ipv == nil || *ipv == nil {
				return v
			}
			return slog.StringValue(maskIP(*ipv).String())
		default:
			return v
		}
	default:
		return v
	}
}

// maskIP zeroes the last octet of an IPv4 address or the low 64 bits
// of an IPv6 address. The returned net.IP is always a fresh slice;
// the input is never mutated.
func maskIP(ip net.IP) net.IP {
	if v4 := ip.To4(); v4 != nil {
		out := make(net.IP, net.IPv4len)
		copy(out, v4)
		out[3] = 0
		return out
	}
	v6 := ip.To16()
	if v6 == nil {
		return ip
	}
	out := make(net.IP, net.IPv6len)
	copy(out, v6)
	for i := 8; i < 16; i++ {
		out[i] = 0
	}
	return out
}

// ─── hash ───────────────────────────────────────────────────────────────────

// hashValue returns sha256:<8-hex> of the value's string form. Operates
// on string-typed attributes; other kinds pass through unchanged.
// Deterministic by construction (sha256 has no salt input here) so the
// same plaintext always hashes to the same digest, preserving the
// ability to correlate redacted records across log lines.
func hashValue(v slog.Value) slog.Value {
	if v.Kind() != slog.KindString {
		return v
	}
	sum := sha256.Sum256([]byte(v.String()))
	return slog.StringValue("sha256:" + hex.EncodeToString(sum[:])[:8])
}

// ─── cookie_redact ──────────────────────────────────────────────────────────

// redactCookieValue rewrites a Cookie / Set-Cookie style header value
// so that each cookie name remains visible but its value is replaced
// with "[redacted]". The rule is bound to the standard header keys
// `cookie` and `set-cookie` (case-insensitive); values bound to other
// keys are left alone, mirroring how the rule is documented.
//
// Multi-value Cookie headers ("a=1; b=2; c=3") and Set-Cookie strings
// with attribute clauses ("sid=abc; Path=/; HttpOnly") are both
// supported. Cookie attributes such as `Path`, `Domain`, `Expires`,
// etc. are passed through verbatim so the redacted form remains
// representative of the original shape.
func redactCookieValue(key string, v slog.Value) slog.Value {
	if !isCookieKey(key) {
		return v
	}
	if v.Kind() != slog.KindString {
		return v
	}
	raw := v.String()
	if raw == "" {
		return v
	}
	if strings.EqualFold(key, "set-cookie") {
		return slog.StringValue(redactSetCookie(raw))
	}
	return slog.StringValue(redactRequestCookie(raw))
}

func isCookieKey(key string) bool {
	return strings.EqualFold(key, "cookie") || strings.EqualFold(key, "set-cookie")
}

// redactRequestCookie redacts the value of every `name=value` pair in a
// request-style Cookie header. Whitespace and ordering are preserved
// where reasonable; we use net/http's parser to extract names robustly
// rather than re-implementing the spec.
func redactRequestCookie(raw string) string {
	header := http.Header{"Cookie": []string{raw}}
	req := http.Request{Header: header}
	cookies := req.Cookies()
	if len(cookies) == 0 {
		// Fallback: if the header is unparseable, redact every
		// `name=value` pair we can recognise via a manual split so
		// that malformed input still gets scrubbed rather than
		// passed through verbatim.
		return manualRedact(raw, "; ")
	}
	parts := make([]string, 0, len(cookies))
	for _, c := range cookies {
		parts = append(parts, c.Name+"=[redacted]")
	}
	return strings.Join(parts, "; ")
}

// redactSetCookie redacts the value of the cookie pair in a Set-Cookie
// string while preserving any attribute clauses (Path, Domain, Max-Age,
// Expires, HttpOnly, Secure, SameSite, etc.).
func redactSetCookie(raw string) string {
	segments := strings.Split(raw, ";")
	if len(segments) == 0 {
		return raw
	}
	first := strings.TrimSpace(segments[0])
	if eq := strings.IndexByte(first, '='); eq >= 0 {
		segments[0] = first[:eq] + "=[redacted]"
	} else {
		segments[0] = first
	}
	for i := 1; i < len(segments); i++ {
		segments[i] = strings.TrimLeft(segments[i], " ")
	}
	return strings.Join(segments, "; ")
}

// manualRedact handles malformed Cookie headers by splitting on sep
// and redacting every `name=value` pair found. Pairs without an `=`
// are kept verbatim — they are not values, just stray tokens.
func manualRedact(raw, sep string) string {
	parts := strings.Split(raw, sep)
	for i, p := range parts {
		p = strings.TrimSpace(p)
		if eq := strings.IndexByte(p, '='); eq >= 0 {
			parts[i] = p[:eq] + "=[redacted]"
		} else {
			parts[i] = p
		}
	}
	return strings.Join(parts, sep)
}
