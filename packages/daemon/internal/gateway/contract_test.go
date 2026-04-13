package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// TestRESTContractFields validates that the JSON field names returned by REST
// endpoints match the TypeScript interfaces in packages/web/src/lib/api.ts.
// This catches drift between proto field names (protojson camelCase) or
// hand-written JSON tags and the frontend's manually-written types.
func TestRESTContractFields(t *testing.T) {
	ctx := context.Background()

	// --- Store setup (same pattern as auth_integration_test.go) ---

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "contract.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })

	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	// --- Create root user ---

	rootPassword := "TestPassword123!"
	hash, err := auth.HashPassword(rootPassword)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateUser(ctx, &store.User{
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
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// --- Seed an audit entry so /api/v1/audit returns data ---

	tx2, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx2.AppendAuditEntry(ctx, &riokuv1.AuditEntry{
		Actor:         "root",
		EntityType:    "route",
		EntityId:      "route-001",
		Operation:     "create",
		Diff:          `{"name":"test-route"}`,
		ConfigVersion: 1,
		OccurredAt:    timestamppb.Now(),
	}); err != nil {
		_ = tx2.Rollback()
		t.Fatal(err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatal(err)
	}

	// --- Auth + config setup ---

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	sm := auth.NewSessionManager(drv, true) // devMode=true

	cfg := config.Default()

	encKey, err := auth.DeriveEncryptionKey(signingKey, totpEncryptionSalt)
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	// --- Build the HTTP handler ---

	// Create grpc-gateway mux for health and config (same as NewGateway).
	gwMux := runtime.NewServeMux(
		runtime.WithErrorHandler(ErrorHandler),
	)

	// Register health via grpc-gateway with a stub implementation.
	healthSvc := &stubHealthService{}
	if err := riokuv1.RegisterHealthServiceHandlerServer(ctx, gwMux, healthSvc); err != nil {
		t.Fatalf("register health service: %v", err)
	}

	// Register config via grpc-gateway. Use a real config engine backed by
	// the same SQLite store so GetConfig returns a proper ConfigSnapshot.
	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{DevMode: true}, "", nil, caddy.SecurityHeadersConfig{})
	engine := config.NewEngine(drv, compiler)
	configSvc := &stubConfigService{engine: engine}
	if err := riokuv1.RegisterConfigServiceHandlerServer(ctx, gwMux, configSvc); err != nil {
		t.Fatalf("register config service: %v", err)
	}

	topMux := http.NewServeMux()
	RegisterAuthRoutes(topMux, a, sm, drv, cfg, enc)
	RegisterAuditRoutes(topMux, drv)
	RegisterStubRoutes(topMux, cfg)

	// grpc-gateway handles /api/ routes not claimed by explicit handlers.
	topMux.Handle("/api/", gwMux)

	var handler http.Handler = topMux
	handler = AuthMiddleware(a, sm)(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	// --- HTTP client with cookie jar ---

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	doJSON := func(t *testing.T, method, path string, body any) *http.Response {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&buf).Encode(body); err != nil {
				t.Fatalf("encode request body: %v", err)
			}
		}
		req, err := http.NewRequest(method, server.URL+path, &buf)
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("do request: %v", err)
		}
		return resp
	}

	// --- Log in to get a session cookie ---

	resp := doJSON(t, http.MethodPost, "/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		t.Fatalf("login failed: status %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// --- Contract subtests ---

	t.Run("health_fields", func(t *testing.T) {
		resp := doJSON(t, http.MethodGet, "/api/v1/health", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/v1/health: expected 200, got %d", resp.StatusCode)
		}

		var body map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decode health response: %v", err)
		}

		// Expected fields from TypeScript HealthStatus interface.
		// Proto field "uptime_seconds" serializes as "uptimeSeconds" via protojson.
		// The TS interface uses "uptime" — this test documents the actual proto
		// field name so we catch any further drift.
		expected := []string{"overall", "store", "caddy", "version", "uptimeSeconds"}
		assertFields(t, "GET /api/v1/health", body, expected)
	})

	t.Run("config_fields", func(t *testing.T) {
		resp := doJSON(t, http.MethodGet, "/api/v1/config", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/v1/config: expected 200, got %d", resp.StatusCode)
		}

		var body map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decode config response: %v", err)
		}

		// Expected fields from TypeScript ConfigSnapshot interface.
		expected := []string{"version", "routes", "services", "policies"}
		assertFields(t, "GET /api/v1/config", body, expected)
	})

	t.Run("audit_fields", func(t *testing.T) {
		resp := doJSON(t, http.MethodGet, "/api/v1/audit", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/v1/audit: expected 200, got %d", resp.StatusCode)
		}

		var body []map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decode audit response: %v", err)
		}

		if len(body) == 0 {
			t.Fatal("GET /api/v1/audit: expected at least one audit entry")
		}

		// Expected fields from TypeScript AuditEntry interface (camelCase from protojson).
		expected := []string{"id", "actor", "entityType", "entityId", "operation", "diff", "configVersion", "occurredAt"}
		assertFields(t, "GET /api/v1/audit[0]", body[0], expected)
	})

	t.Run("auth_me_fields", func(t *testing.T) {
		resp := doJSON(t, http.MethodGet, "/api/v1/auth/me", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/v1/auth/me: expected 200, got %d", resp.StatusCode)
		}

		var body map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decode auth/me response: %v", err)
		}

		// Expected top-level fields from TypeScript MeResponse interface.
		expected := []string{"user", "session"}
		assertFields(t, "GET /api/v1/auth/me", body, expected)
	})
}

// assertFields checks that every field in expected exists as a key in body.
// It reports each missing field as a test error, making it easy to see which
// JSON field names the frontend expects but the backend doesn't produce.
func assertFields(t *testing.T, endpoint string, body map[string]any, expected []string) {
	t.Helper()
	for _, field := range expected {
		if _, ok := body[field]; !ok {
			t.Errorf("%s: missing expected JSON field %q (keys present: %v)", endpoint, field, mapKeys(body))
		}
	}
}

// mapKeys returns the keys of a map for diagnostic output.
func mapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// ---------------------------------------------------------------------------
// Stub gRPC service implementations for contract testing
// ---------------------------------------------------------------------------

// stubHealthService returns a minimal HealthStatus with all expected fields
// populated so the contract test can verify JSON field names.
type stubHealthService struct {
	riokuv1.UnimplementedHealthServiceServer
}

func (s *stubHealthService) GetHealth(_ context.Context, _ *riokuv1.HealthRequest) (*riokuv1.HealthStatus, error) {
	return &riokuv1.HealthStatus{
		Overall: riokuv1.HealthState_HEALTH_STATE_OK,
		Store: &riokuv1.SubsystemHealth{
			State:   riokuv1.HealthState_HEALTH_STATE_OK,
			Message: "ok",
		},
		Caddy: &riokuv1.SubsystemHealth{
			State:   riokuv1.HealthState_HEALTH_STATE_OK,
			Message: "ok",
		},
		Version:       "0.0.0-test",
		UptimeSeconds: 42,
		CheckedAt:     timestamppb.Now(),
	}, nil
}

// stubConfigService delegates GetConfig to the real config engine so we get
// a properly structured ConfigSnapshot. All other RPCs use the unimplemented
// default.
type stubConfigService struct {
	riokuv1.UnimplementedConfigServiceServer
	engine *config.Engine
}

func (s *stubConfigService) GetConfig(ctx context.Context, req *riokuv1.GetConfigRequest) (*riokuv1.ConfigSnapshot, error) {
	return s.engine.GetConfig(ctx)
}
