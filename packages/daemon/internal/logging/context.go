// Package logging — context-scoped logging support.
//
// All daemon log entries that flow through a request handler should carry a
// `request_id` (locally generated or passed in via the `X-Request-ID`
// header) and, when available, a `trace_id` extracted from the W3C
// `traceparent` header that Caddy attaches to upstream requests.
//
// The pieces:
//
//   - WithRequestID / WithTraceID: stash IDs in a context.
//   - RequestIDFromContext / TraceIDFromContext: read them back.
//   - NewContextHandler: wraps a slog.Handler so every record automatically
//     gets `request_id` / `trace_id` attributes pulled from the active
//     context. Callers should use `slog.InfoContext(ctx, ...)` (and the
//     other `*Context` variants) so the handler sees the request context.
//
// # Correlation header contract
//
// The gateway's RequestIDMiddleware (gateway/errors.go) is responsible for
// setting the correlation headers that tie daemon log entries to Caddy access
// log entries:
//
//   - X-Request-ID (response header): echoed to the client so callers can
//     correlate their own traces with daemon logs.
//
//   - X-Caddy-Trace-Id (request header, set on the cloned *http.Request):
//     copied from the resolved request_id before any handler runs. Caddy's
//     access-log encoder (caddy/compiler.go) renames the nested
//     request.headers["X-Caddy-Trace-Id"] field to a top-level "request_id"
//     key, making the join trivial:
//
//     grep '"request_id":"req_abc"' daemon.log  →  both Caddy access entry
//     and Rioku handler entries for the same request.
//
// When request_id is absent from ctx (i.e. the middleware did not run),
// neither header is fabricated — callers must not invent IDs outside of
// RequestIDMiddleware.
package logging

import (
	"context"
	"log/slog"
)

// ─── Context keys ───────────────────────────────────────────────────────────

// ctxKey is an unexported type so other packages can't accidentally use a
// colliding key value.
type ctxKey int

const (
	ctxKeyRequestID ctxKey = iota
	ctxKeyTraceID
	ctxKeyComponent
)

// ─── Setters ────────────────────────────────────────────────────────────────

// WithRequestID returns a child context that carries the given request id.
// An empty id is a no-op (returns the input context unchanged).
func WithRequestID(ctx context.Context, id string) context.Context {
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, ctxKeyRequestID, id)
}

// WithTraceID returns a child context that carries the given W3C trace id.
// An empty id is a no-op.
func WithTraceID(ctx context.Context, id string) context.Context {
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, ctxKeyTraceID, id)
}

// WithComponent tags the context with a component label (e.g. "gateway",
// "config-engine", "caddy"). Sub-system loggers can use this to scope
// every log entry from a request through their layer.
func WithComponent(ctx context.Context, component string) context.Context {
	if component == "" {
		return ctx
	}
	return context.WithValue(ctx, ctxKeyComponent, component)
}

// ─── Getters ────────────────────────────────────────────────────────────────

// RequestIDFromContext returns the request id stored on ctx, or "" if none.
func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(ctxKeyRequestID).(string)
	return id
}

// TraceIDFromContext returns the W3C trace id stored on ctx, or "".
func TraceIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(ctxKeyTraceID).(string)
	return id
}

// ComponentFromContext returns the component label stored on ctx, or "".
func ComponentFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	c, _ := ctx.Value(ctxKeyComponent).(string)
	return c
}

// ─── From ────────────────────────────────────────────────────────────────────

// From returns the default slog.Logger pre-bound with the request_id,
// trace_id, and component values found on ctx. If ctx is nil or any value is
// absent, the corresponding attribute is simply omitted. The returned logger
// is always non-nil.
//
// Usage in handlers:
//
//	log := logging.From(r.Context())
//	log.Info("processing request", "widget_id", id)
func From(ctx context.Context) *slog.Logger {
	log := slog.Default()
	if ctx == nil {
		return log
	}
	if rid := RequestIDFromContext(ctx); rid != "" {
		log = log.With("request_id", rid)
	}
	if tid := TraceIDFromContext(ctx); tid != "" {
		log = log.With("trace_id", tid)
	}
	if comp := ComponentFromContext(ctx); comp != "" {
		log = log.With("component", comp)
	}
	return log
}

// ─── ContextHandler ─────────────────────────────────────────────────────────

// ContextHandler wraps a slog.Handler so that every log record automatically
// gains `request_id`, `trace_id`, and `component` attributes from the
// context — provided the caller used `*Context` logging variants
// (`slog.InfoContext`, `slog.WarnContext`, …) or a logger built via
// `slog.New(handler).WithContext(ctx)`.
//
// Records emitted from contexts that lack any of those keys are written
// unchanged.
type ContextHandler struct {
	inner slog.Handler
}

// NewContextHandler returns a handler that decorates inner with
// context-derived attributes.
func NewContextHandler(inner slog.Handler) *ContextHandler {
	return &ContextHandler{inner: inner}
}

// Enabled delegates to the inner handler.
func (h *ContextHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

// Handle attaches request_id / trace_id / component / route_id /
// log_sample_rate attributes from ctx to the record before forwarding
// to the inner handler. Already-present attributes on the record are
// left untouched (caller's explicit attributes win).
//
// log_sample_rate is what the SamplingHandler downstream keys off
// for deterministic sample-by-request-id; phase-2 plumbing (#198)
// stashes the rate on ctx so the per-route value pulled from the
// cache surfaces as an attribute without every call site needing to
// remember it.
func (h *ContextHandler) Handle(ctx context.Context, r slog.Record) error {
	if rid := RequestIDFromContext(ctx); rid != "" {
		r.AddAttrs(slog.String("request_id", rid))
	}
	if tid := TraceIDFromContext(ctx); tid != "" {
		r.AddAttrs(slog.String("trace_id", tid))
	}
	if comp := ComponentFromContext(ctx); comp != "" {
		r.AddAttrs(slog.String("component", comp))
	}
	if routeID := RouteIDFromContext(ctx); routeID != "" {
		r.AddAttrs(slog.String("route_id", routeID))
	}
	if rate, ok := LogSampleRateFromContext(ctx); ok {
		r.AddAttrs(slog.Float64("log_sample_rate", rate))
	}
	return h.inner.Handle(ctx, r)
}

// WithAttrs / WithGroup forward to the inner handler so structured-attr
// chains and group scoping continue to work transparently.
func (h *ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ContextHandler{inner: h.inner.WithAttrs(attrs)}
}

func (h *ContextHandler) WithGroup(name string) slog.Handler {
	return &ContextHandler{inner: h.inner.WithGroup(name)}
}
