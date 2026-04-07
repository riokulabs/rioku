package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// ---- Config ----------------------------------------------------------------

type Config struct {
	Port         int
	MaxConns     int
	ErrorRate    float64
	QueueDepth   int
	ProcessDelay time.Duration
	LatencyMin   time.Duration
	LatencyMax   time.Duration
}

func parseConfig() Config {
	port := flag.Int("port", 9003, "listen port")
	maxConns := flag.Int("max-conns", 100, "max concurrent connections")
	errorRate := flag.Float64("error-rate", 0, "error injection rate (percent, 0-100)")
	queueDepth := flag.Int("queue-depth", 1000, "per-channel queue depth")
	processDelay := flag.Duration("process-delay", 50*time.Millisecond, "simulated processing delay per webhook")
	latMin := flag.Duration("latency-min", 1*time.Millisecond, "minimum simulated latency")
	latMax := flag.Duration("latency-max", 10*time.Millisecond, "maximum simulated latency")
	flag.Parse()
	return Config{
		Port:         *port,
		MaxConns:     *maxConns,
		ErrorRate:    *errorRate / 100.0,
		QueueDepth:   *queueDepth,
		ProcessDelay: *processDelay,
		LatencyMin:   *latMin,
		LatencyMax:   *latMax,
	}
}

// ---- Domain ----------------------------------------------------------------

type WebhookEvent struct {
	ID         string          `json:"id"`
	Channel    string          `json:"channel"`
	Payload    json.RawMessage `json:"payload"`
	ReceivedAt time.Time       `json:"received_at"`
}

// ---- Channel Queue ---------------------------------------------------------

type ChannelQueue struct {
	ch        chan WebhookEvent
	processed atomic.Int64
	rejected  atomic.Int64
	accepted  atomic.Int64
}

func newChannelQueue(depth int) *ChannelQueue {
	return &ChannelQueue{
		ch: make(chan WebhookEvent, depth),
	}
}

func (q *ChannelQueue) depth() int {
	return len(q.ch)
}

func (q *ChannelQueue) cap() int {
	return cap(q.ch)
}

// ---- Channel Registry ------------------------------------------------------

type Registry struct {
	mu     sync.Mutex
	queues map[string]*ChannelQueue
	depth  int
}

func NewRegistry(depth int) *Registry {
	return &Registry{
		queues: make(map[string]*ChannelQueue),
		depth:  depth,
	}
}

func (r *Registry) get(channel string) *ChannelQueue {
	r.mu.Lock()
	defer r.mu.Unlock()
	q, ok := r.queues[channel]
	if !ok {
		q = newChannelQueue(r.depth)
		r.queues[channel] = q
	}
	return q
}

// lookup returns the queue for a channel if it already exists, or nil.
func (r *Registry) lookup(channel string) *ChannelQueue {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.queues[channel]
}

// drain removes and returns all pending events from the channel queue.
func (r *Registry) drain(channel string) []WebhookEvent {
	r.mu.Lock()
	q, ok := r.queues[channel]
	r.mu.Unlock()
	if !ok {
		return nil
	}
	var events []WebhookEvent
	for {
		select {
		case e := <-q.ch:
			events = append(events, e)
		default:
			return events
		}
	}
}

// ---- Metrics ---------------------------------------------------------------

type Metrics struct {
	totalRequests atomic.Int64
	activeConns   atomic.Int64
	errorCount    atomic.Int64
	accepted      atomic.Int64
	rejected      atomic.Int64
	processed     atomic.Int64
	requestsBy2xx atomic.Int64
	requestsBy4xx atomic.Int64
	requestsBy5xx atomic.Int64
}

