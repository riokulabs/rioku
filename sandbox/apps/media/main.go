package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// ---- Config ----------------------------------------------------------------

type Config struct {
	Port           int
	MaxConns       int
	ErrorRate      float64
	MaxUpload      int64
	BandwidthLimit int64
	LatencyMin     time.Duration
	LatencyMax     time.Duration
}

func parseConfig() Config {
	port := flag.Int("port", 9005, "listen port")
	maxConns := flag.Int("max-conns", 100, "max concurrent connections")
	errorRate := flag.Float64("error-rate", 1.0, "error injection rate (percent, 0-100)")
	maxUpload := flag.Int64("max-upload", 10*1024*1024, "max upload size in bytes (default 10MB)")
	bwLimit := flag.Int64("bandwidth-limit", 0, "bandwidth limit in bytes/sec (0=unlimited)")
	latMin := flag.Duration("latency-min", 2*time.Millisecond, "minimum simulated latency")
	latMax := flag.Duration("latency-max", 20*time.Millisecond, "maximum simulated latency")
	flag.Parse()
	return Config{
		Port:           *port,
		MaxConns:       *maxConns,
		ErrorRate:      *errorRate / 100.0,
		MaxUpload:      *maxUpload,
		BandwidthLimit: *bwLimit,
		LatencyMin:     *latMin,
		LatencyMax:     *latMax,
	}
}

// ---- Blob ------------------------------------------------------------------

type Blob struct {
	ID          string    `json:"id"`
	Size        int64     `json:"size"`
	ContentType string    `json:"content_type"`
	CreatedAt   time.Time `json:"created_at"`
	Data        []byte    `json:"-"`
}

// blobSizes defines the distribution of pre-generated blobs (10 items).
var blobSizes = []int{
	50 * 1024,       // 50KB
	100 * 1024,      // 100KB
	200 * 1024,      // 200KB
	500 * 1024,      // 500KB
	1 * 1024 * 1024, // 1MB
	2 * 1024 * 1024, // 2MB
	50 * 1024,       // 50KB (repeat to reach 10)
	100 * 1024,      // 100KB
	500 * 1024,      // 500KB
	1 * 1024 * 1024, // 1MB
}

func generateBlobs() []*Blob {
	blobs := make([]*Blob, 0, len(blobSizes))
	for i, sz := range blobSizes {
		log.Printf("generating blob %d/%d (%s)...", i+1, len(blobSizes), humanBytes(int64(sz)))
		data := make([]byte, sz)
		if _, err := rand.Read(data); err != nil {
			log.Fatalf("crypto/rand read: %v", err)
		}
		blobs = append(blobs, &Blob{
			ID:          fmt.Sprintf("blob-%03d", i+1),
			Size:        int64(sz),
			ContentType: "application/octet-stream",
			CreatedAt:   time.Now().UTC(),
			Data:        data,
		})
	}
	return blobs
}

func humanBytes(n int64) string {
	switch {
	case n >= 1024*1024:
		return fmt.Sprintf("%.1fMB", float64(n)/float64(1024*1024))
	case n >= 1024:
		return fmt.Sprintf("%.1fKB", float64(n)/float64(1024))
	default:
		return fmt.Sprintf("%dB", n)
	}
}

// ---- Store -----------------------------------------------------------------

type Store struct {
	mu     sync.RWMutex
	blobs  map[string]*Blob
	nextID int64
}

func NewStore(seed []*Blob) *Store {
	s := &Store{
		blobs:  make(map[string]*Blob, len(seed)),
		nextID: int64(len(seed)) + 1,
	}
	for _, b := range seed {
		s.blobs[b.ID] = b
	}
	return s
}

func (s *Store) Get(id string) (*Blob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, ok := s.blobs[id]
	return b, ok
}

func (s *Store) Add(data []byte, contentType string) *Blob {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := fmt.Sprintf("upload-%06d", s.nextID)
	s.nextID++
	b := &Blob{
		ID:          id,
		Size:        int64(len(data)),
		ContentType: contentType,
		CreatedAt:   time.Now().UTC(),
		Data:        data,
	}
	s.blobs[id] = b
	return b
}

func (s *Store) Delete(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.blobs[id]; !ok {
		return false
	}
	delete(s.blobs, id)
	return true
}

func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.blobs)
}

// ---- Metrics ---------------------------------------------------------------

