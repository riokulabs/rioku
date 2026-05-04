// sandbox/tools/otlp-listener — minimal OTLP HTTP/protobuf receiver for sandbox smoke tests.
//
// Listens on a configurable port (default :4318), accepts POST /v1/logs (OTLP/HTTP)
// and any other path as a counted request. Tracks total bytes received and exposes
// a tiny status JSON at GET /__status. Returns 200 to all OTLP POSTs so the
// shipping client (the daemon's OTLP exporter) doesn't back off.
//
// This is deliberately not a full OTLP receiver: it does not decode the protobuf
// payload. The smoke test only needs to confirm bytes arrived at the configured
// endpoint, which is sufficient evidence that the daemon's OTLP exporter is
// wired up and producing traffic.
//
// Usage:
//
//	otlp-listener --port 4318 --status-port 4319
//
// Status check (used by smoke test):
//
//	curl -s http://localhost:4319/__status
//	-> {"requests":3,"bytes":1742,"paths":["/v1/logs"]}
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type listener struct {
	requests  atomic.Int64
	bytes     atomic.Int64
	pathsMu   sync.Mutex
	pathSeen  map[string]int64
	startedAt time.Time
}

func newListener() *listener {
	return &listener{
		pathSeen:  make(map[string]int64),
		startedAt: time.Now().UTC(),
	}
}

// recordReceive is the OTLP intake handler. It counts bytes + requests
// and always responds 200 so the daemon's exporter doesn't back off.
func (l *listener) recordReceive(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("read body: %v", err)
	}
	defer func() { _ = r.Body.Close() }()

	l.requests.Add(1)
	l.bytes.Add(int64(len(body)))

	l.pathsMu.Lock()
	l.pathSeen[r.URL.Path]++
	l.pathsMu.Unlock()

	// OTLP/HTTP+protobuf expects 200 with empty body on success.
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
}

// status returns a JSON snapshot of received traffic. Used by the
// smoke test to verify the OTLP exporter is shipping.
func (l *listener) status(w http.ResponseWriter, _ *http.Request) {
	l.pathsMu.Lock()
	paths := make([]string, 0, len(l.pathSeen))
	for p := range l.pathSeen {
		paths = append(paths, p)
	}
	l.pathsMu.Unlock()
	sort.Strings(paths)

	resp := map[string]any{
		"requests":   l.requests.Load(),
		"bytes":      l.bytes.Load(),
		"paths":      paths,
		"started_at": l.startedAt.Format(time.RFC3339Nano),
		"uptime_sec": int64(time.Since(l.startedAt).Seconds()),
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("encode status: %v", err)
	}
}

func main() {
	var (
		port       = flag.Int("port", 4318, "OTLP HTTP intake port")
		statusPort = flag.Int("status-port", 4319, "status JSON port")
	)
	flag.Parse()

	l := newListener()

	// Intake server (OTLP). Accept POST anywhere — the daemon's
	// OTLP/HTTP exporter posts to /v1/logs by default but we don't
	// gate on the exact path.
	intakeMux := http.NewServeMux()
	intakeMux.HandleFunc("/", l.recordReceive)

	intakeSrv := &http.Server{
		Addr:              fmt.Sprintf(":%d", *port),
		Handler:           intakeMux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Status server — separate port to keep status reads from being
	// counted in the intake totals.
	statusMux := http.NewServeMux()
	statusMux.HandleFunc("/__status", l.status)
	statusMux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "use GET /__status", http.StatusNotFound)
	})

	statusSrv := &http.Server{
		Addr:              fmt.Sprintf(":%d", *statusPort),
		Handler:           statusMux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Start both servers; bail if either fails to bind.
	errCh := make(chan error, 2)
	go func() {
		log.Printf("otlp-listener: intake on :%d", *port)
		if err := intakeSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("intake: %w", err)
		}
	}()
	go func() {
		log.Printf("otlp-listener: status on :%d/__status", *statusPort)
		if err := statusSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("status: %w", err)
		}
	}()

	// Wait for shutdown signal or fatal listener error.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		log.Printf("otlp-listener: server error: %v", err)
		os.Exit(1)
	case <-stop:
		log.Println("otlp-listener: shutting down")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = intakeSrv.Shutdown(ctx)
	_ = statusSrv.Shutdown(ctx)
	log.Printf("otlp-listener: stopped (received %d requests / %d bytes)",
		l.requests.Load(), l.bytes.Load())
}
