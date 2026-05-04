package gateway

import (
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

// setupTOTPTestServer creates a test server with auth routes, TOTP routes,
// RBAC middleware, and user routes registered. Returns the server, store
// driver, root password, and TOTP encryptor.
func setupTOTPTestServer(t *testing.T) (*httptest.Server, store.Driver, string) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "totp_test.db")
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
	RegisterTOTPRoutes(mux, drv, a, sm, enc)

	var handler http.Handler = mux
	handler = SecurityHeadersMiddleware(handler)
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	return server, drv, rootPassword
}

// loginClient logs in as the given user and returns an http.Client with
// the session cookie set.
func loginClient(t *testing.T, serverURL, username, password string) *http.Client {
	t.Helper()
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
		t.Fatalf("login as %s: expected 200, got %d: %s", username, resp.StatusCode, pd.Detail)
	}
	return client
}

func TestTOTPRoutes_Setup(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("TOTP setup: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var setup totpSetupResponse
	if err := json.NewDecoder(resp.Body).Decode(&setup); err != nil {
		t.Fatalf("decode setup response: %v", err)
	}

	if setup.Secret == "" {
		t.Error("expected non-empty secret")
	}
	if !strings.Contains(setup.QRURI, "otpauth://") {
		t.Errorf("expected qrUri to contain 'otpauth://', got %q", setup.QRURI)
	}
}

func TestTOTPRoutes_Verify(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Step 1: Setup TOTP.
	setupResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = setupResp.Body.Close() }()

	if setupResp.StatusCode != http.StatusOK {
		t.Fatalf("TOTP setup: expected 200, got %d", setupResp.StatusCode)
	}

	var setup totpSetupResponse
	if err := json.NewDecoder(setupResp.Body).Decode(&setup); err != nil {
		t.Fatalf("decode setup response: %v", err)
	}

	// Step 2: Compute a valid TOTP code and verify.
	code, err := auth.ComputeTOTPCode(setup.Secret, time.Now())
	if err != nil {
		t.Fatalf("compute TOTP code: %v", err)
	}

	verifyResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{
		Code: code,
	})
	defer func() { _ = verifyResp.Body.Close() }()

	if verifyResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(verifyResp.Body).Decode(&pd)
		t.Fatalf("TOTP verify: expected 200, got %d: %s", verifyResp.StatusCode, pd.Detail)
	}

	var verify totpVerifyResponse
	if err := json.NewDecoder(verifyResp.Body).Decode(&verify); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}

	if len(verify.BackupCodes) == 0 {
		t.Error("expected non-empty backupCodes array")
	}
}

func TestTOTPRoutes_Verify_WrongCode(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Setup TOTP first.
	setupResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = setupResp.Body.Close() }()

	if setupResp.StatusCode != http.StatusOK {
		t.Fatalf("TOTP setup: expected 200, got %d", setupResp.StatusCode)
	}

	// Discard setup body.
	var setup totpSetupResponse
	_ = json.NewDecoder(setupResp.Body).Decode(&setup)

	// Verify with wrong code.
	verifyResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{
		Code: "000000",
	})
	defer func() { _ = verifyResp.Body.Close() }()

	if verifyResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("TOTP verify wrong code: expected 401, got %d", verifyResp.StatusCode)
	}
}

func TestTOTPRoutes_Verify_NotSetup(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Verify without calling setup first — no TOTP secret stored.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{
		Code: "123456",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("TOTP verify not setup: expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Title != "TOTP not set up" {
		t.Errorf("expected title 'TOTP not set up', got %q", pd.Title)
	}
}

func TestTOTPRoutes_Verify_EmptyCode(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Setup TOTP first so we get past the "not set up" check.
	setupResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = setupResp.Body.Close() }()

	if setupResp.StatusCode != http.StatusOK {
		t.Fatalf("TOTP setup: expected 200, got %d", setupResp.StatusCode)
	}

	// Verify with empty code.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{
		Code: "",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("TOTP verify empty code: expected 400, got %d", resp.StatusCode)
	}
}

