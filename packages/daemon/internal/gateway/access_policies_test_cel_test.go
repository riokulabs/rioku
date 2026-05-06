// Tests for the access-policies test-cel endpoint.
//
// The endpoint is real: it compiles and evaluates the supplied CEL expression
// against the provided sample using cel-go. The tests exercise the matched /
// not-matched paths, syntax errors, runtime errors, non-bool results, and the
// 400 envelope path.
package gateway

import (
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

// setupTestCelServer wires up the access-policies test-cel endpoint behind
// the same auth middleware used by the CRUD tests. Returns an authenticated
// client signed in as `root`.
func setupTestCelServer(t *testing.T) (*httptest.Server, *http.Client) {
	t.Helper()
	ctx := t.Context()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	if err := drv.Open(ctx, store.DriverConfig{Path: filepath.Join(t.TempDir(), "tc.db")}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	rootPassword := "TestPassword123!"
	hash := cachedHashPassword(t, rootPassword)
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	rootUser, err := tx.CreateUser(ctx, &store.User{
		Username: "root", PasswordHash: hash, Status: "active",
		ForcePasswordChange: false, PasswordChangedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	roles, _ := tx.ListRoles(ctx)
	var superID string
	for _, r := range roles {
		if r.Name == "superadmin" {
			superID = r.ID
		}
	}
	if err := tx.AssignRole(ctx, rootUser.ID, superID, ""); err != nil {
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

	encKey, _ := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	enc, _ := auth.NewEncryptor(encKey)

	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterAccessPolicyTestCelRoutes(mux)

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

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login",
		map[string]string{"username": "root", "password": rootPassword})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login: %d", resp.StatusCode)
	}
	return server, client
}

// decodeTestCelResponse reads a JSON response body into testCelResponse.
func decodeTestCelResponse(t *testing.T, resp *http.Response) testCelResponse {
	t.Helper()
	var out testCelResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func TestTestCEL_MatchedTrue(t *testing.T) {
	server, client := setupTestCelServer(t)
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies/test-cel",
		map[string]any{
			"expression": `request.method == "GET"`,
			"sample":     map[string]any{"request": map[string]any{"method": "GET"}},
		})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	body := decodeTestCelResponse(t, resp)
	if !body.Matched {
		t.Errorf("expected matched=true, got %+v", body)
	}
	if body.Error != "" {
		t.Errorf("expected no error, got %q", body.Error)
	}
	if body.DurationMs < 0 {
		t.Errorf("durationMs negative: %v", body.DurationMs)
	}
}

func TestTestCEL_MatchedFalse(t *testing.T) {
	server, client := setupTestCelServer(t)
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies/test-cel",
		map[string]any{
			"expression": `request.method == "POST"`,
			"sample":     map[string]any{"request": map[string]any{"method": "GET"}},
		})
	defer func() { _ = resp.Body.Close() }()
	body := decodeTestCelResponse(t, resp)
	if body.Matched {
		t.Errorf("expected matched=false, got %+v", body)
	}
	if body.Error != "" {
		t.Errorf("expected no error, got %q", body.Error)
	}
}

func TestTestCEL_TenantScopedPath(t *testing.T) {
	server, client := setupTestCelServer(t)
	// Tenant-scoped path should accept the same body and return the same shape.
	resp := doJSON(t, client, http.MethodPost,
		server.URL+"/api/v1/t/default/access-policies/test-cel",
		map[string]any{
			"expression": `1 + 1 == 2`,
			"sample":     map[string]any{},
		})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	body := decodeTestCelResponse(t, resp)
	if !body.Matched {
		t.Errorf("expected matched=true, got %+v", body)
	}
}

func TestTestCEL_SyntaxError(t *testing.T) {
	server, client := setupTestCelServer(t)
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies/test-cel",
		map[string]any{
			"expression": `request.method ==`, // truncated
			"sample":     map[string]any{},
		})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for syntax error, got %d", resp.StatusCode)
	}
	body := decodeTestCelResponse(t, resp)
	if body.Matched {
		t.Errorf("matched should be false on syntax error, got %+v", body)
	}
	if body.Error == "" {
		t.Errorf("expected error string for syntax error, got empty")
	}
}

func TestTestCEL_NonBoolResult(t *testing.T) {
	server, client := setupTestCelServer(t)
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies/test-cel",
		map[string]any{
			"expression": `1 + 1`, // int — not a bool
			"sample":     map[string]any{},
		})
	defer func() { _ = resp.Body.Close() }()
	body := decodeTestCelResponse(t, resp)
	if body.Matched {
		t.Errorf("non-bool result must not match, got %+v", body)
	}
	if body.Error == "" {
		t.Errorf("expected error explaining non-bool result")
	}
}

func TestTestCEL_BadEnvelope_NotJSON(t *testing.T) {
	server, client := setupTestCelServer(t)
	req, _ := http.NewRequest(http.MethodPost,
		server.URL+"/api/v1/auth/access-policies/test-cel",
		http.NoBody)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	// Empty body fails JSON decode → 400.
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty body, got %d", resp.StatusCode)
	}
}

func TestTestCEL_BadEnvelope_EmptyExpression(t *testing.T) {
	server, client := setupTestCelServer(t)
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies/test-cel",
		map[string]any{
			"expression": "",
			"sample":     map[string]any{},
		})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty expression, got %d", resp.StatusCode)
	}
}

func TestTestCEL_TopLevelHoisting(t *testing.T) {
	// Caller wrote `foo == "bar"` instead of `sample.foo == "bar"`. Both forms
	// must work because the daemon hoists top-level keys into the activation.
	server, client := setupTestCelServer(t)
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies/test-cel",
		map[string]any{
			"expression": `foo == "bar"`,
			"sample":     map[string]any{"foo": "bar"},
		})
	defer func() { _ = resp.Body.Close() }()
	body := decodeTestCelResponse(t, resp)
	if !body.Matched || body.Error != "" {
		t.Errorf("expected matched without error, got %+v", body)
	}

	// And via `sample.foo` — same input, different write.
	resp2 := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies/test-cel",
		map[string]any{
			"expression": `sample.foo == "bar"`,
			"sample":     map[string]any{"foo": "bar"},
		})
	defer func() { _ = resp2.Body.Close() }()
	body2 := decodeTestCelResponse(t, resp2)
	if !body2.Matched || body2.Error != "" {
		t.Errorf("expected matched via sample.foo, got %+v", body2)
	}
}
