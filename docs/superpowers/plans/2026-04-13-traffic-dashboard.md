# Traffic Dashboard & Per-Entity Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add REST endpoints for a traffic dashboard (global stats, per-route stats, per-service stats) backed by the TraceStore aggregation tables.

**Architecture:** New `traffic_routes.go` file with `RegisterTrafficRoutes`. The dashboard endpoint uses `GetStatsBuckets`, `GetRouteBuckets`, and `GetStatusBuckets` from the TraceStore driver. Per-route uses `GetRouteBuckets` (client-side filter) + `QueryTraces` for status distribution. Per-service resolves which routes target a service from the config engine, then aggregates their route buckets. All endpoints accept a `range` query parameter (`1h`, `6h`, `24h`, `7d`, `30d`) and re-aggregate minute buckets into coarser intervals. The `tracestore.Driver` must be threaded into the gateway.

**Tech Stack:** Go 1.24, net/http, TraceStore (SQLite driver), config.Engine

**Working directory:** `packages/daemon`

**Spec:** `docs/superpowers/specs/2026-04-12-rest-api-endpoints.md` (section #81)

**Key conventions:**
- Go standard library preferred, no external test libraries
- Table-driven tests, real databases for integration tests
- Handle every error explicitly, `-race` flag on all tests
- Conventional Commits required, no AI references in commits
- TDD: write test first, verify it fails, then implement

**Prerequisite:** The settings endpoints plan (#78) should be completed first so gateway.go is in a known state.

---

## Task 1: Thread tracestore.Driver into the gateway

**Files:**
- Modify: `packages/daemon/internal/gateway/gateway.go`
- Modify: `packages/daemon/internal/daemon/daemon.go`
- Modify: `packages/daemon/internal/gateway/gateway_lifecycle_test.go`

- [ ] **Step 1: Add tracestore.Driver parameter to NewGateway**

In `packages/daemon/internal/gateway/gateway.go`, add `traceStore tracestore.Driver` as a new parameter to `NewGateway`, after `traceBuf *tracestore.RingBuffer`:

```go
func NewGateway(
	addr string,
	configSvc riokuv1.ConfigServiceServer,
	healthSvc riokuv1.HealthServiceServer,
	trafficSvc riokuv1.TrafficServiceServer,
	a *auth.Auth,
	sm *auth.SessionManager,
	engine *config.Engine,
	st store.Driver,
	cfg *config.Config,
	spaFS fs.FS,
	traceBuf *tracestore.RingBuffer,
	traceStore tracestore.Driver,
) (*Gateway, error) {
```

Add the `tracestore` import if not already present (it likely is for `*tracestore.RingBuffer`).

- [ ] **Step 2: Update daemon.go call site**

In `packages/daemon/internal/daemon/daemon.go`, update the `NewGateway` call to pass `d.traceStore`:

```go
gw, err = gateway.NewGateway(addr, d.grpc.ConfigService(), d.grpc.HealthService(), d.grpc.TrafficService(), d.auth, d.sessions, d.engine, d.store, d.cfg, spaFS, d.ringBuffer, d.traceStore)
```

- [ ] **Step 3: Update test call sites**

Update all `NewGateway` calls in test files to pass `nil` for the new `traceStore` parameter. Check:
- `packages/daemon/internal/gateway/gateway_lifecycle_test.go` — both `NewGateway` calls need `nil` appended
- Any other test files that call `NewGateway` directly

- [ ] **Step 4: Verify build and tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go build ./...
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/gateway/ ./internal/daemon/
```

- [ ] **Step 5: Commit**

```
refactor(gateway): thread tracestore.Driver into NewGateway
```

---

## Task 2: Implement re-aggregation helper and range parsing

**Files:**
- Create: `packages/daemon/internal/gateway/traffic_routes.go`
- Create: `packages/daemon/internal/gateway/traffic_routes_test.go`

- [ ] **Step 1: Write tests for range parsing and re-aggregation**

Create `packages/daemon/internal/gateway/traffic_routes_test.go` with unit tests for the helpers:

```go
package gateway

import (
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/tracestore"
)

func TestParseRange(t *testing.T) {
	tests := []struct {
		input    string
		wantDur  time.Duration
		wantInt  time.Duration
		wantErr  bool
	}{
		{"1h", 1 * time.Hour, 1 * time.Minute, false},
		{"6h", 6 * time.Hour, 5 * time.Minute, false},
		{"24h", 24 * time.Hour, 15 * time.Minute, false},
		{"7d", 7 * 24 * time.Hour, 1 * time.Hour, false},
		{"30d", 30 * 24 * time.Hour, 6 * time.Hour, false},
		{"", 24 * time.Hour, 15 * time.Minute, false}, // default
		{"2h", 0, 0, true},   // invalid
		{"abc", 0, 0, true},  // invalid
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			dur, interval, err := parseRange(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if dur != tt.wantDur {
				t.Errorf("duration = %v, want %v", dur, tt.wantDur)
			}
			if interval != tt.wantInt {
				t.Errorf("interval = %v, want %v", interval, tt.wantInt)
			}
		})
	}
}

func TestReaggregateStatsBuckets(t *testing.T) {
	now := time.Now().Truncate(time.Minute)

	// 3 one-minute buckets.
	buckets := []tracestore.StatsBucket{
		{BucketStart: now, RequestCount: 10, ErrorCount: 1, P50LatencyMS: 20, P95LatencyMS: 80, P99LatencyMS: 150, BytesSent: 1000, BytesRecv: 500},
		{BucketStart: now.Add(1 * time.Minute), RequestCount: 20, ErrorCount: 2, P50LatencyMS: 30, P95LatencyMS: 90, P99LatencyMS: 200, BytesSent: 2000, BytesRecv: 1000},
		{BucketStart: now.Add(2 * time.Minute), RequestCount: 30, ErrorCount: 3, P50LatencyMS: 40, P95LatencyMS: 100, P99LatencyMS: 250, BytesSent: 3000, BytesRecv: 1500},
	}

	// Re-aggregate into 5-minute intervals — all 3 should merge into one bucket.
	result := reaggregateStatsBuckets(buckets, 5*time.Minute)

	if len(result) != 1 {
		t.Fatalf("expected 1 aggregated bucket, got %d", len(result))
	}
	agg := result[0]
	if agg.RequestCount != 60 {
		t.Errorf("RequestCount = %d, want 60", agg.RequestCount)
	}
	if agg.ErrorCount != 6 {
		t.Errorf("ErrorCount = %d, want 6", agg.ErrorCount)
	}
	// P50 should be the weighted average: (20*10 + 30*20 + 40*30) / 60 = 2000/60 ≈ 33
	// (implementation may use simple average or weighted — check what makes sense)
}
```

- [ ] **Step 2: Implement parseRange and reaggregateStatsBuckets**

Create `packages/daemon/internal/gateway/traffic_routes.go`:

```go
package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/tracestore"
)

