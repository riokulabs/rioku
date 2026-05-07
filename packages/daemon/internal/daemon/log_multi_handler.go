// Package daemon: tiny fan-out slog.Handler so the in-memory log-tail
// ring buffer (#191 / Plan 07-007) can co-exist with the configured
// stderr/file/OTLP handler that `logging.Setup` produces.
//
// Each downstream handler decides for itself whether the record is
// in-scope (via Enabled). Errors from individual handlers are returned
// as a joined slice so partial failures don't silently drop records.
package daemon

import (
	"context"
	"errors"
	"log/slog"
)

type multiHandler struct {
	handlers []slog.Handler
}

func newMultiHandler(hs ...slog.Handler) slog.Handler {
	out := make([]slog.Handler, 0, len(hs))
	for _, h := range hs {
		if h == nil {
			continue
		}
		out = append(out, h)
	}
	return &multiHandler{handlers: out}
}

func (m *multiHandler) Enabled(ctx context.Context, lvl slog.Level) bool {
	for _, h := range m.handlers {
		if h.Enabled(ctx, lvl) {
			return true
		}
	}
	return false
}

func (m *multiHandler) Handle(ctx context.Context, rec slog.Record) error {
	var errs []error
	for _, h := range m.handlers {
		if !h.Enabled(ctx, rec.Level) {
			continue
		}
		if err := h.Handle(ctx, rec.Clone()); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (m *multiHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	out := make([]slog.Handler, len(m.handlers))
	for i, h := range m.handlers {
		out[i] = h.WithAttrs(attrs)
	}
	return &multiHandler{handlers: out}
}

func (m *multiHandler) WithGroup(name string) slog.Handler {
	out := make([]slog.Handler, len(m.handlers))
	for i, h := range m.handlers {
		out[i] = h.WithGroup(name)
	}
	return &multiHandler{handlers: out}
}
