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
	"sort"
	"strconv"
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
	LatencyMin time.Duration
	LatencyMax time.Duration
}

func parseConfig() Config {
	port := flag.Int("port", 9001, "listen port")
	maxConns := flag.Int("max-conns", 100, "max concurrent connections")
	errorRate := flag.Float64("error-rate", 1.0, "error injection rate (percent, 0-100)")
	latMin := flag.Duration("latency-min", 2*time.Millisecond, "minimum simulated latency")
	latMax := flag.Duration("latency-max", 50*time.Millisecond, "maximum simulated latency")
	flag.Parse()
	return Config{
		Port:       *port,
		MaxConns:   *maxConns,
		ErrorRate:  *errorRate / 100.0,
		LatencyMin: *latMin,
		LatencyMax: *latMax,
	}
}

// ---- Domain ----------------------------------------------------------------

type User struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Deleted   bool      `json:"-"`
}

type CreateUserRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type UpdateUserRequest struct {
	Name  *string `json:"name,omitempty"`
	Email *string `json:"email,omitempty"`
}

// ---- Seed data -------------------------------------------------------------

var firstNames = []string{
	"Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Henry",
	"Iris", "Jack", "Karen", "Liam", "Mia", "Noah", "Olivia", "Paul",
	"Quinn", "Rachel", "Samuel", "Tara", "Uma", "Victor", "Wendy", "Xander",
	"Yara", "Zach", "Abby", "Brian", "Clara", "Derek", "Elena", "Felix",
	"Gina", "Hugo", "Isla", "James", "Kylie", "Leo", "Maya", "Nate",
}

var lastNames = []string{
	"Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
	"Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
	"Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
	"Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
	"Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
	"Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
}

var emailDomains = []string{
	"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
	"protonmail.com", "fastmail.com", "example.com", "test.io", "dev.net",
}

func seedUsers(n int, rng *rand.Rand) []*User {
	users := make([]*User, 0, n)
	seen := make(map[string]bool, n)
	now := time.Now().UTC()
	for i := 1; len(users) < n; i++ {
		first := firstNames[rng.Intn(len(firstNames))]
		last := lastNames[rng.Intn(len(lastNames))]
		domain := emailDomains[rng.Intn(len(emailDomains))]
		suffix := rng.Intn(9999)
		email := fmt.Sprintf("%s.%s%d@%s", strings.ToLower(first), strings.ToLower(last), suffix, domain)
		if seen[email] {
			continue
		}
		seen[email] = true
		created := now.Add(-time.Duration(rng.Intn(365*24)) * time.Hour)
		users = append(users, &User{
			ID:        int64(i),
			Name:      first + " " + last,
			Email:     email,
			CreatedAt: created,
			UpdatedAt: created,
		})
	}
	return users
}

// ---- Store -----------------------------------------------------------------

type Store struct {
	mu      sync.RWMutex
	users   map[int64]*User
	nextID  int64
	ordered []int64 // insertion order for stable pagination
}

func NewStore(seed []*User) *Store {
	s := &Store{
		users:   make(map[int64]*User, len(seed)),
		ordered: make([]int64, 0, len(seed)),
	}
	for _, u := range seed {
		s.users[u.ID] = u
		s.ordered = append(s.ordered, u.ID)
		if u.ID >= s.nextID {
			s.nextID = u.ID + 1
		}
	}
	return s
}