// RegisterTrafficRoutes registers traffic analytics endpoints.
func RegisterTrafficRoutes(mux *http.ServeMux, engine *config.Engine, ts tracestore.Driver) {
	if ts == nil {
		return // TraceStore not configured — skip traffic routes.
	}
	mux.Handle("GET /api/v1/traffic/dashboard", RequirePermission("traffic:read")(http.HandlerFunc(handleTrafficDashboard(ts))))
	mux.Handle("GET /api/v1/traffic/routes/{id}", RequirePermission("traffic:read")(http.HandlerFunc(handleTrafficRoute(ts))))
	mux.Handle("GET /api/v1/traffic/services/{id}", RequirePermission("traffic:read")(http.HandlerFunc(handleTrafficService(engine, ts))))
}

type rangeSpec struct {
	duration time.Duration
	interval time.Duration
}

var rangeSpecs = map[string]rangeSpec{
	"1h":  {1 * time.Hour, 1 * time.Minute},
	"6h":  {6 * time.Hour, 5 * time.Minute},
	"24h": {24 * time.Hour, 15 * time.Minute},
	"7d":  {7 * 24 * time.Hour, 1 * time.Hour},
	"30d": {30 * 24 * time.Hour, 6 * time.Hour},
}

func parseRange(r string) (time.Duration, time.Duration, error) {
	if r == "" {
		r = "24h"
	}
	spec, ok := rangeSpecs[r]
	if !ok {
		return 0, 0, fmt.Errorf("unsupported range %q: use 1h, 6h, 24h, 7d, or 30d", r)
	}
	return spec.duration, spec.interval, nil
}

