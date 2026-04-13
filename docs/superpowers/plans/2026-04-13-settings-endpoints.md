# Settings Endpoints (GET-Only v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `GET /api/v1/settings` stub with 7 category-specific GET endpoints that read from the in-memory `*config.Config` struct, plus live store health. No file writes, no reload.

**Architecture:** New `settings_routes.go` file with `RegisterSettingsRoutes`. Each handler reads from `*config.Config` (passed at registration) and returns a JSON object. The store health endpoint additionally calls `store.Driver.Health()` and `CurrentVersion()`. The old monolithic settings stub is removed from `stub_routes.go`. All 7 endpoints require `settings:read` permission.

**Tech Stack:** Go 1.24, net/http, SQLite store

**Working directory:** `packages/daemon`

**Spec:** `docs/superpowers/specs/2026-04-12-rest-api-endpoints.md` (section #78)

**Key conventions:**
- Go standard library preferred, no external test libraries
- Table-driven tests, real databases for integration tests
- Handle every error explicitly, `-race` flag on all tests
- Conventional Commits required, no AI references in commits
- TDD: write test first, verify it fails, then implement

---

## Task 1: Create settings_routes.go with RegisterSettingsRoutes and general endpoint

**Files:**
- Create: `packages/daemon/internal/gateway/settings_routes.go`
- Create: `packages/daemon/internal/gateway/settings_routes_test.go`

- [ ] **Step 1: Write failing test for GET /api/v1/settings/general**

Create `packages/daemon/internal/gateway/settings_routes_test.go`:

```go
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
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func setupSettingsTestServer(t *testing.T) (*httptest.Server, store.Driver, string, *http.Client) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "settings_routes.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

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

	startedAt := time.Now().UTC()

	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterSettingsRoutes(mux, cfg, drv, startedAt)

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

	return server, drv, rootPassword, client
}

func TestGetSettings_General(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/general", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get settings/general: status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// logLevel should come from config defaults.
	if body["logLevel"] != "info" {
		t.Errorf("logLevel = %v, want info", body["logLevel"])
	}
	// daemonVersion should be a non-empty string.
	if v, ok := body["daemonVersion"].(string); !ok || v == "" {
		t.Errorf("daemonVersion missing or empty: %v", body["daemonVersion"])
	}
	// goVersion should start with "go".
	if v, ok := body["goVersion"].(string); !ok || len(v) < 2 || v[:2] != "go" {
		t.Errorf("goVersion unexpected: %v", body["goVersion"])
	}
	// uptimeSeconds should be >= 0.
	if u, ok := body["uptimeSeconds"].(float64); !ok || u < 0 {
		t.Errorf("uptimeSeconds unexpected: %v", body["uptimeSeconds"])
	}
}
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestGetSettings_General"
```

Expected: FAIL — `RegisterSettingsRoutes` not defined.

- [ ] **Step 3: Create settings_routes.go with general endpoint**

Create `packages/daemon/internal/gateway/settings_routes.go`:

```go
package gateway

import (
	"encoding/json"
	"net/http"
	"runtime"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/version"
)

// RegisterSettingsRoutes registers GET-only settings endpoints.
// All endpoints require settings:read permission.
func RegisterSettingsRoutes(mux *http.ServeMux, cfg *config.Config, st store.Driver, startedAt time.Time) {
	mux.Handle("GET /api/v1/settings/general", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsGeneral(cfg, startedAt))))
}

func handleSettingsGeneral(cfg *config.Config, startedAt time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]any{
			"logLevel":       cfg.LogLevel,
			"dataDir":        cfg.DataDir,
			"daemonVersion":  version.Version,
			"goVersion":      runtime.Version(),
			"uptimeSeconds":  int(time.Since(startedAt).Seconds()),
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
```

- [ ] **Step 4: Run test**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestGetSettings_General"
```

Expected: PASS

- [ ] **Step 5: Commit**

```
feat(gateway): add settings/general endpoint
```

---

## Task 2: Add remaining 6 settings endpoints (network, store, auth, traces, pki, caddy)

**Files:**
- Modify: `packages/daemon/internal/gateway/settings_routes.go`
- Modify: `packages/daemon/internal/gateway/settings_routes_test.go`

- [ ] **Step 1: Write tests for all 6 remaining endpoints plus an all-endpoints test**

Add to `settings_routes_test.go`:

```go
func TestGetSettings_Network(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/network", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["grpcAddress"] == nil {
		t.Error("grpcAddress missing")
	}
	if body["restAddress"] == nil {
		t.Error("restAddress missing")
	}
}

