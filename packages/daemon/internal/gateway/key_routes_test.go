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

// decodeKeyList unwraps a key-list response into its inner array. The
// list endpoint moved from emitting a bare `[...]` array to the
// OpenAPI-aligned `{"apiKeys": [...], "nextPageToken": "…"}` shape so
// the SPA's Orval-typed hooks could read `data.data.apiKeys` directly;
// keep the test helper here so the call sites stay narrow.
func decodeKeyList(t *testing.T, body interface{ Read(p []byte) (int, error) }) []map[string]any {
	t.Helper()
	var wrap struct {
		ApiKeys []map[string]any `json:"apiKeys"`
	}
	if err := json.NewDecoder(body).Decode(&wrap); err != nil {
		t.Fatalf("decode key list: %v", err)
	}
	return wrap.ApiKeys
}

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

	keys := decodeKeyList(t, listResp.Body)

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

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 422 {
		t.Errorf("problem status = %d, want 422", pd.Status)
	}
	if len(pd.Errors) == 0 || !strings.Contains(pd.Errors[0].Reason, "duration") {
		t.Errorf("errors[0].reason = %q, want it to contain 'duration'", func() string {
			if len(pd.Errors) > 0 {
				return pd.Errors[0].Reason
			}
			return ""
		}())
	}
}