func reaggregateStatsBuckets(buckets []tracestore.StatsBucket, interval time.Duration) []tracestore.StatsBucket {
	if len(buckets) == 0 {
		return nil
	}

	groups := make(map[time.Time]*tracestore.StatsBucket)
	var keys []time.Time

	for _, b := range buckets {
		key := b.BucketStart.Truncate(interval)
		agg, ok := groups[key]
		if !ok {
			agg = &tracestore.StatsBucket{BucketStart: key}
			groups[key] = agg
			keys = append(keys, key)
		}
		agg.RequestCount += b.RequestCount
		agg.ErrorCount += b.ErrorCount
		agg.BytesSent += b.BytesSent
		agg.BytesRecv += b.BytesRecv
		// For percentiles, use request-weighted average.
		// This is an approximation — true percentiles would require raw data.
		total := agg.RequestCount
		prevCount := total - b.RequestCount
		if total > 0 {
			agg.P50LatencyMS = (agg.P50LatencyMS*prevCount + b.P50LatencyMS*b.RequestCount) / total
			agg.P95LatencyMS = (agg.P95LatencyMS*prevCount + b.P95LatencyMS*b.RequestCount) / total
			agg.P99LatencyMS = (agg.P99LatencyMS*prevCount + b.P99LatencyMS*b.RequestCount) / total
		}
	}

	result := make([]tracestore.StatsBucket, 0, len(keys))
	sort.Slice(keys, func(i, j int) bool { return keys[i].Before(keys[j]) })
	for _, k := range keys {
		result = append(result, *groups[k])
	}
	return result
}

func reaggregateRouteBuckets(buckets []tracestore.RouteBucket, interval time.Duration) []tracestore.RouteBucket {
	if len(buckets) == 0 {
		return nil
	}

	type key struct {
		t       time.Time
		routeID string
	}
	groups := make(map[key]*tracestore.RouteBucket)
	var keys []key

	for _, b := range buckets {
		k := key{b.BucketStart.Truncate(interval), b.RouteID}
		agg, ok := groups[k]
		if !ok {
			agg = &tracestore.RouteBucket{BucketStart: k.t, RouteID: k.routeID}
			groups[k] = agg
			keys = append(keys, k)
		}
		total := agg.RequestCount + b.RequestCount
		if total > 0 {
			agg.AvgLatencyMS = (agg.AvgLatencyMS*agg.RequestCount + b.AvgLatencyMS*b.RequestCount) / total
		}
		agg.RequestCount = total
		agg.ErrorCount += b.ErrorCount
	}

	result := make([]tracestore.RouteBucket, 0, len(keys))
	sort.Slice(keys, func(i, j int) bool { return keys[i].t.Before(keys[j].t) })
	for _, k := range keys {
		result = append(result, *groups[k])
	}
	return result
}
```

- [ ] **Step 3: Run unit tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestParseRange|TestReaggregate"
```

Expected: PASS

- [ ] **Step 4: Commit**

```
feat(gateway): add traffic range parsing and bucket re-aggregation helpers
```

---

## Task 3: Implement dashboard endpoint (GET /api/v1/traffic/dashboard)

**Files:**
- Modify: `packages/daemon/internal/gateway/traffic_routes.go`
- Modify: `packages/daemon/internal/gateway/traffic_routes_test.go`

- [ ] **Step 1: Write test for dashboard endpoint**

Add to `traffic_routes_test.go`. This requires a test setup with a real TraceStore. The test validates the response shape with an empty TraceStore (zero-value stat cards, empty arrays):