func (s *Store) List(page, pageSize int, nameFilter, emailFilter, sortBy string) ([]*User, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var matched []*User
	nl := strings.ToLower(nameFilter)
	el := strings.ToLower(emailFilter)
	for _, id := range s.ordered {
		u := s.users[id]
		if u.Deleted {
			continue
		}
		if nl != "" && !strings.Contains(strings.ToLower(u.Name), nl) {
			continue
		}
		if el != "" && !strings.Contains(strings.ToLower(u.Email), el) {
			continue
		}
		matched = append(matched, u)
	}

	switch sortBy {
	case "name":
		sort.Slice(matched, func(i, j int) bool {
			return strings.ToLower(matched[i].Name) < strings.ToLower(matched[j].Name)
		})
	case "email":
		sort.Slice(matched, func(i, j int) bool {
			return strings.ToLower(matched[i].Email) < strings.ToLower(matched[j].Email)
		})
	case "created_at":
		sort.Slice(matched, func(i, j int) bool {
			return matched[i].CreatedAt.Before(matched[j].CreatedAt)
		})
	}

	total := len(matched)
	if pageSize <= 0 {
		pageSize = 20
	}
	if page <= 0 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start >= total {
		return []*User{}, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return matched[start:end], total
}

func (s *Store) Get(id int64) (*User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	if !ok || u.Deleted {
		return nil, false
	}
	return u, true
}

func (s *Store) Create(name, email string) *User {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	u := &User{
		ID:        s.nextID,
		Name:      name,
		Email:     email,
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.nextID++
	s.users[u.ID] = u
	s.ordered = append(s.ordered, u.ID)
	return u
}

func (s *Store) Update(id int64, name, email *string) (*User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok || u.Deleted {
		return nil, false
	}
	if name != nil {
		u.Name = *name
	}
	if email != nil {
		u.Email = *email
	}
	u.UpdatedAt = time.Now().UTC()
	return u, true
}

func (s *Store) Delete(id int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok || u.Deleted {
		return false
	}
	u.Deleted = true
	u.UpdatedAt = time.Now().UTC()
	return true
}

// ---- Metrics ---------------------------------------------------------------

type Metrics struct {
	totalRequests atomic.Int64
	activeConns   atomic.Int64
	errorCount    atomic.Int64
	requestsBy2xx atomic.Int64
	requestsBy4xx atomic.Int64
	requestsBy5xx atomic.Int64
}

func (m *Metrics) Text() string {
	var sb strings.Builder
	sb.WriteString("# HELP users_requests_total Total HTTP requests received\n")
	sb.WriteString("# TYPE users_requests_total counter\n")
	fmt.Fprintf(&sb, "users_requests_total %d\n", m.totalRequests.Load())
	sb.WriteString("# HELP users_active_connections Current active connections\n")
	sb.WriteString("# TYPE users_active_connections gauge\n")
	fmt.Fprintf(&sb, "users_active_connections %d\n", m.activeConns.Load())
	sb.WriteString("# HELP users_errors_total Total injected or real errors\n")
	sb.WriteString("# TYPE users_errors_total counter\n")
	fmt.Fprintf(&sb, "users_errors_total %d\n", m.errorCount.Load())
	sb.WriteString("# HELP users_responses_total Responses by status class\n")
	sb.WriteString("# TYPE users_responses_total counter\n")
	fmt.Fprintf(&sb, "users_responses_total{status=\"2xx\"} %d\n", m.requestsBy2xx.Load())
	fmt.Fprintf(&sb, "users_responses_total{status=\"4xx\"} %d\n", m.requestsBy4xx.Load())
	fmt.Fprintf(&sb, "users_responses_total{status=\"5xx\"} %d\n", m.requestsBy5xx.Load())
	return sb.String()
}

// ---- Server ----------------------------------------------------------------

type Server struct {
	cfg     Config
	store   *Store
	metrics *Metrics
	rng     *rand.Rand
	rngMu   sync.Mutex
}

func NewServer(cfg Config, store *Store) *Server {
	return &Server{
		cfg:     cfg,
		store:   store,
		metrics: &Metrics{},
		rng:     rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (s *Server) randFloat() float64 {
	s.rngMu.Lock()
	v := s.rng.Float64()
	s.rngMu.Unlock()
	return v
}

func (s *Server) injectLatency(scale float64) {
	span := float64(s.cfg.LatencyMax - s.cfg.LatencyMin)
	jitter := time.Duration(s.randFloat() * span * scale)
	time.Sleep(s.cfg.LatencyMin + jitter)
}

func (s *Server) middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		s.metrics.totalRequests.Add(1)
		active := s.metrics.activeConns.Add(1)
		defer s.metrics.activeConns.Add(-1)

		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = fmt.Sprintf("usr-%d", time.Now().UnixNano())
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
		"status": "ok",
		"app":    "users",
		"time":   time.Now().UTC(),
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprint(w, s.metrics.Text())
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	nameFilter := q.Get("name")
	emailFilter := q.Get("email")
	sortBy := q.Get("sort")

	if pageSize <= 0 {
		pageSize = 20
	}
	if page <= 0 {
		page = 1
	}

	users, total := s.store.List(page, pageSize, nameFilter, emailFilter, sortBy)

	// Scale latency with result set size
	scale := 0.2 + 0.8*float64(len(users))/float64(pageSize)
	s.injectLatency(scale)

	json.NewEncoder(w).Encode(map[string]any{
		"data":      users,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r.URL.Path, "/users/")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid id"})
		return
	}

	s.injectLatency(1.0)

	u, ok := s.store.Get(id)
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
		return
	}
	json.NewEncoder(w).Encode(u)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.TrimSpace(req.Email)
	if req.Name == "" || req.Email == "" {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "name and email are required"})
		return
	}

	s.injectLatency(1.0)

	u := s.store.Create(req.Name, req.Email)
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(u)
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r.URL.Path, "/users/")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid id"})
		return
	}

	var req UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON"})
		return
	}

	s.injectLatency(1.0)

	u, ok := s.store.Update(id, req.Name, req.Email)
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
		return
	}
	json.NewEncoder(w).Encode(u)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r.URL.Path, "/users/")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid id"})
		return
	}

	s.injectLatency(1.0)

	if !s.store.Delete(id) {
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
	mux.HandleFunc("/metrics", s.handleMetrics) // no middleware: metrics never inject errors/latency

	mux.HandleFunc("/users", s.middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			s.handleListUsers(w, r)
		case http.MethodPost:
			s.handleCreateUser(w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		}
	}))

	mux.HandleFunc("/users/", s.middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			s.handleGetUser(w, r)
		case http.MethodPut:
			s.handleUpdateUser(w, r)
		case http.MethodDelete:
			s.handleDeleteUser(w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		}
	}))

	return mux
}

// ---- Helpers ---------------------------------------------------------------

func pathID(path, prefix string) (int64, error) {
	seg := strings.TrimPrefix(path, prefix)
	seg = strings.TrimSuffix(seg, "/")
	if seg == "" {
		return 0, fmt.Errorf("missing id")
	}
	return strconv.ParseInt(seg, 10, 64)
}

// ---- Main ------------------------------------------------------------------

func main() {
	cfg := parseConfig()

	rng := rand.New(rand.NewSource(42))
	users := seedUsers(1000, rng)
	store := NewStore(users)
	srv := NewServer(cfg, store)

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

	log.Printf("users app listening on %s (max-conns=%d error-rate=%.1f%% latency=%v-%v)",
		addr, cfg.MaxConns, cfg.ErrorRate*100, cfg.LatencyMin, cfg.LatencyMax)

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
