package tracestore

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ---------------------------------------------------------------------------
// Caddy log format (JSON structs for zero-allocation parsing)
// ---------------------------------------------------------------------------

// caddyLogEntry mirrors the Caddy structured JSON access log format.
type caddyLogEntry struct {
	Level     string       `json:"level"`
	TS        float64      `json:"ts"`
	Request   caddyRequest `json:"request"`
	Duration  float64      `json:"duration"`
	Status    int32        `json:"status"`
	Size      int64        `json:"size"`
	BytesRead int64        `json:"bytes_read"`

	// Rioku-specific extra fields injected via Caddy log placeholders.
	RouteID         string `json:"rioku_route_id"`
	ServiceID       string `json:"rioku_service_id"`
	UpstreamAddress string `json:"upstream_address"`

	// TracingSpan is set automatically by Caddy's tracing handler when it is
	// part of the handler chain. It contains the OTEL trace ID.
	TracingSpan string `json:"tracing_span,omitempty"`
}

type caddyRequest struct {
	Method string `json:"method"`
	Host   string `json:"host"`
	URI    string `json:"uri"`
}

// ---------------------------------------------------------------------------
// ParseLogLine
// ---------------------------------------------------------------------------

// ParseLogLine parses a single Caddy structured JSON access log line into a
// *riokuv1.RequestTrace. A new UUID is generated for the trace_id and
// started_at is derived from the ts field.
func ParseLogLine(data []byte) (*riokuv1.RequestTrace, error) {
	var entry caddyLogEntry
	if err := json.Unmarshal(data, &entry); err != nil {
		return nil, fmt.Errorf("ParseLogLine: json unmarshal: %w", err)
	}

	// Convert the float64 Unix timestamp (seconds.fractional) to a
	// protobuf Timestamp. We use time.Unix with explicit nano conversion to
	// preserve sub-second precision.
	sec := int64(entry.TS)
	nsec := int64((entry.TS - float64(sec)) * 1e9)
	startedAt := timestamppb.New(time.Unix(sec, nsec))

	// duration_ms: Caddy logs duration in seconds; multiply by 1000 for ms.
	durationMS := int64(entry.Duration * 1000)

	// Prefer the OTEL trace ID from Caddy's tracing handler when available;
	// fall back to a random UUID otherwise.
	traceID := entry.TracingSpan
	if traceID == "" {
		traceID = uuid.New().String()
	}

	return &riokuv1.RequestTrace{
		TraceId:      traceID,
		StartedAt:    startedAt,
		DurationMs:   durationMS,
		Method:       entry.Request.Method,
		Path:         entry.Request.URI,
		Host:         entry.Request.Host,
		StatusCode:   entry.Status,
		BytesSent:    entry.Size,
		BytesRecv:    entry.BytesRead,
		RouteId:      entry.RouteID,
		ServiceId:    entry.ServiceID,
		UpstreamAddr: entry.UpstreamAddress,
	}, nil
}

// ---------------------------------------------------------------------------
// ShouldSample
// ---------------------------------------------------------------------------

// ShouldSample reports whether the given trace should be kept according to cfg.
// Priority rules (in order):
//  1. Error responses (status >= 500) are always kept when ErrorsAlways is set.
//  2. Slow requests exceed SlowThresholdMS are always kept when the threshold > 0.
//  3. AI traces are always kept when AIAlways is set.
//  4. Rate == 1.0 → keep all; Rate <= 0 → keep none.
//  5. Otherwise, keep the trace with probability Rate.
func ShouldSample(trace *riokuv1.RequestTrace, cfg SamplingConfig) bool {
	if cfg.ErrorsAlways && trace.StatusCode >= 500 {
		return true
	}
	if cfg.SlowThresholdMS > 0 && trace.DurationMs >= int64(cfg.SlowThresholdMS) {
		return true
	}
	if cfg.AIAlways && trace.Ai != nil {
		return true
	}
	if cfg.Rate >= 1.0 {
		return true
	}
	if cfg.Rate <= 0 {
		return false
	}
	return rand.Float64() < cfg.Rate
}

// ---------------------------------------------------------------------------
// Ingester
// ---------------------------------------------------------------------------

// Ingester reads structured JSON log lines from a unixgram socket, parses
// them into *riokuv1.RequestTrace values, applies sampling, and pushes
// accepted traces into a RingBuffer.
type Ingester struct {
	socketPath string
	buf        *RingBuffer
	sampling   SamplingConfig
	conn       net.PacketConn
	stopCh     chan struct{}
	done       chan struct{}
	stopOnce   sync.Once
}

// NewIngester creates a new Ingester. Call Start to begin listening.
func NewIngester(socketPath string, buf *RingBuffer, cfg SamplingConfig) *Ingester {
	return &Ingester{
		socketPath: socketPath,
		buf:        buf,
		sampling:   cfg,
		stopCh:     make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// Start removes any stale socket file, binds a unixgram socket at socketPath,
// and launches the read loop in a background goroutine. It returns an error if
// the socket cannot be opened.
func (ing *Ingester) Start(_ context.Context) error {
	// Remove any existing socket file so ListenPacket succeeds.
	if err := os.Remove(ing.socketPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("ingester: remove stale socket: %w", err)
	}

	conn, err := net.ListenPacket("unixgram", ing.socketPath)
	if err != nil {
		return fmt.Errorf("ingester: listen unixgram %s: %w", ing.socketPath, err)
	}
	ing.conn = conn

	go ing.readLoop()
	return nil
}

// Stop signals the ingester to shut down and waits for the read loop to exit.
// It is safe to call Stop more than once.
func (ing *Ingester) Stop() {
	ing.stopOnce.Do(func() {
		close(ing.stopCh)
		// Closing the connection causes any blocking ReadFrom to return an error,
		// which causes the read loop to notice stopCh is closed and exit.
		ing.conn.Close()
	})
	<-ing.done
}

// readLoop is the main goroutine that reads datagrams from the socket.
func (ing *Ingester) readLoop() {
	defer close(ing.done)

	// 64 KB is the maximum UDP/unixgram datagram size; Caddy log lines are
	// well under this limit in practice.
	const maxDatagramSize = 64 * 1024
	readBuf := make([]byte, maxDatagramSize)

	for {
		n, _, err := ing.conn.ReadFrom(readBuf)
		if err != nil {
			// Check whether we were asked to stop.
			select {
			case <-ing.stopCh:
				return
			default:
			}
			// Transient read error — continue rather than crash.
			continue
		}

		trace, err := ParseLogLine(readBuf[:n])
		if err != nil {
			// Malformed log line; skip silently.
			continue
		}

		if ShouldSample(trace, ing.sampling) {
			ing.buf.Push(trace)
		}
	}
}