type Metrics struct {
	totalRequests atomic.Int64
	activeConns   atomic.Int64
	errorCount    atomic.Int64
	bytesServed   atomic.Int64
	requestsBy2xx atomic.Int64
	requestsBy4xx atomic.Int64
	requestsBy5xx atomic.Int64
}

func (m *Metrics) Text() string {
	var sb strings.Builder
	sb.WriteString("# HELP media_requests_total Total HTTP requests received\n")
	sb.WriteString("# TYPE media_requests_total counter\n")
	fmt.Fprintf(&sb, "media_requests_total %d\n", m.totalRequests.Load())
	sb.WriteString("# HELP media_active_connections Current active connections\n")
	sb.WriteString("# TYPE media_active_connections gauge\n")
	fmt.Fprintf(&sb, "media_active_connections %d\n", m.activeConns.Load())
	sb.WriteString("# HELP media_errors_total Total injected or real errors\n")
	sb.WriteString("# TYPE media_errors_total counter\n")
	fmt.Fprintf(&sb, "media_errors_total %d\n", m.errorCount.Load())
	sb.WriteString("# HELP media_bytes_served_total Total bytes served to clients\n")
	sb.WriteString("# TYPE media_bytes_served_total counter\n")
	fmt.Fprintf(&sb, "media_bytes_served_total %d\n", m.bytesServed.Load())
	sb.WriteString("# HELP media_responses_total Responses by status class\n")
	sb.WriteString("# TYPE media_responses_total counter\n")
	fmt.Fprintf(&sb, "media_responses_total{status=\"2xx\"} %d\n", m.requestsBy2xx.Load())
	fmt.Fprintf(&sb, "media_responses_total{status=\"4xx\"} %d\n", m.requestsBy4xx.Load())
	fmt.Fprintf(&sb, "media_responses_total{status=\"5xx\"} %d\n", m.requestsBy5xx.Load())
	return sb.String()
}

// ---- Throttled writer ------------------------------------------------------

// throttledWriter writes data in chunks, sleeping between them to simulate
// a bandwidth limit. If limit is 0, data is written directly without throttling.
type throttledWriter struct {
	w     http.ResponseWriter
	limit int64 // bytes per second; 0 = unlimited
}

func (tw *throttledWriter) write(data []byte) (int, error) {
	if tw.limit <= 0 {
		n, err := tw.w.Write(data)
		if f, ok := tw.w.(http.Flusher); ok {
			f.Flush()
		}
		return n, err
	}

	// Write in chunks: limit/10 bytes per 100ms to approximate limit bytes/sec.
	chunkSize := tw.limit / 10
	if chunkSize < 1 {
		chunkSize = 1
	}

	total := 0
	buf := data
	for len(buf) > 0 {
		end := int(chunkSize)
		if end > len(buf) {
			end = len(buf)
		}
		n, err := tw.w.Write(buf[:end])
		total += n
		if f, ok := tw.w.(http.Flusher); ok {
			f.Flush()
		}
		if err != nil {
			return total, err
		}
		buf = buf[n:]
		if len(buf) > 0 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	return total, nil
}

// ---- Server ----------------------------------------------------------------

type Server struct {
	cfg     Config
	store   *Store
	metrics *Metrics
}

func NewServer(cfg Config, store *Store) *Server {
	return &Server{
		cfg:     cfg,
		store:   store,
		metrics: &Metrics{},
	}
}

func (s *Server) injectLatency() {
	if s.cfg.LatencyMax <= s.cfg.LatencyMin {
		time.Sleep(s.cfg.LatencyMin)
		return
	}
	span := s.cfg.LatencyMax - s.cfg.LatencyMin
	// Use crypto/rand for latency jitter to avoid math/rand dependency.
	b := make([]byte, 4)
	if _, err := rand.Read(b); err == nil {
		v := int64(b[0])<<24 | int64(b[1])<<16 | int64(b[2])<<8 | int64(b[3])
		if v < 0 {
			v = -v
		}
		jitter := time.Duration(v % int64(span))
		time.Sleep(s.cfg.LatencyMin + jitter)
	} else {
		time.Sleep(s.cfg.LatencyMin)
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

func (s *Server) middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		s.metrics.totalRequests.Add(1)
		active := s.metrics.activeConns.Add(1)
		defer s.metrics.activeConns.Add(-1)

		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			b := make([]byte, 8)
			rand.Read(b) //nolint: error ignored intentionally
			reqID = fmt.Sprintf("med-%x", b)
		}
		w.Header().Set("X-Request-ID", reqID)

		if int(active) > s.cfg.MaxConns {
			s.metrics.requestsBy5xx.Add(1)
			s.metrics.errorCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "too many connections"})
			log.Printf("%s %s 503 %s [conns=%d] %v", r.Method, r.URL.Path, reqID, active, time.Since(start))
			return
		}

		if s.cfg.ErrorRate > 0 {
			b := make([]byte, 8)
			rand.Read(b) //nolint
			v := float64(int64(b[0])<<8|int64(b[1])) / float64(0xFFFF)
			if v < s.cfg.ErrorRate {
				s.metrics.requestsBy5xx.Add(1)
				s.metrics.errorCount.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "injected error"})
				log.Printf("%s %s 500 %s [injected] %v", r.Method, r.URL.Path, reqID, time.Since(start))
				return
			}
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

