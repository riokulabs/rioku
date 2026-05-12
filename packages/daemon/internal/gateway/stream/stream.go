// Package stream provides a generic Server-Sent-Events runner used by
// every streaming endpoint in the daemon (audit, notifications, AI
// traces, plugin install progress, AI agent invoke).
//
// The runner handles:
//   - SSE headers and the initial flush.
//   - Heartbeat comments so intermediaries don't close idle connections.
//   - Bounded backlog with a documented drop policy: when the consumer
//     can't keep up, we drop the oldest events and emit a `:dropped N`
//     comment so the client knows it lost ground.
//   - Clean shutdown on `r.Context().Done()`.
//
// Endpoint-specific code supplies an EventEncoder that turns a domain
// value of type T into the `event:` name and `data:` payload for the
// SSE frame.
package stream

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"
)

// DefaultHeartbeat is sent as an SSE comment line every interval to
// keep idle connections open through proxies / load balancers.
const DefaultHeartbeat = 15 * time.Second

// DefaultBacklog is the per-connection event buffer. When full, the
// oldest events are dropped and a `:dropped` comment is emitted.
const DefaultBacklog = 32

// EventEncoder converts a domain value into the SSE frame fields.
//
// Returning a non-nil error skips the event without closing the stream
// (the runner logs and continues).
type EventEncoder[T any] func(T) (eventName string, data []byte, err error)

// Stream is one generic SSE handler.
//
// Usage:
//
//	s := stream.Stream[*Foo]{
//	    EventName: "foo",  // default for every emit
//	    Encode:    encodeFoo,
//	    Subscribe: func(ctx) (<-chan *Foo, func(), error) { ... },
//	}
//	mux.HandleFunc("GET /api/v1/.../stream", s.Handler())
//
// Subscribe returns a channel that the runner reads until it's closed
// or the request ctx fires. The cleanup func is always called on exit.
type Stream[T any] struct {
	// EventName is the default `event:` field. Encode may override it
	// per-event by returning a non-empty string.
	EventName string

	// Encode renders one value to its SSE payload.
	Encode EventEncoder[T]

	// Subscribe is called once per request and returns the source
	// channel. It MUST honour ctx and close / unsubscribe via the
	// returned func when the runner is done.
	Subscribe func(ctx context.Context) (<-chan T, func(), error)

	// Heartbeat overrides DefaultHeartbeat. Zero means default.
	Heartbeat time.Duration

	// Backlog overrides DefaultBacklog. Zero means default.
	Backlog int

	// Logger receives non-fatal warnings (encode errors, drops).
	// Optional — if nil, warnings are silently swallowed.
	Logger Logger
}

// Logger is the minimal logging contract the runner needs. log/slog
// satisfies it via slog.Logger's Warn method. Tests can inject a
// no-op implementation.
type Logger interface {
	Warn(msg string, args ...any)
}

type nopLogger struct{}

func (nopLogger) Warn(string, ...any) {}

// Handler returns an http.HandlerFunc that runs this Stream against
// each incoming request.
func (s Stream[T]) Handler() http.HandlerFunc {
	heartbeat := s.Heartbeat
	if heartbeat <= 0 {
		heartbeat = DefaultHeartbeat
	}
	backlog := s.Backlog
	if backlog <= 0 {
		backlog = DefaultBacklog
	}
	logger := s.Logger
	if logger == nil {
		logger = nopLogger{}
	}

	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError) //nolint:forbidigo // SSE fallback path
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		ch, cleanup, err := s.Subscribe(r.Context())
		if err != nil {
			logger.Warn("sse subscribe failed", "error", err, "path", r.URL.Path)
			return
		}
		defer cleanup()

		// We funnel events through a bounded local buffer so a slow
		// consumer doesn't block the producer. When full, we drop the
		// oldest event and bump a counter that's flushed as a `:dropped`
		// comment on the next successful write. Counter is atomic
		// because the producer goroutine writes it while the consumer
		// loop reads it.
		buf := make(chan T, backlog)
		var dropped atomic.Int32
		go func() {
			for {
				select {
				case <-r.Context().Done():
					return
				case evt, ok := <-ch:
					if !ok {
						close(buf)
						return
					}
					select {
					case buf <- evt:
					default:
						// Drop oldest, push newest.
						select {
						case <-buf:
						default:
						}
						buf <- evt
						dropped.Add(1)
					}
				}
			}
		}()

		ticker := time.NewTicker(heartbeat)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				if _, err := fmt.Fprintf(w, ": heartbeat %d\n\n", time.Now().Unix()); err != nil {
					return
				}
				flusher.Flush()
			case evt, ok := <-buf:
				if !ok {
					return
				}
				if d := dropped.Swap(0); d > 0 {
					if _, err := fmt.Fprintf(w, ": dropped %d\n\n", d); err != nil {
						return
					}
				}
				name, data, err := s.Encode(evt)
				if err != nil {
					if errors.Is(err, ErrSkip) {
						continue
					}
					logger.Warn("sse encode failed", "error", err)
					continue
				}
				if name == "" {
					name = s.EventName
				}
				if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, data); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	}
}

// ErrSkip can be returned from an EventEncoder to drop one event
// without logging a warning. Useful when the encoder filters events
// based on caller permissions.
var ErrSkip = errors.New("stream: skip event")