func (m *Metrics) Text() string {
	var sb strings.Builder
	sb.WriteString("# HELP webhooks_requests_total Total HTTP requests received\n")
	sb.WriteString("# TYPE webhooks_requests_total counter\n")
	fmt.Fprintf(&sb, "webhooks_requests_total %d\n", m.totalRequests.Load())
	sb.WriteString("# HELP webhooks_active_connections Current active connections\n")
	sb.WriteString("# TYPE webhooks_active_connections gauge\n")
	fmt.Fprintf(&sb, "webhooks_active_connections %d\n", m.activeConns.Load())
	sb.WriteString("# HELP webhooks_errors_total Total injected or real errors\n")
	sb.WriteString("# TYPE webhooks_errors_total counter\n")
	fmt.Fprintf(&sb, "webhooks_errors_total %d\n", m.errorCount.Load())
	sb.WriteString("# HELP webhooks_accepted_total Total webhook events accepted\n")
	sb.WriteString("# TYPE webhooks_accepted_total counter\n")
	fmt.Fprintf(&sb, "webhooks_accepted_total %d\n", m.accepted.Load())
	sb.WriteString("# HELP webhooks_rejected_total Total webhook events rejected (queue full)\n")
	sb.WriteString("# TYPE webhooks_rejected_total counter\n")
	fmt.Fprintf(&sb, "webhooks_rejected_total %d\n", m.rejected.Load())
	sb.WriteString("# HELP webhooks_processed_total Total webhook events processed\n")
	sb.WriteString("# TYPE webhooks_processed_total counter\n")
	fmt.Fprintf(&sb, "webhooks_processed_total %d\n", m.processed.Load())
	sb.WriteString("# HELP webhooks_responses_total Responses by status class\n")
	sb.WriteString("# TYPE webhooks_responses_total counter\n")
	fmt.Fprintf(&sb, "webhooks_responses_total{status=\"2xx\"} %d\n", m.requestsBy2xx.Load())
	fmt.Fprintf(&sb, "webhooks_responses_total{status=\"4xx\"} %d\n", m.requestsBy4xx.Load())
	fmt.Fprintf(&sb, "webhooks_responses_total{status=\"5xx\"} %d\n", m.requestsBy5xx.Load())
	return sb.String()
}

// ---- Server ----------------------------------------------------------------

type Server struct {
	cfg      Config
	registry *Registry
	metrics  *Metrics
	rng      *rand.Rand
	rngMu    sync.Mutex
}

func NewServer(cfg Config, registry *Registry) *Server {
	return &Server{
		cfg:      cfg,
		registry: registry,
		metrics:  &Metrics{},
		rng:      rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (s *Server) randFloat() float64 {
	s.rngMu.Lock()
	v := s.rng.Float64()
	s.rngMu.Unlock()
	return v
}

func (s *Server) injectLatency() {
	span := float64(s.cfg.LatencyMax - s.cfg.LatencyMin)
	jitter := time.Duration(s.randFloat() * span)
	time.Sleep(s.cfg.LatencyMin + jitter)
}

func (s *Server) newEventID() string {
	s.rngMu.Lock()
	n := s.rng.Int63()
	s.rngMu.Unlock()
	return fmt.Sprintf("wh-%x-%d", n, time.Now().UnixNano())
}

func (s *Server) middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		s.metrics.totalRequests.Add(1)
		active := s.metrics.activeConns.Add(1)
		defer s.metrics.activeConns.Add(-1)

		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = fmt.Sprintf("wh-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", reqID)
		w.Header().Set("Content-Type", "application/json")

		if int(active) > s.cfg.MaxConns {
			s.metrics.requestsBy5xx.Add(1)
			s.metrics.errorCount.Add(1)
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "too many connections"})
			log.Printf("%s %s 503 %s [conns=%d] %v", r.Method, r.URL.Path, reqID, active, time.Since(start))
			return
		}

		if s.cfg.ErrorRate > 0 && s.randFloat() < s.cfg.ErrorRate {
			s.metrics.requestsBy5xx.Add(1)
			s.metrics.errorCount.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "injected error"})
			log.Printf("%s %s 500 %s [injected] %v", r.Method, r.URL.Path, reqID, time.Since(start))
			return
		}

		rw := &responseWriter{ResponseWriter: w, status: 200}
		next(rw, r)

		switch {
		case rw.status >= 500:
			s.metrics.requestsBy5xx.Add(1)
		case rw.status >= 400:
			s.metrics.requestsBy4xx.Add(1)
		default:
			s.metrics.requestsBy2xx.Add(1)
		}
		log.Printf("%s %s %d %s %v", r.Method, r.URL.Path, rw.status, reqID, time.Since(start))
	}
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// ---- Handlers --------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{
		"status":        "ok",
		"app":           "webhooks",
		"queue_depth":   s.cfg.QueueDepth,
		"process_delay": s.cfg.ProcessDelay.String(),
		"time":          time.Now().UTC(),
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprint(w, s.metrics.Text())
}

