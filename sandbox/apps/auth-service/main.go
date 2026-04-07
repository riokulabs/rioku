package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	mrand "math/rand"
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
	Port       int
	MaxConns   int
	ErrorRate  float64
	RateLimit  int
	LatencyMin time.Duration
	LatencyMax time.Duration
}

func parseConfig() Config {
	port := flag.Int("port", 9004, "listen port")
	maxConns := flag.Int("max-conns", 100, "max concurrent connections")
	errorRate := flag.Float64("error-rate", 0, "error injection rate (percent, 0-100)")
	rateLimit := flag.Int("rate-limit", 100, "per-IP requests per second")
	latMin := flag.Duration("latency-min", 1*time.Millisecond, "minimum simulated latency")
	latMax := flag.Duration("latency-max", 5*time.Millisecond, "maximum simulated latency")
	flag.Parse()
	return Config{
		Port:       *port,
		MaxConns:   *maxConns,
		ErrorRate:  *errorRate / 100.0,
		RateLimit:  *rateLimit,
		LatencyMin: *latMin,
		LatencyMax: *latMax,
	}
}

// ---- Known Users -----------------------------------------------------------

type knownUser struct {
	password string
	roles    []string
}

var knownUsers = map[string]knownUser{
	"admin":    {password: "admin123", roles: []string{"admin", "read", "write"}},
	"editor":   {password: "editor123", roles: []string{"read", "write"}},
	"viewer":   {password: "viewer123", roles: []string{"read"}},
	"testuser": {password: "testpass", roles: []string{"read"}},
}

// ---- Token Claims ----------------------------------------------------------

type Claims struct {
	Sub   string   `json:"sub"`
	Roles []string `json:"roles"`
	Exp   int64    `json:"exp"`
	Iat   int64    `json:"iat"`
	Type  string   `json:"type"`
	JTI   string   `json:"jti"` // unique token ID to prevent collision on same-second issuance
}

// newJTI generates a random 12-byte URL-safe base64 token identifier.
func newJTI() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func encodeToken(c Claims) (string, error) {
	data, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func decodeToken(token string) (*Claims, error) {
	data, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("invalid token encoding")
	}
	var c Claims
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("invalid token payload")
	}
	return &c, nil
}

// ---- Token Store -----------------------------------------------------------

// TokenStore tracks active refresh tokens (one-time use).
type TokenStore struct {
	mu      sync.Mutex
	refresh map[string]bool // token -> valid (true = not yet used)
}

func NewTokenStore() *TokenStore {
	return &TokenStore{refresh: make(map[string]bool)}
}

// RegisterRefresh stores a refresh token as valid.
func (ts *TokenStore) RegisterRefresh(token string) {
	ts.mu.Lock()
	ts.refresh[token] = true
	ts.mu.Unlock()
}

// ConsumeRefresh atomically validates and revokes a refresh token.
// Returns true if the token was valid and has been consumed.
func (ts *TokenStore) ConsumeRefresh(token string) bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	valid, exists := ts.refresh[token]
	if !exists || !valid {
		return false
	}
	ts.refresh[token] = false
	return true
}

// ---- Per-IP Rate Limiter ---------------------------------------------------

type ipWindow struct {
	count    int
	windowAt time.Time
}

type RateLimiter struct {
	mu      sync.Mutex
	windows map[string]*ipWindow
	limit   int // requests per second
}

func NewRateLimiter(limit int) *RateLimiter {
	return &RateLimiter{
		windows: make(map[string]*ipWindow),
		limit:   limit,
	}
}

// Allow checks the sliding (1s tumbling) window for the given IP.
// Returns true if the request is allowed.
func (rl *RateLimiter) Allow(ip string) bool {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()
	w, ok := rl.windows[ip]
	if !ok {
		rl.windows[ip] = &ipWindow{count: 1, windowAt: now}
		return true
	}
	if now.Sub(w.windowAt) >= time.Second {
		w.count = 1
		w.windowAt = now
		return true
	}
	w.count++
	return w.count <= rl.limit
}

