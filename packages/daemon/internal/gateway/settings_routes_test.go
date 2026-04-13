package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
	"github.com/riokulabs/rioku/internal/version"
)

// setupSettingsTestServer creates a test server with auth + settings routes
// registered. Returns the server, store driver, root password, and an
// authenticated client.
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

	// Create root user (superadmin).
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

	// Assign superadmin role to root user.
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

	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterSettingsRoutes(mux, cfg, drv, time.Now().UTC())

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

	return server, drv, rootPassword, client
}

func TestGetSettings_General(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/general", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// logLevel must be a string.
	logLevel, ok := body["logLevel"].(string)
	if !ok || logLevel == "" {
		t.Errorf("logLevel: expected non-empty string, got %v", body["logLevel"])
	}
	if logLevel != "info" {
		t.Errorf("logLevel = %q, want %q", logLevel, "info")
	}

	// daemonVersion must match version.Version.
	dv, ok := body["daemonVersion"].(string)
	if !ok || dv == "" {
		t.Errorf("daemonVersion: expected non-empty string, got %v", body["daemonVersion"])
	}
	if dv != version.Version {
		t.Errorf("daemonVersion = %q, want %q", dv, version.Version)
	}

	// goVersion must match runtime.Version().
	gv, ok := body["goVersion"].(string)
	if !ok || gv == "" {
		t.Errorf("goVersion: expected non-empty string, got %v", body["goVersion"])
	}
	if gv != runtime.Version() {
		t.Errorf("goVersion = %q, want %q", gv, runtime.Version())
	}

	// uptimeSeconds must be a number >= 0.
	uptime, ok := body["uptimeSeconds"].(float64)
	if !ok {
		t.Errorf("uptimeSeconds: expected number, got %T", body["uptimeSeconds"])
	}
	if uptime < 0 {
		t.Errorf("uptimeSeconds = %v, want >= 0", uptime)
	}

	// dataDir must be present.
	if _, ok := body["dataDir"].(string); !ok {
		t.Errorf("dataDir: expected string, got %T", body["dataDir"])
	}
}

func TestGetSettings_Network(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/network", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	grpcAddr, ok := body["grpcAddress"].(string)
	if !ok || grpcAddr == "" {
		t.Errorf("grpcAddress: expected non-empty string, got %v", body["grpcAddress"])
	}
	if grpcAddr != ":7777" {
		t.Errorf("grpcAddress = %q, want %q", grpcAddr, ":7777")
	}

	restAddr, ok := body["restAddress"].(string)
	if !ok || restAddr == "" {
		t.Errorf("restAddress: expected non-empty string, got %v", body["restAddress"])
	}
	if restAddr != ":7778" {
		t.Errorf("restAddress = %q, want %q", restAddr, ":7778")
	}

	// adminDomain may be empty but must be a string.
	if _, ok := body["adminDomain"]; !ok {
		t.Error("adminDomain field missing")
	}
}

func TestGetSettings_Store(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/store", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// driver must be a string (the test uses sqlite).
	driver, ok := body["driver"].(string)
	if !ok || driver == "" {
		t.Errorf("driver: expected non-empty string, got %v", body["driver"])
	}

	// healthy must be a bool.
	healthy, ok := body["healthy"].(bool)
	if !ok {
		t.Errorf("healthy: expected bool, got %T", body["healthy"])
	}
	if !healthy {
		t.Error("healthy: expected true for open sqlite store")
	}

	// migrationVersion must be a number > 0.
	migVer, ok := body["migrationVersion"].(float64)
	if !ok {
		t.Errorf("migrationVersion: expected number, got %T", body["migrationVersion"])
	}
	if migVer <= 0 {
		t.Errorf("migrationVersion = %v, want > 0", migVer)
	}

	// connection must be present as string.
	if _, ok := body["connection"].(string); !ok {
		t.Errorf("connection: expected string, got %T", body["connection"])
	}
}

func TestGetSettings_Auth(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/auth", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// passwordPolicy.minLength must be a number.
	pp, ok := body["passwordPolicy"].(map[string]interface{})
	if !ok {
		t.Fatalf("passwordPolicy: expected object, got %T", body["passwordPolicy"])
	}
	minLen, ok := pp["minLength"].(float64)
	if !ok {
		t.Errorf("passwordPolicy.minLength: expected number, got %T", pp["minLength"])
	}
	if minLen != 12 {
		t.Errorf("passwordPolicy.minLength = %v, want 12", minLen)
	}

	// Verify boolean fields.
	if _, ok := pp["requireUppercase"].(bool); !ok {
		t.Errorf("passwordPolicy.requireUppercase: expected bool, got %T", pp["requireUppercase"])
	}
	if _, ok := pp["requireLowercase"].(bool); !ok {
		t.Errorf("passwordPolicy.requireLowercase: expected bool, got %T", pp["requireLowercase"])
	}
	if _, ok := pp["requireDigit"].(bool); !ok {
		t.Errorf("passwordPolicy.requireDigit: expected bool, got %T", pp["requireDigit"])
	}

	// lockout.maxAttempts must be a number.
	lockout, ok := body["lockout"].(map[string]interface{})
	if !ok {
		t.Fatalf("lockout: expected object, got %T", body["lockout"])
	}
	maxAttempts, ok := lockout["maxAttempts"].(float64)
	if !ok {
		t.Errorf("lockout.maxAttempts: expected number, got %T", lockout["maxAttempts"])
	}
	if maxAttempts != 5 {
		t.Errorf("lockout.maxAttempts = %v, want 5", maxAttempts)
	}

	// lockout.lockoutDurationMinutes must be a number.
	if _, ok := lockout["lockoutDurationMinutes"].(float64); !ok {
		t.Errorf("lockout.lockoutDurationMinutes: expected number, got %T", lockout["lockoutDurationMinutes"])
	}

	// rateLimit must be present.
	rl, ok := body["rateLimit"].(map[string]interface{})
	if !ok {
		t.Fatalf("rateLimit: expected object, got %T", body["rateLimit"])
	}
	if _, ok := rl["requestsPerMinute"].(float64); !ok {
		t.Errorf("rateLimit.requestsPerMinute: expected number, got %T", rl["requestsPerMinute"])
	}
}