func TestTOTPRoutes_Disable(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Step 1: Setup TOTP.
	setupResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = setupResp.Body.Close() }()

	var setup totpSetupResponse
	if err := json.NewDecoder(setupResp.Body).Decode(&setup); err != nil {
		t.Fatalf("decode setup: %v", err)
	}

	// Step 2: Verify TOTP.
	code, err := auth.ComputeTOTPCode(setup.Secret, time.Now())
	if err != nil {
		t.Fatalf("compute TOTP code: %v", err)
	}

	verifyResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{
		Code: code,
	})
	defer func() { _ = verifyResp.Body.Close() }()

	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("TOTP verify: expected 200, got %d", verifyResp.StatusCode)
	}

	// Step 3: Disable TOTP.
	disableResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/disable", totpDisableRequest{
		CurrentPassword: rootPassword,
	})
	defer func() { _ = disableResp.Body.Close() }()

	if disableResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(disableResp.Body).Decode(&pd)
		t.Fatalf("TOTP disable: expected 200, got %d: %s", disableResp.StatusCode, pd.Detail)
	}

	var okResp map[string]bool
	if err := json.NewDecoder(disableResp.Body).Decode(&okResp); err != nil {
		t.Fatalf("decode disable response: %v", err)
	}
	if !okResp["ok"] {
		t.Error("expected ok=true in disable response")
	}
}

func TestTOTPRoutes_Disable_WrongPassword(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Setup TOTP.
	setupResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = setupResp.Body.Close() }()

	var setup totpSetupResponse
	_ = json.NewDecoder(setupResp.Body).Decode(&setup)

	// Verify TOTP.
	code, err := auth.ComputeTOTPCode(setup.Secret, time.Now())
	if err != nil {
		t.Fatalf("compute TOTP code: %v", err)
	}
	verifyResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{Code: code})
	defer func() { _ = verifyResp.Body.Close() }()

	// Try to disable with wrong password.
	disableResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/disable", totpDisableRequest{
		CurrentPassword: "WrongPassword123!",
	})
	defer func() { _ = disableResp.Body.Close() }()

	if disableResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("TOTP disable wrong password: expected 401, got %d", disableResp.StatusCode)
	}
}

func TestTOTPRoutes_Disable_NotSetup(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Disable without TOTP being set up. The handler verifies the password
	// first, then clears TOTP fields (which are already nil). This should
	// succeed as a no-op.
	disableResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/disable", totpDisableRequest{
		CurrentPassword: rootPassword,
	})
	defer func() { _ = disableResp.Body.Close() }()

	if disableResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(disableResp.Body).Decode(&pd)
		t.Fatalf("TOTP disable (not setup): expected 200, got %d: %s", disableResp.StatusCode, pd.Detail)
	}
}

func TestTOTPRoutes_Reset(t *testing.T) {
	server, drv, rootPassword := setupTOTPTestServer(t)
	ctx := context.Background()

	// Create a second user who will have TOTP enabled.
	targetPassword := "TargetUser123!!"
	targetHash := cachedHashPassword(t, targetPassword)
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	targetUser, err := tx.CreateUser(ctx, &store.User{
		Username:            "totp-target",
		PasswordHash:        targetHash,
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

	// Login as target user and set up + verify TOTP.
	targetClient := loginClient(t, server.URL, "totp-target", targetPassword)

	setupResp := doJSON(t, targetClient, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = setupResp.Body.Close() }()

	var setup totpSetupResponse
	if err := json.NewDecoder(setupResp.Body).Decode(&setup); err != nil {
		t.Fatalf("decode setup: %v", err)
	}

	code, err := auth.ComputeTOTPCode(setup.Secret, time.Now())
	if err != nil {
		t.Fatalf("compute TOTP code: %v", err)
	}
	verifyResp := doJSON(t, targetClient, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{Code: code})
	defer func() { _ = verifyResp.Body.Close() }()

	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("TOTP verify for target: expected 200, got %d", verifyResp.StatusCode)
	}

	// Now login as root (superadmin) and reset the target user's TOTP.
	rootClient := loginClient(t, server.URL, "root", rootPassword)

	resetResp := doJSON(t, rootClient, http.MethodPost, server.URL+"/api/v1/users/"+targetUser.ID+"/totp/reset", nil)
	defer func() { _ = resetResp.Body.Close() }()

	if resetResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resetResp.Body).Decode(&pd)
		t.Fatalf("TOTP reset: expected 200, got %d: %s", resetResp.StatusCode, pd.Detail)
	}

	var okResp map[string]bool
	if err := json.NewDecoder(resetResp.Body).Decode(&okResp); err != nil {
		t.Fatalf("decode reset response: %v", err)
	}
	if !okResp["ok"] {
		t.Error("expected ok=true in reset response")
	}

	// Verify the TOTP was actually cleared by checking the user record.
	rtx, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rtx.Rollback() }()

	updatedUser, err := rtx.GetUser(ctx, targetUser.ID)
	if err != nil {
		t.Fatalf("get target user: %v", err)
	}

	if updatedUser.TOTPEnabled {
		t.Error("expected TOTPEnabled to be false after admin reset")
	}
	if updatedUser.TOTPSecret != nil {
		t.Errorf("expected TOTPSecret to be nil after admin reset, got %v", updatedUser.TOTPSecret)
	}
}

