package gateway

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/tracestore"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// sseRetryMs is the reconnect interval (in milliseconds) advertised to SSE
// clients via the `retry:` directive at stream open. Browsers honour this
// when reconnecting after the connection drops.
const sseRetryMs = 30000

// RegisterSSERoutes registers Server-Sent Events endpoints for streaming RPCs.
func RegisterSSERoutes(mux *http.ServeMux, engine *config.Engine, buf *tracestore.RingBuffer) {
	mux.HandleFunc("GET /api/v1/events/config", handleConfigSSE(engine))
	mux.HandleFunc("GET /api/v1/events/traffic", handleTrafficSSE(buf))
}

func handleConfigSSE(engine *config.Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering
		w.WriteHeader(http.StatusOK)
		// Advertise the reconnect interval to the client up front.
		_, _ = fmt.Fprintf(w, "retry: %d\n\n", sseRetryMs)
		flusher.Flush()

		ch, err := engine.WatchChanges(r.Context(), 0)
		if err != nil {
			slog.Error("watch changes failed", "component", "gateway", "error", err)
			return
		}

		for {
			select {
			case <-r.Context().Done():
				return
			case evt, ok := <-ch:
				if !ok {
					return
				}
				data, err := marshalEvent(evt)
				if err != nil {
					slog.Warn("marshal event failed", "component", "gateway", "error", err)
					continue
				}
				_, _ = fmt.Fprintf(w, "event: config_change\ndata: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}

func handleTrafficSSE(buf *tracestore.RingBuffer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering
		w.WriteHeader(http.StatusOK)
		// Advertise the reconnect interval to the client up front.
		_, _ = fmt.Fprintf(w, "retry: %d\n\n", sseRetryMs)
		flusher.Flush()

		// Subscribe BEFORE reading the snapshot so we don't miss events
		// that arrive between snapshot+resume.
		ch, unsub := buf.Subscribe(256)
		defer unsub()

		// Last-Event-ID resume: replay any items in the ring buffer that
		// follow the supplied trace ID. The ring buffer is bounded, so if
		// the client's last seen ID has already aged out we replay nothing
		// and continue with the live stream — clients should treat the
		// gap as expected.
		lastID := r.Header.Get("Last-Event-ID")
		if lastID != "" {
			snap := buf.Snapshot(0x7fffffff) // full buffer
			seen := false
			for _, tr := range snap {
				if !seen {
					if tr.GetTraceId() == lastID {
						seen = true
					}
					continue
				}
				if err := writeTrafficSSEEvent(w, tr); err != nil {
					slog.Warn("write resume event failed", "component", "gateway", "error", err)
					return
				}
			}
			flusher.Flush()
		}

		for {
			select {
			case <-r.Context().Done():
				return
			case trace, ok := <-ch:
				if !ok {
					return
				}
				if err := writeTrafficSSEEvent(w, trace); err != nil {
					slog.Warn("write trace failed", "component", "gateway", "error", err)
					continue
				}
				flusher.Flush()
			}
		}
	}
}

// writeTrafficSSEEvent serialises a single trace to the SSE stream. The
// `id:` field is the trace_id, allowing clients to send Last-Event-ID on
// reconnect to resume.
func writeTrafficSSEEvent(w http.ResponseWriter, trace *riokuv1.RequestTrace) error {
	evt := map[string]any{
		"id":         trace.GetTraceId(),
		"timestamp":  trace.GetStartedAt().AsTime().Format(time.RFC3339Nano),
		"method":     trace.GetMethod(),
		"path":       trace.GetPath(),
		"status":     trace.GetStatusCode(),
		"latency_ms": trace.GetDurationMs(),
		"upstream":   trace.GetUpstreamAddr(),
		"route_id":   trace.GetRouteId(),
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "id: %s\nevent: trace\ndata: %s\n\n", trace.GetTraceId(), data)
	return err
}

func marshalEvent(evt *riokuv1.ConfigEvent) ([]byte, error) {
	// Use protojson for consistent field naming with the REST API.
	data, err := protojson.Marshal(evt)
	if err != nil {
		return json.Marshal(evt) // fallback to standard json
	}
	return data, nil
}