// ---- Failed Attempt Tracking -----------------------------------------------

type FailStats struct {
	mu    sync.Mutex
	total int64
	byIP  map[string]int64
}

func NewFailStats() *FailStats {
	return &FailStats{byIP: make(map[string]int64)}
}

func (fs *FailStats) Record(ip string) {
	fs.mu.Lock()
	fs.total++
	fs.byIP[ip]++
	fs.mu.Unlock()
}

func (fs *FailStats) Snapshot() (int64, map[string]int64) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	cp := make(map[string]int64, len(fs.byIP))
	for k, v := range fs.byIP {
		cp[k] = v
	}
	return fs.total, cp
}

// ---- Metrics ---------------------------------------------------------------

type Metrics struct {
	totalRequests   atomic.Int64
	activeConns     atomic.Int64
	errorCount      atomic.Int64
	requestsBy2xx   atomic.Int64
	requestsBy4xx   atomic.Int64
	requestsBy5xx   atomic.Int64
	tokensIssued    atomic.Int64
	tokensValidated atomic.Int64
	tokensRefreshed atomic.Int64
	authFailures    atomic.Int64
	rateLimited     atomic.Int64
}

func (m *Metrics) Text() string {
	var sb strings.Builder
	sb.WriteString("# HELP auth_requests_total Total HTTP requests received\n")
	sb.WriteString("# TYPE auth_requests_total counter\n")
	fmt.Fprintf(&sb, "auth_requests_total %d\n", m.totalRequests.Load())
	sb.WriteString("# HELP auth_active_connections Current active connections\n")
	sb.WriteString("# TYPE auth_active_connections gauge\n")
	fmt.Fprintf(&sb, "auth_active_connections %d\n", m.activeConns.Load())
	sb.WriteString("# HELP auth_errors_total Total injected or real errors\n")
	sb.WriteString("# TYPE auth_errors_total counter\n")
	fmt.Fprintf(&sb, "auth_errors_total %d\n", m.errorCount.Load())
	sb.WriteString("# HELP auth_responses_total Responses by status class\n")
	sb.WriteString("# TYPE auth_responses_total counter\n")
	fmt.Fprintf(&sb, "auth_responses_total{status=\"2xx\"} %d\n", m.requestsBy2xx.Load())
	fmt.Fprintf(&sb, "auth_responses_total{status=\"4xx\"} %d\n", m.requestsBy4xx.Load())
	fmt.Fprintf(&sb, "auth_responses_total{status=\"5xx\"} %d\n", m.requestsBy5xx.Load())
	sb.WriteString("# HELP auth_tokens_issued_total Total access tokens issued\n")
	sb.WriteString("# TYPE auth_tokens_issued_total counter\n")
	fmt.Fprintf(&sb, "auth_tokens_issued_total %d\n", m.tokensIssued.Load())
	sb.WriteString("# HELP auth_tokens_validated_total Total token validations\n")
	sb.WriteString("# TYPE auth_tokens_validated_total counter\n")
	fmt.Fprintf(&sb, "auth_tokens_validated_total %d\n", m.tokensValidated.Load())
	sb.WriteString("# HELP auth_tokens_refreshed_total Total token refreshes\n")
	sb.WriteString("# TYPE auth_tokens_refreshed_total counter\n")
	fmt.Fprintf(&sb, "auth_tokens_refreshed_total %d\n", m.tokensRefreshed.Load())
	sb.WriteString("# HELP auth_failures_total Total authentication failures\n")
	sb.WriteString("# TYPE auth_failures_total counter\n")
	fmt.Fprintf(&sb, "auth_failures_total %d\n", m.authFailures.Load())
	sb.WriteString("# HELP auth_rate_limited_total Total requests rate limited\n")
	sb.WriteString("# TYPE auth_rate_limited_total counter\n")
	fmt.Fprintf(&sb, "auth_rate_limited_total %d\n", m.rateLimited.Load())
	return sb.String()
}

// ---- Server ----------------------------------------------------------------

