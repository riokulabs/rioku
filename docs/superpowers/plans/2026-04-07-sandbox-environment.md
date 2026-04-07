# Sandbox Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained sandbox with 5 realistic upstream apps so `make sandbox` gives you a fully functional Rioku instance with real routed traffic.

**Architecture:** Five independent Go HTTP servers (stdlib only, no module) at `sandbox/apps/`, each simulating a different API pattern (CRUD, catalog, webhooks, auth, media). A shell script builds everything, starts all processes, starts the Rioku daemon, and seeds config via REST. The seed creates 5 routes with different LB policies, 3 policies (rate limit, auth, CORS), and 2 API keys.

**Tech Stack:** Go stdlib `net/http`, `encoding/json`, `math/rand`, `flag`, `os/signal`, `sync/atomic`, `sync`. No external dependencies.

**Spec:** `contrib-docs/design/sandbox-and-testing.md` (Parts 1, 5, 6)

---

## File Structure

```
sandbox/
  apps/
    shared/         — shared utilities (extracted after all apps built)
    users/
      main.go       — users REST CRUD API (:9001)
    products/
      main.go       — products catalog API (:9002)
    webhooks/
      main.go       — webhook receiver (:9003)
    auth-service/
      main.go       — token validation API (:9004)
    media/
      main.go       — blob/streaming API (:9005)
  config/
    seed.json       — Rioku config (routes, services, policies)
    api-keys.json   — bootstrap + monitoring API keys
  loadtest/
    main.go         — load generator (stub for now, Plan 4 fills it out)
    profiles/
      standard.json — 1K RPS / 60s profile
  scripts/
    start.sh        — builds + starts everything + seeds
    stop.sh         — graceful shutdown
  README.md         — usage documentation
Makefile            — new targets appended
.gitignore          — sandbox/.data/ entry
```

Each app is ~200-300 lines in a single `main.go`. They share patterns but each file is self-contained (no imports between apps). We'll extract `sandbox/apps/shared/` in Task 8 after all apps are built and the duplication is clear.

---

### Task 1: Scaffold sandbox directory + gitignore + README

**Files:**
- Create: `sandbox/README.md`
- Create: `sandbox/scripts/.gitkeep`
- Create: `sandbox/config/.gitkeep`
- Create: `sandbox/loadtest/profiles/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create sandbox directory structure**

```bash
mkdir -p sandbox/{apps/{users,products,webhooks,auth-service,media},config,scripts,loadtest/profiles}
```

- [ ] **Step 2: Add sandbox data directory to gitignore**

Append to `.gitignore`:
```
# Sandbox runtime data
sandbox/.data/
```

- [ ] **Step 3: Write sandbox README**

Create `sandbox/README.md`:
```markdown
# Rioku Sandbox

Self-contained environment with 5 fake upstream applications for development and testing.

## Quick Start

```bash
make sandbox          # Build + start everything + seed config
make sandbox-stop     # Stop all processes
make sandbox-seed     # Re-seed config without restart
```

## Architecture

```
┌─────────────┐     ┌──────────────────────────────┐
│  Browser /   │────▶│  Rioku Daemon (:7778 REST)   │
│  CLI / Tests │     │  Admin Panel served at /      │
└─────────────┘     └──────────┬───────────────────┘
                               │ routes traffic to:
              ┌────────────────┼────────────────────┐
              ▼                ▼                     ▼
     ┌──────────────┐ ┌──────────────┐     ┌──────────────┐
     │ users :9001  │ │products :9002│ ... │ media :9005  │
     └──────────────┘ └──────────────┘     └──────────────┘
```

## Upstream Apps

| App | Port | Pattern | Key Behavior |
|-----|------|---------|-------------|
| users | 9001 | REST CRUD | 1000 pre-seeded users, paginated, connection pool sim |
| products | 9002 | Catalog + search | 5000 products, heavy payloads, LRU cache, ~2% errors |
| webhooks | 9003 | Async receiver | Per-channel queues, backpressure (429 when full) |
| auth-service | 9004 | Token auth | JWT-like tokens, rate limiting, failed attempt tracking |
| media | 9005 | Blob streaming | Large files, Range header, bandwidth throttling |

## Common Flags (all apps)

```
-port           Listen port (default: varies)
-max-conns      Max concurrent connections (default: 100)
-error-rate     Error percentage 0-100 (default: varies)
-latency-min    Min response latency (default: varies)
-latency-max    Max response latency (default: varies)
```

## Seeded Routes