// ---- Handlers --------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":     "ok",
		"app":        "media",
		"blob_count": s.store.Count(),
		"time":       time.Now().UTC(),
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprint(w, s.metrics.Text())
}

// handleGetMedia streams a blob with optional Range support.
func (s *Server) handleGetMedia(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/media/")
	id = strings.TrimSuffix(id, "/")

	s.injectLatency()

	blob, ok := s.store.Get(id)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
		return
	}

	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		s.serveRange(w, r, blob, rangeHeader)
		return
	}

	// Full response: 200
	w.Header().Set("Content-Type", blob.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(blob.Size, 10))
	w.Header().Set("Accept-Ranges", "bytes")
	w.WriteHeader(http.StatusOK)

	tw := &throttledWriter{w: w, limit: s.cfg.BandwidthLimit}
	n, _ := tw.write(blob.Data)
	s.metrics.bytesServed.Add(int64(n))
}

// serveRange handles partial content requests (Range: bytes=start-end).
func (s *Server) serveRange(w http.ResponseWriter, r *http.Request, blob *Blob, rangeHeader string) {
	if !strings.HasPrefix(rangeHeader, "bytes=") {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", blob.Size))
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}

	rangeSpec := strings.TrimPrefix(rangeHeader, "bytes=")
	// Only support single range for simplicity: start-end
	parts := strings.SplitN(rangeSpec, "-", 2)
	if len(parts) != 2 {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", blob.Size))
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}

	var start, end int64
	var err error

	if parts[0] == "" {
		// suffix range: -N means last N bytes
		suffixLen, err2 := strconv.ParseInt(parts[1], 10, 64)
		if err2 != nil || suffixLen <= 0 {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", blob.Size))
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		start = blob.Size - suffixLen
		if start < 0 {
			start = 0
		}
		end = blob.Size - 1
	} else {
		start, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", blob.Size))
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		if parts[1] == "" {
			end = blob.Size - 1
		} else {
			end, err = strconv.ParseInt(parts[1], 10, 64)
			if err != nil {
				w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", blob.Size))
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}
		}
	}

	if start < 0 || end < start || start >= blob.Size || end >= blob.Size {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", blob.Size))
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}

	sliceLen := end - start + 1
	w.Header().Set("Content-Type", blob.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(sliceLen, 10))
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, blob.Size))
	w.Header().Set("Accept-Ranges", "bytes")
	w.WriteHeader(http.StatusPartialContent)

	if r.Method == http.MethodHead {
		return
	}

	tw := &throttledWriter{w: w, limit: s.cfg.BandwidthLimit}
	n, _ := tw.write(blob.Data[start : end+1])
	s.metrics.bytesServed.Add(int64(n))
}

// handleGetMeta returns metadata JSON without sending the blob body.
func (s *Server) handleGetMeta(w http.ResponseWriter, r *http.Request) {
	// Path: /media/:id/meta
	path := strings.TrimSuffix(r.URL.Path, "/")
	path = strings.TrimPrefix(path, "/media/")
	id := strings.TrimSuffix(path, "/meta")

	s.injectLatency()

	blob, ok := s.store.Get(id)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":           blob.ID,
		"size":         blob.Size,
		"content_type": blob.ContentType,
		"created_at":   blob.CreatedAt,
	})
}