type Server struct {
	cfg         Config
	metrics     *Metrics
	tokens      *TokenStore
	rateLimiter *RateLimiter
	failStats   *FailStats
	rng         *mrand.Rand
	rngMu       sync.Mutex
}

func NewServer(cfg Config) *Server {
	return &Server{
		cfg:         cfg,
		metrics:     &Metrics{},
		tokens:      NewTokenStore(),
		rateLimiter: NewRateLimiter(cfg.RateLimit),
		failStats:   NewFailStats(),
		rng:         mrand.New(mrand.NewSource(time.Now().UnixNano())),
	}
}

func (s *Server) randFloat() float64 {
	s.rngMu.Lock()
	v := s.rng.Float64()
	s.rngMu.Unlock()
	return v
}

func (s *Server) randIntn(n int) int {
	s.rngMu.Lock()
	v := s.rng.Intn(n)
	s.rngMu.Unlock()
	return v
}

func (s *Server) injectLatency() {
	span := float64(s.cfg.LatencyMax - s.cfg.LatencyMin)
	jitter := time.Duration(s.randFloat() * span)
	time.Sleep(s.cfg.LatencyMin + jitter)
}

// simulateBcrypt sleeps 10-30ms to simulate bcrypt password checking.
func (s *Server) simulateBcrypt() {
	ms := 10 + s.randIntn(21) // [10, 30]
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

// simulateCacheLookup sleeps 1-3ms to simulate a cache read.
func (s *Server) simulateCacheLookup() {
	ms := 1 + s.randIntn(3) // [1, 3]
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

// clientIP extracts a best-effort IP from the request.
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.SplitN(fwd, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ---- Response Writer -------------------------------------------------------

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// ---- Middleware ------------------------------------------------------------

func (s *Server) middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		s.metrics.totalRequests.Add(1)
		active := s.metrics.activeConns.Add(1)
		defer s.metrics.activeConns.Add(-1)

		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = fmt.Sprintf("auth-%d", time.Now().UnixNano())
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

		// Per-IP rate limiting
		ip := clientIP(r)
		if !s.rateLimiter.Allow(ip) {
			s.metrics.rateLimited.Add(1)
			s.metrics.requestsBy4xx.Add(1)
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{"error": "rate limit exceeded"})
			log.Printf("%s %s 429 %s [ip=%s rate-limited] %v", r.Method, r.URL.Path, reqID, ip, time.Since(start))
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

// ---- Handlers --------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"app":    "auth-service",
		"time":   time.Now().UTC(),
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprint(w, s.metrics.Text())
}

// POST /auth/token
func (s *Server) handleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON"})
		return
	}

	// Simulate bcrypt latency regardless of outcome (constant-time behavior)
	s.simulateBcrypt()
	s.injectLatency()

	ip := clientIP(r)
	user, ok := knownUsers[req.Username]
	if !ok || user.password != req.Password {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid credentials"})
		return
	}

	now := time.Now().UTC()
	accessJTI, err := newJTI()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "token generation failed"})
		return
	}
	refreshJTI, err := newJTI()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "token generation failed"})
		return
	}
	accessClaims := Claims{
		Sub:   req.Username,
		Roles: user.roles,
		Exp:   now.Add(15 * time.Minute).Unix(),
		Iat:   now.Unix(),
		Type:  "access",
		JTI:   accessJTI,
	}
	refreshClaims := Claims{
		Sub:   req.Username,
		Roles: user.roles,
		Exp:   now.Add(7 * 24 * time.Hour).Unix(),
		Iat:   now.Unix(),
		Type:  "refresh",
		JTI:   refreshJTI,
	}

	accessToken, err := encodeToken(accessClaims)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "token encoding failed"})
		return
	}
	refreshToken, err := encodeToken(refreshClaims)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "token encoding failed"})
		return
	}

	s.tokens.RegisterRefresh(refreshToken)
	s.metrics.tokensIssued.Add(1)

	json.NewEncoder(w).Encode(map[string]any{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    900,
	})
}