func TestKeyRoutes_CreateKey_MissingName(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"scopes": "read",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 422 {
		t.Errorf("problem status = %d, want 422", pd.Status)
	}
	if len(pd.Errors) == 0 || pd.Errors[0].Field != "name" {
		t.Errorf("expected validation error on field 'name', got errors=%v", pd.Errors)
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

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 422 {
		t.Errorf("problem status = %d, want 422", pd.Status)
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

	keys := decodeKeyList(t, resp.Body)

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
	_, err = tx.CreateAPIKey(ctx, "bootstrap", auth.HashToken("fake-bootstrap"), "", []string{"admin"}, nil, "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	_, err = tx.CreateAPIKey(ctx, "refresh:user123", auth.HashToken("fake-refresh"), "", []string{"refresh"}, nil, "")
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

	keys := decodeKeyList(t, resp.Body)

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

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 422 {
		t.Errorf("problem status = %d, want 422", pd.Status)
	}
	if len(pd.Errors) == 0 || pd.Errors[0].Field != "id" {
		t.Errorf("expected validation error on field 'id', got errors=%v", pd.Errors)
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

// ---------------------------------------------------------------------------
// Permission enforcement and ownership model tests
// ---------------------------------------------------------------------------

// createUserWithRole creates a test user in the store, assigns the named
// built-in role, and returns the user ID and an authenticated HTTP client.
// The built-in role IDs follow the pattern "role_<name>" (e.g. "role_viewer",
// "role_operator", "role_admin").
func createUserWithRole(t *testing.T, drv store.Driver, serverURL, username, password, roleName string) (string, *http.Client) {
	t.Helper()
	ctx := context.Background()

	hash := cachedHashPassword(t, password)

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	user, err := tx.CreateUser(ctx, &store.User{
		Username:            username,
		PasswordHash:        hash,
		Status:              "active",
		ForcePasswordChange: false,
		PasswordChangedAt:   time.Now().UTC(),
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	// Built-in role IDs are "role_<name>".
	roleID := "role_" + roleName
	if err := tx.AssignRole(ctx, user.ID, roleID, ""); err != nil {
		_ = tx.Rollback()
		t.Fatalf("assign role %q to user %q: %v", roleName, username, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// Log in and return an authenticated client.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}
	resp := doJSON(t, client, http.MethodPost, serverURL+"/api/v1/auth/login", map[string]string{
		"username": username,
		"password": password,
	})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("login as %q: expected 200, got %d: %s", username, resp.StatusCode, pd.Detail)
	}

	return user.ID, client
}

// ---------------------------------------------------------------------------
// Permission enforcement
// ---------------------------------------------------------------------------

// TestKeyRoutes_ViewerRole_Forbidden verifies that a user with the viewer role
// (which has no key permissions) receives 403 on all key endpoints.
func TestKeyRoutes_ViewerRole_Forbidden(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	_, viewerClient := createUserWithRole(t, drv, server.URL, "viewer-user", "ViewerPass123!", "viewer")

	endpoints := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodPost, "/api/v1/keys", map[string]string{"name": "test"}},
		{http.MethodGet, "/api/v1/keys", nil},
		{http.MethodDelete, "/api/v1/keys/some-id", nil},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+"_"+ep.path, func(t *testing.T) {
			resp := doJSON(t, viewerClient, ep.method, server.URL+ep.path, ep.body)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("expected 403, got %d", resp.StatusCode)
			}
			var pd ProblemDetail
			if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
				t.Fatalf("decode problem detail: %v", err)
			}
			if pd.Status != 403 {
				t.Errorf("problem status = %d, want 403", pd.Status)
			}
		})
	}
}

// TestKeyRoutes_OperatorCanCreate verifies that a user with the operator role
// (which has keys:own) can create an API key with scopes within their
// permissions.
func TestKeyRoutes_OperatorCanCreate(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	_, opClient := createUserWithRole(t, drv, server.URL, "op-create", "OpPass123!", "operator")

	resp := doJSON(t, opClient, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"name":   "op-key",
		"scopes": "config:read,audit:read",
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
		t.Error("expected non-empty id")
	}
	if !strings.HasPrefix(result["key"], "rku_tok_") {
		t.Errorf("key = %q, want prefix rku_tok_", result["key"])
	}
}

// TestKeyRoutes_OperatorListsOnlyOwnKeys verifies that when two operators each
// create a key, each only sees their own key in the list response.
func TestKeyRoutes_OperatorListsOnlyOwnKeys(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	_, opClientA := createUserWithRole(t, drv, server.URL, "op-list-a", "OpPassA123!", "operator")
	_, opClientB := createUserWithRole(t, drv, server.URL, "op-list-b", "OpPassB123!", "operator")

	// Each operator creates one key.
	idA, _ := createKeyViaAPI(t, opClientA, server.URL, map[string]string{"name": "key-of-a"})
	idB, _ := createKeyViaAPI(t, opClientB, server.URL, map[string]string{"name": "key-of-b"})

	// Operator A should only see their own key.
	respA := doJSON(t, opClientA, http.MethodGet, server.URL+"/api/v1/keys", nil)
	defer func() { _ = respA.Body.Close() }()
	if respA.StatusCode != http.StatusOK {
		t.Fatalf("op-a list: expected 200, got %d", respA.StatusCode)
	}
	keysA := decodeKeyList(t, respA.Body)
	if len(keysA) != 1 {
		t.Fatalf("op-a: expected 1 key, got %d", len(keysA))
	}
	if keysA[0]["id"] != idA {
		t.Errorf("op-a: expected key id %q, got %q", idA, keysA[0]["id"])
	}

	// Operator B should only see their own key.
	respB := doJSON(t, opClientB, http.MethodGet, server.URL+"/api/v1/keys", nil)
	defer func() { _ = respB.Body.Close() }()
	if respB.StatusCode != http.StatusOK {
		t.Fatalf("op-b list: expected 200, got %d", respB.StatusCode)
	}
	keysB := decodeKeyList(t, respB.Body)
	if len(keysB) != 1 {
		t.Fatalf("op-b: expected 1 key, got %d", len(keysB))
	}
	if keysB[0]["id"] != idB {
		t.Errorf("op-b: expected key id %q, got %q", idB, keysB[0]["id"])
	}
}

// TestKeyRoutes_OperatorCannotRevokeOthersKey verifies that an operator cannot
// revoke an API key owned by a different user.
func TestKeyRoutes_OperatorCannotRevokeOthersKey(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	_, opClientA := createUserWithRole(t, drv, server.URL, "op-revoke-a", "OpPassA123!", "operator")
	_, opClientB := createUserWithRole(t, drv, server.URL, "op-revoke-b", "OpPassB123!", "operator")

	// Operator A creates a key.
	idA, _ := createKeyViaAPI(t, opClientA, server.URL, map[string]string{"name": "a-key"})

	// Operator B tries to revoke A's key — should get 403.
	resp := doJSON(t, opClientB, http.MethodDelete, server.URL+"/api/v1/keys/"+idA, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 403, got %d: %s", resp.StatusCode, pd.Detail)
	}
	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 403 {
		t.Errorf("problem status = %d, want 403", pd.Status)
	}
}

// TestKeyRoutes_AdminCanListAllKeys verifies that an admin can see all keys
// created by any user, not just their own.
func TestKeyRoutes_AdminCanListAllKeys(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	_, opClientA := createUserWithRole(t, drv, server.URL, "op-admin-list-a", "OpPassA123!", "operator")
	_, opClientB := createUserWithRole(t, drv, server.URL, "op-admin-list-b", "OpPassB123!", "operator")
	_, adminClient := createUserWithRole(t, drv, server.URL, "admin-list", "AdminPass123!", "admin")

	// Each operator creates one key.
	idA, _ := createKeyViaAPI(t, opClientA, server.URL, map[string]string{"name": "key-a"})
	idB, _ := createKeyViaAPI(t, opClientB, server.URL, map[string]string{"name": "key-b"})

	// Admin lists all keys — should see both.
	resp := doJSON(t, adminClient, http.MethodGet, server.URL+"/api/v1/keys", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin list: expected 200, got %d", resp.StatusCode)
	}
	keys := decodeKeyList(t, resp.Body)

	found := make(map[string]bool)
	for _, k := range keys {
		if id, ok := k["id"].(string); ok {
			found[id] = true
		}
	}
	if !found[idA] {
		t.Errorf("admin list: key %q (op-a) not found", idA)
	}
	if !found[idB] {
		t.Errorf("admin list: key %q (op-b) not found", idB)
	}
}

// TestKeyRoutes_AdminCanRevokeAnyKey verifies that an admin can revoke a key
// created by another user.
func TestKeyRoutes_AdminCanRevokeAnyKey(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	_, opClient := createUserWithRole(t, drv, server.URL, "op-for-admin-revoke", "OpPass123!", "operator")
	_, adminClient := createUserWithRole(t, drv, server.URL, "admin-revoke", "AdminPass123!", "admin")

	// Operator creates a key.
	id, _ := createKeyViaAPI(t, opClient, server.URL, map[string]string{"name": "op-key-to-revoke"})

	// Admin revokes it — should succeed (204).
	resp := doJSON(t, adminClient, http.MethodDelete, server.URL+"/api/v1/keys/"+id, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("admin revoke: expected 204, got %d: %s", resp.StatusCode, pd.Detail)
	}
}

// ---------------------------------------------------------------------------
// Scope escalation prevention
// ---------------------------------------------------------------------------

// TestKeyRoutes_OperatorCannotEscalateScopes verifies that an operator cannot
// create a key with the "admin" scope (which exceeds their own permissions).
func TestKeyRoutes_OperatorCannotEscalateScopes(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	_, opClient := createUserWithRole(t, drv, server.URL, "op-escalate", "OpPass123!", "operator")

	resp := doJSON(t, opClient, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"name":   "escalated-key",
		"scopes": "admin",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 403, got %d: %s", resp.StatusCode, pd.Detail)
	}
	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Status != 403 {
		t.Errorf("problem status = %d, want 403", pd.Status)
	}
}

// TestKeyRoutes_OperatorCanCreateKeyWithAllowedScopes verifies that an
// operator can create a key with scopes that are within their own permissions.
func TestKeyRoutes_OperatorCanCreateKeyWithAllowedScopes(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	_, opClient := createUserWithRole(t, drv, server.URL, "op-allowed-scopes", "OpPass123!", "operator")

	// config:read and audit:read are both within operator's config:* and audit:read permissions.
	resp := doJSON(t, opClient, http.MethodPost, server.URL+"/api/v1/keys", map[string]string{
		"name":   "allowed-scopes-key",
		"scopes": "config:read,audit:read",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

// TestKeyRoutes_OwnerIDSetOnCreation verifies that a key created via session
// auth has the owner's user ID stored and returned in the list response.
func TestKeyRoutes_OwnerIDSetOnCreation(t *testing.T) {
	server, drv, _, _ := setupKeyTestServer(t)

	userID, opClient := createUserWithRole(t, drv, server.URL, "op-owner-id", "OpPass123!", "operator")

	createKeyViaAPI(t, opClient, server.URL, map[string]string{"name": "owned-key"})

	// List keys and verify ownerId matches the creating user.
	resp := doJSON(t, opClient, http.MethodGet, server.URL+"/api/v1/keys", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", resp.StatusCode)
	}
	keys := decodeKeyList(t, resp.Body)
	if len(keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(keys))
	}

	ownerId, ok := keys[0]["ownerId"].(string)
	if !ok || ownerId == "" {
		t.Fatalf("expected non-empty ownerId in list response, got %v", keys[0]["ownerId"])
	}
	if ownerId != userID {
		t.Errorf("ownerId = %q, want %q", ownerId, userID)
	}
}

// TestKeyRoutes_APIKeyAuthCreatesSystemKey verifies that when a key is created
// using Bearer (API key) authentication, the resulting key has an empty
// ownerId (it is a system key, not tied to a user).
func TestKeyRoutes_APIKeyAuthCreatesSystemKey(t *testing.T) {
	server, drv, _, rootClient := setupKeyTestServer(t)
	ctx := context.Background()

	// Create a bootstrap-style API key with admin scopes directly in the store
	// so we can use it as a Bearer token.
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	rawBootstrap, err := auth.GenerateBootstrapToken()
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	_, err = tx.CreateAPIKey(ctx, "bootstrap-test", auth.HashToken(rawBootstrap), "", []string{"admin"}, nil, "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// Use the bootstrap key as a Bearer token to create a new key.
	bearerClient := &http.Client{}
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/keys",
		strings.NewReader(`{"name":"system-created-key"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+rawBootstrap)
	resp, err := bearerClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}
	var createResult map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&createResult); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	newKeyID := createResult["id"]
	if newKeyID == "" {
		t.Fatal("expected non-empty id in create response")
	}

	// Verify via admin session that the ownerId is empty on this key.
	listResp := doJSON(t, rootClient, http.MethodGet, server.URL+"/api/v1/keys", nil)
	defer func() { _ = listResp.Body.Close() }()
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", listResp.StatusCode)
	}
	keys := decodeKeyList(t, listResp.Body)

	var found bool
	for _, k := range keys {
		if k["id"] == newKeyID {
			found = true
			// ownerId should be absent or empty for a system key.
			if ownerID, exists := k["ownerId"]; exists && ownerID != "" {
				t.Errorf("system key: expected empty ownerId, got %q", ownerID)
			}
			break
		}
	}
	if !found {
		t.Errorf("newly created system key %q not found in list", newKeyID)
	}
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

// TestKeyRoutes_RevokeAlreadyRevokedAsNonOwner verifies the behavior when a
// non-owner tries to revoke a key that has already been revoked. Because
// GetAPIKey returns the row regardless of revocation status, the ownership
// check runs first: the non-owner receives 403, not 404. A completely
// nonexistent key ID returns 404. This test documents both behaviors.
func TestKeyRoutes_RevokeAlreadyRevokedAsNonOwner(t *testing.T) {
	server, drv, _, rootClient := setupKeyTestServer(t)

	_, opClient := createUserWithRole(t, drv, server.URL, "op-revoked-edge", "OpPass123!", "operator")

	// Operator creates a key; root revokes it first.
	id, _ := createKeyViaAPI(t, opClient, server.URL, map[string]string{"name": "edge-key"})

	revokeResp := doJSON(t, rootClient, http.MethodDelete, server.URL+"/api/v1/keys/"+id, nil)
	defer func() { _ = revokeResp.Body.Close() }()
	if revokeResp.StatusCode != http.StatusNoContent {
		t.Fatalf("root revoke: expected 204, got %d", revokeResp.StatusCode)
	}

	// Another operator (not the owner) tries to revoke the already-revoked key.
	// GetAPIKey returns the row even after revocation, so the ownership check
	// fires first: the non-owner gets 403 (ownership denied), not 404.
	_, opClientB := createUserWithRole(t, drv, server.URL, "op-revoked-edge-b", "OpPass123!", "operator")

	resp := doJSON(t, opClientB, http.MethodDelete, server.URL+"/api/v1/keys/"+id, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 403 (ownership denied before revoked-state check), got %d: %s", resp.StatusCode, pd.Detail)
	}

	// A completely nonexistent ID returns 404.
	resp2 := doJSON(t, opClientB, http.MethodDelete, server.URL+"/api/v1/keys/nonexistent-id-xyz", nil)
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for nonexistent id, got %d", resp2.StatusCode)
	}
}

// ─── Usage stats endpoint (#85) ─────────────────────────────────────────────

func TestKeyRoutes_Usage_FreshKeyShowsZero(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)
	id, _ := createKeyViaAPI(t, client, server.URL, map[string]string{"name": "fresh-usage"})

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/keys/"+id+"/usage", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if body["id"] != id {
		t.Errorf("id = %v, want %s", body["id"], id)
	}
	if uc, ok := body["usageCount"].(float64); !ok || uc != 0 {
		t.Errorf("usageCount = %v, want 0", body["usageCount"])
	}
	if _, has := body["lastUsedAt"]; has {
		t.Errorf("lastUsedAt should be omitted on fresh key, got %v", body["lastUsedAt"])
	}
}

func TestKeyRoutes_Usage_AfterRecordedUse(t *testing.T) {
	server, drv, _, client := setupKeyTestServer(t)
	id, _ := createKeyViaAPI(t, client, server.URL, map[string]string{"name": "used-key"})

	// Simulate 4 authenticated requests by writing usage events
	// directly through the store (bypasses the goroutine in the
	// auth path, which would race with the test).
	ctx := context.Background()
	for i := 0; i < 4; i++ {
		tx, _ := drv.Begin(ctx, store.TxOptions{})
		if err := tx.RecordAPIKeyUse(ctx, id, time.Now().UTC()); err != nil {
			_ = tx.Rollback()
			t.Fatalf("RecordAPIKeyUse: %v", err)
		}
		_ = tx.Commit()
	}

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/keys/"+id+"/usage", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if uc, _ := body["usageCount"].(float64); uc != 4 {
		t.Errorf("usageCount = %v, want 4", body["usageCount"])
	}
	if _, has := body["lastUsedAt"]; !has {
		t.Errorf("lastUsedAt should be set after usage, got body=%v", body)
	}
}

func TestKeyRoutes_Usage_NotFoundForBogusID(t *testing.T) {
	server, _, _, client := setupKeyTestServer(t)
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/keys/bogus-id-xyz/usage", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404 for unknown key id, got %d", resp.StatusCode)
	}
}

// TestKeyRoutes_TenantScopedPath asserts that the new
// `/api/v1/t/{tenant}/api-keys` aliases are wired alongside the legacy
// `/api/v1/keys` paths. We don't need to drive a full CRUD flow — just
// confirm that the tenant-scoped path resolves through TenantMiddleware
// (200/401 = matched the route; 404 from the middleware = unknown slug).
func TestKeyRoutes_TenantScopedPath(t *testing.T) {
	_, drv, _, _ := setupKeyTestServer(t)

	mux := http.NewServeMux()
	RegisterKeyRoutes(mux, drv)
	var handler http.Handler = mux
	handler = TenantMiddleware(drv)(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	// Known tenant slug → middleware resolves, route handler runs.
	// Without AuthMiddleware in the chain RequirePermission returns 401
	// — that's fine; it proves the alias is registered (a missing route
	// would 404).
	resp, err := http.Get(server.URL + "/api/v1/t/default/api-keys")
	if err != nil {
		t.Fatalf("GET tenant-scoped api-keys: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		t.Errorf("GET /api/v1/t/default/api-keys: 404 — path alias not registered")
	}

	// Unknown tenant slug → TenantMiddleware writes 404 before the
	// handler runs.
	resp, err = http.Get(server.URL + "/api/v1/t/no-such-tenant/api-keys")
	if err != nil {
		t.Fatalf("GET unknown tenant: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown tenant: expected 404 from TenantMiddleware, got %d", resp.StatusCode)
	}
}
