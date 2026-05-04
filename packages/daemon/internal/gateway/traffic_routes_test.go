package gateway

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
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func setupTrafficTestServer(t *testing.T) (*httptest.Server, *http.Client, tracestore.Driver, *config.Engine) {
	t.Helper()
	ctx := context.Background()

	// Config store (standard pattern).
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

	// Create root user (superadmin).
	rootPassword := "TestPassword123!"
	hash := cachedHashPassword(t, rootPassword)
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

	// Assign superadmin role.
	roles, err := tx.ListRoles(ctx)
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	var superadminRoleID string
	for _, role := range roles {
		if role.Name == "superadmin" {
			superadminRoleID = role.ID
			break
		}
	}
	if superadminRoleID == "" {
		_ = tx.Rollback()
		t.Fatal("superadmin role not found after migration")
	}
	if err := tx.AssignRole(ctx, rootUser.ID, superadminRoleID, ""); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	sm := auth.NewSessionManager(drv, true)

	cfg := config.Default()
	cfg.Auth.RateLimit.RequestsPerMinute = 1000
	cfg.Auth.CORS = config.CORSConfig{
		AllowedOrigins: []string{"https://app.rioku.dev"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization", "X-Request-ID"},
		MaxAge:         3600,
	}

	encKey, err := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	// TraceStore.
	tsDrv, err := tracestore.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	tsPath := filepath.Join(t.TempDir(), "traces.db")
	if err := tsDrv.Open(ctx, tracestore.DriverConfig{Path: tsPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tsDrv.Close() })

	// Create config.Engine (needed for per-service handler).
	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{DevMode: true}, "", nil, caddy.SecurityHeadersConfig{})
	engine := config.NewEngine(drv, compiler)

	// Register auth + traffic routes; apply auth/requestID middleware.
	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterTrafficRoutes(mux, engine, tsDrv)

	var handler http.Handler = mux
	handler = SecurityHeadersMiddleware(handler)
	handler = CORSMiddleware(cfg.Auth.CORS)(handler)
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	// Log in as root to get an authenticated client.
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

	return server, client, tsDrv, engine
}

// ---------------------------------------------------------------------------
// Unit tests: parseRange
// ---------------------------------------------------------------------------