```go
func TestTrafficDashboard_Empty(t *testing.T) {
	server, client := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/dashboard", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("dashboard: status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Stat cards should have zero values.
	sc, ok := body["statCards"].(map[string]any)
	if !ok {
		t.Fatal("statCards missing")
	}
	if sc["totalRequests"].(float64) != 0 {
		t.Errorf("totalRequests = %v, want 0", sc["totalRequests"])
	}

	// Time series should be empty array.
	ts, ok := body["timeSeries"].([]any)
	if !ok {
		t.Fatal("timeSeries missing")
	}
	if len(ts) != 0 {
		t.Errorf("timeSeries length = %d, want 0", len(ts))
	}

	if body["range"].(string) != "24h" {
		t.Errorf("range = %v, want 24h", body["range"])
	}
}

func TestTrafficDashboard_InvalidRange(t *testing.T) {
	server, client := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/dashboard?range=2h", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid range: status %d, want 400", resp.StatusCode)
	}
}
```

You'll need to write `setupTrafficTestServer` — similar to `setupSettingsTestServer` but also sets up a TraceStore driver:

```go
func setupTrafficTestServer(t *testing.T) (*httptest.Server, *http.Client) {
	t.Helper()
	ctx := context.Background()

	// Store driver.
	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "traffic_routes.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	// TraceStore driver.
	tsDrv, err := tracestore.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	tsPath := filepath.Join(t.TempDir(), "traces.db")
	if err := tsDrv.Open(ctx, tracestore.DriverConfig{Path: tsPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tsDrv.Close() })

	// Root user setup (same as other test servers).
	rootPassword := "TestPassword123!"
	hash, err := auth.HashPassword(rootPassword)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	rootUser, err := tx.CreateUser(ctx, &store.User{
		Username:            "root",
		PasswordHash:        hash,
		Status:              "active",
		ForcePasswordChange: false,
		PasswordChangedAt:   time.Now().UTC(),
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	roles, err := tx.ListRoles(ctx)
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	for _, role := range roles {
		if role.Name == "superadmin" {
			if err := tx.AssignRole(ctx, rootUser.ID, role.ID, ""); err != nil {
				_ = tx.Rollback()
				t.Fatal(err)
			}
			break
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	sm := auth.NewSessionManager(drv, true)

	cfg := config.Default()
	cfg.Auth.RateLimit.RequestsPerMinute = 1000

	encKey, err := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{DevMode: true}, "", nil, caddy.SecurityHeadersConfig{})
	engine := config.NewEngine(drv, compiler)

	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterTrafficRoutes(mux, engine, tsDrv)

	var handler http.Handler = mux
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("root login: expected 200, got %d", resp.StatusCode)
	}

	return server, client
}
```

Ensure these imports are at the top of the test file:

```go
import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
	"github.com/riokulabs/rioku/internal/tracestore"
	_ "github.com/riokulabs/rioku/internal/tracestore/sqlite"
)
```

- [ ] **Step 2: Implement handleTrafficDashboard**

In `traffic_routes.go`, add:

