package gateway

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/tracestore"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

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
		flusher.Flush()

		ch, err := engine.WatchChanges(r.Context(), 0)
		if err != nil {
			log.Printf("sse: watch changes: %v", err)
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
					log.Printf("sse: marshal event: %v", err)
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
		flusher.Flush()

		ch, unsub := buf.Subscribe(256)
		defer unsub()

		for {
			select {
			case <-r.Context().Done():
				return
			case trace, ok := <-ch:
				if !ok {
					return
				}
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
					log.Printf("sse: marshal trace: %v", err)
					continue
				}
				_, _ = fmt.Fprintf(w, "event: trace\ndata: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}

func marshalEvent(evt *riokuv1.ConfigEvent) ([]byte, error) {
	// Use protojson for consistent field naming with the REST API.
	data, err := protojson.Marshal(evt)
	if err != nil {
		return json.Marshal(evt) // fallback to standard json
	}
	return data, nil
}