// POST /hooks/:channel
func (s *Server) handleReceive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	channel := extractChannel(r.URL.Path)
	if channel == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "channel required"})
		return
	}

	var payload json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON"})
		return
	}

	s.injectLatency()

	q := s.registry.get(channel)
	event := WebhookEvent{
		ID:         s.newEventID(),
		Channel:    channel,
		Payload:    payload,
		ReceivedAt: time.Now().UTC(),
	}

	select {
	case q.ch <- event:
		s.metrics.accepted.Add(1)
		q.accepted.Add(1)
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]any{
			"id":          event.ID,
			"channel":     channel,
			"received_at": event.ReceivedAt,
			"queue_depth": q.depth(),
		})
	default:
		s.metrics.rejected.Add(1)
		q.rejected.Add(1)
		w.Header().Set("Retry-After", "1")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]any{
			"error":       "queue full",
			"channel":     channel,
			"queue_depth": q.depth(),
			"queue_cap":   q.cap(),
		})
	}
}

// GET /hooks/:channel/pending
func (s *Server) handlePending(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	channel := extractChannelSuffix(r.URL.Path, "/pending")
	if channel == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "channel required"})
		return
	}

	q := s.registry.get(channel)
	json.NewEncoder(w).Encode(map[string]any{
		"channel":   channel,
		"pending":   q.depth(),
		"capacity":  q.cap(),
		"accepted":  q.accepted.Load(),
		"rejected":  q.rejected.Load(),
		"processed": q.processed.Load(),
	})
}

// GET /hooks/:channel/drain
func (s *Server) handleDrain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	channel := extractChannelSuffix(r.URL.Path, "/drain")
	if channel == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "channel required"})
		return
	}

	events := s.registry.drain(channel)
	count := len(events)
	s.metrics.processed.Add(int64(count))
	if q := s.registry.lookup(channel); q != nil {
		q.processed.Add(int64(count))
	}

	json.NewEncoder(w).Encode(map[string]any{
		"channel": channel,
		"drained": count,
	})
}

// ---- Routing ---------------------------------------------------------------

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", s.middleware(s.handleHealth))
	mux.HandleFunc("/metrics", s.handleMetrics) // no middleware: never inject errors/latency

	// /hooks/:channel/pending and /hooks/:channel/drain must be registered before
	// the bare /hooks/ catch-all so the mux routes them correctly.
	mux.HandleFunc("/hooks/", s.middleware(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case strings.HasSuffix(path, "/pending"):
			s.handlePending(w, r)
		case strings.HasSuffix(path, "/drain"):
			s.handleDrain(w, r)
		default:
			s.handleReceive(w, r)
		}
	}))

	return mux
}

// ---- Path helpers ----------------------------------------------------------

// extractChannel returns the channel name from /hooks/:channel
func extractChannel(path string) string {
	seg := strings.TrimPrefix(path, "/hooks/")
	seg = strings.Trim(seg, "/")
	return seg
}

// extractChannelSuffix returns the channel from /hooks/:channel/<suffix>
func extractChannelSuffix(path, suffix string) string {
	trimmed := strings.TrimSuffix(path, suffix)
	return extractChannel(trimmed)
}

// ---- Background processor --------------------------------------------------

// startProcessor spawns a goroutine that drains each channel queue with a
// configurable delay, simulating async webhook processing.
func startProcessor(ctx context.Context, registry *Registry, metrics *Metrics, delay time.Duration) {
	go func() {
		ticker := time.NewTicker(delay)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				registry.mu.Lock()
				channels := make([]*ChannelQueue, 0, len(registry.queues))
				for _, q := range registry.queues {
					channels = append(channels, q)
				}
				registry.mu.Unlock()

				for _, q := range channels {
					select {
					case <-q.ch:
						metrics.processed.Add(1)
						q.processed.Add(1)
					default:
						// nothing pending
					}
				}
			}
		}
	}()
}

// ---- Main ------------------------------------------------------------------

func main() {
	cfg := parseConfig()

	registry := NewRegistry(cfg.QueueDepth)
	srv := NewServer(cfg, registry)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	startProcessor(ctx, registry, srv.metrics, cfg.ProcessDelay)

	addr := fmt.Sprintf(":%d", cfg.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen %s: %v", addr, err)
	}

	httpSrv := &http.Server{
		Handler:      srv.routes(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("webhooks app listening on %s (max-conns=%d error-rate=%.1f%% queue-depth=%d process-delay=%v latency=%v-%v)",
		addr, cfg.MaxConns, cfg.ErrorRate*100, cfg.QueueDepth, cfg.ProcessDelay, cfg.LatencyMin, cfg.LatencyMax)

	go func() {
		if err := httpSrv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	cancel()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	if err := httpSrv.Shutdown(shutCtx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
	log.Println("stopped")
}