func TestTOTPRoutes_Reset_NotFound(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	rootClient := loginClient(t, server.URL, "root", rootPassword)

	resetResp := doJSON(t, rootClient, http.MethodPost, server.URL+"/api/v1/users/nonexistent-user-id/totp/reset", nil)
	defer func() { _ = resetResp.Body.Close() }()

	if resetResp.StatusCode != http.StatusNotFound {
		t.Fatalf("TOTP reset not found: expected 404, got %d", resetResp.StatusCode)
	}
}

func TestTOTPRoutes_Disable_EmptyPassword(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Disable with empty current password — should return 400 validation error.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/disable", totpDisableRequest{
		CurrentPassword: "",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("TOTP disable empty password: expected 400, got %d", resp.StatusCode)
	}
}

func TestTOTPRoutes_Verify_InvalidJSON(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Send invalid JSON to the verify endpoint.
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/totp/verify",
		strings.NewReader("not-json"))
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
		t.Fatalf("TOTP verify invalid JSON: expected 400, got %d", resp.StatusCode)
	}
}

func TestTOTPRoutes_Disable_InvalidJSON(t *testing.T) {
	server, _, rootPassword := setupTOTPTestServer(t)
	client := loginClient(t, server.URL, "root", rootPassword)

	// Send invalid JSON to the disable endpoint.
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/totp/disable",
		strings.NewReader("not-json"))
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
		t.Fatalf("TOTP disable invalid JSON: expected 400, got %d", resp.StatusCode)
	}
}

func TestTOTPRoutes_Reset_Forbidden(t *testing.T) {
	server, drv, rootPassword := setupTOTPTestServer(t)
	ctx := context.Background()
	_ = rootPassword

	// Create an unprivileged user.
	userPassword := "NormalUser123!!"
	hash := cachedHashPassword(t, userPassword)
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateUser(ctx, &store.User{
		Username:            "normal-user",
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

	// Login as unprivileged user.
	normalClient := loginClient(t, server.URL, "normal-user", userPassword)

	// Attempt to reset another user's TOTP — should be 403 forbidden.
	resp := doJSON(t, normalClient, http.MethodPost, server.URL+"/api/v1/users/some-user-id/totp/reset", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("TOTP reset as unprivileged user: expected 403, got %d", resp.StatusCode)
	}
}

// TestTOTPRoutes_Unauthenticated verifies that TOTP endpoints return 401
// when accessed without authentication.
func TestTOTPRoutes_Unauthenticated(t *testing.T) {
	server, _, _ := setupTOTPTestServer(t)
	client := &http.Client{}

	paths := []string{
		"/api/v1/auth/totp/setup",
		"/api/v1/auth/totp/verify",
		"/api/v1/auth/totp/disable",
		"/api/v1/users/some-id/totp/reset",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			resp := doJSON(t, client, http.MethodPost, server.URL+path, map[string]string{"code": "123456"})
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("unauthenticated %s: expected 401, got %d", path, resp.StatusCode)
			}
		})
	}
}

