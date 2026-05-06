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

func TestAuthIntegration(t *testing.T) {
	ctx := context.Background()

	// Open SQLite with a file-based DB (shared across connections).
	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "integration.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })

	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	// Create root user (mimics rioku init).
	rootPassword := "TestPassword123!"
	hash := cachedHashPassword(t, rootPassword)
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateUser(ctx, &store.User{
		Username:            "root",
		PasswordHash:        hash,
		Status:              "active",
		ForcePasswordChange: true,
		PasswordChangedAt:   time.Now().UTC(),
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// Create bootstrap token.
	bootstrapToken, err := auth.GenerateBootstrapToken()
	if err != nil {
		t.Fatal(err)
	}
	tx2, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx2.CreateAPIKey(ctx, "bootstrap", auth.HashToken(bootstrapToken), "", []string{"admin"}, nil, "")
	if err != nil {
		_ = tx2.Rollback()
		t.Fatal(err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatal(err)
	}

	// Set up auth.
	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	sm := auth.NewSessionManager(drv, true) // devMode=true for test

	// Build config with default password policy.
	cfg := config.Default()

	// Derive TOTP encryption key for auth routes.
	encKey, err := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	// Set up HTTP server with middleware + routes.
	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)

	var handler http.Handler = mux
	handler = AuthMiddleware(a, sm)(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	// Use a cookie jar to track cookies across requests.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	// Helper to make JSON requests.
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

	// Helper to decode JSON response body.
	decodeBody := func(t *testing.T, resp *http.Response, v any) {
		t.Helper()
		defer func() { _ = resp.Body.Close() }()
		if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
			t.Fatalf("decode response body: %v", err)
		}
	}

	// ---------- Subtests (sequential) ----------

	t.Run("login_success", func(t *testing.T) {
		resp := doJSON(t, http.MethodPost, "/api/v1/auth/login", map[string]string{
			"username": "root",
			"password": rootPassword,
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, pd.Detail)
		}

		// Verify Set-Cookie header is present.
		found := false
		for _, c := range resp.Cookies() {
			if c.Name == auth.SessionCookieName {
				found = true
				if c.Value == "" {
					t.Error("session cookie value is empty")
				}
				break
			}
		}
		if !found {
			t.Error("expected Set-Cookie header with session cookie")
		}

		// Decode and verify response.
		var loginResp loginResponse
		if err := json.NewDecoder(resp.Body).Decode(&loginResp); err != nil {
			t.Fatalf("decode login response: %v", err)
		}
		if loginResp.User.Username != "root" {
			t.Errorf("username = %q, want %q", loginResp.User.Username, "root")
		}
		if !loginResp.User.ForcePasswordChange {
			t.Error("expected force_password_change to be true")
		}
		if loginResp.Session.ID == "" {
			t.Error("session ID is empty")
		}
	})

	t.Run("me_with_cookie", func(t *testing.T) {
		resp := doJSON(t, http.MethodGet, "/api/v1/auth/me", nil)

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		var me meResponse
		decodeBody(t, resp, &me)

		if me.User.Username != "root" {
			t.Errorf("username = %q, want %q", me.User.Username, "root")
		}
		if !me.User.ForcePasswordChange {
			t.Error("expected force_password_change to be true")
		}
		if me.Session.ID == "" {
			t.Error("expected session info in /me response")
		}
	})

	t.Run("login_wrong_password", func(t *testing.T) {
		resp := doJSON(t, http.MethodPost, "/api/v1/auth/login", map[string]string{
			"username": "root",
			"password": "WrongPassword!",
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.StatusCode)
		}
	})

	t.Run("login_lockout", func(t *testing.T) {
		// The default lockout policy is 5 attempts. The first successful
		// login in login_success reset failed_attempts to 0. The
		// login_wrong_password subtest above already used 1 attempt.
		// We need 4 more failures (attempts 2-5). The 5th total failure
		// should trigger lockout (MaxAttempts=5 means lockout on the 5th).

		// Use a fresh client without cookies so we don't get auto-authenticated
		// by the session.
		freshClient := &http.Client{}

		var lastResp *http.Response
		for i := 0; i < 4; i++ {
			var buf bytes.Buffer
			_ = json.NewEncoder(&buf).Encode(map[string]string{
				"username": "root",
				"password": "WrongPassword!",
			})
			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/login", &buf)
			if err != nil {
				t.Fatalf("request %d: %v", i, err)
			}
			req.Header.Set("Content-Type", "application/json")
			resp, err := freshClient.Do(req)
			if err != nil {
				t.Fatalf("request %d: %v", i, err)
			}
			lastResp = resp
			_ = resp.Body.Close()
		}

		// The 4th request here is the 5th total failed attempt.
		// After that, the account should be locked.
		// Now try one more login — it should return 423 Locked.
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(map[string]string{
			"username": "root",
			"password": "WrongPassword!",
		})
		req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/login", &buf)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		lastResp, err = freshClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = lastResp.Body.Close() }()

		if lastResp.StatusCode != http.StatusLocked {
			t.Fatalf("expected 423 Locked, got %d", lastResp.StatusCode)
		}

		retryAfter := lastResp.Header.Get("Retry-After")
		if retryAfter == "" {
			t.Error("expected Retry-After header on lockout response")
		}
	})

	// Unlock the account so subsequent tests can proceed.
	// (Reset failed_attempts and clear locked_until.)
	func() {
		utx, err := drv.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("begin unlock tx: %v", err)
		}
		user, err := utx.GetUserByUsername(ctx, "root")
		if err != nil {
			_ = utx.Rollback()
			t.Fatalf("get root user: %v", err)
		}
		if err := utx.ResetFailedAttempts(ctx, user.ID); err != nil {
			_ = utx.Rollback()
			t.Fatalf("reset failed attempts: %v", err)
		}
		user.Status = "active"
		user.LockedUntil = nil
		if _, err := utx.UpdateUser(ctx, user); err != nil {
			_ = utx.Rollback()
			t.Fatalf("update user: %v", err)
		}
		if err := utx.Commit(); err != nil {
			t.Fatalf("commit unlock: %v", err)
		}
	}()

	t.Run("password_change", func(t *testing.T) {
		newPassword := "NewSecurePass123!"
		resp := doJSON(t, http.MethodPost, "/api/v1/auth/password", map[string]string{
			"currentPassword": rootPassword,
			"newPassword":     newPassword,
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, pd.Detail)
		}

		var result map[string]bool
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			// Body may have been consumed by the error path above, but
			// since we only enter here on 200, it should be fine.
			t.Logf("decode response: %v (may have been read in error path)", err)
		}

		// Update rootPassword for subsequent tests.
		rootPassword = newPassword
	})

	t.Run("logout", func(t *testing.T) {
		resp := doJSON(t, http.MethodPost, "/api/v1/auth/logout", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		// Verify the response body.
		var result map[string]bool
		decodeBody(t, resp, &result)
		if !result["ok"] {
			t.Error("expected ok=true in logout response")
		}
	})

	t.Run("me_after_logout", func(t *testing.T) {
		resp := doJSON(t, http.MethodGet, "/api/v1/auth/me", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.StatusCode)
		}
	})

	t.Run("bearer_auth_still_works", func(t *testing.T) {
		// Exchange bootstrap token for an access token.
		resp := doJSON(t, http.MethodPost, "/api/v1/auth/token", map[string]string{
			"token": bootstrapToken,
		})

		if resp.StatusCode != http.StatusOK {
			var pd ProblemDetail
			_ = json.NewDecoder(resp.Body).Decode(&pd)
			_ = resp.Body.Close()
			t.Fatalf("expected 200 from token exchange, got %d: %s", resp.StatusCode, pd.Detail)
		}

		var pair auth.TokenPair
		decodeBody(t, resp, &pair)

		if pair.AccessToken == "" {
			t.Fatal("access_token is empty")
		}
		if pair.TokenType != "Bearer" {
			t.Errorf("token_type = %q, want %q", pair.TokenType, "Bearer")
		}
		if pair.ExpiresIn <= 0 {
			t.Errorf("expected positive expires_in, got %d", pair.ExpiresIn)
		}
		if pair.RefreshToken == "" {
			t.Error("expected non-empty refresh_token")
		}

		// Use the access token in Authorization header to call /me.
		// The bootstrap token's subject is "admin" (not a real user ID),
		// so /me returns 404 ("user not found") rather than 200. The key
		// assertion is that bearer auth passes the middleware — a 401 would
		// mean authentication failed, while 404 confirms the token was
		// accepted and the handler ran.
		req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/auth/me", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)

		// Use a client without cookies so only the bearer token is used.
		bearerClient := &http.Client{}
		meResp, err := bearerClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = meResp.Body.Close() }()

		// 404 = auth passed, user not found (bootstrap subject is "admin", not a real user ID).
		// 401 would mean the bearer token was rejected by middleware.
		if meResp.StatusCode == http.StatusUnauthorized {
			t.Fatal("bearer token was rejected by auth middleware (got 401)")
		}
		if meResp.StatusCode != http.StatusNotFound {
			t.Logf("unexpected status %d (expected 404 for bootstrap subject)", meResp.StatusCode)
		}

		// Also verify that an invalid bearer token gets rejected.
		reqBad, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/auth/me", nil)
		if err != nil {
			t.Fatal(err)
		}
		reqBad.Header.Set("Authorization", "Bearer invalid-token")

		badResp, err := bearerClient.Do(reqBad)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = badResp.Body.Close() }()

		if badResp.StatusCode != http.StatusUnauthorized {
			t.Errorf("expected 401 for invalid bearer, got %d", badResp.StatusCode)
		}
	})
}
