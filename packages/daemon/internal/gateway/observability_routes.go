// Package gateway — observability endpoints (#191).
//
//	GET /api/v1/observability/jwks                       (legacy, unscoped)
//	GET /api/v1/t/{tenant}/observability/logs/tail       SSE log tail
//
// The unscoped JWKS endpoint returns the in-process JWKS refresh
// registry: per-source URL status, last-refresh time, last-error, and
// consecutive-failure counter.
//
// The tenant-scoped logs/tail endpoint streams Server-Sent Events drawn
// from a small in-memory ring buffer wired into the daemon's slog
// pipeline. Subscribers receive the most-recent N lines on connect, then
// live updates as new lines land. Because the ring buffer is a slog
// `Handler` it integrates with the existing daemon logger via
// composition at startup.
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/riokulabs/rioku/internal/observability"
	"github.com/riokulabs/rioku/internal/rerr"
)

type jwksObservabilityResponse struct {
	Available bool                      `json:"available"`
	Entries   []observability.JWKSEntry `json:"entries"`
}

// RegisterObservabilityRoutes registers the observability surface.
// When reg is nil (rioku_jwt not configured / data plane not yet
// reporting), the handler returns Available=false with an empty
// entries slice so the admin panel can render a graceful empty
// state rather than a 404.
//
// `tail` may be nil — the logs/tail endpoint then responds with an
// SSE stream that immediately closes with a `disabled` event so the
// admin panel can render a clear "feature not enabled" message rather
// than seeing a 404.
func RegisterObservabilityRoutes(mux *http.ServeMux, reg *observability.JWKSRegistry, tail *LogTailBuffer) {
	mux.Handle("GET /api/v1/observability/jwks",
		RequirePermission("settings:read")(rerr.H(handleJWKSObservability(reg))))
	mux.Handle("GET /api/v1/t/{tenant}/observability/logs/tail",
		RequirePermission("observability:read")(http.HandlerFunc(handleLogsTail(tail)))) // rerr-skip: SSE streaming handler
}

func handleJWKSObservability(reg *observability.JWKSRegistry) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if reg == nil {
			return rerr.JSON(w, jwksObservabilityResponse{
				Available: false,
				Entries:   []observability.JWKSEntry{},
			})
		}
		snap := reg.Snapshot()
		if snap == nil {
			snap = []observability.JWKSEntry{}
		}
		return rerr.JSON(w, jwksObservabilityResponse{
			Available: true,
			Entries:   snap,
		})
	}
}

// ─── Log tail ring buffer + SSE handler ─────────────────────────────────────

// LogTailBuffer is a slog.Handler that retains the most recent N records
// and broadcasts new records to subscribed SSE clients. It is process-
// global (constructed once at daemon startup) and concurrent-safe.
type LogTailBuffer struct {
	mu      sync.Mutex
	cap     int
	records []LogRecord
	subs    map[chan LogRecord]struct{}
	level   slog.Leveler
}

// LogRecord is the JSON shape published over SSE. It is also what
// `Snapshot()` returns for the replay on initial subscribe.
type LogRecord struct {
	Timestamp string         `json:"timestamp"`
	Level     string         `json:"level"`
	Msg       string         `json:"msg"`
	Fields    map[string]any `json:"fields,omitempty"`
}

// NewLogTailBuffer constructs a ring buffer with the given capacity. A
// zero or negative capacity falls back to the default (1000 lines).
func NewLogTailBuffer(capacity int) *LogTailBuffer {
	if capacity <= 0 {
		capacity = 1000
	}
	return &LogTailBuffer{
		cap:   capacity,
		subs:  make(map[chan LogRecord]struct{}),
		level: slog.LevelDebug,
	}
}

// Enabled implements slog.Handler. We accept every record at or above
// the configured level (default Debug) — the daemon's primary handler
// applies the user-configured threshold; this buffer is purely a tap.
func (b *LogTailBuffer) Enabled(_ context.Context, lvl slog.Level) bool {
	return lvl >= b.level.Level()
}

// Handle implements slog.Handler. It snapshots the record into a
// LogRecord, appends it to the ring, and fans the line out to current
// subscribers. Slow subscribers are skipped (best-effort delivery —
// dropped lines are still in the ring for the next poll).
func (b *LogTailBuffer) Handle(_ context.Context, rec slog.Record) error {
	out := LogRecord{
		Timestamp: rec.Time.UTC().Format(time.RFC3339Nano),
		Level:     rec.Level.String(),
		Msg:       rec.Message,
	}
	if rec.NumAttrs() > 0 {
		out.Fields = make(map[string]any, rec.NumAttrs())
		rec.Attrs(func(a slog.Attr) bool {
			out.Fields[a.Key] = a.Value.Any()
			return true
		})
	}

	b.mu.Lock()
	if len(b.records) >= b.cap {
		// Drop the oldest line to keep the ring at cap.
		copy(b.records, b.records[1:])
		b.records = b.records[:b.cap-1]
	}
	b.records = append(b.records, out)
	subs := make([]chan LogRecord, 0, len(b.subs))
	for c := range b.subs {
		subs = append(subs, c)
	}
	b.mu.Unlock()

	for _, c := range subs {
		select {
		case c <- out:
		default:
			// Subscriber is slow; skip. The line is still in the ring
			// and will be visible on next reconnect.
		}
	}
	return nil
}

// WithAttrs is a no-op for the tail buffer — tap handlers don't need
// per-logger attribute scoping; the calling slog.Logger applies them
// before Handle is invoked.
func (b *LogTailBuffer) WithAttrs(_ []slog.Attr) slog.Handler { return b }

// WithGroup is similarly a no-op.
func (b *LogTailBuffer) WithGroup(_ string) slog.Handler { return b }

// Snapshot returns a copy of the most recent records (oldest-first).
func (b *LogTailBuffer) Snapshot() []LogRecord {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]LogRecord, len(b.records))
	copy(out, b.records)
	return out
}

// Subscribe registers a new live channel and returns it plus an
// unsubscribe func. The channel is buffered to absorb small bursts.
func (b *LogTailBuffer) Subscribe(buf int) (chan LogRecord, func()) {
	if buf <= 0 {
		buf = 64
	}
	ch := make(chan LogRecord, buf)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		_, present := b.subs[ch]
		if present {
			delete(b.subs, ch)
		}
		b.mu.Unlock()
		if present {
			close(ch)
		}
	}
}

// handleLogsTail emits the snapshot followed by live records as SSE
// events. Each event payload is a JSON-encoded LogRecord. When the tail
// buffer isn't wired (`tail == nil`) we still open the stream and emit
// a single `disabled` event so the client surface knows the feature is
// not active rather than treating it as a transient network error.
func handleLogsTail(tail *LogTailBuffer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError) //nolint:forbidigo // SSE fallback path
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		if tail == nil {
			_, _ = fmt.Fprint(w, "event: disabled\ndata: {\"reason\":\"log tail buffer not configured\"}\n\n")
			flusher.Flush()
			return
		}

		// Subscribe BEFORE replaying the snapshot so we don't miss any
		// records that land between the snapshot copy and Subscribe().
		ch, unsub := tail.Subscribe(256)
		defer unsub()

		for _, rec := range tail.Snapshot() {
			data, err := json.Marshal(rec)
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
		}
		flusher.Flush()

		for {
			select {
			case <-r.Context().Done():
				return
			case rec, ok := <-ch:
				if !ok {
					return
				}
				data, err := json.Marshal(rec)
				if err != nil {
					continue
				}
				_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}
