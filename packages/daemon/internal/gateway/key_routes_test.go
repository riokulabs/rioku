package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// setupKeyTestServer creates a fully wired test server with auth middleware,
// auth routes (for login), and key routes. Returns the server, store driver,
// root password, and an authenticated HTTP client (logged in as root).
func setupKeyTestServer(t *testing.T) (*httptest.Server, store.Driver, string, *http.Client) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "key_routes.db")
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
	RegisterKeyRoutes(mux, drv)

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

	// Log in as root to get an authenticated session.
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
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("root login: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	return server, drv, rootPassword, client
}

// createKeyViaAPI is a test helper that creates an API key and returns the id
// and raw key from the response.
func createKeyViaAPI(t *testing.T, client *http.Client, serverURL string, body map[string]string) (string, string) {
	t.Helper()
	resp := doJSON(t, client, http.MethodPost, serverURL+"/api/v1/keys", body)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("create key: expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}
	var result map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode create key response: %v", err)
	}
	return result["id"], result["key"]
}

func TestKeyRoutes_CreateKey(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"name": "test-key",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var result map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result["id"] == "" {
		t.Error("expected non-empty id in response")
	}
	if !strings.HasPrefix(result["key"], "rku_tok_") {
		t.Errorf("key = %q, want prefix rku_tok_", result["key"])
	}
}

func TestKeyRoutes_CreateKey_WithScopes(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	// Create a key with custom scopes.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"name":   "scoped-key",
		"scopes": "read,write",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}

	// List keys and verify the scopes.
	listResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/keys", nil)
	defer func() { _ = listResp.Body.Close() }()

	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list keys: expected 200, got %d", listResp.StatusCode)
	}

	var keys []map[string]any
	if err := json.NewDecoder(listResp.Body).Decode(&keys); err != nil {
		t.Fatalf("decode list response: %v", err)
	}

	var found bool
	for _, k := range keys {
		if k["name"] == "scoped-key" {
			found = true
			scopes, ok := k["scopes"].([]any)
			if !ok {
				t.Fatalf("expected scopes to be array, got %T", k["scopes"])
			}
			if len(scopes) != 2 {
				t.Fatalf("expected 2 scopes, got %d", len(scopes))
			}
			if scopes[0] != "read" || scopes[1] != "write" {
				t.Errorf("scopes = %v, want [read, write]", scopes)
			}
		}
	}
	if !found {
		t.Error("scoped-key not found in key list")
	}
}

func TestKeyRoutes_CreateKey_WithExpires(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"name":    "expiring-key",
		"expires": "24h",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var result map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result["id"] == "" {
		t.Error("expected non-empty id in response")
	}
	if result["key"] == "" {
		t.Error("expected non-empty key in response")
	}
}

func TestKeyRoutes_CreateKey_InvalidExpires(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"name":    "bad-expiry",
		"expires": "invalid",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 400 {
		t.Errorf("problem status = %d, want 400", pd.Status)
	}
	if !strings.Contains(pd.Detail, "Invalid expiration duration") {
		t.Errorf("detail = %q, want it to contain 'Invalid expiration duration'", pd.Detail)
	}
}

func TestKeyRoutes_CreateKey_MissingName(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"scopes": "read",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 400 {
		t.Errorf("problem status = %d, want 400", pd.Status)
	}
	if !strings.Contains(pd.Detail, "Key name is required") {
		t.Errorf("detail = %q, want it to contain 'Key name is required'", pd.Detail)
	}
}

func TestKeyRoutes_CreateKey_InvalidJSON(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/keys",
		bytes.NewBufferString("{not valid json"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 400 {
		t.Errorf("problem status = %d, want 400", pd.Status)
	}
}

func TestKeyRoutes_ListKeys(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	// Create two keys.
	createKeyViaAPI(t, client, server.URL, map[string]string{"name": "key-one"})
	createKeyViaAPI(t, client, server.URL, map[string]string{"name": "key-two"})

	// List keys.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/keys", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var keys []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&keys); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(keys))
	}

	// Verify each key has the expected fields.
	names := make(map[string]bool)
	for _, k := range keys {
		if k["id"] == nil || k["id"] == "" {
			t.Error("expected non-empty id")
		}
		if k["name"] == nil || k["name"] == "" {
			t.Error("expected non-empty name")
		}
		if k["createdAt"] == nil || k["createdAt"] == "" {
			t.Error("expected non-empty createdAt")
		}
		if k["scopes"] == nil {
			t.Error("expected scopes field")
		}
		names[k["name"].(string)] = true
	}
	if !names["key-one"] || !names["key-two"] {
		t.Errorf("expected keys key-one and key-two, got %v", names)
	}
}

