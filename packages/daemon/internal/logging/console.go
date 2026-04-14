package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"
)

// ANSI color codes.
const (
	ansiReset   = "\033[0m"
	ansiBold    = "\033[1m"
	ansiRed     = "\033[31m"
	ansiGreen   = "\033[32m"
	ansiYellow  = "\033[33m"
	ansiBlue    = "\033[34m"
	ansiCyan    = "\033[36m"
	ansiGray    = "\033[90m"
	ansiMagenta = "\033[35m"
)

// consoleHandler writes logs in a colored, Caddy-inspired format with an "RKU"
// prefix to distinguish daemon logs from Caddy's own output.
//
// Format: 2026/04/14 04:10:30 RKU INFO  store   driver ready  driver=sqlite
type consoleHandler struct {
	w     io.Writer
	level slog.Leveler
	attrs []slog.Attr
	group string
	mu    *sync.Mutex
}

func newConsoleHandler(w io.Writer, opts *slog.HandlerOptions) *consoleHandler {
	var leveler slog.Leveler
	if opts != nil && opts.Level != nil {
		leveler = opts.Level
	}
	return &consoleHandler{
		w:     w,
		level: leveler,
		mu:    &sync.Mutex{},
	}
}

func (h *consoleHandler) Enabled(_ context.Context, level slog.Level) bool {
	if h.level != nil {
		return level >= h.level.Level()
	}
	return level >= slog.LevelInfo
}

func (h *consoleHandler) Handle(_ context.Context, r slog.Record) error {
	// Timestamp: 2026/04/14 04:10:30
	ts := r.Time.Format("2006/01/02 15:04:05")

	// Level with color.
	var levelStr string
	switch {
	case r.Level >= slog.LevelError:
		levelStr = ansiRed + ansiBold + "ERROR" + ansiReset
	case r.Level >= slog.LevelWarn:
		levelStr = ansiYellow + "WARN " + ansiReset
	case r.Level >= slog.LevelInfo:
		levelStr = ansiBlue + "INFO " + ansiReset
	default:
		levelStr = ansiGray + "DEBUG" + ansiReset
	}

	// Extract component from pre-baked attrs or record attrs.
	component := ""
	var extraAttrs []slog.Attr

	// Check pre-baked attrs first (from Logger.With("component", ...)).
	for _, a := range h.attrs {
		if a.Key == "component" {
			component = a.Value.String()
		} else {
			extraAttrs = append(extraAttrs, a)
		}
	}

	// Check record attrs.
	var recordAttrs []slog.Attr
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == "component" && component == "" {
			component = a.Value.String()
		} else {
			recordAttrs = append(recordAttrs, a)
		}
		return true
	})

	// Component column (padded to 8 chars for alignment).
	compStr := ""
	if component != "" {
		compStr = fmt.Sprintf("%-8s", component)
		compStr = ansiCyan + compStr + ansiReset
	} else {
		compStr = "        " // 8 spaces
	}

	// Build the line.
	// Format: 2026/04/14 04:10:30 RKU INFO  store    driver ready  key=value
	line := fmt.Sprintf("%s %s%s%s %s %s %s",
		ansiGray+ts+ansiReset,
		ansiMagenta, "RKU", ansiReset,
		levelStr,
		compStr,
		r.Message,
	)

	// Append key=value pairs for pre-baked and record attrs.
	allAttrs := append(extraAttrs, recordAttrs...)
	for _, a := range allAttrs {
		line += fmt.Sprintf("  %s%s%s=%v", ansiGray, a.Key, ansiReset, a.Value)
	}

	line += "\n"

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := io.WriteString(h.w, line)
	return err
}

func (h *consoleHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	newAttrs := make([]slog.Attr, len(h.attrs)+len(attrs))
	copy(newAttrs, h.attrs)
	copy(newAttrs[len(h.attrs):], attrs)
	return &consoleHandler{
		w:     h.w,
		level: h.level,
		attrs: newAttrs,
		group: h.group,
		mu:    h.mu,
	}
}

func (h *consoleHandler) WithGroup(name string) slog.Handler {
	return &consoleHandler{
		w:     h.w,
		level: h.level,
		attrs: h.attrs,
		group: name,
		mu:    h.mu,
	}
}

// Ensure we satisfy the interface.
var _ slog.Handler = (*consoleHandler)(nil)