// GET /auth/validate
func (s *Server) handleValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	// Simulate cache lookup latency
	s.simulateCacheLookup()
	s.injectLatency()

	ip := clientIP(r)
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "missing or invalid Authorization header"})
		return
	}

	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	claims, err := decodeToken(tokenStr)
	if err != nil {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	if claims.Type != "access" {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid token type"})
		return
	}

	if time.Now().Unix() > claims.Exp {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "token expired"})
		return
	}

	s.metrics.tokensValidated.Add(1)
	json.NewEncoder(w).Encode(map[string]any{
		"valid": true,
		"sub":   claims.Sub,
		"roles": claims.Roles,
		"exp":   claims.Exp,
		"iat":   claims.Iat,
		"type":  claims.Type,
	})
}

// POST /auth/refresh
func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON"})
		return
	}

	// Simulate bcrypt latency for refresh (consistent with token ops)
	s.simulateBcrypt()
	s.injectLatency()

	ip := clientIP(r)

	if req.RefreshToken == "" {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "refresh_token is required"})
		return
	}

	claims, err := decodeToken(req.RefreshToken)
	if err != nil {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	if claims.Type != "refresh" {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid token type"})
		return
	}

	if time.Now().Unix() > claims.Exp {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "refresh token expired"})
		return
	}

	// Atomically consume the refresh token (one-time use)
	if !s.tokens.ConsumeRefresh(req.RefreshToken) {
		s.metrics.authFailures.Add(1)
		s.failStats.Record(ip)
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "refresh token already used or unknown"})
		return
	}

	// Issue a new token pair
	now := time.Now().UTC()
	accessJTI, err := newJTI()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "token generation failed"})
		return
	}
	refreshJTI, err := newJTI()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "token generation failed"})
		return
	}
	accessClaims := Claims{
		Sub:   claims.Sub,
		Roles: claims.Roles,
		Exp:   now.Add(15 * time.Minute).Unix(),
		Iat:   now.Unix(),
		Type:  "access",
		JTI:   accessJTI,
	}
	refreshClaims := Claims{
		Sub:   claims.Sub,
		Roles: claims.Roles,
		Exp:   now.Add(7 * 24 * time.Hour).Unix(),
		Iat:   now.Unix(),
		Type:  "refresh",
		JTI:   refreshJTI,
	}

	accessToken, err := encodeToken(accessClaims)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "token encoding failed"})
		return
	}
	newRefreshToken, err := encodeToken(refreshClaims)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "token encoding failed"})
		return
	}

	s.tokens.RegisterRefresh(newRefreshToken)
	s.metrics.tokensRefreshed.Add(1)
	s.metrics.tokensIssued.Add(1)

	json.NewEncoder(w).Encode(map[string]any{
		"access_token":  accessToken,
		"refresh_token": newRefreshToken,
		"token_type":    "Bearer",
		"expires_in":    900,
	})
}

// GET /auth/stats
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}
	total, byIP := s.failStats.Snapshot()
	json.NewEncoder(w).Encode(map[string]any{
		"failed_attempts_total": total,
		"failed_attempts_by_ip": byIP,
	})
}

// ---- Routing ---------------------------------------------------------------

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", s.middleware(s.handleHealth))
	mux.HandleFunc("/metrics", s.handleMetrics) // no middleware: metrics never inject errors/latency

	mux.HandleFunc("/auth/token", s.middleware(s.handleToken))
	mux.HandleFunc("/auth/validate", s.middleware(s.handleValidate))
	mux.HandleFunc("/auth/refresh", s.middleware(s.handleRefresh))
	mux.HandleFunc("/auth/stats", s.middleware(s.handleStats))

	return mux
}

// ---- Main ------------------------------------------------------------------

func main() {
	cfg := parseConfig()
	srv := NewServer(cfg)

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

	log.Printf("auth-service listening on %s (max-conns=%d error-rate=%.1f%% rate-limit=%d/s latency=%v-%v)",
		addr, cfg.MaxConns, cfg.ErrorRate*100, cfg.RateLimit, cfg.LatencyMin, cfg.LatencyMax)

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
