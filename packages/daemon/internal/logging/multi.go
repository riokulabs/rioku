package logging

import (
	"context"
	"log/slog"
)

// MultiHandler dispatches log records to multiple handlers.
// Errors from any handler are returned as the first non-nil error
// encountered; the remaining handlers are still called.
type MultiHandler struct {
	handlers []slog.Handler
}

// NewMultiHandler returns a handler that forwards each log record to
// all of the provided handlers.
func NewMultiHandler(handlers ...slog.Handler) *MultiHandler {
	return &MultiHandler{handlers: handlers}
}

// Enabled returns true if at least one inner handler is enabled for
// the given level.
func (h *MultiHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, hh := range h.handlers {
		if hh.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

// Handle forwards the record clone to every handler that is enabled
// for its level. The first non-nil error is returned; the remaining
// handlers still receive the record.
func (h *MultiHandler) Handle(ctx context.Context, r slog.Record) error {
	var firstErr error
	for _, hh := range h.handlers {
		if hh.Enabled(ctx, r.Level) {
			if err := hh.Handle(ctx, r.Clone()); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// WithAttrs returns a new MultiHandler whose inner handlers have all
// had WithAttrs applied.
func (h *MultiHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	out := make([]slog.Handler, len(h.handlers))
	for i, hh := range h.handlers {
		out[i] = hh.WithAttrs(attrs)
	}
	return &MultiHandler{handlers: out}
}

// WithGroup returns a new MultiHandler whose inner handlers have all
// had WithGroup applied.
func (h *MultiHandler) WithGroup(name string) slog.Handler {
	out := make([]slog.Handler, len(h.handlers))
	for i, hh := range h.handlers {
		out[i] = hh.WithGroup(name)
	}
	return &MultiHandler{handlers: out}
}