func TestGetSettings_Store(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/store", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := body["driver"].(string); !ok {
		t.Error("driver missing or not a string")
	}
	if _, ok := body["healthy"].(bool); !ok {
		t.Error("healthy missing or not a bool")
	}
	if _, ok := body["migrationVersion"].(float64); !ok {
		t.Error("migrationVersion missing or not a number")
	}
}

func TestGetSettings_Auth(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/auth", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	pp, ok := body["passwordPolicy"].(map[string]any)
	if !ok {
		t.Fatal("passwordPolicy missing or not an object")
	}
	if pp["minLength"] == nil {
		t.Error("passwordPolicy.minLength missing")
	}
	lo, ok := body["lockout"].(map[string]any)
	if !ok {
		t.Fatal("lockout missing or not an object")
	}
	if lo["maxAttempts"] == nil {
		t.Error("lockout.maxAttempts missing")
	}
}

func TestGetSettings_Traces(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/traces", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["store"] == nil {
		t.Error("store field missing")
	}
}

func TestGetSettings_PKI(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/pki", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["keyAlgorithm"] == nil {
		t.Error("keyAlgorithm missing")
	}
}

func TestGetSettings_Caddy(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/caddy", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["adminAddr"] == nil {
		t.Error("adminAddr missing")
	}
}

func TestGetSettings_AllEndpoints(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	endpoints := []string{
		"/api/v1/settings/general",
		"/api/v1/settings/network",
		"/api/v1/settings/store",
		"/api/v1/settings/auth",
		"/api/v1/settings/traces",
		"/api/v1/settings/pki",
		"/api/v1/settings/caddy",
	}

	for _, ep := range endpoints {
		t.Run(ep, func(t *testing.T) {
			resp := doJSON(t, client, http.MethodGet, server.URL+ep, nil)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusOK {
				t.Errorf("%s: status %d, want 200", ep, resp.StatusCode)
			}
			if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
				t.Errorf("%s: Content-Type = %q, want application/json", ep, ct)
			}
		})
	}
}