func TestGetSettings_Traces(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/traces", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// store must be present as string.
	traceStore, ok := body["store"].(string)
	if !ok || traceStore == "" {
		t.Errorf("store: expected non-empty string, got %v", body["store"])
	}
	if traceStore != "sqlite" {
		t.Errorf("store = %q, want %q", traceStore, "sqlite")
	}

	// retention must be present as object with duration strings.
	retention, ok := body["retention"].(map[string]interface{})
	if !ok {
		t.Fatalf("retention: expected object, got %T", body["retention"])
	}
	for _, field := range []string{"requestTraces", "aiSessions", "aggregates"} {
		if _, ok := retention[field].(string); !ok {
			t.Errorf("retention.%s: expected string, got %T", field, retention[field])
		}
	}

	// samplingRate should be present since Default() sets it.
	sr, ok := body["samplingRate"].(float64)
	if !ok {
		t.Errorf("samplingRate: expected number, got %T", body["samplingRate"])
	}
	if sr != 1.0 {
		t.Errorf("samplingRate = %v, want 1.0", sr)
	}
}

func TestGetSettings_PKI(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/pki", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	keyAlg, ok := body["keyAlgorithm"].(string)
	if !ok || keyAlg == "" {
		t.Errorf("keyAlgorithm: expected non-empty string, got %v", body["keyAlgorithm"])
	}
	if keyAlg != "ecdsa-p256" {
		t.Errorf("keyAlgorithm = %q, want %q", keyAlg, "ecdsa-p256")
	}

	if _, ok := body["passphraseSource"].(string); !ok {
		t.Errorf("passphraseSource: expected string, got %T", body["passphraseSource"])
	}

	if _, ok := body["caValidity"].(string); !ok {
		t.Errorf("caValidity: expected string, got %T", body["caValidity"])
	}

	if _, ok := body["nodeValidity"].(string); !ok {
		t.Errorf("nodeValidity: expected string, got %T", body["nodeValidity"])
	}

	if _, ok := body["rotationThreshold"].(string); !ok {
		t.Errorf("rotationThreshold: expected string, got %T", body["rotationThreshold"])
	}
}

func TestGetSettings_Caddy(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/settings/caddy", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	adminAddr, ok := body["adminAddr"].(string)
	if !ok || adminAddr == "" {
		t.Errorf("adminAddr: expected non-empty string, got %v", body["adminAddr"])
	}
	if adminAddr != "localhost:2019" {
		t.Errorf("adminAddr = %q, want %q", adminAddr, "localhost:2019")
	}

	if _, ok := body["binary"].(string); !ok {
		t.Errorf("binary: expected string, got %T", body["binary"])
	}

	addrs, ok := body["trafficAddrs"].([]interface{})
	if !ok {
		t.Errorf("trafficAddrs: expected array, got %T", body["trafficAddrs"])
	}
	if len(addrs) == 0 {
		t.Error("trafficAddrs: expected non-empty array")
	}
}

func TestGetSettings_AllEndpoints(t *testing.T) {
	server, _, _, client := setupSettingsTestServer(t)

	paths := []string{
		"/api/v1/settings/general",
		"/api/v1/settings/network",
		"/api/v1/settings/store",
		"/api/v1/settings/auth",
		"/api/v1/settings/traces",
		"/api/v1/settings/pki",
		"/api/v1/settings/caddy",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			resp := doJSON(t, client, http.MethodGet, server.URL+path, nil)
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusOK {
				t.Fatalf("expected 200, got %d", resp.StatusCode)
			}
			ct := resp.Header.Get("Content-Type")
			if ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}

			// Verify body is valid JSON.
			var body map[string]interface{}
			if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if len(body) == 0 {
				t.Error("expected non-empty JSON object")
			}
		})
	}
}

func TestGetSettings_Unauthenticated(t *testing.T) {
	server, _, _, _ := setupSettingsTestServer(t)

	// Fresh client without session cookie.
	unauthClient := &http.Client{}

	paths := []string{
		"/api/v1/settings/general",
		"/api/v1/settings/network",
		"/api/v1/settings/store",
		"/api/v1/settings/auth",
		"/api/v1/settings/traces",
		"/api/v1/settings/pki",
		"/api/v1/settings/caddy",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			resp := doJSON(t, unauthClient, http.MethodGet, server.URL+path, nil)
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d", resp.StatusCode)
			}
		})
	}
}