func TestKeyRoutes_ListKeys_FiltersInternalTokens(t *testing.T) {
	server, drv, _, client := setupKeyTestServer(t)
	ctx := context.Background()

	// Directly insert internal tokens into the store (bootstrap and refresh tokens).
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateAPIKey(ctx, "bootstrap", auth.HashToken("fake-bootstrap"), []string{"admin"}, nil, "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	_, err = tx.CreateAPIKey(ctx, "refresh:user123", auth.HashToken("fake-refresh"), []string{"refresh"}, nil, "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// Also create a normal user key.
	createKeyViaAPI(t, client, server.URL, map[string]string{"name": "visible-key"})

	// List keys — internal tokens should be filtered out.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/keys", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var keys []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&keys); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	for _, k := range keys {
		name := k["name"].(string)
		if name == "bootstrap" {
			t.Error("bootstrap token should be filtered from list")
		}
		if strings.HasPrefix(name, "refresh:") {
			t.Errorf("refresh token %q should be filtered from list", name)
		}
	}
	if len(keys) != 1 {
		t.Fatalf("expected 1 visible key, got %d", len(keys))
	}
	if keys[0]["name"] != "visible-key" {
		t.Errorf("expected visible-key, got %q", keys[0]["name"])
	}
}

func TestKeyRoutes_RevokeKey(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	// Create a key.
	id, _ := createKeyViaAPI(t, client, server.URL, map[string]string{"name": "to-revoke"})

	// Revoke it.
	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/keys/"+id, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 204, got %d: %s", resp.StatusCode, pd.Detail)
	}
}

func TestKeyRoutes_RevokeKey_EmptyID(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	// DELETE /api/v1/keys/ with no ID should return 400.
	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/keys/", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 400 {
		t.Errorf("problem status = %d, want 400", pd.Status)
	}
	if !strings.Contains(pd.Detail, "Key ID is required") {
		t.Errorf("detail = %q, want it to contain 'Key ID is required'", pd.Detail)
	}
}

func TestKeyRoutes_RevokeKey_AlreadyRevoked(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	// Create and revoke a key.
	id, _ := createKeyViaAPI(t, client, server.URL, map[string]string{"name": "double-revoke"})

	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/keys/"+id, nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("first revoke: expected 204, got %d", resp.StatusCode)
	}

	// Try to revoke again — should be 404.
	resp2 := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/keys/"+id, nil)
	defer func() { _ = resp2.Body.Close() }()

	if resp2.StatusCode != http.StatusNotFound {
		t.Fatalf("second revoke: expected 404, got %d", resp2.StatusCode)
	}
}

func TestKeyRoutes_RevokeKey_NotFound(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/keys/nonexistent-id", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 404 {
		t.Errorf("problem status = %d, want 404", pd.Status)
	}
}

func TestKeyRoutes_AuthWithKey(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	// Create a key.
	_, rawKey := createKeyViaAPI(t, client, server.URL, map[string]string{"name": "auth-key"})

	// Use the raw key as a Bearer token to access a protected endpoint.
	// We'll hit GET /api/v1/keys which requires authentication.
	unauthClient := &http.Client{}
	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/keys", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+rawKey)
	resp, err := unauthClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 200 with Bearer API key, got %d: %s", resp.StatusCode, pd.Detail)
	}
}

func TestKeyRoutes_Unauthenticated(t *testing.T) {
	server, _, _, _ := setupKeyTestServer(t)

	// Attempt to access key routes without authentication.
	unauthClient := &http.Client{}
	endpoints := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/keys"},
		{http.MethodGet, "/api/v1/keys"},
		{http.MethodDelete, "/api/v1/keys/some-id"},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+"_"+ep.path, func(t *testing.T) {
			var body *bytes.Buffer
			if ep.method == http.MethodPost {
				body = bytes.NewBufferString(`{"name":"test"}`)
			} else {
				body = &bytes.Buffer{}
			}
			req, err := http.NewRequest(ep.method, server.URL+ep.path, body)
			if err != nil {
				t.Fatal(err)
			}
			if ep.method == http.MethodPost {
				req.Header.Set("Content-Type", "application/json")
			}
			resp, err := unauthClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d", resp.StatusCode)
			}
		})
	}
}

func TestKeyRoutes_WriteInternalError(t *testing.T) {
	// Test writeInternalError directly to cover that utility function.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	req.Header.Set("X-Request-ID", "test-req-123")

	writeInternalError(rec, req, "test context")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	ct := rec.Header().Get("Content-Type")
	if ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(rec.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 500 {
		t.Errorf("problem status = %d, want 500", pd.Status)
	}
	if !strings.Contains(pd.Detail, "test-req-123") {
		t.Errorf("detail = %q, want it to contain request ID 'test-req-123'", pd.Detail)
	}
	if pd.Instance != "/api/v1/test" {
		t.Errorf("instance = %q, want /api/v1/test", pd.Instance)
	}
}