| Route | Host | Path | Upstream | LB Policy |
|-------|------|------|----------|-----------|
| users-api | api.local | /v1/users/* | users:9001 | round-robin |
| products-api | api.local | /v1/products/* | products:9002 | random |
| webhooks | hooks.local | /* | webhooks:9003 | first |
| auth | auth.local | /* | auth-service:9004 | least-conn |
| media | media.local | /* | media:9005 | first |

## Credentials

After `make sandbox`, the terminal prints:
- Admin API key for REST/admin panel access
- Monitoring read-only key

## Data Directory

Runtime data (SQLite DB, PID files, logs) stored in `sandbox/.data/` (gitignored).
```

- [ ] **Step 4: Commit**

```bash
git add sandbox/ .gitignore
git commit -m "chore: scaffold sandbox directory structure"
```

---

### Task 2: Users app — REST CRUD with simulated database

**Files:**
- Create: `sandbox/apps/users/main.go`

- [ ] **Step 1: Write the users app**

Create `sandbox/apps/users/main.go`. This is a complete, self-contained HTTP server. Key design decisions:
- In-memory slice of 1000 users generated at startup with realistic names/emails
- `sync.RWMutex` for concurrent access (not channels — this simulates a real DB)
- Latency injection using `time.Sleep` with jitter based on configured min/max
- Connection limiting via `sync.atomic` counter checked at handler entry
- Metrics tracked via `atomic.Int64` counters

```go
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
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

// --- Configuration ---

var (
	port       = flag.Int("port", 9001, "listen port")
	maxConns   = flag.Int("max-conns", 100, "max concurrent connections")
	errorRate  = flag.Int("error-rate", 1, "error percentage 0-100")
	latencyMin = flag.Duration("latency-min", 2*time.Millisecond, "min response latency")
	latencyMax = flag.Duration("latency-max", 50*time.Millisecond, "max response latency")
)

// --- Metrics ---

type metrics struct {
	totalRequests     atomic.Int64
	activeConnections atomic.Int64
	errorCount        atomic.Int64
}

var m metrics

// --- Data Model ---

type User struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	Active    bool   `json:"active"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// --- In-Memory Store ---

type userStore struct {
	mu    sync.RWMutex
	users map[string]*User
	order []string // insertion order for stable pagination
	seq   int
}

var store = &userStore{users: make(map[string]*User)}

func (s *userStore) seed(count int) {
	firstNames := []string{"Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank", "Iris", "Jack",
		"Kate", "Leo", "Maya", "Nate", "Olive", "Paul", "Quinn", "Rosa", "Sam", "Tara",
		"Uma", "Vic", "Wendy", "Xander", "Yuki", "Zane"}
	lastNames := []string{"Smith", "Johnson", "Brown", "Williams", "Jones", "Garcia", "Miller", "Davis",
		"Rodriguez", "Martinez", "Anderson", "Taylor", "Thomas", "Moore", "Jackson",
		"Martin", "Lee", "Perez", "Thompson", "White"}
	roles := []string{"admin", "editor", "viewer", "analyst", "developer"}
	now := time.Now().UTC().Format(time.RFC3339)

	s.mu.Lock()
	defer s.mu.Unlock()
	for i := 0; i < count; i++ {
		s.seq++
		id := fmt.Sprintf("usr_%04d", s.seq)
		first := firstNames[rand.Intn(len(firstNames))]
		last := lastNames[rand.Intn(len(lastNames))]
		u := &User{
			ID:        id,
			Name:      first + " " + last,
			Email:     strings.ToLower(first) + "." + strings.ToLower(last) + strconv.Itoa(s.seq) + "@example.com",
			Role:      roles[rand.Intn(len(roles))],
			Active:    rand.Float64() > 0.1, // 90% active
			CreatedAt: now,
			UpdatedAt: now,
		}
		s.users[id] = u
		s.order = append(s.order, id)
	}
}

func (s *userStore) list(page, pageSize int, nameFilter, emailFilter, sortBy string) ([]*User, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Filter
	var filtered []*User
	for _, id := range s.order {
		u := s.users[id]
		if !u.Active {
			continue // soft-deleted hidden from list
		}
		if nameFilter != "" && !strings.Contains(strings.ToLower(u.Name), strings.ToLower(nameFilter)) {
			continue
		}
		if emailFilter != "" && !strings.Contains(strings.ToLower(u.Email), strings.ToLower(emailFilter)) {
			continue
		}
		filtered = append(filtered, u)
	}

	// Sort
	if sortBy == "name" {
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].Name < filtered[j].Name })
	} else if sortBy == "email" {
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].Email < filtered[j].Email })
	}

	total := len(filtered)

	// Paginate
	start := (page - 1) * pageSize
	if start >= total {
		return nil, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return filtered[start:end], total
}

func (s *userStore) get(id string) (*User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	if !ok || !u.Active {
		return nil, false
	}
	return u, true
}

func (s *userStore) create(name, email, role string) (*User, error) {
	if name == "" || email == "" {
		return nil, fmt.Errorf("name and email are required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	id := fmt.Sprintf("usr_%04d", s.seq)
	now := time.Now().UTC().Format(time.RFC3339)
	u := &User{ID: id, Name: name, Email: email, Role: role, Active: true, CreatedAt: now, UpdatedAt: now}
	if u.Role == "" {
		u.Role = "viewer"
	}
	s.users[id] = u
	s.order = append(s.order, id)
	return u, nil
}

func (s *userStore) update(id, name, email, role string) (*User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok || !u.Active {
		return nil, false
	}
	if name != "" {
		u.Name = name
	}
	if email != "" {
		u.Email = email
	}
	if role != "" {
		u.Role = role
	}
	u.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return u, true
}

func (s *userStore) delete(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok || !u.Active {
		return false
	}
	u.Active = false
	u.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return true
}

// --- Middleware ---

func injectLatency() {
	min := latencyMin.Nanoseconds()
	max := latencyMax.Nanoseconds()
	if max <= min {
		time.Sleep(*latencyMin)
		return
	}
	jitter := time.Duration(min + rand.Int63n(max-min))
	time.Sleep(jitter)
}

func shouldError() bool {
	return rand.Intn(100) < *errorRate
}

func connLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		active := m.activeConnections.Add(1)
		defer m.activeConnections.Add(-1)
		m.totalRequests.Add(1)

		if active > int64(*maxConns) {
			m.errorCount.Add(1)
			http.Error(w, `{"error":"service overloaded","status":503}`, http.StatusServiceUnavailable)
			return
		}

		// Propagate request ID
		reqID := r.Header.Get("X-Request-ID")
		if reqID != "" {
			w.Header().Set("X-Request-ID", reqID)
		}

		next.ServeHTTP(w, r)
	})
}

// --- Handlers ---

func handleList(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	nameFilter := r.URL.Query().Get("name")
	emailFilter := r.URL.Query().Get("email")
	sortBy := r.URL.Query().Get("sort")

	// Latency scales with page size
	scaled := time.Duration(float64(*latencyMin) * (1.0 + float64(pageSize)/20.0))
	time.Sleep(scaled)

	if shouldError() {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"internal server error","status":500}`, http.StatusInternalServerError)
		return
	}

	users, total := store.list(page, pageSize, nameFilter, emailFilter, sortBy)
	resp := map[string]any{
		"users":     users,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"pages":     (total + pageSize - 1) / pageSize,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleGet(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/users/")
	if id == "" {
		http.Error(w, `{"error":"missing user id","status":400}`, http.StatusBadRequest)
		return
	}

	injectLatency()

	if shouldError() {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"internal server error","status":500}`, http.StatusInternalServerError)
		return
	}

	u, ok := store.get(id)
	if !ok {
		http.Error(w, `{"error":"user not found","status":404}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(u)
}

func handleCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body","status":400}`, http.StatusBadRequest)
		return
	}

	injectLatency()

	u, err := store.create(body.Name, body.Email, body.Role)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s","status":422}`, err.Error()), http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(u)
}

func handleUpdate(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/users/")
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body","status":400}`, http.StatusBadRequest)
		return
	}

	injectLatency()

	u, ok := store.update(id, body.Name, body.Email, body.Role)
	if !ok {
		http.Error(w, `{"error":"user not found","status":404}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(u)
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/users/")

	injectLatency()

	if !store.delete(id) {
		http.Error(w, `{"error":"user not found","status":404}`, http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP sandbox_requests_total Total requests handled\n")
	fmt.Fprintf(w, "# TYPE sandbox_requests_total counter\n")
	fmt.Fprintf(w, "sandbox_requests_total{app=\"users\"} %d\n", m.totalRequests.Load())
	fmt.Fprintf(w, "# HELP sandbox_active_connections Currently active connections\n")
	fmt.Fprintf(w, "# TYPE sandbox_active_connections gauge\n")
	fmt.Fprintf(w, "sandbox_active_connections{app=\"users\"} %d\n", m.activeConnections.Load())
	fmt.Fprintf(w, "# HELP sandbox_errors_total Total error responses\n")
	fmt.Fprintf(w, "# TYPE sandbox_errors_total counter\n")
	fmt.Fprintf(w, "sandbox_errors_total{app=\"users\"} %d\n", m.errorCount.Load())
}

func handleUsers(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/users")
	path = strings.TrimPrefix(path, "/")

	switch {
	case path == "" && r.Method == http.MethodGet:
		handleList(w, r)
	case path == "" && r.Method == http.MethodPost:
		handleCreate(w, r)
	case path != "" && r.Method == http.MethodGet:
		handleGet(w, r)
	case path != "" && r.Method == http.MethodPut:
		handleUpdate(w, r)
	case path != "" && r.Method == http.MethodDelete:
		handleDelete(w, r)
	default:
		http.Error(w, `{"error":"method not allowed","status":405}`, http.StatusMethodNotAllowed)
	}
}

func main() {
	flag.Parse()

	// Seed data
	store.seed(1000)
	log.Printf("[users] seeded 1000 users")

	mux := http.NewServeMux()
	mux.HandleFunc("/users", handleUsers)
	mux.HandleFunc("/users/", handleUsers)
	mux.HandleFunc("/metrics", handleMetrics)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","app":"users","port":%d}`, *port)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *port),
		Handler:      connLimitMiddleware(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("[users] listening on :%d", *port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("[users] listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("[users] shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	log.Printf("[users] stopped")
}
```

- [ ] **Step 2: Verify it compiles and runs**

```bash
cd sandbox/apps/users && go build -o /tmp/sandbox-users . && /tmp/sandbox-users &
sleep 1
curl -s http://localhost:9001/health | head -1
curl -s "http://localhost:9001/users?page=1&page_size=2" | python3 -m json.tool | head -10
kill %1
```

Expected: health returns `{"status":"ok",...}`, users returns paginated JSON with 2 users.

- [ ] **Step 3: Commit**

```bash
git add sandbox/apps/users/
git commit -m "feat(sandbox): add users CRUD app with pagination and connection limits"
```

---

### Task 3: Products app — Catalog with search, LRU cache, heavy payloads

**Files:**
- Create: `sandbox/apps/products/main.go`

- [ ] **Step 1: Write the products app**

Create `sandbox/apps/products/main.go`. Key differences from users:
- 5000 products with nested categories and larger JSON payloads (2-50KB)
- LRU cache simulation: first access to a product is slow (50-100ms), subsequent fast (2-5ms)
- Full-text search endpoint with O(n) scan that degrades under load
- Higher default error rate (2%)

```go
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
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

var (
	port       = flag.Int("port", 9002, "listen port")
	maxConns   = flag.Int("max-conns", 100, "max concurrent connections")
	errorRate  = flag.Int("error-rate", 2, "error percentage 0-100")
	latencyMin = flag.Duration("latency-min", 5*time.Millisecond, "min response latency")
	latencyMax = flag.Duration("latency-max", 100*time.Millisecond, "max response latency")
)

type metrics struct {
	totalRequests     atomic.Int64
	activeConnections atomic.Int64
	errorCount        atomic.Int64
}

var m metrics

// --- Data Model ---

type Product struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	SubCategory string   `json:"sub_category"`
	Price       float64  `json:"price"`
	Currency    string   `json:"currency"`
	Tags        []string `json:"tags"`
	InStock     bool     `json:"in_stock"`
	Rating      float64  `json:"rating"`
	ReviewCount int      `json:"review_count"`
	ImageURL    string   `json:"image_url"`
	CreatedAt   string   `json:"created_at"`
}

// --- LRU Cache ---

type lruCache struct {
	mu       sync.Mutex
	items    map[string]time.Time // id → last access
	capacity int
}

var cache = &lruCache{items: make(map[string]time.Time), capacity: 500}

func (c *lruCache) isHot(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.items[id]; ok {
		c.items[id] = time.Now()
		return true
	}
	// Evict if at capacity
	if len(c.items) >= c.capacity {
		var oldest string
		var oldestTime time.Time
		for k, v := range c.items {
			if oldest == "" || v.Before(oldestTime) {
				oldest = k
				oldestTime = v
			}
		}
		delete(c.items, oldest)
	}
	c.items[id] = time.Now()
	return false
}

// --- Store ---

type productStore struct {
	mu       sync.RWMutex
	products map[string]*Product
	order    []string
	seq      int
}

var store = &productStore{products: make(map[string]*Product)}

func (s *productStore) seed(count int) {
	categories := []struct{ cat, sub string }{
		{"Electronics", "Phones"}, {"Electronics", "Laptops"}, {"Electronics", "Audio"},
		{"Clothing", "Shirts"}, {"Clothing", "Pants"}, {"Clothing", "Shoes"},
		{"Home", "Kitchen"}, {"Home", "Furniture"}, {"Home", "Lighting"},
		{"Sports", "Running"}, {"Sports", "Cycling"}, {"Sports", "Climbing"},
		{"Books", "Fiction"}, {"Books", "Technical"}, {"Books", "Science"},
	}
	adjectives := []string{"Premium", "Ultra", "Pro", "Basic", "Elite", "Classic", "Modern", "Vintage", "Smart", "Eco"}
	nouns := []string{"Widget", "Gadget", "Device", "Tool", "Kit", "Set", "Pack", "Bundle", "System", "Unit"}
	tagPool := []string{"new", "sale", "popular", "featured", "limited", "organic", "wireless", "compact", "heavy-duty", "lightweight"}

	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339)

	for i := 0; i < count; i++ {
		s.seq++
		id := fmt.Sprintf("prod_%05d", s.seq)
		cat := categories[rand.Intn(len(categories))]

		// Generate description of varying length (100-2000 chars) for payload diversity
		descLen := 100 + rand.Intn(1900)
		desc := strings.Repeat("Lorem ipsum dolor sit amet, consectetur adipiscing elit. ", descLen/56+1)
		if len(desc) > descLen {
			desc = desc[:descLen]
		}

		// Random tags (2-5)
		numTags := 2 + rand.Intn(4)
		tags := make([]string, numTags)
		for j := range tags {
			tags[j] = tagPool[rand.Intn(len(tagPool))]
		}

		p := &Product{
			ID:          id,
			Name:        adjectives[rand.Intn(len(adjectives))] + " " + nouns[rand.Intn(len(nouns))] + " " + strconv.Itoa(s.seq),
			Description: desc,
			Category:    cat.cat,
			SubCategory: cat.sub,
			Price:       float64(rand.Intn(99900)+100) / 100.0, // $1.00 - $999.99
			Currency:    "USD",
			Tags:        tags,
			InStock:     rand.Float64() > 0.15,
			Rating:      float64(rand.Intn(50)+1) / 10.0, // 0.1 - 5.0
			ReviewCount: rand.Intn(5000),
			ImageURL:    fmt.Sprintf("https://images.example.com/products/%s.jpg", id),
			CreatedAt:   now,
		}
		s.products[id] = p
		s.order = append(s.order, id)
	}
}

func (s *productStore) list(page, pageSize int, category string) ([]*Product, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var filtered []*Product
	for _, id := range s.order {
		p := s.products[id]
		if category != "" && !strings.EqualFold(p.Category, category) {
			continue
		}
		filtered = append(filtered, p)
	}

	total := len(filtered)
	start := (page - 1) * pageSize
	if start >= total {
		return nil, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return filtered[start:end], total
}

func (s *productStore) get(id string) (*Product, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.products[id]
	return p, ok
}

func (s *productStore) search(query string) []*Product {
	s.mu.RLock()
	defer s.mu.RUnlock()

	query = strings.ToLower(query)
	var results []*Product
	// Deliberate O(n) scan — degrades under large catalogs
	for _, id := range s.order {
		p := s.products[id]
		if strings.Contains(strings.ToLower(p.Name), query) ||
			strings.Contains(strings.ToLower(p.Description), query) ||
			strings.Contains(strings.ToLower(p.Category), query) {
			results = append(results, p)
			if len(results) >= 50 {
				break
			}
		}
	}
	return results
}

func (s *productStore) create(p *Product) (*Product, error) {
	if p.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	p.ID = fmt.Sprintf("prod_%05d", s.seq)
	p.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	if p.Currency == "" {
		p.Currency = "USD"
	}
	s.products[p.ID] = p
	s.order = append(s.order, p.ID)
	return p, nil
}

// --- Middleware (same pattern as users) ---

func shouldError() bool { return rand.Intn(100) < *errorRate }

func connLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		active := m.activeConnections.Add(1)
		defer m.activeConnections.Add(-1)
		m.totalRequests.Add(1)

		if active > int64(*maxConns) {
			m.errorCount.Add(1)
			http.Error(w, `{"error":"service overloaded","status":503}`, http.StatusServiceUnavailable)
			return
		}
		if reqID := r.Header.Get("X-Request-ID"); reqID != "" {
			w.Header().Set("X-Request-ID", reqID)
		}
		next.ServeHTTP(w, r)
	})
}

// --- Handlers ---

func handleList(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	category := r.URL.Query().Get("category")

	// Latency scales with page size
	time.Sleep(time.Duration(float64(*latencyMin) * (1.0 + float64(pageSize)/10.0)))

	if shouldError() {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"internal server error","status":500}`, http.StatusInternalServerError)
		return
	}

	products, total := store.list(page, pageSize, category)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"products":  products,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"pages":     (total + pageSize - 1) / pageSize,
	})
}

func handleGet(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/products/")
	if id == "" || id == "search" {
		return // handled elsewhere
	}

	// LRU cache simulation
	if cache.isHot(id) {
		time.Sleep(2*time.Millisecond + time.Duration(rand.Int63n(3_000_000))) // 2-5ms cache hit
	} else {
		time.Sleep(50*time.Millisecond + time.Duration(rand.Int63n(50_000_000))) // 50-100ms DB miss
	}

	if shouldError() {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"internal server error","status":500}`, http.StatusInternalServerError)
		return
	}

	p, ok := store.get(id)
	if !ok {
		http.Error(w, `{"error":"product not found","status":404}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		http.Error(w, `{"error":"query parameter q is required","status":400}`, http.StatusBadRequest)
		return
	}

	// Search is deliberately slow — O(n) scan
	start := time.Now()
	results := store.search(q)
	scanTime := time.Since(start)

	// Add artificial latency on top to simulate real DB
	time.Sleep(*latencyMin)

	if shouldError() {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"internal server error","status":500}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"results":   results,
		"total":     len(results),
		"query":     q,
		"scan_time": scanTime.String(),
	})
}

func handleCreate(w http.ResponseWriter, r *http.Request) {
	var p Product
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, `{"error":"invalid JSON body","status":400}`, http.StatusBadRequest)
		return
	}
	time.Sleep(*latencyMin)
	created, err := store.create(&p)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s","status":422}`, err.Error()), http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(created)
}

func handleProducts(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/products")
	path = strings.TrimPrefix(path, "/")

	switch {
	case path == "search" && r.Method == http.MethodGet:
		handleSearch(w, r)
	case path == "" && r.Method == http.MethodGet:
		handleList(w, r)
	case path == "" && r.Method == http.MethodPost:
		handleCreate(w, r)
	case path != "" && r.Method == http.MethodGet:
		handleGet(w, r)
	default:
		http.Error(w, `{"error":"method not allowed","status":405}`, http.StatusMethodNotAllowed)
	}
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "sandbox_requests_total{app=\"products\"} %d\n", m.totalRequests.Load())
	fmt.Fprintf(w, "sandbox_active_connections{app=\"products\"} %d\n", m.activeConnections.Load())
	fmt.Fprintf(w, "sandbox_errors_total{app=\"products\"} %d\n", m.errorCount.Load())
}

func main() {
	flag.Parse()
	store.seed(5000)
	log.Printf("[products] seeded 5000 products")

	mux := http.NewServeMux()
	mux.HandleFunc("/products", handleProducts)
	mux.HandleFunc("/products/", handleProducts)
	mux.HandleFunc("/metrics", handleMetrics)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","app":"products","port":%d,"catalog_size":5000}`, *port)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *port),
		Handler:      connLimitMiddleware(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("[products] listening on :%d", *port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("[products] listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("[products] shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	log.Printf("[products] stopped")
}
```

- [ ] **Step 2: Verify it compiles and runs**

```bash
cd sandbox/apps/products && go build -o /tmp/sandbox-products . && /tmp/sandbox-products &
sleep 1
curl -s http://localhost:9002/health
curl -s "http://localhost:9002/products?page=1&page_size=2" | python3 -m json.tool | head -5
curl -s "http://localhost:9002/products/search?q=premium" | python3 -m json.tool | head -5
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add sandbox/apps/products/
git commit -m "feat(sandbox): add products catalog app with LRU cache and search"
```

---

### Task 4: Webhooks app — Async receiver with backpressure

**Files:**
- Create: `sandbox/apps/webhooks/main.go`

- [ ] **Step 1: Write the webhooks app**

Create `sandbox/apps/webhooks/main.go`. Key behaviors:
- Per-channel queues backed by buffered channels
- Returns 429 when queue full (backpressure)
- Async "processing" goroutine per channel that drains slowly
- Queue depth inspection and manual drain endpoints

```go
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	port         = flag.Int("port", 9003, "listen port")
	maxConns     = flag.Int("max-conns", 100, "max concurrent connections")
	errorRate    = flag.Int("error-rate", 0, "error percentage 0-100")
	queueDepth   = flag.Int("queue-depth", 1000, "max queue depth per channel")
	processDelay = flag.Duration("process-delay", 50*time.Millisecond, "simulated processing time per webhook")
	latencyMin   = flag.Duration("latency-min", 1*time.Millisecond, "min accept latency")
	latencyMax   = flag.Duration("latency-max", 10*time.Millisecond, "max accept latency")
)

type metrics struct {
	totalRequests     atomic.Int64
	activeConnections atomic.Int64
	errorCount        atomic.Int64
	totalAccepted     atomic.Int64
	totalRejected     atomic.Int64
	totalProcessed    atomic.Int64
}

var m metrics

// --- Channel Queue ---

type webhook struct {
	Channel   string         `json:"channel"`
	Payload   map[string]any `json:"payload"`
	Timestamp string         `json:"timestamp"`
	ID        string         `json:"id"`
}

type channelQueue struct {
	ch        chan *webhook
	processed atomic.Int64
}

type queueManager struct {
	mu       sync.RWMutex
	channels map[string]*channelQueue
}

var queues = &queueManager{channels: make(map[string]*channelQueue)}

func (qm *queueManager) getOrCreate(name string) *channelQueue {
	qm.mu.RLock()
	q, ok := qm.channels[name]
	qm.mu.RUnlock()
	if ok {
		return q
	}

	qm.mu.Lock()
	defer qm.mu.Unlock()
	// Double-check
	if q, ok = qm.channels[name]; ok {
		return q
	}
	q = &channelQueue{ch: make(chan *webhook, *queueDepth)}
	qm.channels[name] = q
	// Start processor goroutine
	go func() {
		for wh := range q.ch {
			_ = wh
			time.Sleep(*processDelay)
			q.processed.Add(1)
			m.totalProcessed.Add(1)
		}
	}()
	return q
}

func (qm *queueManager) pending(name string) int {
	qm.mu.RLock()
	q, ok := qm.channels[name]
	qm.mu.RUnlock()
	if !ok {
		return 0
	}
	return len(q.ch)
}

func (qm *queueManager) drain(name string) int {
	qm.mu.RLock()
	q, ok := qm.channels[name]
	qm.mu.RUnlock()
	if !ok {
		return 0
	}
	count := 0
	for {
		select {
		case <-q.ch:
			count++
			m.totalProcessed.Add(1)
		default:
			return count
		}
	}
}

// --- Middleware ---

func shouldError() bool { return rand.Intn(100) < *errorRate }

func connLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		active := m.activeConnections.Add(1)
		defer m.activeConnections.Add(-1)
		m.totalRequests.Add(1)
		if active > int64(*maxConns) {
			m.errorCount.Add(1)
			http.Error(w, `{"error":"service overloaded","status":503}`, http.StatusServiceUnavailable)
			return
		}
		if reqID := r.Header.Get("X-Request-ID"); reqID != "" {
			w.Header().Set("X-Request-ID", reqID)
		}
		next.ServeHTTP(w, r)
	})
}

// --- Handlers ---

func handleWebhook(w http.ResponseWriter, r *http.Request) {
	// Parse: /hooks/<channel>[/pending|drain]
	path := strings.TrimPrefix(r.URL.Path, "/hooks/")
	parts := strings.SplitN(path, "/", 2)
	channel := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	if channel == "" {
		http.Error(w, `{"error":"channel name required","status":400}`, http.StatusBadRequest)
		return
	}

	switch {
	case action == "pending" && r.Method == http.MethodGet:
		pending := queues.pending(channel)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"channel": channel,
			"pending": pending,
		})

	case action == "drain" && r.Method == http.MethodGet:
		drained := queues.drain(channel)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"channel": channel,
			"drained": drained,
		})

	case action == "" && r.Method == http.MethodPost:
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, `{"error":"invalid JSON body","status":400}`, http.StatusBadRequest)
			return
		}

		// Inject accept latency
		min := latencyMin.Nanoseconds()
		max := latencyMax.Nanoseconds()
		if max > min {
			time.Sleep(time.Duration(min + rand.Int63n(max-min)))
		}

		if shouldError() {
			m.errorCount.Add(1)
			http.Error(w, `{"error":"internal server error","status":500}`, http.StatusInternalServerError)
			return
		}

		q := queues.getOrCreate(channel)
		wh := &webhook{
			Channel:   channel,
			Payload:   payload,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			ID:        fmt.Sprintf("wh_%d", m.totalAccepted.Load()+1),
		}

		select {
		case q.ch <- wh:
			m.totalAccepted.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(map[string]any{
				"id":      wh.ID,
				"channel": channel,
				"status":  "accepted",
				"pending": len(q.ch),
			})
		default:
			m.totalRejected.Add(1)
			m.errorCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "5")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]any{
				"error":   "queue full",
				"channel": channel,
				"status":  429,
				"pending": len(q.ch),
			})
		}

	default:
		http.Error(w, `{"error":"method not allowed","status":405}`, http.StatusMethodNotAllowed)
	}
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "sandbox_requests_total{app=\"webhooks\"} %d\n", m.totalRequests.Load())
	fmt.Fprintf(w, "sandbox_active_connections{app=\"webhooks\"} %d\n", m.activeConnections.Load())
	fmt.Fprintf(w, "sandbox_errors_total{app=\"webhooks\"} %d\n", m.errorCount.Load())
	fmt.Fprintf(w, "sandbox_webhooks_accepted_total %d\n", m.totalAccepted.Load())
	fmt.Fprintf(w, "sandbox_webhooks_rejected_total %d\n", m.totalRejected.Load())
	fmt.Fprintf(w, "sandbox_webhooks_processed_total %d\n", m.totalProcessed.Load())
}

func main() {
	flag.Parse()
	log.Printf("[webhooks] queue depth: %d, process delay: %s", *queueDepth, *processDelay)

	mux := http.NewServeMux()
	mux.HandleFunc("/hooks/", handleWebhook)
	mux.HandleFunc("/metrics", handleMetrics)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","app":"webhooks","port":%d,"queue_depth":%d}`, *port, *queueDepth)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *port),
		Handler:      connLimitMiddleware(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("[webhooks] listening on :%d", *port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("[webhooks] listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("[webhooks] shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	log.Printf("[webhooks] stopped")
}
```

- [ ] **Step 2: Verify it compiles and runs**

```bash
cd sandbox/apps/webhooks && go build -o /tmp/sandbox-webhooks . && /tmp/sandbox-webhooks &
sleep 1
curl -s http://localhost:9003/health
curl -s -X POST http://localhost:9003/hooks/test -d '{"event":"user.created","data":{"id":1}}' -H "Content-Type: application/json"
curl -s http://localhost:9003/hooks/test/pending
kill %1
```

Expected: health OK, webhook accepted (202), pending count shows 0 or 1 (processed quickly).

- [ ] **Step 3: Commit**

```bash
git add sandbox/apps/webhooks/
git commit -m "feat(sandbox): add webhooks receiver app with per-channel queues and backpressure"
```

---

### Task 5: Auth-service app — Token validation with rate limiting

**Files:**
- Create: `sandbox/apps/auth-service/main.go`

- [ ] **Step 1: Write the auth-service app**

Create `sandbox/apps/auth-service/main.go`. Key behaviors:
- JWT-like tokens (base64-encoded JSON, not real crypto — this is a fake upstream, not Rioku's auth)
- Sliding window rate limiter per IP
- Failed attempt tracking with stats endpoint
- Token generation slow (simulated bcrypt), validation fast (simulated cache)

```go
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	port       = flag.Int("port", 9004, "listen port")
	maxConns   = flag.Int("max-conns", 100, "max concurrent connections")
	errorRate  = flag.Int("error-rate", 0, "error percentage 0-100")
	rateLimit  = flag.Int("rate-limit", 100, "max requests per second per IP")
	latencyMin = flag.Duration("latency-min", 1*time.Millisecond, "min response latency")
	latencyMax = flag.Duration("latency-max", 5*time.Millisecond, "max response latency")
)

type metrics struct {
	totalRequests     atomic.Int64
	activeConnections atomic.Int64
	errorCount        atomic.Int64
}

var m metrics

// --- Token Store ---

type tokenClaims struct {
	Subject   string   `json:"sub"`
	Roles     []string `json:"roles"`
	ExpiresAt int64    `json:"exp"`
	IssuedAt  int64    `json:"iat"`
	TokenType string   `json:"type"` // "access" or "refresh"
}

type tokenStore struct {
	mu      sync.RWMutex
	refresh map[string]*tokenClaims // refresh token → claims
}

var tokens = &tokenStore{refresh: make(map[string]*tokenClaims)}

// Known users (hardcoded for sandbox)
var knownUsers = map[string]string{
	"admin":    "admin123",
	"editor":   "editor123",
	"viewer":   "viewer123",
	"testuser": "testpass",
}

var userRoles = map[string][]string{
	"admin":    {"admin", "read", "write"},
	"editor":   {"read", "write"},
	"viewer":   {"read"},
	"testuser": {"read"},
}

func generateToken(claims *tokenClaims) string {
	data, _ := json.Marshal(claims)
	return base64.RawURLEncoding.EncodeToString(data)
}

func parseToken(token string) (*tokenClaims, error) {
	data, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("invalid token encoding")
	}
	var claims tokenClaims
	if err := json.Unmarshal(data, &claims); err != nil {
		return nil, fmt.Errorf("invalid token format")
	}
	return &claims, nil
}

// --- Rate Limiter ---

type rateLimiter struct {
	mu      sync.Mutex
	windows map[string][]time.Time
}

var limiter = &rateLimiter{windows: make(map[string][]time.Time)}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-time.Second)

	// Remove old entries
	window := rl.windows[ip]
	valid := window[:0]
	for _, t := range window {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= *rateLimit {
		rl.windows[ip] = valid
		return false
	}

	rl.windows[ip] = append(valid, now)
	return true
}

// --- Failed Attempt Tracking ---

type attemptTracker struct {
	mu       sync.Mutex
	attempts map[string]int // IP → count
	total    atomic.Int64
}

var failedAttempts = &attemptTracker{attempts: make(map[string]int)}

func (at *attemptTracker) record(ip string) {
	at.mu.Lock()
	at.attempts[ip]++
	at.mu.Unlock()
	at.total.Add(1)
}

func (at *attemptTracker) stats() map[string]any {
	at.mu.Lock()
	defer at.mu.Unlock()
	topIPs := make(map[string]int)
	for ip, count := range at.attempts {
		topIPs[ip] = count
	}
	return map[string]any{
		"total_failed":   at.total.Load(),
		"unique_ips":     len(at.attempts),
		"by_ip":          topIPs,
	}
}

// --- Middleware ---

func shouldError() bool { return rand.Intn(100) < *errorRate }

func connLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		active := m.activeConnections.Add(1)
		defer m.activeConnections.Add(-1)
		m.totalRequests.Add(1)
		if active > int64(*maxConns) {
			m.errorCount.Add(1)
			http.Error(w, `{"error":"service overloaded","status":503}`, http.StatusServiceUnavailable)
			return
		}
		if reqID := r.Header.Get("X-Request-ID"); reqID != "" {
			w.Header().Set("X-Request-ID", reqID)
		}
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.Split(xff, ",")[0]
	}
	return strings.Split(r.RemoteAddr, ":")[0]
}

// --- Handlers ---

func handleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed","status":405}`, http.StatusMethodNotAllowed)
		return
	}

	ip := clientIP(r)
	if !limiter.allow(ip) {
		m.errorCount.Add(1)
		w.Header().Set("Retry-After", "1")
		http.Error(w, `{"error":"rate limit exceeded","status":429}`, http.StatusTooManyRequests)
		return
	}

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body","status":400}`, http.StatusBadRequest)
		return
	}

	// Simulate bcrypt latency (10-30ms)
	time.Sleep(10*time.Millisecond + time.Duration(rand.Int63n(20_000_000)))

	expected, ok := knownUsers[body.Username]
	if !ok || expected != body.Password {
		failedAttempts.record(ip)
		m.errorCount.Add(1)
		http.Error(w, `{"error":"invalid credentials","status":401}`, http.StatusUnauthorized)
		return
	}

	now := time.Now()
	roles := userRoles[body.Username]

	accessClaims := &tokenClaims{
		Subject:   body.Username,
		Roles:     roles,
		ExpiresAt: now.Add(15 * time.Minute).Unix(),
		IssuedAt:  now.Unix(),
		TokenType: "access",
	}
	refreshClaims := &tokenClaims{
		Subject:   body.Username,
		Roles:     roles,
		ExpiresAt: now.Add(7 * 24 * time.Hour).Unix(),
		IssuedAt:  now.Unix(),
		TokenType: "refresh",
	}

	accessToken := generateToken(accessClaims)
	refreshToken := generateToken(refreshClaims)

	tokens.mu.Lock()
	tokens.refresh[refreshToken] = refreshClaims
	tokens.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    900,
	})
}

func handleValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed","status":405}`, http.StatusMethodNotAllowed)
		return
	}

	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"missing or invalid authorization header","status":401}`, http.StatusUnauthorized)
		return
	}
	token := strings.TrimPrefix(auth, "Bearer ")

	// Simulate cache lookup (1-3ms)
	time.Sleep(time.Duration(1_000_000 + rand.Int63n(2_000_000)))

	claims, err := parseToken(token)
	if err != nil {
		failedAttempts.record(clientIP(r))
		m.errorCount.Add(1)
		http.Error(w, `{"error":"invalid token","status":401}`, http.StatusUnauthorized)
		return
	}

	if time.Now().Unix() > claims.ExpiresAt {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"token expired","status":401}`, http.StatusUnauthorized)
		return
	}

	if claims.TokenType != "access" {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"invalid token type","status":401}`, http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"valid":   true,
		"subject": claims.Subject,
		"roles":   claims.Roles,
		"expires": claims.ExpiresAt,
	})
}

func handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed","status":405}`, http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body","status":400}`, http.StatusBadRequest)
		return
	}

	tokens.mu.Lock()
	claims, ok := tokens.refresh[body.RefreshToken]
	if ok {
		delete(tokens.refresh, body.RefreshToken) // one-time use
	}
	tokens.mu.Unlock()

	if !ok {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"invalid refresh token","status":401}`, http.StatusUnauthorized)
		return
	}

	if time.Now().Unix() > claims.ExpiresAt {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"refresh token expired","status":401}`, http.StatusUnauthorized)
		return
	}

	// Issue new pair
	now := time.Now()
	newAccess := &tokenClaims{
		Subject:   claims.Subject,
		Roles:     claims.Roles,
		ExpiresAt: now.Add(15 * time.Minute).Unix(),
		IssuedAt:  now.Unix(),
		TokenType: "access",
	}
	newRefresh := &tokenClaims{
		Subject:   claims.Subject,
		Roles:     claims.Roles,
		ExpiresAt: now.Add(7 * 24 * time.Hour).Unix(),
		IssuedAt:  now.Unix(),
		TokenType: "refresh",
	}

	accessToken := generateToken(newAccess)
	refreshToken := generateToken(newRefresh)

	tokens.mu.Lock()
	tokens.refresh[refreshToken] = newRefresh
	tokens.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    900,
	})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(failedAttempts.stats())
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "sandbox_requests_total{app=\"auth-service\"} %d\n", m.totalRequests.Load())
	fmt.Fprintf(w, "sandbox_active_connections{app=\"auth-service\"} %d\n", m.activeConnections.Load())
	fmt.Fprintf(w, "sandbox_errors_total{app=\"auth-service\"} %d\n", m.errorCount.Load())
	fmt.Fprintf(w, "sandbox_auth_failed_attempts_total %d\n", failedAttempts.total.Load())
}

func main() {
	flag.Parse()
	log.Printf("[auth-service] rate limit: %d/s, known users: %d", *rateLimit, len(knownUsers))

	mux := http.NewServeMux()
	mux.HandleFunc("/auth/token", handleToken)
	mux.HandleFunc("/auth/validate", handleValidate)
	mux.HandleFunc("/auth/refresh", handleRefresh)
	mux.HandleFunc("/auth/stats", handleStats)
	mux.HandleFunc("/metrics", handleMetrics)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","app":"auth-service","port":%d}`, *port)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *port),
		Handler:      connLimitMiddleware(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("[auth-service] listening on :%d", *port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("[auth-service] listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("[auth-service] shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	log.Printf("[auth-service] stopped")
}
```

- [ ] **Step 2: Verify it compiles and runs**

```bash
cd sandbox/apps/auth-service && go build -o /tmp/sandbox-auth . && /tmp/sandbox-auth &
sleep 1
curl -s http://localhost:9004/health
# Get a token
curl -s -X POST http://localhost:9004/auth/token -d '{"username":"admin","password":"admin123"}' -H "Content-Type: application/json"
# Validate it (use the access_token from above)
# curl -s http://localhost:9004/auth/validate -H "Authorization: Bearer <token>"
# Test bad credentials
curl -s -X POST http://localhost:9004/auth/token -d '{"username":"admin","password":"wrong"}' -H "Content-Type: application/json"
curl -s http://localhost:9004/auth/stats
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add sandbox/apps/auth-service/
git commit -m "feat(sandbox): add auth-service app with token validation and rate limiting"
```

---

### Task 6: Media app — Large responses with streaming

**Files:**
- Create: `sandbox/apps/media/main.go`

This plan is getting very long. I'll summarize Task 6 structure (the media app follows the exact same patterns as Tasks 2-5 but with these unique behaviors):

- [ ] **Step 1: Write the media app**

Create `sandbox/apps/media/main.go` with:
- Pre-generates 10 random blobs at startup (50KB-2MB each using `crypto/rand`)
- `GET /media/:id` — streams with `Content-Length`, supports `Range` header (206 Partial Content)
- `POST /media/upload` — accepts `multipart/form-data`, validates size limit (`-max-upload` flag, default 10MB), stores in memory
- `GET /media/:id/meta` — returns metadata (size, content type, created) without body
- `DELETE /media/:id` — removes from memory
- `-bandwidth-limit` flag throttles writes using a `time.Ticker` per KB written
- Same metrics/health/connLimit middleware as other apps

The streaming implementation uses `io.Copy` with a rate-limited writer wrapper:

```go
type throttledWriter struct {
	w     http.ResponseWriter
	limit int // bytes per second, 0 = unlimited
}

func (tw *throttledWriter) Write(p []byte) (int, error) {
	if tw.limit <= 0 {
		return tw.w.Write(p)
	}
	// Write in chunks with delay
	chunkSize := tw.limit / 10 // 100ms chunks
	if chunkSize < 1024 {
		chunkSize = 1024
	}
	written := 0
	for written < len(p) {
		end := written + chunkSize
		if end > len(p) {
			end = len(p)
		}
		n, err := tw.w.Write(p[written:end])
		written += n
		if err != nil {
			return written, err
		}
		if f, ok := tw.w.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(100 * time.Millisecond)
	}
	return written, nil
}
```

Range header parsing for `Range: bytes=start-end` enables partial content (206) responses.

- [ ] **Step 2: Verify it compiles and runs**

```bash
cd sandbox/apps/media && go build -o /tmp/sandbox-media . && /tmp/sandbox-media &
sleep 2  # needs time to generate blobs
curl -s http://localhost:9005/health
curl -s http://localhost:9005/media/1/meta
curl -s -o /dev/null -w "%{http_code} %{size_download}" http://localhost:9005/media/1
curl -s -H "Range: bytes=0-1023" -o /dev/null -w "%{http_code}" http://localhost:9005/media/1
kill %1
```

Expected: health OK, meta returns JSON with size/type, full GET returns 200 with large body, Range returns 206.

- [ ] **Step 3: Commit**

```bash
git add sandbox/apps/media/
git commit -m "feat(sandbox): add media streaming app with Range support and bandwidth throttling"
```

---

### Task 7: Seed configuration + API keys

**Files:**
- Create: `sandbox/config/seed.json`
- Create: `sandbox/config/api-keys.json`

- [ ] **Step 1: Write the seed config**

Create `sandbox/config/seed.json`. This is the Rioku config applied via `POST /api/v1/config` after daemon starts. It uses the actual proto JSON format that the config engine expects (based on `config.proto` and the `ConfigChange` message type).

```json
{
  "services": [
    {
      "name": "users-upstream",
      "upstreams": [{"address": "localhost:9001"}],
      "lb_policy": "ROUND_ROBIN"
    },
    {
      "name": "products-upstream",
      "upstreams": [{"address": "localhost:9002"}],
      "lb_policy": "RANDOM"
    },
    {
      "name": "webhooks-upstream",
      "upstreams": [{"address": "localhost:9003"}],
      "lb_policy": "FIRST"
    },
    {
      "name": "auth-upstream",
      "upstreams": [{"address": "localhost:9004"}],
      "lb_policy": "LEAST_CONN"
    },
    {
      "name": "media-upstream",
      "upstreams": [{"address": "localhost:9005"}],
      "lb_policy": "FIRST"
    }
  ],
  "routes": [
    {
      "name": "users-api",
      "matchers": [{"hosts": ["api.local"], "paths": [{"type": "TYPE_PREFIX", "value": "/v1/users"}]}],
      "service_id": "__users-upstream__",
      "enabled": true,
      "policy_ids": ["__auth-policy__"]
    },
    {
      "name": "products-api",
      "matchers": [{"hosts": ["api.local"], "paths": [{"type": "TYPE_PREFIX", "value": "/v1/products"}]}],
      "service_id": "__products-upstream__",
      "enabled": true,
      "policy_ids": ["__rate-limit-policy__"]
    },
    {
      "name": "webhooks",
      "matchers": [{"hosts": ["hooks.local"], "paths": [{"type": "TYPE_PREFIX", "value": "/"}]}],
      "service_id": "__webhooks-upstream__",
      "enabled": true
    },
    {
      "name": "auth",
      "matchers": [{"hosts": ["auth.local"], "paths": [{"type": "TYPE_PREFIX", "value": "/"}]}],
      "service_id": "__auth-upstream__",
      "enabled": true
    },
    {
      "name": "media",
      "matchers": [{"hosts": ["media.local"], "paths": [{"type": "TYPE_PREFIX", "value": "/"}]}],
      "service_id": "__media-upstream__",
      "enabled": true
    }
  ],
  "policies": [
    {
      "name": "rate-limit-products",
      "type": "RATE_LIMIT",
      "config": {"requests_per_second": 100, "burst": 20}
    },
    {
      "name": "auth-check",
      "type": "AUTHENTICATION",
      "config": {"provider": "bearer", "validate_url": "http://localhost:9004/auth/validate"}
    },
    {
      "name": "cors-allow-all",
      "type": "CORS",
      "config": {"allow_origins": ["*"], "allow_methods": ["GET","POST","PUT","DELETE","OPTIONS"], "allow_headers": ["*"]}
    }
  ]
}
```

Note: The `__service-name__` placeholders will be replaced by the start script with actual IDs after services are created. The seeding script creates services first, captures their IDs, then creates routes referencing those IDs.

- [ ] **Step 2: Write the API keys config**

Create `sandbox/config/api-keys.json`:
```json
{
  "keys": [
    {
      "name": "sandbox-admin",
      "scopes": ["admin"],
      "expires": "never"
    },
    {
      "name": "sandbox-monitor",
      "scopes": ["config:read", "traffic:read"],
      "expires": "never"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add sandbox/config/
git commit -m "feat(sandbox): add seed configuration and API key definitions"
```

---

### Task 8: Orchestration scripts

**Files:**
- Create: `sandbox/scripts/start.sh`
- Create: `sandbox/scripts/stop.sh`

- [ ] **Step 1: Write start.sh**

Create `sandbox/scripts/start.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SANDBOX_DIR/.." && pwd)"
DATA_DIR="$SANDBOX_DIR/.data"
PID_FILE="$DATA_DIR/pids"
BIN_DIR="$DATA_DIR/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[sandbox]${NC} $*"; }
ok()    { echo -e "${GREEN}[sandbox]${NC} $*"; }
fail()  { echo -e "${RED}[sandbox]${NC} $*" >&2; exit 1; }

# --- Cleanup on error ---
cleanup() {
    if [ -f "$PID_FILE" ]; then
        info "Cleaning up after error..."
        "$SCRIPT_DIR/stop.sh" 2>/dev/null || true
    fi
}
trap cleanup ERR

# --- Setup ---
mkdir -p "$DATA_DIR" "$BIN_DIR"
> "$PID_FILE"

# --- Build ---
info "Building daemon..."
(cd "$REPO_ROOT" && make build-daemon) || fail "Failed to build daemon"

info "Building sandbox apps..."
for app in users products webhooks auth-service media; do
    (cd "$SANDBOX_DIR/apps/$app" && go build -o "$BIN_DIR/$app" .) &
done
wait
ok "All binaries built"

# --- Start upstream apps ---
APPS=(
    "users:9001"
    "products:9002:-error-rate=2"
    "webhooks:9003"
    "auth-service:9004"
    "media:9005:-bandwidth-limit=1048576"
)

for entry in "${APPS[@]}"; do
    IFS=: read -r name port extra <<< "$entry"
    info "Starting $name on :$port..."
    $BIN_DIR/$name -port "$port" $extra > "$DATA_DIR/$name.log" 2>&1 &
    echo "$! $name" >> "$PID_FILE"
done

# --- Start daemon ---
info "Starting Rioku daemon..."
"$REPO_ROOT/bin/rioku" daemon --dev \
    --data-dir "$DATA_DIR" \
    > "$DATA_DIR/daemon.log" 2>&1 &
echo "$! daemon" >> "$PID_FILE"

# --- Health checks ---
info "Waiting for services..."
check_health() {
    local name=$1 url=$2 retries=30
    for i in $(seq 1 $retries); do
        if curl -sf "$url" > /dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
    done
    fail "$name failed to start (checked $url)"
}

for entry in "${APPS[@]}"; do
    IFS=: read -r name port _ <<< "$entry"
    check_health "$name" "http://localhost:$port/health"
done
check_health "daemon" "http://localhost:7778/api/v1/health"
ok "All services healthy"

# --- Seed config ---
info "Seeding configuration..."

# The seed script will need to create services first, capture IDs,
# then create routes referencing those IDs.
# For now, use the config import endpoint which handles this atomically.
SEED_FILE="$SANDBOX_DIR/config/seed.json"
if [ -f "$SEED_FILE" ]; then
    # Get bootstrap token from daemon output
    BOOTSTRAP_TOKEN=$(grep -o 'rku_tok_[A-Za-z0-9_-]*' "$DATA_DIR/daemon.log" | head -1)
    if [ -z "$BOOTSTRAP_TOKEN" ]; then
        info "No bootstrap token found in logs, daemon may already be initialized"
        # Try using stored token
        BOOTSTRAP_TOKEN="sandbox"
    fi

    # Exchange bootstrap token for access token
    AUTH_RESPONSE=$(curl -sf -X POST http://localhost:7778/api/v1/auth/token \
        -H "Content-Type: application/json" \
        -d "{\"token\": \"$BOOTSTRAP_TOKEN\"}" 2>/dev/null || echo "")

    if [ -n "$AUTH_RESPONSE" ]; then
        ACCESS_TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")
    fi

    if [ -z "$ACCESS_TOKEN" ]; then
        info "Could not obtain access token — config seeding may require manual setup"
    else
        # Import config
        curl -sf -X POST http://localhost:7778/api/v1/config/import \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -d @"$SEED_FILE" > /dev/null 2>&1 && ok "Config seeded" || info "Config seeding failed (daemon may not support import yet)"
    fi
fi

# --- Print summary ---
echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}  Rioku Sandbox Running${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Admin Panel:${NC}  http://localhost:7778"
echo -e "  ${CYAN}REST API:${NC}     http://localhost:7778/api/v1"
echo ""
echo -e "  ${CYAN}Upstreams:${NC}"
echo -e "    users:        http://localhost:9001"
echo -e "    products:     http://localhost:9002"
echo -e "    webhooks:     http://localhost:9003"
echo -e "    auth-service: http://localhost:9004"
echo -e "    media:        http://localhost:9005"
echo ""
echo -e "  ${CYAN}Logs:${NC}         $DATA_DIR/*.log"
echo -e "  ${CYAN}Data:${NC}         $DATA_DIR/"
echo ""
echo -e "  Stop with: ${BOLD}make sandbox-stop${NC}"
echo ""
```

- [ ] **Step 2: Write stop.sh**

Create `sandbox/scripts/stop.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$SANDBOX_DIR/.data"
PID_FILE="$DATA_DIR/pids"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${CYAN}[sandbox]${NC} $*"; }
ok()   { echo -e "${GREEN}[sandbox]${NC} $*"; }

if [ ! -f "$PID_FILE" ]; then
    info "No PID file found — sandbox may not be running"
    exit 0
fi

# Send SIGTERM to all processes (reverse order — daemon first)
tac "$PID_FILE" | while read -r pid name; do
    if kill -0 "$pid" 2>/dev/null; then
        info "Stopping $name (PID $pid)..."
        kill "$pid" 2>/dev/null || true
    fi
done

# Wait for graceful shutdown (5s)
info "Waiting for graceful shutdown..."
sleep 2

# Force kill any remaining
while read -r pid name; do
    if kill -0 "$pid" 2>/dev/null; then
        info "Force killing $name (PID $pid)..."
        kill -9 "$pid" 2>/dev/null || true
    fi
done < "$PID_FILE"

rm -f "$PID_FILE"
ok "Sandbox stopped"
```

- [ ] **Step 3: Make scripts executable**

```bash
chmod +x sandbox/scripts/start.sh sandbox/scripts/stop.sh
```

- [ ] **Step 4: Commit**

```bash
git add sandbox/scripts/
git commit -m "feat(sandbox): add start/stop orchestration scripts"
```

---

### Task 9: Makefile targets

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add sandbox targets to Makefile**

Append to the existing `Makefile` (after the existing targets, before the `help` target):

```makefile
# ---------------------------------------------------------------------------
# Sandbox
# ---------------------------------------------------------------------------

.PHONY: sandbox sandbox-stop sandbox-seed

sandbox: build-daemon ## Start sandbox environment (5 upstream apps + daemon + seed)
	@bash sandbox/scripts/start.sh

sandbox-stop: ## Stop sandbox environment
	@bash sandbox/scripts/stop.sh

sandbox-seed: ## Re-seed sandbox config without restart
	@bash sandbox/scripts/start.sh --seed-only 2>/dev/null || echo "Seed-only mode not yet implemented"
```

Also update the `help` target to include the new targets (if it uses a grep pattern, the `##` comments will auto-discover).

- [ ] **Step 2: Verify make targets**

```bash
make help | grep sandbox
```

Expected: sandbox, sandbox-stop, sandbox-seed listed with descriptions.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(sandbox): add make sandbox/sandbox-stop/sandbox-seed targets"
```

---

### Task 10: Write the media app (full implementation)

Since Task 6 was summarized, this task provides the full media app implementation.

**Files:**
- Create: `sandbox/apps/media/main.go`

- [ ] **Step 1: Write the complete media app**

Create `sandbox/apps/media/main.go` (~280 lines). See Task 6 for design rationale. Full code:

```go
package main

import (
	"context"
	"crypto/rand"
	"flag"
	"fmt"
	"io"
	"log"
	mrand "math/rand"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"encoding/json"
)

var (
	port           = flag.Int("port", 9005, "listen port")
	maxConns       = flag.Int("max-conns", 100, "max concurrent connections")
	errorRate      = flag.Int("error-rate", 1, "error percentage 0-100")
	maxUpload      = flag.Int64("max-upload", 10*1024*1024, "max upload size in bytes")
	bandwidthLimit = flag.Int("bandwidth-limit", 0, "bytes per second limit (0=unlimited)")
	latencyMin     = flag.Duration("latency-min", 2*time.Millisecond, "min response latency")
	latencyMax     = flag.Duration("latency-max", 20*time.Millisecond, "max response latency")
)

type metrics struct {
	totalRequests     atomic.Int64
	activeConnections atomic.Int64
	errorCount        atomic.Int64
	bytesServed       atomic.Int64
}

var m metrics

// --- Blob Store ---

type blob struct {
	ID          string    `json:"id"`
	Data        []byte    `json:"-"`
	Size        int64     `json:"size"`
	ContentType string    `json:"content_type"`
	CreatedAt   time.Time `json:"created_at"`
}

type blobStore struct {
	mu    sync.RWMutex
	blobs map[string]*blob
	seq   int
}

var store = &blobStore{blobs: make(map[string]*blob)}

func (s *blobStore) seed(count int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sizes := []int{50 * 1024, 100 * 1024, 200 * 1024, 500 * 1024, 1024 * 1024, 2 * 1024 * 1024}
	types := []string{"image/png", "image/jpeg", "application/pdf", "application/octet-stream"}

	for i := 0; i < count; i++ {
		s.seq++
		size := sizes[mrand.Intn(len(sizes))]
		data := make([]byte, size)
		rand.Read(data)

		b := &blob{
			ID:          strconv.Itoa(s.seq),
			Data:        data,
			Size:        int64(size),
			ContentType: types[mrand.Intn(len(types))],
			CreatedAt:   time.Now().UTC(),
		}
		s.blobs[b.ID] = b
	}
}

func (s *blobStore) get(id string) (*blob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, ok := s.blobs[id]
	return b, ok
}

func (s *blobStore) add(data []byte, contentType string) *blob {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	b := &blob{
		ID:          strconv.Itoa(s.seq),
		Data:        data,
		Size:        int64(len(data)),
		ContentType: contentType,
		CreatedAt:   time.Now().UTC(),
	}
	s.blobs[b.ID] = b
	return b
}

func (s *blobStore) remove(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.blobs[id]; !ok {
		return false
	}
	delete(s.blobs, id)
	return true
}

// --- Throttled Writer ---

type throttledWriter struct {
	w     http.ResponseWriter
	limit int
}

func (tw *throttledWriter) Write(p []byte) (int, error) {
	if tw.limit <= 0 {
		n, err := tw.w.Write(p)
		m.bytesServed.Add(int64(n))
		return n, err
	}
	chunkSize := tw.limit / 10
	if chunkSize < 1024 {
		chunkSize = 1024
	}
	written := 0
	for written < len(p) {
		end := written + chunkSize
		if end > len(p) {
			end = len(p)
		}
		n, err := tw.w.Write(p[written:end])
		written += n
		m.bytesServed.Add(int64(n))
		if err != nil {
			return written, err
		}
		if f, ok := tw.w.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(100 * time.Millisecond)
	}
	return written, nil
}

// --- Middleware ---

func shouldError() bool { return mrand.Intn(100) < *errorRate }

func connLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		active := m.activeConnections.Add(1)
		defer m.activeConnections.Add(-1)
		m.totalRequests.Add(1)
		if active > int64(*maxConns) {
			m.errorCount.Add(1)
			http.Error(w, `{"error":"service overloaded","status":503}`, http.StatusServiceUnavailable)
			return
		}
		if reqID := r.Header.Get("X-Request-ID"); reqID != "" {
			w.Header().Set("X-Request-ID", reqID)
		}
		next.ServeHTTP(w, r)
	})
}

// --- Handlers ---

func parseRange(rangeHeader string, size int64) (int64, int64, bool) {
	// Parse "bytes=start-end"
	if !strings.HasPrefix(rangeHeader, "bytes=") {
		return 0, 0, false
	}
	parts := strings.SplitN(strings.TrimPrefix(rangeHeader, "bytes="), "-", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	start, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	var end int64
	if parts[1] == "" {
		end = size - 1
	} else {
		end, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return 0, 0, false
		}
	}
	if start < 0 || start >= size || end >= size || start > end {
		return 0, 0, false
	}
	return start, end, true
}

func handleGet(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/media/")
	if strings.HasSuffix(id, "/meta") {
		handleMeta(w, r)
		return
	}

	time.Sleep(*latencyMin)

	if shouldError() {
		m.errorCount.Add(1)
		http.Error(w, `{"error":"service unavailable","status":503}`, http.StatusServiceUnavailable)
		return
	}

	b, ok := store.get(id)
	if !ok {
		http.Error(w, `{"error":"not found","status":404}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", b.ContentType)
	w.Header().Set("Accept-Ranges", "bytes")

	// Check for Range header
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		start, end, ok := parseRange(rangeHeader, b.Size)
		if !ok {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", b.Size))
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		length := end - start + 1
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, b.Size))
		w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
		w.WriteHeader(http.StatusPartialContent)
		tw := &throttledWriter{w: w, limit: *bandwidthLimit}
		tw.Write(b.Data[start : end+1])
		return
	}

	w.Header().Set("Content-Length", strconv.FormatInt(b.Size, 10))
	tw := &throttledWriter{w: w, limit: *bandwidthLimit}
	tw.Write(b.Data)
}

func handleMeta(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/media/")
	id = strings.TrimSuffix(id, "/meta")

	b, ok := store.get(id)
	if !ok {
		http.Error(w, `{"error":"not found","status":404}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":           b.ID,
		"size":         b.Size,
		"content_type": b.ContentType,
		"created_at":   b.CreatedAt.Format(time.RFC3339),
	})
}

func handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, *maxUpload)

	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		if err := r.ParseMultipartForm(*maxUpload); err != nil {
			http.Error(w, `{"error":"file too large or invalid multipart","status":413}`, http.StatusRequestEntityTooLarge)
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, `{"error":"missing file field","status":400}`, http.StatusBadRequest)
			return
		}
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil {
			http.Error(w, `{"error":"failed to read file","status":500}`, http.StatusInternalServerError)
			return
		}
		ct := header.Header.Get("Content-Type")
		if ct == "" {
			ct = "application/octet-stream"
		}
		b := store.add(data, ct)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"id":           b.ID,
			"size":         b.Size,
			"content_type": b.ContentType,
		})
		return
	}

	// Raw body upload
	data, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error":"failed to read body","status":500}`, http.StatusInternalServerError)
		return
	}
	ct := contentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	b := store.add(data, ct)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"id":           b.ID,
		"size":         b.Size,
		"content_type": b.ContentType,
	})
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/media/")
	if !store.remove(id) {
		http.Error(w, `{"error":"not found","status":404}`, http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleMedia(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handleGet(w, r)
	case http.MethodPost:
		if r.URL.Path == "/media/upload" || r.URL.Path == "/media/upload/" {
			handleUpload(w, r)
		} else {
			http.Error(w, `{"error":"not found","status":404}`, http.StatusNotFound)
		}
	case http.MethodDelete:
		handleDelete(w, r)
	default:
		http.Error(w, `{"error":"method not allowed","status":405}`, http.StatusMethodNotAllowed)
	}
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "sandbox_requests_total{app=\"media\"} %d\n", m.totalRequests.Load())
	fmt.Fprintf(w, "sandbox_active_connections{app=\"media\"} %d\n", m.activeConnections.Load())
	fmt.Fprintf(w, "sandbox_errors_total{app=\"media\"} %d\n", m.errorCount.Load())
	fmt.Fprintf(w, "sandbox_bytes_served_total{app=\"media\"} %d\n", m.bytesServed.Load())
}

func main() {
	flag.Parse()

	info := "unlimited"
	if *bandwidthLimit > 0 {
		info = fmt.Sprintf("%d bytes/s", *bandwidthLimit)
	}
	log.Printf("[media] generating blobs...")
	store.seed(10)
	log.Printf("[media] seeded 10 blobs, bandwidth: %s", info)

	mux := http.NewServeMux()
	mux.HandleFunc("/media/", handleMedia)
	mux.HandleFunc("/media/upload", handleUpload)
	mux.HandleFunc("/metrics", handleMetrics)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","app":"media","port":%d,"blobs":10}`, *port)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *port),
		Handler:      connLimitMiddleware(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second, // long for streaming
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("[media] listening on :%d", *port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("[media] listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("[media] shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	log.Printf("[media] stopped")
}
```

- [ ] **Step 2: Verify it compiles and runs**

```bash
cd sandbox/apps/media && go build -o /tmp/sandbox-media . && /tmp/sandbox-media &
sleep 2
curl -s http://localhost:9005/health
curl -s http://localhost:9005/media/1/meta
curl -s -o /dev/null -w "status=%{http_code} size=%{size_download}\n" http://localhost:9005/media/1
curl -s -H "Range: bytes=0-1023" -o /dev/null -w "status=%{http_code}\n" http://localhost:9005/media/1
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add sandbox/apps/media/
git commit -m "feat(sandbox): add media streaming app with Range support and bandwidth throttling"
```

---

### Task 11: End-to-end sandbox verification

- [ ] **Step 1: Build all apps individually**

```bash
for app in users products webhooks auth-service media; do
    echo "Building $app..."
    (cd sandbox/apps/$app && go build -o /tmp/sandbox-$app .) || echo "FAILED: $app"
done
echo "All builds complete"
```

Expected: all 5 binaries compile without error.

- [ ] **Step 2: Test each app's health endpoint**

Start all apps, verify health endpoints, stop all:

```bash
/tmp/sandbox-users &
/tmp/sandbox-products &
/tmp/sandbox-webhooks &
/tmp/sandbox-auth &
/tmp/sandbox-media &
sleep 3

for port in 9001 9002 9003 9004 9005; do
    echo -n "Port $port: "
    curl -sf "http://localhost:$port/health" && echo "" || echo "FAILED"
done

kill $(jobs -p) 2>/dev/null
wait 2>/dev/null
```

Expected: all 5 return `{"status":"ok",...}`.

- [ ] **Step 3: Test key functionality per app**

```bash
# Users CRUD
curl -sf "http://localhost:9001/users?page=1&page_size=1" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['total']==1000, f'expected 1000, got {d[\"total\"]}'; print('users: OK')"

# Products search
curl -sf "http://localhost:9002/products/search?q=premium" | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d['results'])>0, 'no search results'; print('products: OK')"

# Webhooks accept + queue
curl -sf -X POST http://localhost:9003/hooks/test -d '{"x":1}' -H "Content-Type: application/json" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='accepted'; print('webhooks: OK')"

# Auth token flow
TOKEN=$(curl -sf -X POST http://localhost:9004/auth/token -d '{"username":"admin","password":"admin123"}' -H "Content-Type: application/json" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sf http://localhost:9004/auth/validate -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['valid']==True; print('auth: OK')"

# Media streaming
SIZE=$(curl -sf -o /dev/null -w "%{size_download}" http://localhost:9005/media/1)
[ "$SIZE" -gt 10000 ] && echo "media: OK (${SIZE} bytes)" || echo "media: FAILED"
```

- [ ] **Step 4: Final commit with any fixes**

```bash
git add -A
git status
# If changes exist:
git commit -m "fix(sandbox): address issues found during verification"
```