func TestParseTrafficRange(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantDur time.Duration
		wantInt time.Duration
		wantErr bool
	}{
		{name: "1h", input: "1h", wantDur: 1 * time.Hour, wantInt: 1 * time.Minute},
		{name: "6h", input: "6h", wantDur: 6 * time.Hour, wantInt: 5 * time.Minute},
		{name: "24h", input: "24h", wantDur: 24 * time.Hour, wantInt: 15 * time.Minute},
		{name: "7d", input: "7d", wantDur: 7 * 24 * time.Hour, wantInt: 1 * time.Hour},
		{name: "30d", input: "30d", wantDur: 30 * 24 * time.Hour, wantInt: 6 * time.Hour},
		{name: "empty defaults to 24h", input: "", wantDur: 24 * time.Hour, wantInt: 15 * time.Minute},
		{name: "invalid 2h", input: "2h", wantErr: true},
		{name: "invalid abc", input: "abc", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dur, interval, err := parseTrafficRange(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if dur != tc.wantDur {
				t.Errorf("duration = %v, want %v", dur, tc.wantDur)
			}
			if interval != tc.wantInt {
				t.Errorf("interval = %v, want %v", interval, tc.wantInt)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Unit tests: reaggregateStatsBuckets
// ---------------------------------------------------------------------------

func TestReaggregateStatsBuckets(t *testing.T) {
	base := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)

	// 3 one-minute buckets that should collapse into a single 5-min bucket.
	buckets := []tracestore.StatsBucket{
		{
			BucketStart:  base,
			RequestCount: 100,
			ErrorCount:   5,
			P50LatencyMS: 10,
			P95LatencyMS: 50,
			P99LatencyMS: 100,
			BytesSent:    1000,
			BytesRecv:    500,
		},
		{
			BucketStart:  base.Add(1 * time.Minute),
			RequestCount: 200,
			ErrorCount:   10,
			P50LatencyMS: 20,
			P95LatencyMS: 60,
			P99LatencyMS: 120,
			BytesSent:    2000,
			BytesRecv:    1000,
		},
		{
			BucketStart:  base.Add(2 * time.Minute),
			RequestCount: 300,
			ErrorCount:   15,
			P50LatencyMS: 30,
			P95LatencyMS: 70,
			P99LatencyMS: 140,
			BytesSent:    3000,
			BytesRecv:    1500,
		},
	}

	result := reaggregateStatsBuckets(buckets, 5*time.Minute)

	if len(result) != 1 {
		t.Fatalf("expected 1 aggregated bucket, got %d", len(result))
	}

	b := result[0]
	if b.RequestCount != 600 {
		t.Errorf("RequestCount = %d, want 600", b.RequestCount)
	}
	if b.ErrorCount != 30 {
		t.Errorf("ErrorCount = %d, want 30", b.ErrorCount)
	}
	if b.BytesSent != 6000 {
		t.Errorf("BytesSent = %d, want 6000", b.BytesSent)
	}
	if b.BytesRecv != 3000 {
		t.Errorf("BytesRecv = %d, want 3000", b.BytesRecv)
	}

	// Request-weighted average P50: (100*10 + 200*20 + 300*30) / 600 = 14000/600 = 23
	expectedP50 := int64((100*10 + 200*20 + 300*30) / 600)
	if b.P50LatencyMS != expectedP50 {
		t.Errorf("P50LatencyMS = %d, want %d", b.P50LatencyMS, expectedP50)
	}

	// Request-weighted average P95: (100*50 + 200*60 + 300*70) / 600 = 38000/600 = 63
	expectedP95 := int64((100*50 + 200*60 + 300*70) / 600)
	if b.P95LatencyMS != expectedP95 {
		t.Errorf("P95LatencyMS = %d, want %d", b.P95LatencyMS, expectedP95)
	}

	// Request-weighted average P99: (100*100 + 200*120 + 300*140) / 600 = 76000/600 = 126
	expectedP99 := int64((100*100 + 200*120 + 300*140) / 600)
	if b.P99LatencyMS != expectedP99 {
		t.Errorf("P99LatencyMS = %d, want %d", b.P99LatencyMS, expectedP99)
	}
}

func TestReaggregateStatsBuckets_Empty(t *testing.T) {
	result := reaggregateStatsBuckets(nil, 5*time.Minute)
	if result == nil {
		t.Fatal("expected non-nil empty slice, got nil")
	}
	if len(result) != 0 {
		t.Errorf("expected empty slice, got %d elements", len(result))
	}
}

// ---------------------------------------------------------------------------
// Unit tests: reaggregateRouteBuckets
// ---------------------------------------------------------------------------

func TestReaggregateRouteBuckets(t *testing.T) {
	base := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)

	// 3 one-minute buckets for the same route.
	buckets := []tracestore.RouteBucket{
		{BucketStart: base, RouteID: "r1", RequestCount: 100, ErrorCount: 5, AvgLatencyMS: 10},
		{BucketStart: base.Add(1 * time.Minute), RouteID: "r1", RequestCount: 200, ErrorCount: 10, AvgLatencyMS: 20},
		{BucketStart: base.Add(2 * time.Minute), RouteID: "r1", RequestCount: 300, ErrorCount: 15, AvgLatencyMS: 30},
	}

	result := reaggregateRouteBuckets(buckets, 5*time.Minute)

	if len(result) != 1 {
		t.Fatalf("expected 1 aggregated bucket, got %d", len(result))
	}

	b := result[0]
	if b.RouteID != "r1" {
		t.Errorf("RouteID = %q, want %q", b.RouteID, "r1")
	}
	if b.RequestCount != 600 {
		t.Errorf("RequestCount = %d, want 600", b.RequestCount)
	}
	if b.ErrorCount != 30 {
		t.Errorf("ErrorCount = %d, want 30", b.ErrorCount)
	}

	// Weighted avg: (100*10 + 200*20 + 300*30) / 600 = 23
	expectedLat := int64((100*10 + 200*20 + 300*30) / 600)
	if b.AvgLatencyMS != expectedLat {
		t.Errorf("AvgLatencyMS = %d, want %d", b.AvgLatencyMS, expectedLat)
	}
}

func TestReaggregateRouteBuckets_Empty(t *testing.T) {
	result := reaggregateRouteBuckets(nil, 5*time.Minute)
	if result == nil {
		t.Fatal("expected non-nil empty slice, got nil")
	}
	if len(result) != 0 {
		t.Errorf("expected empty slice, got %d elements", len(result))
	}
}

func TestReaggregateRouteBuckets_MultipleRoutes(t *testing.T) {
	base := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)

	buckets := []tracestore.RouteBucket{
		{BucketStart: base, RouteID: "r1", RequestCount: 100, ErrorCount: 5, AvgLatencyMS: 10},
		{BucketStart: base, RouteID: "r2", RequestCount: 50, ErrorCount: 2, AvgLatencyMS: 20},
		{BucketStart: base.Add(1 * time.Minute), RouteID: "r1", RequestCount: 100, ErrorCount: 5, AvgLatencyMS: 10},
	}

	result := reaggregateRouteBuckets(buckets, 5*time.Minute)

	if len(result) != 2 {
		t.Fatalf("expected 2 aggregated buckets, got %d", len(result))
	}

	// Results should be sorted by (time, routeID).
	if result[0].RouteID != "r1" {
		t.Errorf("first bucket RouteID = %q, want r1", result[0].RouteID)
	}
	if result[1].RouteID != "r2" {
		t.Errorf("second bucket RouteID = %q, want r2", result[1].RouteID)
	}
	if result[0].RequestCount != 200 {
		t.Errorf("r1 RequestCount = %d, want 200", result[0].RequestCount)
	}
	if result[1].RequestCount != 50 {
		t.Errorf("r2 RequestCount = %d, want 50", result[1].RequestCount)
	}
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

func TestTrafficDashboard_Empty(t *testing.T) {
	server, client, _, _ := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/dashboard?range=24h", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Verify range.
	if rng, ok := body["range"].(string); !ok || rng != "24h" {
		t.Errorf("range = %v, want %q", body["range"], "24h")
	}

	// Verify stat cards.
	sc, ok := body["statCards"].(map[string]interface{})
	if !ok {
		t.Fatalf("statCards: expected object, got %T", body["statCards"])
	}
	if v, ok := sc["totalRequests"].(float64); !ok || v != 0 {
		t.Errorf("statCards.totalRequests = %v, want 0", sc["totalRequests"])
	}
	if v, ok := sc["avgLatencyMs"].(float64); !ok || v != 0 {
		t.Errorf("statCards.avgLatencyMs = %v, want 0", sc["avgLatencyMs"])
	}
	if v, ok := sc["errorRate"].(float64); !ok || v != 0 {
		t.Errorf("statCards.errorRate = %v, want 0", sc["errorRate"])
	}
	if v, ok := sc["activeRoutes"].(float64); !ok || v != 0 {
		t.Errorf("statCards.activeRoutes = %v, want 0", sc["activeRoutes"])
	}
	if v, ok := sc["requestsPerSecond"].(float64); !ok || v != 0 {
		t.Errorf("statCards.requestsPerSecond = %v, want 0", sc["requestsPerSecond"])
	}

	// Verify time series is empty array (not null).
	ts, ok := body["timeSeries"].([]interface{})
	if !ok {
		t.Fatalf("timeSeries: expected array, got %T", body["timeSeries"])
	}
	if len(ts) != 0 {
		t.Errorf("timeSeries: expected empty, got %d items", len(ts))
	}

	// Verify top routes is empty array (not null).
	tr, ok := body["topRoutes"].([]interface{})
	if !ok {
		t.Fatalf("topRoutes: expected array, got %T", body["topRoutes"])
	}
	if len(tr) != 0 {
		t.Errorf("topRoutes: expected empty, got %d items", len(tr))
	}

	// Verify status distribution.
	sd, ok := body["statusDistribution"].(map[string]interface{})
	if !ok {
		t.Fatalf("statusDistribution: expected object, got %T", body["statusDistribution"])
	}
	for _, class := range []string{"2xx", "3xx", "4xx", "5xx"} {
		v, ok := sd[class].(float64)
		if !ok {
			t.Errorf("statusDistribution.%s: expected number, got %T", class, sd[class])
		}
		if v != 0 {
			t.Errorf("statusDistribution.%s = %v, want 0", class, v)
		}
	}
}

func TestTrafficDashboard_InvalidRange(t *testing.T) {
	server, client, _, _ := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/dashboard?range=2h", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestTrafficDashboard_DefaultRange(t *testing.T) {
	server, client, _, _ := setupTrafficTestServer(t)

	// No range parameter should default to 24h.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/dashboard", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if rng, ok := body["range"].(string); !ok || rng != "24h" {
		t.Errorf("range = %v, want %q", body["range"], "24h")
	}
}

func TestTrafficRoute_Empty(t *testing.T) {
	server, client, _, _ := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/routes/nonexistent-route?range=24h", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Verify routeId.
	if rid, ok := body["routeId"].(string); !ok || rid != "nonexistent-route" {
		t.Errorf("routeId = %v, want %q", body["routeId"], "nonexistent-route")
	}

	// Verify range.
	if rng, ok := body["range"].(string); !ok || rng != "24h" {
		t.Errorf("range = %v, want %q", body["range"], "24h")
	}

	// Verify stat cards.
	sc, ok := body["statCards"].(map[string]interface{})
	if !ok {
		t.Fatalf("statCards: expected object, got %T", body["statCards"])
	}
	if v, ok := sc["totalRequests"].(float64); !ok || v != 0 {
		t.Errorf("statCards.totalRequests = %v, want 0", sc["totalRequests"])
	}
	if v, ok := sc["avgLatencyMs"].(float64); !ok || v != 0 {
		t.Errorf("statCards.avgLatencyMs = %v, want 0", sc["avgLatencyMs"])
	}
	if v, ok := sc["errorCount"].(float64); !ok || v != 0 {
		t.Errorf("statCards.errorCount = %v, want 0", sc["errorCount"])
	}
	if v, ok := sc["requestsPerSecond"].(float64); !ok || v != 0 {
		t.Errorf("statCards.requestsPerSecond = %v, want 0", sc["requestsPerSecond"])
	}

	// Verify time series is empty array (not null).
	ts, ok := body["timeSeries"].([]interface{})
	if !ok {
		t.Fatalf("timeSeries: expected array, got %T", body["timeSeries"])
	}
	if len(ts) != 0 {
		t.Errorf("timeSeries: expected empty, got %d items", len(ts))
	}

	// Verify status distribution.
	sd, ok := body["statusDistribution"].(map[string]interface{})
	if !ok {
		t.Fatalf("statusDistribution: expected object, got %T", body["statusDistribution"])
	}
	for _, class := range []string{"2xx", "4xx", "5xx"} {
		v, ok := sd[class].(float64)
		if !ok {
			t.Errorf("statusDistribution.%s: expected number, got %T", class, sd[class])
		}
		if v != 0 {
			t.Errorf("statusDistribution.%s = %v, want 0", class, v)
		}
	}
}

func TestTrafficRoute_InvalidRange(t *testing.T) {
	server, client, _, _ := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/routes/some-route?range=2h", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestTrafficService_NoRoutes(t *testing.T) {
	server, client, _, _ := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/services/nonexistent-service?range=24h", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Verify serviceId.
	if sid, ok := body["serviceId"].(string); !ok || sid != "nonexistent-service" {
		t.Errorf("serviceId = %v, want %q", body["serviceId"], "nonexistent-service")
	}

	// Verify range.
	if rng, ok := body["range"].(string); !ok || rng != "24h" {
		t.Errorf("range = %v, want %q", body["range"], "24h")
	}

	// Verify routeIds is empty array (not null).
	rids, ok := body["routeIds"].([]interface{})
	if !ok {
		t.Fatalf("routeIds: expected array, got %T", body["routeIds"])
	}
	if len(rids) != 0 {
		t.Errorf("routeIds: expected empty, got %d items", len(rids))
	}

	// Verify stat cards.
	sc, ok := body["statCards"].(map[string]interface{})
	if !ok {
		t.Fatalf("statCards: expected object, got %T", body["statCards"])
	}
	if v, ok := sc["totalRequests"].(float64); !ok || v != 0 {
		t.Errorf("statCards.totalRequests = %v, want 0", sc["totalRequests"])
	}
	if v, ok := sc["avgLatencyMs"].(float64); !ok || v != 0 {
		t.Errorf("statCards.avgLatencyMs = %v, want 0", sc["avgLatencyMs"])
	}
	if v, ok := sc["errorCount"].(float64); !ok || v != 0 {
		t.Errorf("statCards.errorCount = %v, want 0", sc["errorCount"])
	}
	if v, ok := sc["requestsPerSecond"].(float64); !ok || v != 0 {
		t.Errorf("statCards.requestsPerSecond = %v, want 0", sc["requestsPerSecond"])
	}

	// Verify time series is empty array (not null).
	ts, ok := body["timeSeries"].([]interface{})
	if !ok {
		t.Fatalf("timeSeries: expected array, got %T", body["timeSeries"])
	}
	if len(ts) != 0 {
		t.Errorf("timeSeries: expected empty, got %d items", len(ts))
	}
}

func TestTrafficService_InvalidRange(t *testing.T) {
	server, client, _, _ := setupTrafficTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/services/some-service?range=2h", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// Integration tests — with seeded data
// ---------------------------------------------------------------------------

func TestTrafficDashboard_WithData(t *testing.T) {
	server, client, tsDrv, _ := setupTrafficTestServer(t)
	ctx := context.Background()

	// Seed stats buckets within the last hour.
	now := time.Now().UTC().Truncate(time.Minute)
	statsBuckets := []tracestore.StatsBucket{
		{BucketStart: now.Add(-30 * time.Minute), RequestCount: 100, ErrorCount: 5, P50LatencyMS: 50, P95LatencyMS: 200, P99LatencyMS: 500, BytesSent: 50000, BytesRecv: 20000},
		{BucketStart: now.Add(-20 * time.Minute), RequestCount: 200, ErrorCount: 10, P50LatencyMS: 60, P95LatencyMS: 220, P99LatencyMS: 550, BytesSent: 100000, BytesRecv: 40000},
	}
	for _, b := range statsBuckets {
		if err := tsDrv.WriteStatsBucket(ctx, b); err != nil {
			t.Fatalf("WriteStatsBucket: %v", err)
		}
	}

	// Seed route buckets.
	routeBuckets := []tracestore.RouteBucket{
		{BucketStart: now.Add(-30 * time.Minute), RouteID: "route-a", RequestCount: 200, ErrorCount: 10, AvgLatencyMS: 55},
		{BucketStart: now.Add(-30 * time.Minute), RouteID: "route-b", RequestCount: 100, ErrorCount: 5, AvgLatencyMS: 70},
	}
	for _, b := range routeBuckets {
		if err := tsDrv.WriteRouteBucket(ctx, b); err != nil {
			t.Fatalf("WriteRouteBucket: %v", err)
		}
	}

	// Seed status buckets.
	statusBuckets := []tracestore.StatusBucket{
		{BucketStart: now.Add(-30 * time.Minute), StatusClass: "2xx", RequestCount: 280},
		{BucketStart: now.Add(-30 * time.Minute), StatusClass: "5xx", RequestCount: 15},
		{BucketStart: now.Add(-30 * time.Minute), StatusClass: "4xx", RequestCount: 5},
	}
	for _, b := range statusBuckets {
		if err := tsDrv.WriteStatusBucket(ctx, b); err != nil {
			t.Fatalf("WriteStatusBucket: %v", err)
		}
	}

	// Query dashboard with 1h range.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/dashboard?range=1h", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Verify stat cards.
	sc := body["statCards"].(map[string]any)
	totalReq := int64(sc["totalRequests"].(float64))
	if totalReq != 300 {
		t.Errorf("totalRequests = %d, want 300", totalReq)
	}
	activeRoutes := int(sc["activeRoutes"].(float64))
	if activeRoutes != 2 {
		t.Errorf("activeRoutes = %d, want 2", activeRoutes)
	}
	errRate := sc["errorRate"].(float64)
	if errRate < 0.04 || errRate > 0.06 { // 15/300 = 0.05
		t.Errorf("errorRate = %v, want ~0.05", errRate)
	}

	// Verify top routes sorted desc by requestCount.
	topRoutes := body["topRoutes"].([]any)
	if len(topRoutes) != 2 {
		t.Fatalf("topRoutes length = %d, want 2", len(topRoutes))
	}
	first := topRoutes[0].(map[string]any)
	if first["routeId"].(string) != "route-a" {
		t.Errorf("top route = %v, want route-a", first["routeId"])
	}
	if int64(first["requestCount"].(float64)) != 200 {
		t.Errorf("route-a requestCount = %v, want 200", first["requestCount"])
	}

	// Verify status distribution.
	sd := body["statusDistribution"].(map[string]any)
	if int64(sd["2xx"].(float64)) != 280 {
		t.Errorf("2xx = %v, want 280", sd["2xx"])
	}
	if int64(sd["5xx"].(float64)) != 15 {
		t.Errorf("5xx = %v, want 15", sd["5xx"])
	}

	// Time series should be non-empty.
	ts := body["timeSeries"].([]any)
	if len(ts) == 0 {
		t.Error("timeSeries should be non-empty with seeded data")
	}
}

func TestTrafficRoute_WithData(t *testing.T) {
	server, client, tsDrv, _ := setupTrafficTestServer(t)
	ctx := context.Background()

	now := time.Now().UTC().Truncate(time.Minute)

	// Two routes; we'll query route-x.
	routeBuckets := []tracestore.RouteBucket{
		{BucketStart: now.Add(-30 * time.Minute), RouteID: "route-x", RequestCount: 150, ErrorCount: 3, AvgLatencyMS: 40},
		{BucketStart: now.Add(-20 * time.Minute), RouteID: "route-x", RequestCount: 50, ErrorCount: 1, AvgLatencyMS: 60},
		{BucketStart: now.Add(-30 * time.Minute), RouteID: "route-y", RequestCount: 999, ErrorCount: 99, AvgLatencyMS: 999},
	}
	for _, b := range routeBuckets {
		if err := tsDrv.WriteRouteBucket(ctx, b); err != nil {
			t.Fatalf("WriteRouteBucket: %v", err)
		}
	}

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/routes/route-x?range=1h", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if body["routeId"].(string) != "route-x" {
		t.Errorf("routeId = %v, want route-x", body["routeId"])
	}

	sc := body["statCards"].(map[string]any)
	if int64(sc["totalRequests"].(float64)) != 200 {
		t.Errorf("totalRequests = %v, want 200 (route-x only)", sc["totalRequests"])
	}
	if int64(sc["errorCount"].(float64)) != 4 {
		t.Errorf("errorCount = %v, want 4", sc["errorCount"])
	}
	// Weighted avg latency: (40*150 + 60*50) / 200 = 9000/200 = 45
	avg := int64(sc["avgLatencyMs"].(float64))
	if avg < 44 || avg > 46 {
		t.Errorf("avgLatencyMs = %v, want ~45", avg)
	}

	// Time series should have data.
	ts := body["timeSeries"].([]any)
	if len(ts) == 0 {
		t.Error("timeSeries should be non-empty")
	}
}

func TestTrafficService_WithData(t *testing.T) {
	server, client, tsDrv, eng := setupTrafficTestServer(t)
	ctx := context.Background()

	// Create a service via engine.
	_, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name:      "my-svc",
					Upstreams: []*riokuv1.Upstream{{Address: "127.0.0.1:8080"}},
				},
			},
		},
	}, "test")
	if err != nil {
		t.Fatalf("create service: %v", err)
	}

	// Get the service ID from the snapshot.
	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after service create: %v", err)
	}
	if len(snap.GetServices()) != 1 {
		t.Fatalf("expected 1 service, got %d", len(snap.GetServices()))
	}
	svcID := snap.GetServices()[0].GetId()

	// Create 2 routes targeting this service.
	for i, name := range []string{"r-one", "r-two"} {
		_, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
			Operation: &riokuv1.ConfigChange_Route{
				Route: &riokuv1.RouteOp{
					Action: riokuv1.RouteOp_UPSERT,
					Route: &riokuv1.Route{
						Name:     name,
						Enabled:  true,
						Matchers: []*riokuv1.Matcher{{Hosts: []string{"example.com"}, Paths: []*riokuv1.PathMatcher{{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/" + name}}}},
						Target:   &riokuv1.Route_ServiceId{ServiceId: svcID},
					},
				},
			},
		}, "test")
		if err != nil {
			t.Fatalf("create route %d: %v", i, err)
		}
	}

	// Get the actual route IDs from the snapshot.
	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	var routeIDs []string
	for _, r := range snap.GetRoutes() {
		routeIDs = append(routeIDs, r.GetId())
	}
	if len(routeIDs) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(routeIDs))
	}

	// Seed route buckets for both routes + one unrelated.
	now := time.Now().UTC().Truncate(time.Minute)
	buckets := []tracestore.RouteBucket{
		{BucketStart: now.Add(-30 * time.Minute), RouteID: routeIDs[0], RequestCount: 100, ErrorCount: 2, AvgLatencyMS: 50},
		{BucketStart: now.Add(-30 * time.Minute), RouteID: routeIDs[1], RequestCount: 200, ErrorCount: 3, AvgLatencyMS: 60},
		{BucketStart: now.Add(-30 * time.Minute), RouteID: "unrelated-route", RequestCount: 999, ErrorCount: 99, AvgLatencyMS: 999},
	}
	for _, b := range buckets {
		if err := tsDrv.WriteRouteBucket(ctx, b); err != nil {
			t.Fatalf("WriteRouteBucket: %v", err)
		}
	}

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/traffic/services/"+svcID+"?range=1h", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if body["serviceId"].(string) != svcID {
		t.Errorf("serviceId = %v, want %s", body["serviceId"], svcID)
	}

	routeIDsResp := body["routeIds"].([]any)
	if len(routeIDsResp) != 2 {
		t.Errorf("routeIds length = %d, want 2", len(routeIDsResp))
	}

	sc := body["statCards"].(map[string]any)
	totalReq := int64(sc["totalRequests"].(float64))
	// 100 + 200 = 300, unrelated-route should not be counted.
	if totalReq != 300 {
		t.Errorf("totalRequests = %d, want 300 (unrelated route should be excluded)", totalReq)
	}
	if int64(sc["errorCount"].(float64)) != 5 {
		t.Errorf("errorCount = %v, want 5", sc["errorCount"])
	}
}
