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

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// setupRBACTestServer creates a fully wired test server with auth, RBAC, rate
// limiting, CORS, and security headers middleware. Returns the server, store
// driver, and root password.
func setupRBACTestServer(t *testing.T) (*httptest.Server, store.Driver, string) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "rbac_integration.db")
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
	// Use high rate limit for non-rate-limit tests to avoid interference.
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
	RegisterRBACRoutes(mux, drv)

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

	return server, drv, rootPassword
}

// doJSON sends a JSON request and returns the response.
func doJSON(t *testing.T, client *http.Client, method, url string, body any) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode request body: %v", err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
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

func TestRBACIntegration(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	ctx := context.Background()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	rootClient := &http.Client{Jar: jar}

	// Step 1: Login as root (superadmin).
	t.Run("root_login", func(t *testing.T) {
		resp := doJSON(t, rootClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
			"username": "root",
			"password": rootPassword,
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			t.Fatalf("root login: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
		}
	})

	// Step 2: Create a custom "editor" role with specific permissions.
	var editorRoleID string
	t.Run("create_editor_role", func(t *testing.T) {
		resp := doJSON(t, rootClient, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
			Name:        "editor",
			Description: "Can read roles and permissions but cannot manage them",
			Permissions: []string{"roles:read"},
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusCreated {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			t.Fatalf("create role: expected 201, got %d: %s", resp.StatusCode, pd.Detail)
		}

		var role roleResponse
		if err := json.NewDecoder(resp.Body).Decode(&role); err != nil {
			t.Fatalf("decode role: %v", err)
		}
		editorRoleID = role.ID
		if role.Name != "editor" {
			t.Errorf("name = %q, want %q", role.Name, "editor")
		}
	})

	// Step 3: Create a new user.
	newUserPassword := "EditorPass123!!"
	var newUserID string
	func() {
		hash, err := auth.HashPassword(newUserPassword)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := drv.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatal(err)
		}
		user, err := tx.CreateUser(ctx, &store.User{
			Username:            "editor-user",
			PasswordHash:        hash,
			Status:              "active",
			ForcePasswordChange: false,
			PasswordChangedAt:   time.Now().UTC(),
		})
		if err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		newUserID = user.ID
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}()

	// Step 4: Assign the editor role to the new user.
	t.Run("assign_editor_role", func(t *testing.T) {
		resp := doJSON(t, rootClient, http.MethodPost, server.URL+"/api/v1/users/"+newUserID+"/roles", assignRoleRequest{
			RoleID: editorRoleID,
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusCreated {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			t.Fatalf("assign role: expected 201, got %d: %s", resp.StatusCode, pd.Detail)
		}
	})

	// Step 5: Login as the new user.
	editorJar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	editorClient := &http.Client{Jar: editorJar}

	t.Run("editor_login", func(t *testing.T) {
		resp := doJSON(t, editorClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
			"username": "editor-user",
			"password": newUserPassword,
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			t.Fatalf("editor login: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
		}
	})

	// Step 6: Verify the editor CAN access roles:read endpoints.
	t.Run("editor_can_list_roles", func(t *testing.T) {
		resp := doJSON(t, editorClient, http.MethodGet, server.URL+"/api/v1/roles", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			t.Fatalf("editor list roles: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
		}
	})

	t.Run("editor_can_list_permissions", func(t *testing.T) {
		resp := doJSON(t, editorClient, http.MethodGet, server.URL+"/api/v1/permissions", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			t.Fatalf("editor list permissions: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
		}
	})

	// Step 7: Verify the editor CANNOT access roles:manage endpoints (403).
	t.Run("editor_cannot_create_role", func(t *testing.T) {
		resp := doJSON(t, editorClient, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
			Name:        "should-fail",
			Description: "This role creation should be forbidden",
			Permissions: []string{"roles:read"},
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("editor create role: expected 403, got %d", resp.StatusCode)
		}
	})

	t.Run("editor_cannot_delete_role", func(t *testing.T) {
		resp := doJSON(t, editorClient, http.MethodDelete, server.URL+"/api/v1/roles/"+editorRoleID, nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("editor delete role: expected 403, got %d", resp.StatusCode)
		}
	})

	t.Run("editor_cannot_manage_user_roles", func(t *testing.T) {
		resp := doJSON(t, editorClient, http.MethodPost, server.URL+"/api/v1/users/"+newUserID+"/roles", assignRoleRequest{
			RoleID: editorRoleID,
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("editor assign role: expected 403, got %d", resp.StatusCode)
		}
	})

	// Step 8: Revoke the editor role, verify access is denied.
	t.Run("revoke_and_verify_denied", func(t *testing.T) {
		// Revoke role as root.
		resp := doJSON(t, rootClient, http.MethodDelete, server.URL+"/api/v1/users/"+newUserID+"/roles/"+editorRoleID, nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("revoke role: expected 204, got %d", resp.StatusCode)
		}

		// Re-login as editor to get a fresh session with updated scopes.
		editorJar2, _ := cookiejar.New(nil)
		editorClient2 := &http.Client{Jar: editorJar2}

		loginResp := doJSON(t, editorClient2, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
			"username": "editor-user",
			"password": newUserPassword,
		})
		defer func() { _ = loginResp.Body.Close() }()

		if loginResp.StatusCode != http.StatusOK {
			t.Fatalf("editor re-login: expected 200, got %d", loginResp.StatusCode)
		}

		// Now the editor should be denied because roles:read was revoked.
		rolesResp := doJSON(t, editorClient2, http.MethodGet, server.URL+"/api/v1/roles", nil)
		defer func() { _ = rolesResp.Body.Close() }()

		if rolesResp.StatusCode != http.StatusForbidden {
			t.Fatalf("revoked editor list roles: expected 403, got %d", rolesResp.StatusCode)
		}
	})
}

func TestSecurityHeaders(t *testing.T) {
	server, _, _ := setupRBACTestServer(t)

	client := &http.Client{}

	t.Run("security_headers_present", func(t *testing.T) {
		// Hit an unauthenticated API endpoint so auth middleware passes through
		// to the security headers middleware. POST /api/v1/auth/login with an
		// invalid body produces a 400 but still passes through the full
		// middleware chain.
		req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/login", bytes.NewBufferString("{}"))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()

		checks := map[string]string{
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options":        "DENY",
			"X-XSS-Protection":       "0",
			"Referrer-Policy":        "strict-origin-when-cross-origin",
			"Permissions-Policy":     "camera=(), microphone=(), geolocation=()",
		}
		for header, expected := range checks {
			got := resp.Header.Get(header)
			if got != expected {
				t.Errorf("%s = %q, want %q", header, got, expected)
			}
		}

		// CSP should be set for /api/ paths.
		csp := resp.Header.Get("Content-Security-Policy")
		if csp != "default-src 'none'; frame-ancestors 'none'" {
			t.Errorf("CSP = %q, want %q", csp, "default-src 'none'; frame-ancestors 'none'")
		}

		// X-Request-ID should always be present.
		reqID := resp.Header.Get("X-Request-ID")
		if reqID == "" {
			t.Error("expected X-Request-ID header to be present")
		}
	})

	t.Run("cors_preflight", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodOptions, server.URL+"/api/v1/roles", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", "https://app.rioku.dev")
		req.Header.Set("Access-Control-Request-Method", "POST")

		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("CORS preflight: expected 204, got %d", resp.StatusCode)
		}

		origin := resp.Header.Get("Access-Control-Allow-Origin")
		if origin != "https://app.rioku.dev" {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q", origin, "https://app.rioku.dev")
		}

		methods := resp.Header.Get("Access-Control-Allow-Methods")
		if methods == "" {
			t.Error("expected Access-Control-Allow-Methods header")
		}

		headers := resp.Header.Get("Access-Control-Allow-Headers")
		if headers == "" {
			t.Error("expected Access-Control-Allow-Headers header")
		}

		maxAge := resp.Header.Get("Access-Control-Max-Age")
		if maxAge != "3600" {
			t.Errorf("Access-Control-Max-Age = %q, want %q", maxAge, "3600")
		}

		creds := resp.Header.Get("Access-Control-Allow-Credentials")
		if creds != "true" {
			t.Errorf("Access-Control-Allow-Credentials = %q, want %q", creds, "true")
		}
	})

	t.Run("cors_disallowed_origin", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodOptions, server.URL+"/api/v1/roles", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", "https://evil.example.com")
		req.Header.Set("Access-Control-Request-Method", "POST")

		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()

		// Disallowed origin should not get CORS headers.
		origin := resp.Header.Get("Access-Control-Allow-Origin")
		if origin != "" {
			t.Errorf("expected no Access-Control-Allow-Origin for disallowed origin, got %q", origin)
		}
	})
}

func TestRateLimiting(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "ratelimit.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })

	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	sm := auth.NewSessionManager(drv, true)
	cfg := config.Default()
	cfg.Auth.RateLimit.RequestsPerMinute = 5 // Low limit for testing.

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

	var handler http.Handler = mux
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	client := &http.Client{}

	t.Run("rate_limit_429", func(t *testing.T) {
		// Make requests up to the limit.
		for i := 0; i < 5; i++ {
			req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/auth/login", nil)
			if err != nil {
				t.Fatal(err)
			}
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			_ = resp.Body.Close()

			// Verify rate limit headers are present.
			if resp.Header.Get("X-RateLimit-Limit") != "5" {
				t.Errorf("request %d: X-RateLimit-Limit = %q, want %q", i+1, resp.Header.Get("X-RateLimit-Limit"), "5")
			}
		}

		// Next request should be rate limited.
		req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/auth/login", nil)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("expected 429, got %d", resp.StatusCode)
		}

		retryAfter := resp.Header.Get("Retry-After")
		if retryAfter == "" {
			t.Error("expected Retry-After header on 429 response")
		}

		remaining := resp.Header.Get("X-RateLimit-Remaining")
		if remaining != "0" {
			t.Errorf("X-RateLimit-Remaining = %q, want %q", remaining, "0")
		}

		// Verify the body is a proper problem detail.
		var pd ProblemDetail
		if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
			t.Fatalf("decode problem detail: %v", err)
		}
		if pd.Status != 429 {
			t.Errorf("problem status = %d, want 429", pd.Status)
		}
		if pd.Type != errTypeRateLimit {
			t.Errorf("problem type = %q, want %q", pd.Type, errTypeRateLimit)
		}
	})
}

func TestRateLimiterCleanup(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config:  config.RateLimitConfig{RequestsPerMinute: 10},
		done:    make(chan struct{}),
	}

	// Add expired and non-expired windows.
	rl.windows["expired"] = &window{count: 5, resetAt: time.Now().Add(-time.Minute)}
	rl.windows["active"] = &window{count: 3, resetAt: time.Now().Add(time.Minute)}

	// Manually trigger cleanup logic.
	now := time.Now()
	rl.mu.Lock()
	for key, w := range rl.windows {
		if now.After(w.resetAt) {
			delete(rl.windows, key)
		}
	}
	rl.mu.Unlock()

	rl.mu.Lock()
	defer rl.mu.Unlock()

	if _, ok := rl.windows["expired"]; ok {
		t.Error("expected expired window to be cleaned up")
	}
	if _, ok := rl.windows["active"]; !ok {
		t.Error("expected active window to still exist")
	}
}

func TestExtractIP(t *testing.T) {
	tests := []struct {
		name     string
		xff      string
		remote   string
		expected string
	}{
		{
			name:     "from X-Forwarded-For single",
			xff:      "192.168.1.1",
			remote:   "10.0.0.1:12345",
			expected: "192.168.1.1",
		},
		{
			name:     "from X-Forwarded-For multiple",
			xff:      "192.168.1.1, 10.0.0.2, 10.0.0.3",
			remote:   "10.0.0.1:12345",
			expected: "192.168.1.1",
		},
		{
			name:     "from RemoteAddr",
			xff:      "",
			remote:   "10.0.0.1:12345",
			expected: "10.0.0.1",
		},
		{
			name:     "from RemoteAddr without port",
			xff:      "",
			remote:   "10.0.0.1",
			expected: "10.0.0.1",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, _ := http.NewRequest(http.MethodGet, "/", nil)
			if tt.xff != "" {
				r.Header.Set("X-Forwarded-For", tt.xff)
			}
			r.RemoteAddr = tt.remote

			got := extractIP(r)
			if got != tt.expected {
				t.Errorf("extractIP() = %q, want %q", got, tt.expected)
			}
		})
	}
}