// handleUpload accepts multipart/form-data or raw body uploads.
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUpload+1024) // small headroom for multipart overhead

	contentType := r.Header.Get("Content-Type")
	var data []byte
	var detectedType string

	if strings.HasPrefix(contentType, "multipart/form-data") {
		_, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid multipart content-type"})
			return
		}
		boundary := params["boundary"]
		mr := multipart.NewReader(r.Body, boundary)
		var found bool
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "multipart read error"})
				return
			}
			if part.FormName() == "file" {
				var buf bytes.Buffer
				lr := &io.LimitedReader{R: part, N: s.cfg.MaxUpload + 1}
				if _, err := io.Copy(&buf, lr); err != nil {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "read error"})
					return
				}
				if lr.N == 0 {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusRequestEntityTooLarge)
					json.NewEncoder(w).Encode(map[string]string{"error": "upload exceeds max size"})
					return
				}
				data = buf.Bytes()
				detectedType = part.Header.Get("Content-Type")
				if detectedType == "" {
					detectedType = "application/octet-stream"
				}
				found = true
				part.Close()
				break
			}
			part.Close()
		}
		if !found {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "missing 'file' field in multipart"})
			return
		}
	} else {
		// Raw body upload
		lr := &io.LimitedReader{R: r.Body, N: s.cfg.MaxUpload + 1}
		var buf bytes.Buffer
		if _, err := io.Copy(&buf, lr); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "read error"})
			return
		}
		if lr.N == 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			json.NewEncoder(w).Encode(map[string]string{"error": "upload exceeds max size"})
			return
		}
		data = buf.Bytes()
		detectedType = contentType
		if detectedType == "" {
			detectedType = "application/octet-stream"
		}
	}

	if int64(len(data)) > s.cfg.MaxUpload {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		json.NewEncoder(w).Encode(map[string]string{"error": "upload exceeds max size"})
		return
	}

	blob := s.store.Add(data, detectedType)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"id":           blob.ID,
		"size":         blob.Size,
		"content_type": blob.ContentType,
	})
}

// handleDeleteMedia removes a blob from memory.
func (s *Server) handleDeleteMedia(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/media/")
	id = strings.TrimSuffix(id, "/")

	s.injectLatency()

	if !s.store.Delete(id) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- Routing ---------------------------------------------------------------

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", s.middleware(s.handleHealth))
	mux.HandleFunc("/metrics", s.handleMetrics) // no middleware: never inject errors/latency

	mux.HandleFunc("/media/upload", s.middleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
			return
		}
		s.handleUpload(w, r)
	}))

	// /media/:id/meta and /media/:id
	mux.HandleFunc("/media/", s.middleware(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimSuffix(r.URL.Path, "/")

		if strings.HasSuffix(path, "/meta") {
			if r.Method != http.MethodGet {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusMethodNotAllowed)
				json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
				return
			}
			s.handleGetMeta(w, r)
			return
		}

		switch r.Method {
		case http.MethodGet:
			s.handleGetMedia(w, r)
		case http.MethodDelete:
			s.handleDeleteMedia(w, r)
		default:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		}
	}))

	return mux
}

// ---- Main ------------------------------------------------------------------

func main() {
	cfg := parseConfig()

	log.Printf("generating %d blobs (this may take a moment)...", len(blobSizes))
	blobs := generateBlobs()
	store := NewStore(blobs)
	srv := NewServer(cfg, store)
	log.Printf("blobs ready: %d items in store", store.Count())

	addr := fmt.Sprintf(":%d", cfg.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen %s: %v", addr, err)
	}

	writeTimeout := 5 * time.Minute // large for slow bandwidth-limited transfers
	if cfg.BandwidthLimit > 0 {
		// Estimate worst-case: largest blob (2MB) at minimum bandwidth
		worst := time.Duration(2*1024*1024/cfg.BandwidthLimit)*time.Second + 30*time.Second
		if worst > writeTimeout {
			writeTimeout = worst
		}
	}

	httpSrv := &http.Server{
		Handler:      srv.routes(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: writeTimeout,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("media app listening on %s (max-conns=%d error-rate=%.1f%% bw-limit=%s latency=%v-%v max-upload=%s)",
		addr, cfg.MaxConns, cfg.ErrorRate*100,
		humanBytes(cfg.BandwidthLimit)+"/s",
		cfg.LatencyMin, cfg.LatencyMax,
		humanBytes(cfg.MaxUpload))

	go func() {
		if err := httpSrv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
	log.Println("stopped")
}