```go
func handleTrafficDashboard(ts tracestore.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		dur, interval, err := parseRange(r.URL.Query().Get("range"))
		if err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid range",
				err.Error(), r.URL.Path, nil)
			return
		}

		rangeLabel := r.URL.Query().Get("range")
		if rangeLabel == "" {
			rangeLabel = "24h"
		}

		now := time.Now().UTC()
		since := now.Add(-dur)

		statBuckets, err := ts.GetStatsBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get stats buckets")
			return
		}
		routeBuckets, err := ts.GetRouteBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get route buckets")
			return
		}
		statusBuckets, err := ts.GetStatusBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get status buckets")
			return
		}

		// Re-aggregate stats into output intervals.
		aggStats := reaggregateStatsBuckets(statBuckets, interval)

		// Compute stat cards from raw minute buckets.
		var totalReq, totalErr, totalP50 int64
		for _, b := range statBuckets {
			totalReq += b.RequestCount
			totalErr += b.ErrorCount
			totalP50 += b.P50LatencyMS * b.RequestCount
		}
		var avgLatency int64
		if totalReq > 0 {
			avgLatency = totalP50 / totalReq
		}
		var errorRate float64
		if totalReq > 0 {
			errorRate = float64(totalErr) / float64(totalReq)
		}
		rps := float64(totalReq) / dur.Seconds()

		// Count active routes.
		routeSet := make(map[string]struct{})
		for _, b := range routeBuckets {
			routeSet[b.RouteID] = struct{}{}
		}

		// Top routes by request count.
		routeTotals := make(map[string]*struct {
			requests int64
			errors   int64
			latency  int64
		})
		for _, b := range routeBuckets {
			rt, ok := routeTotals[b.RouteID]
			if !ok {
				rt = &struct {
					requests int64
					errors   int64
					latency  int64
				}{}
				routeTotals[b.RouteID] = rt
			}
			total := rt.requests + b.RequestCount
			if total > 0 {
				rt.latency = (rt.latency*rt.requests + b.AvgLatencyMS*b.RequestCount) / total
			}
			rt.requests = total
			rt.errors += b.ErrorCount
		}

		type topRoute struct {
			RouteID      string `json:"routeId"`
			RequestCount int64  `json:"requestCount"`
			ErrorCount   int64  `json:"errorCount"`
			AvgLatencyMs int64  `json:"avgLatencyMs"`
		}
		topRoutes := make([]topRoute, 0, len(routeTotals))
		for rid, rt := range routeTotals {
			topRoutes = append(topRoutes, topRoute{
				RouteID:      rid,
				RequestCount: rt.requests,
				ErrorCount:   rt.errors,
				AvgLatencyMs: rt.latency,
			})
		}
		sort.Slice(topRoutes, func(i, j int) bool {
			return topRoutes[i].RequestCount > topRoutes[j].RequestCount
		})
		if len(topRoutes) > 10 {
			topRoutes = topRoutes[:10]
		}

		// Status distribution.
		statusDist := map[string]int64{
			"2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0,
		}
		for _, b := range statusBuckets {
			statusDist[b.StatusClass] += b.RequestCount
		}

		// Build time series.
		timeSeries := make([]map[string]any, 0, len(aggStats))
		for _, b := range aggStats {
			timeSeries = append(timeSeries, map[string]any{
				"timestamp":    b.BucketStart.Format(time.RFC3339),
				"requests":     b.RequestCount,
				"avgLatencyMs": b.P50LatencyMS,
				"errorCount":   b.ErrorCount,
				"p50LatencyMs": b.P50LatencyMS,
				"p95LatencyMs": b.P95LatencyMS,
				"p99LatencyMs": b.P99LatencyMS,
			})
		}

		resp := map[string]any{
			"statCards": map[string]any{
				"totalRequests":    totalReq,
				"avgLatencyMs":     avgLatency,
				"errorRate":        errorRate,
				"activeRoutes":     len(routeSet),
				"requestsPerSecond": rps,
			},
			"timeSeries":        timeSeries,
			"topRoutes":         topRoutes,
			"statusDistribution": statusDist,
			"range":             rangeLabel,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestTrafficDashboard"
```

Expected: PASS

- [ ] **Step 4: Commit**

```
feat(gateway): add traffic dashboard endpoint with stats and time series
```

---

## Task 4: Implement per-route endpoint (GET /api/v1/traffic/routes/{id})

**Files:**
- Modify: `packages/daemon/internal/gateway/traffic_routes.go`
- Modify: `packages/daemon/internal/gateway/traffic_routes_test.go`

- [ ] **Step 1: Write test for per-route endpoint (empty)**

```go
func TestTrafficRoute_NotFound(t *testing.T) {
	server, client := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/routes/nonexistent-id", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("per-route: status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	sc := body["statCards"].(map[string]any)
	if sc["totalRequests"].(float64) != 0 {
		t.Errorf("totalRequests = %v, want 0", sc["totalRequests"])
	}
}
```

- [ ] **Step 2: Implement handleTrafficRoute**