func TestGetSettings_Unauthenticated(t *testing.T) {
	server, _, _, _ := setupSettingsTestServer(t)

	// Fresh client without session cookie.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	noAuthClient := &http.Client{Jar: jar}

	resp := doJSON(t, noAuthClient, http.MethodGet, server.URL+"/api/v1/settings/general", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated settings: status %d, want 401", resp.StatusCode)
	}
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestGetSettings"
```

Expected: General passes, rest fail (routes not registered).

- [ ] **Step 3: Add remaining 6 handlers to settings_routes.go**

In `settings_routes.go`, add routes to `RegisterSettingsRoutes`:

```go
func RegisterSettingsRoutes(mux *http.ServeMux, cfg *config.Config, st store.Driver, startedAt time.Time) {
	mux.Handle("GET /api/v1/settings/general", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsGeneral(cfg, startedAt))))
	mux.Handle("GET /api/v1/settings/network", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsNetwork(cfg))))
	mux.Handle("GET /api/v1/settings/store", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsStore(cfg, st))))
	mux.Handle("GET /api/v1/settings/auth", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsAuth(cfg))))
	mux.Handle("GET /api/v1/settings/traces", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsTraces(cfg))))
	mux.Handle("GET /api/v1/settings/pki", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsPKI(cfg))))
	mux.Handle("GET /api/v1/settings/caddy", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsCaddy(cfg))))
}
```

Add each handler:

```go
func handleSettingsNetwork(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]any{
			"grpcAddress":  cfg.Listen.GRPC,
			"restAddress":  cfg.Listen.REST,
			"adminDomain":  cfg.Listen.AdminDomain,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsStore(cfg *config.Config, st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		h := st.Health(ctx)

		migVer, err := st.CurrentVersion(ctx)
		if err != nil {
			migVer = -1
		}

		resp := map[string]any{
			"driver":           cfg.Store.Driver,
			"connection":       storeConnection(cfg),
			"healthy":          h.OK,
			"migrationVersion": migVer,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsAuth(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]any{
			"passwordPolicy": map[string]any{
				"minLength":        cfg.Auth.PasswordPolicy.MinLength,
				"requireUppercase": cfg.Auth.PasswordPolicy.RequireUppercase,
				"requireLowercase": cfg.Auth.PasswordPolicy.RequireLowercase,
				"requireDigit":     cfg.Auth.PasswordPolicy.RequireDigit,
				"requireSpecial":   cfg.Auth.PasswordPolicy.RequireSpecial,
				"maxAgeDays":       cfg.Auth.PasswordPolicy.MaxAgeDays,
			},
			"lockout": map[string]any{
				"maxAttempts":            cfg.Auth.Lockout.MaxAttempts,
				"lockoutDurationMinutes": int(cfg.Auth.Lockout.LockoutDuration.Minutes()),
				"resetAfterMinutes":      int(cfg.Auth.Lockout.ResetAfter.Minutes()),
			},
			"rateLimit": map[string]any{
				"requestsPerMinute": cfg.Auth.RateLimit.RequestsPerMinute,
				"burstSize":         cfg.Auth.RateLimit.BurstSize,
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsTraces(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]any{
			"store":     cfg.Traces.Store,
			"retention": map[string]any{
				"requestTraces": cfg.Traces.Retention.RequestTraces.String(),
				"aiSessions":    cfg.Traces.Retention.AISessions.String(),
				"aggregates":    cfg.Traces.Retention.Aggregates.String(),
			},
		}
		if cfg.Traces.Sampling.Rate != nil {
			resp["samplingRate"] = *cfg.Traces.Sampling.Rate
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsPKI(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]any{
			"keyAlgorithm":      cfg.PKI.CA.KeyAlgorithm,
			"passphraseSource":  cfg.PKI.CA.KeyPassphraseSource,
			"caValidity":        cfg.PKI.CA.Validity.String(),
			"nodeValidity":      cfg.PKI.Node.Validity.String(),
			"rotationThreshold": cfg.PKI.Node.RotationThreshold.String(),
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsCaddy(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]any{
			"binary":       cfg.Caddy.Binary,
			"adminAddr":    cfg.Caddy.AdminAddr,
			"trafficAddrs": cfg.Caddy.TrafficAddrs,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
```

**Note:** `storeConnection` is already defined in `stub_routes.go` (same package). It returns a display-safe connection string. If the function is not accessible, check if it's in the same package — it should be since both files are in `package gateway`.

- [ ] **Step 4: Run all settings tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestGetSettings"
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```
feat(gateway): add settings endpoints for network, store, auth, traces, pki, caddy
```

---

## Task 3: Wire RegisterSettingsRoutes into gateway.go and remove old settings stub

**Files:**
- Modify: `packages/daemon/internal/gateway/gateway.go`
- Modify: `packages/daemon/internal/gateway/stub_routes.go`

- [ ] **Step 1: Add RegisterSettingsRoutes call to gateway.go**

In `packages/daemon/internal/gateway/gateway.go`, in `NewGateway`, after the `RegisterStubRoutes` call (line ~109), add:

```go
	// Settings endpoints (replaces old monolithic GET /api/v1/settings stub).
	RegisterSettingsRoutes(topMux, cfg, st, time.Now().UTC())
```

Ensure `time` is imported.

- [ ] **Step 2: Remove the old settings stub from stub_routes.go**

In `packages/daemon/internal/gateway/stub_routes.go`, remove:
- The `mux.HandleFunc("GET /api/v1/settings", ...)` line from `RegisterStubRoutes`
- The `handleStubSettings` function

**Keep** `storeConnection` and `formatDuration` helper functions — `storeConnection` is used by the new settings store handler, and `formatDuration` may be useful elsewhere.

**Keep** the other stub routes (cluster, plugins) unchanged.

- [ ] **Step 3: Build to verify compilation**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go build ./...
```

- [ ] **Step 4: Run full gateway test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/gateway/
```

Expected: All pass. Any test that called the old `GET /api/v1/settings` should now 404. Check if `contract_test.go` or any other test file references that endpoint and update accordingly.

- [ ] **Step 5: Commit**

```
refactor(gateway): wire settings routes and remove monolithic settings stub
```

---

## Task 4: Full verification

- [ ] **Step 1: Run complete daemon test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./...
```

Expected: All pass.

- [ ] **Step 2: Verify build**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && make build-daemon
```

Expected: Binary builds cleanly.

- [ ] **Step 3: Commit (if any fixups needed)**

---

## Summary of all files modified/created

### Created:
- `packages/daemon/internal/gateway/settings_routes.go` — 7 GET handlers, `RegisterSettingsRoutes`
- `packages/daemon/internal/gateway/settings_routes_test.go` — 9 test functions

### Modified:
- `packages/daemon/internal/gateway/gateway.go` — Call `RegisterSettingsRoutes`
- `packages/daemon/internal/gateway/stub_routes.go` — Remove `handleStubSettings` and its route registration

### Commits (3-4 total):
1. `feat(gateway): add settings/general endpoint`
2. `feat(gateway): add settings endpoints for network, store, auth, traces, pki, caddy`
3. `refactor(gateway): wire settings routes and remove monolithic settings stub`
4. (optional) fixup from full verification