// TestTOTPRoutes_ResolveAuthenticatedUser_BearerToken tests TOTP setup using
// a bearer token instead of a session cookie, exercising the ClaimsFromContext
// branch of resolveAuthenticatedUser.
func TestTOTPRoutes_ResolveAuthenticatedUser_BearerToken(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "totp_bearer.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	// Create a user.
	hash := cachedHashPassword(t, "TestPassword123!")
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	user, err := tx.CreateUser(ctx, &store.User{
		Username:            "bearer-user",
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

	// Issue a JWT bearer token directly for this user.
	pair, err := a.IssueTokenPair(ctx, user.ID, []string{"admin"})
	if err != nil {
		t.Fatalf("issue token pair: %v", err)
	}

	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterTOTPRoutes(mux, drv, a, sm, enc)

	var handler http.Handler = mux
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = AuthMiddleware(a, sm)(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	// Call TOTP setup with bearer token.
	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+pair.AccessToken)

	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("TOTP setup via bearer: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var setup totpSetupResponse
	if err := json.NewDecoder(resp.Body).Decode(&setup); err != nil {
		t.Fatalf("decode setup: %v", err)
	}
	if setup.Secret == "" {
		t.Error("expected non-empty secret from bearer auth setup")
	}
	// When using bearer token, username is empty in claims, so the handler
	// falls back to the stored username. Verify the QR URI contains the
	// user's actual username.
	if !strings.Contains(setup.QRURI, "bearer-user") {
		t.Errorf("expected qrUri to contain 'bearer-user', got %q", setup.QRURI)
	}
}

// TestTOTPRoutes_Setup_UserNotFound tests the setup handler when the
// authenticated user ID no longer exists in the database. This exercises
// the user-not-found error path in handleTOTPSetup.
func TestTOTPRoutes_Setup_UserNotFound(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "totp_setup_notfound.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	encKey, err := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	handler := handleTOTPSetup(drv, enc)

	// Inject session claims with a non-existent user ID.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/totp/setup", nil)
	claims := &auth.SessionClaims{
		SessionID: "fake-session",
		UserID:    "nonexistent-user-id",
		Username:  "ghost",
	}
	req = req.WithContext(auth.WithSessionClaims(req.Context(), claims))

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("setup user not found: expected 404, got %d", rr.Code)
	}
}

// TestTOTPRoutes_Verify_UserNotFound tests the verify handler when the
// authenticated user ID no longer exists in the database.
func TestTOTPRoutes_Verify_UserNotFound(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "totp_verify_notfound.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	sm := auth.NewSessionManager(drv, true)
	encKey, err := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	handler := handleTOTPVerify(drv, sm, enc)

	body := `{"code":"123456"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/totp/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	claims := &auth.SessionClaims{
		SessionID: "fake-session",
		UserID:    "nonexistent-user-id",
		Username:  "ghost",
	}
	req = req.WithContext(auth.WithSessionClaims(req.Context(), claims))

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("verify user not found: expected 404, got %d", rr.Code)
	}
}

// TestTOTPRoutes_Disable_UserNotFound tests the disable handler when the
// authenticated user ID no longer exists in the database.
func TestTOTPRoutes_Disable_UserNotFound(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "totp_disable_notfound.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	sm := auth.NewSessionManager(drv, true)
	encKey, err := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	handler := handleTOTPDisable(drv, sm, enc)

	body := `{"currentPassword":"SomePass123!"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/totp/disable", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	claims := &auth.SessionClaims{
		SessionID: "fake-session",
		UserID:    "nonexistent-user-id",
		Username:  "ghost",
	}
	req = req.WithContext(auth.WithSessionClaims(req.Context(), claims))

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("disable user not found: expected 404, got %d", rr.Code)
	}
}

// TestTOTPRoutes_Reset_EmptyPathValue tests the reset handler when the {id}
// path value is empty. This exercises the validation path in handleTOTPReset.
func TestTOTPRoutes_Reset_EmptyPathValue(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "totp_reset_empty.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	handler := handleTOTPReset(drv)

	// Call handler directly without a path value for {id}.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users//totp/reset", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("reset empty path value: expected 400, got %d", rr.Code)
	}
}

// TestTOTPRoutes_Reset_UserNotFound_Direct tests the reset handler when the
// target user ID doesn't exist, called directly to bypass middleware.
func TestTOTPRoutes_Reset_UserNotFound_Direct(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "totp_reset_notfound.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	// Register on a mux so {id} path value is resolved.
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/users/{id}/totp/reset", handleTOTPReset(drv))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/nonexistent-id/totp/reset", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("reset user not found direct: expected 404, got %d", rr.Code)
	}
}

// TestTOTPRoutes_ResolveAuthenticatedUser_NoAuth tests the resolveAuthenticatedUser
// helper when no session or bearer claims are present. This exercises lines 361-363
// by calling the handler directly without the AuthMiddleware.
func TestTOTPRoutes_ResolveAuthenticatedUser_NoAuth(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "totp_noauth.db")
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

	encKey, err := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	// Register routes WITHOUT the AuthMiddleware so requests reach the handler
	// without any claims in the context.
	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterTOTPRoutes(mux, drv, a, sm, enc)

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := &http.Client{}

	// Call setup without any auth — should get 401 from resolveAuthenticatedUser.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("setup without auth: expected 401, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Title != "Authentication required" {
		t.Errorf("expected title 'Authentication required', got %q", pd.Title)
	}
}