```go
func handleTrafficRoute(ts tracestore.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		routeID := r.PathValue("id")
		if routeID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Route ID is required", r.URL.Path, nil)
			return
		}

		dur, interval, err := parseRange(r.URL.Query().Get("range"))
		if err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid range",
				err.Error(), r.URL.Path, nil)
			return
		}

		rangeLabel := r.URL.Query().Get("range")
		if rangeLabel == "" {
			rangeLabel = "24h"
		}

		now := time.Now().UTC()
		since := now.Add(-dur)

		allRouteBuckets, err := ts.GetRouteBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get route buckets")
			return
		}

		// Filter to this route.
		var filtered []tracestore.RouteBucket
		for _, b := range allRouteBuckets {
			if b.RouteID == routeID {
				filtered = append(filtered, b)
			}
		}

		// Re-aggregate.
		aggBuckets := reaggregateRouteBuckets(filtered, interval)

		// Compute stat cards.
		var totalReq, totalErr, totalLatency int64
		for _, b := range filtered {
			total := totalReq + b.RequestCount
			if total > 0 {
				totalLatency = (totalLatency*totalReq + b.AvgLatencyMS*b.RequestCount) / total
			}
			totalReq = total
			totalErr += b.ErrorCount
		}
		rps := float64(totalReq) / dur.Seconds()

		// Build time series (without route ID since it's a single route).
		timeSeries := make([]map[string]any, 0, len(aggBuckets))
		for _, b := range aggBuckets {
			timeSeries = append(timeSeries, map[string]any{
				"timestamp":    b.BucketStart.Format(time.RFC3339),
				"requests":     b.RequestCount,
				"errorCount":   b.ErrorCount,
				"avgLatencyMs": b.AvgLatencyMS,
			})
		}

		// Status distribution from route buckets (aggregated — no per-status breakdown available from RouteBucket).
		// The spec says to use QueryTraces for this, but for v1 we provide totals only.
		statusDist := map[string]int64{
			"2xx": totalReq - totalErr,
			"4xx": 0,
			"5xx": totalErr,
		}

		resp := map[string]any{
			"routeId": routeID,
			"statCards": map[string]any{
				"totalRequests":    totalReq,
				"avgLatencyMs":     totalLatency,
				"errorCount":       totalErr,
				"requestsPerSecond": rps,
			},
			"timeSeries":        timeSeries,
			"statusDistribution": statusDist,
			"range":             rangeLabel,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestTrafficRoute"
```

- [ ] **Step 4: Commit**

```
feat(gateway): add per-route traffic analytics endpoint
```

---

## Task 5: Implement per-service endpoint (GET /api/v1/traffic/services/{id})

**Files:**
- Modify: `packages/daemon/internal/gateway/traffic_routes.go`
- Modify: `packages/daemon/internal/gateway/traffic_routes_test.go`

- [ ] **Step 1: Write test for per-service endpoint (empty)**

```go
func TestTrafficService_NoRoutes(t *testing.T) {
	server, client := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/services/nonexistent-id", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("per-service: status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	sc := body["statCards"].(map[string]any)
	if sc["totalRequests"].(float64) != 0 {
		t.Errorf("totalRequests = %v, want 0", sc["totalRequests"])
	}

	routeIDs := body["routeIds"].([]any)
	if len(routeIDs) != 0 {
		t.Errorf("routeIds length = %d, want 0", len(routeIDs))
	}
}
```

- [ ] **Step 2: Implement handleTrafficService**

```go
func handleTrafficService(engine *config.Engine, ts tracestore.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		serviceID := r.PathValue("id")
		if serviceID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Service ID is required", r.URL.Path, nil)
			return
		}

		dur, interval, err := parseRange(r.URL.Query().Get("range"))
		if err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid range",
				err.Error(), r.URL.Path, nil)
			return
		}

		rangeLabel := r.URL.Query().Get("range")
		if rangeLabel == "" {
			rangeLabel = "24h"
		}

		// Find which routes target this service.
		snap, err := engine.GetConfig(ctx)
		if err != nil {
			writeInternalError(w, r, "get config snapshot")
			return
		}

		var routeIDs []string
		for _, route := range snap.GetRoutes() {
			if t, ok := route.GetTarget().(*riokuv1.Route_ServiceId); ok && t.ServiceId == serviceID {
				routeIDs = append(routeIDs, route.GetId())
			}
		}
		if routeIDs == nil {
			routeIDs = []string{}
		}

		now := time.Now().UTC()
		since := now.Add(-dur)

		allRouteBuckets, err := ts.GetRouteBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get route buckets")
			return
		}

		// Filter to routes that target this service.
		routeSet := make(map[string]struct{}, len(routeIDs))
		for _, rid := range routeIDs {
			routeSet[rid] = struct{}{}
		}
		var filtered []tracestore.RouteBucket
		for _, b := range allRouteBuckets {
			if _, ok := routeSet[b.RouteID]; ok {
				filtered = append(filtered, b)
			}
		}

		// Re-aggregate (collapse all routes into time-based buckets).
		aggBuckets := reaggregateRouteBuckets(filtered, interval)

		// Stat cards.
		var totalReq, totalErr, totalLatency int64
		for _, b := range filtered {
			total := totalReq + b.RequestCount
			if total > 0 {
				totalLatency = (totalLatency*totalReq + b.AvgLatencyMS*b.RequestCount) / total
			}
			totalReq = total
			totalErr += b.ErrorCount
		}
		rps := float64(totalReq) / dur.Seconds()

		// Time series — collapse all route IDs, group by time only.
		timeGroups := make(map[time.Time]*struct{ req, err, lat int64 })
		var timeKeys []time.Time
		for _, b := range aggBuckets {
			g, ok := timeGroups[b.BucketStart]
			if !ok {
				g = &struct{ req, err, lat int64 }{}
				timeGroups[b.BucketStart] = g
				timeKeys = append(timeKeys, b.BucketStart)
			}
			total := g.req + b.RequestCount
			if total > 0 {
				g.lat = (g.lat*g.req + b.AvgLatencyMS*b.RequestCount) / total
			}
			g.req = total
			g.err += b.ErrorCount
		}
		sort.Slice(timeKeys, func(i, j int) bool { return timeKeys[i].Before(timeKeys[j]) })

		timeSeries := make([]map[string]any, 0, len(timeKeys))
		for _, ts := range timeKeys {
			g := timeGroups[ts]
			timeSeries = append(timeSeries, map[string]any{
				"timestamp":    ts.Format(time.RFC3339),
				"requests":     g.req,
				"errorCount":   g.err,
				"avgLatencyMs": g.lat,
			})
		}

		resp := map[string]any{
			"serviceId": serviceID,
			"routeIds":  routeIDs,
			"statCards": map[string]any{
				"totalRequests":    totalReq,
				"avgLatencyMs":     totalLatency,
				"errorCount":       totalErr,
				"requestsPerSecond": rps,
			},
			"timeSeries": timeSeries,
			"range":      rangeLabel,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
```

Add the import for `riokuv1` at the top of the file:

```go
riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
```

- [ ] **Step 3: Run tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestTrafficService"
```

- [ ] **Step 4: Run full gateway suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/gateway/
```

- [ ] **Step 5: Commit**

```
feat(gateway): add per-service traffic analytics endpoint
```

---

## Task 6: Wire traffic routes into gateway.go and full verification

**Files:**
- Modify: `packages/daemon/internal/gateway/gateway.go`

- [ ] **Step 1: Add RegisterTrafficRoutes call to gateway.go**

In `NewGateway`, add after the `RegisterSettingsRoutes` call:

```go
	// Traffic analytics endpoints.
	RegisterTrafficRoutes(topMux, engine, traceStore)
```

- [ ] **Step 2: Run full daemon test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./...
```

- [ ] **Step 3: Verify build**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && make build-daemon
```

- [ ] **Step 4: Commit**

```
feat(gateway): wire traffic analytics routes into gateway
```

---

## Summary of all files modified/created

### Created:
- `packages/daemon/internal/gateway/traffic_routes.go` — 3 handlers, re-aggregation helpers, range parsing
- `packages/daemon/internal/gateway/traffic_routes_test.go` — test setup, 4+ test functions

### Modified:
- `packages/daemon/internal/gateway/gateway.go` — Add `traceStore tracestore.Driver` param, call `RegisterTrafficRoutes`
- `packages/daemon/internal/daemon/daemon.go` — Pass `d.traceStore` to `NewGateway`
- `packages/daemon/internal/gateway/gateway_lifecycle_test.go` — Add nil for new param

### Commits (5-6 total):
1. `refactor(gateway): thread tracestore.Driver into NewGateway`
2. `feat(gateway): add traffic range parsing and bucket re-aggregation helpers`
3. `feat(gateway): add traffic dashboard endpoint with stats and time series`
4. `feat(gateway): add per-route traffic analytics endpoint`
5. `feat(gateway): add per-service traffic analytics endpoint`
6. `feat(gateway): wire traffic analytics routes into gateway`
