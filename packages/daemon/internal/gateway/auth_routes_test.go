package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
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

// setupAuthTestServer creates a fully wired test server with auth routes,
// TOTP routes, and key routes registered. Returns the server, store driver,
// auth instance, root password, and bootstrap token.
func setupAuthTestServer(t *testing.T) (*httptest.Server, store.Driver, *auth.Auth, string, string) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "auth_routes.db")
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

	// Create bootstrap token.
	bootstrapToken, err := auth.GenerateBootstrapToken()
	if err != nil {
		t.Fatal(err)
	}
	tx2, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx2.CreateAPIKey(ctx, "bootstrap", auth.HashToken(bootstrapToken), []string{"admin"}, nil, "")
	if err != nil {
		_ = tx2.Rollback()
		t.Fatal(err)
	}
	if err := tx2.Commit(); err != nil {
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
	RegisterKeyRoutes(mux, drv)

	var handler http.Handler = mux
	handler = SecurityHeadersMiddleware(handler)
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	return server, drv, a, rootPassword, bootstrapToken
}

// ---------------------------------------------------------------------------
// Token Exchange
// ---------------------------------------------------------------------------

func TestAuthRoutes_TokenExchange_Bootstrap(t *testing.T) {
	server, _, _, _, bootstrapToken := setupAuthTestServer(t)
	client := &http.Client{}

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/token", map[string]string{
		"token": bootstrapToken,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var pair auth.TokenPair
	if err := json.NewDecoder(resp.Body).Decode(&pair); err != nil {
		t.Fatalf("decode token pair: %v", err)
	}
	if pair.AccessToken == "" {
		t.Error("expected non-empty access_token")
	}
	if pair.RefreshToken == "" {
		t.Error("expected non-empty refresh_token")
	}
	if pair.TokenType != "Bearer" {
		t.Errorf("token_type = %q, want Bearer", pair.TokenType)
	}
	if pair.ExpiresIn <= 0 {
		t.Errorf("expected positive expires_in, got %d", pair.ExpiresIn)
	}
}

func TestAuthRoutes_TokenExchange_APIKey(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	// Log in to create an API key.
	adminClient := loginClient(t, server.URL, "root", rootPassword)

	// Create an API key via the key routes.
	_, rawKey := createKeyViaAPI(t, adminClient, server.URL, map[string]string{
		"name": "exchange-test-key",
	})

	// Exchange the API key for tokens.
	unauthClient := &http.Client{}
	resp := doJSON(t, unauthClient, http.MethodPost, server.URL+"/api/v1/auth/token", map[string]string{
		"token": rawKey,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var pair auth.TokenPair
	if err := json.NewDecoder(resp.Body).Decode(&pair); err != nil {
		t.Fatalf("decode token pair: %v", err)
	}
	if pair.AccessToken == "" {
		t.Error("expected non-empty access_token")
	}
	if pair.RefreshToken == "" {
		t.Error("expected non-empty refresh_token")
	}
}

func TestAuthRoutes_TokenExchange_Invalid(t *testing.T) {
	server, _, _, _, _ := setupAuthTestServer(t)
	client := &http.Client{}

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/token", map[string]string{
		"token": "rku_tok_invalid_token_value_here",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}

	wwwAuth := resp.Header.Get("WWW-Authenticate")
	if wwwAuth != "Bearer" {
		t.Errorf("WWW-Authenticate = %q, want Bearer", wwwAuth)
	}
}

func TestAuthRoutes_TokenExchange_EmptyToken(t *testing.T) {
	server, _, _, _, _ := setupAuthTestServer(t)
	client := &http.Client{}

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/token", map[string]string{
		"token": "",
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
}

func TestAuthRoutes_TokenExchange_InvalidJSON(t *testing.T) {
	server, _, _, _, _ := setupAuthTestServer(t)
	client := &http.Client{}

	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/token",
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
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

func TestAuthRoutes_TokenRefresh(t *testing.T) {
	server, _, _, _, bootstrapToken := setupAuthTestServer(t)
	client := &http.Client{}

	// First, exchange bootstrap token for an initial token pair.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/token", map[string]string{
		"token": bootstrapToken,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("token exchange: expected 200, got %d", resp.StatusCode)
	}

	var initialPair auth.TokenPair
	if err := json.NewDecoder(resp.Body).Decode(&initialPair); err != nil {
		t.Fatalf("decode initial pair: %v", err)
	}

	// Now refresh the tokens.
	refreshResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/refresh", map[string]string{
		"refreshToken": initialPair.RefreshToken,
	})
	defer func() { _ = refreshResp.Body.Close() }()

	if refreshResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(refreshResp.Body).Decode(&pd)
		t.Fatalf("refresh: expected 200, got %d: %s", refreshResp.StatusCode, pd.Detail)
	}

	var newPair auth.TokenPair
	if err := json.NewDecoder(refreshResp.Body).Decode(&newPair); err != nil {
		t.Fatalf("decode new pair: %v", err)
	}

	if newPair.AccessToken == "" {
		t.Error("expected non-empty access_token after refresh")
	}
	if newPair.RefreshToken == "" {
		t.Error("expected non-empty refresh_token after refresh")
	}
	if newPair.AccessToken == initialPair.AccessToken {
		t.Error("expected new access_token to differ from initial")
	}
}

func TestAuthRoutes_TokenRefresh_Invalid(t *testing.T) {
	server, _, _, _, _ := setupAuthTestServer(t)
	client := &http.Client{}

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/refresh", map[string]string{
		"refreshToken": "rku_ref_invalid_refresh_token_value",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}

	wwwAuth := resp.Header.Get("WWW-Authenticate")
	if wwwAuth != "Bearer" {
		t.Errorf("WWW-Authenticate = %q, want Bearer", wwwAuth)
	}
}

func TestAuthRoutes_TokenRefresh_EmptyToken(t *testing.T) {
	server, _, _, _, _ := setupAuthTestServer(t)
	client := &http.Client{}

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/refresh", map[string]string{
		"refreshToken": "",
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
}

// ---------------------------------------------------------------------------
// Login edge cases
// ---------------------------------------------------------------------------

func TestAuthRoutes_Login_NonexistentUser(t *testing.T) {
	server, _, _, _, _ := setupAuthTestServer(t)
	client := &http.Client{}

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "does-not-exist",
		"password": "SomePassword123!",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestAuthRoutes_Login_SuspendedAccount(t *testing.T) {
	server, drv, _, _, _ := setupAuthTestServer(t)
	ctx := context.Background()

	// Create a user and suspend them.
	suspendedPassword := "SuspendedUser123!"
	hash, err := auth.HashPassword(suspendedPassword)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateUser(ctx, &store.User{
		Username:            "suspended-user",
		PasswordHash:        hash,
		Status:              "suspended",
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

	client := &http.Client{}
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "suspended-user",
		"password": suspendedPassword,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if !strings.Contains(pd.Title, "suspended") {
		t.Errorf("expected title to contain 'suspended', got %q", pd.Title)
	}
}

func TestAuthRoutes_Login_EmptyFields(t *testing.T) {
	server, _, _, _, _ := setupAuthTestServer(t)
	client := &http.Client{}

	// Empty username and password.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "",
		"password": "",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if len(pd.Errors) < 2 {
		t.Errorf("expected at least 2 validation errors, got %d", len(pd.Errors))
	}
}

func TestAuthRoutes_Login_InvalidJSON(t *testing.T) {
	server, _, _, _, _ := setupAuthTestServer(t)
	client := &http.Client{}

	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/login",
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
}

func TestAuthRoutes_Login_WithTOTP(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	// Step 1: Login as root and enable TOTP.
	client := loginClient(t, server.URL, "root", rootPassword)

	// Setup TOTP.
	setupResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = setupResp.Body.Close() }()

	if setupResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(setupResp.Body).Decode(&pd)
		t.Fatalf("TOTP setup: expected 200, got %d: %s", setupResp.StatusCode, pd.Detail)
	}

	var setup totpSetupResponse
	if err := json.NewDecoder(setupResp.Body).Decode(&setup); err != nil {
		t.Fatalf("decode setup: %v", err)
	}

	// Verify TOTP to enable it.
	totpCode, err := auth.ComputeTOTPCode(setup.Secret, time.Now())
	if err != nil {
		t.Fatalf("compute TOTP code: %v", err)
	}

	verifyResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{
		Code: totpCode,
	})
	defer func() { _ = verifyResp.Body.Close() }()

	if verifyResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(verifyResp.Body).Decode(&pd)
		t.Fatalf("TOTP verify: expected 200, got %d: %s", verifyResp.StatusCode, pd.Detail)
	}

	// Step 2: Login without TOTP code -- should get requiresTotp response.
	freshClient := &http.Client{}
	loginResp := doJSON(t, freshClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = loginResp.Body.Close() }()

	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login without TOTP: expected 200, got %d", loginResp.StatusCode)
	}

	var totpRequired totpRequiredResponse
	if err := json.NewDecoder(loginResp.Body).Decode(&totpRequired); err != nil {
		t.Fatalf("decode TOTP required response: %v", err)
	}
	if !totpRequired.RequiresTOTP {
		t.Error("expected requiresTotp to be true")
	}
	if totpRequired.UserID == "" {
		t.Error("expected non-empty userId")
	}

	// Step 3: Login with valid TOTP code -- should succeed.
	validCode, err := auth.ComputeTOTPCode(setup.Secret, time.Now())
	if err != nil {
		t.Fatalf("compute TOTP code for login: %v", err)
	}

	totpLoginResp := doJSON(t, freshClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]any{
		"username": "root",
		"password": rootPassword,
		"totpCode": validCode,
	})
	defer func() { _ = totpLoginResp.Body.Close() }()

	if totpLoginResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(totpLoginResp.Body).Decode(&pd)
		t.Fatalf("TOTP login: expected 200, got %d: %s", totpLoginResp.StatusCode, pd.Detail)
	}

	var lr loginResponse
	if err := json.NewDecoder(totpLoginResp.Body).Decode(&lr); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	if lr.User.Username != "root" {
		t.Errorf("username = %q, want root", lr.User.Username)
	}
	if lr.Session.ID == "" {
		t.Error("expected non-empty session ID")
	}
}

func TestAuthRoutes_Login_WithBackupCode(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	// Step 1: Login and enable TOTP to get backup codes.
	client := loginClient(t, server.URL, "root", rootPassword)

	setupResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/setup", nil)
	defer func() { _ = setupResp.Body.Close() }()

	if setupResp.StatusCode != http.StatusOK {
		t.Fatalf("TOTP setup: expected 200, got %d", setupResp.StatusCode)
	}

	var setup totpSetupResponse
	if err := json.NewDecoder(setupResp.Body).Decode(&setup); err != nil {
		t.Fatalf("decode setup: %v", err)
	}

	totpCode, err := auth.ComputeTOTPCode(setup.Secret, time.Now())
	if err != nil {
		t.Fatalf("compute TOTP code: %v", err)
	}

	verifyResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/totp/verify", totpVerifyRequest{
		Code: totpCode,
	})
	defer func() { _ = verifyResp.Body.Close() }()

	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("TOTP verify: expected 200, got %d", verifyResp.StatusCode)
	}

	var verifyResult totpVerifyResponse
	if err := json.NewDecoder(verifyResp.Body).Decode(&verifyResult); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}
	if len(verifyResult.BackupCodes) == 0 {
		t.Fatal("expected non-empty backup codes")
	}

	backupCode := verifyResult.BackupCodes[0]

	// Step 2: Login with backup code instead of TOTP.
	freshClient := &http.Client{}
	loginResp := doJSON(t, freshClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]any{
		"username": "root",
		"password": rootPassword,
		"totpCode": backupCode,
	})
	defer func() { _ = loginResp.Body.Close() }()

	if loginResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(loginResp.Body).Decode(&pd)
		t.Fatalf("backup code login: expected 200, got %d: %s", loginResp.StatusCode, pd.Detail)
	}

	var lr loginResponse
	if err := json.NewDecoder(loginResp.Body).Decode(&lr); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	if lr.User.Username != "root" {
		t.Errorf("username = %q, want root", lr.User.Username)
	}
}

// ---------------------------------------------------------------------------
// Password change edge cases
// ---------------------------------------------------------------------------

func TestAuthRoutes_PasswordChange_WrongCurrent(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	client := loginClient(t, server.URL, "root", rootPassword)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/password", map[string]string{
		"currentPassword": "WrongCurrent123!",
		"newPassword":     "NewSecurePass123!",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestAuthRoutes_PasswordChange_WeakNew(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	client := loginClient(t, server.URL, "root", rootPassword)

	// "short" is too short (default policy requires 12 characters).
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/password", map[string]string{
		"currentPassword": rootPassword,
		"newPassword":     "short",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if !strings.Contains(pd.Title, "policy") {
		t.Errorf("expected title to contain 'policy', got %q", pd.Title)
	}
}

func TestAuthRoutes_PasswordChange_EmptyFields(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	client := loginClient(t, server.URL, "root", rootPassword)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/password", map[string]string{
		"currentPassword": "",
		"newPassword":     "",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if len(pd.Errors) < 2 {
		t.Errorf("expected at least 2 validation errors, got %d", len(pd.Errors))
	}
}

// ---------------------------------------------------------------------------
// Profile update
// ---------------------------------------------------------------------------

func TestAuthRoutes_UpdateProfile(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	client := loginClient(t, server.URL, "root", rootPassword)

	displayName := "Root Admin"
	email := "root@rioku.dev"
	resp := doJSON(t, client, http.MethodPatch, server.URL+"/api/v1/auth/me", map[string]string{
		"displayName": displayName,
		"email":       email,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var profile updateProfileResponse
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		t.Fatalf("decode profile: %v", err)
	}
	if profile.DisplayName != displayName {
		t.Errorf("displayName = %q, want %q", profile.DisplayName, displayName)
	}
	if profile.Email != email {
		t.Errorf("email = %q, want %q", profile.Email, email)
	}
	if profile.Username != "root" {
		t.Errorf("username = %q, want root", profile.Username)
	}
}

func TestAuthRoutes_UpdateProfile_InvalidJSON(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	client := loginClient(t, server.URL, "root", rootPassword)

	req, err := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/auth/me",
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
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

func TestAuthRoutes_ListSessions(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	client := loginClient(t, server.URL, "root", rootPassword)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/auth/sessions", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var sessions []sessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}
	if len(sessions) < 1 {
		t.Fatalf("expected at least 1 session, got %d", len(sessions))
	}

	// Verify session fields are populated.
	s := sessions[0]
	if s.ID == "" {
		t.Error("expected non-empty session ID")
	}
	if s.CreatedAt == "" {
		t.Error("expected non-empty createdAt")
	}
	if s.ExpiresAt == "" {
		t.Error("expected non-empty expiresAt")
	}
}

func TestAuthRoutes_RevokeSession(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	// Login to create a session.
	client := loginClient(t, server.URL, "root", rootPassword)

	// List sessions.
	listResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/auth/sessions", nil)
	defer func() { _ = listResp.Body.Close() }()

	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list sessions: expected 200, got %d", listResp.StatusCode)
	}

	var sessions []sessionResponse
	if err := json.NewDecoder(listResp.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}
	if len(sessions) == 0 {
		t.Fatal("expected at least 1 session")
	}

	sessionID := sessions[0].ID

	// Revoke own session.
	revokeResp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/auth/sessions/"+sessionID, nil)
	defer func() { _ = revokeResp.Body.Close() }()

	if revokeResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(revokeResp.Body).Decode(&pd)
		t.Fatalf("revoke session: expected 200, got %d: %s", revokeResp.StatusCode, pd.Detail)
	}

	var result map[string]bool
	if err := json.NewDecoder(revokeResp.Body).Decode(&result); err != nil {
		t.Fatalf("decode revoke response: %v", err)
	}
	if !result["ok"] {
		t.Error("expected ok=true in revoke response")
	}
}

func TestAuthRoutes_RevokeSession_NotOwned(t *testing.T) {
	server, drv, _, rootPassword, _ := setupAuthTestServer(t)
	ctx := context.Background()

	// Create a second unprivileged user.
	normalPassword := "NormalUser12345!"
	hash, err := auth.HashPassword(normalPassword)
	if err != nil {
		t.Fatal(err)
	}
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

	// Login as root to create a root session.
	rootClient := loginClient(t, server.URL, "root", rootPassword)

	// Get root's session ID.
	listResp := doJSON(t, rootClient, http.MethodGet, server.URL+"/api/v1/auth/sessions", nil)
	defer func() { _ = listResp.Body.Close() }()

	var rootSessions []sessionResponse
	if err := json.NewDecoder(listResp.Body).Decode(&rootSessions); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}
	if len(rootSessions) == 0 {
		t.Fatal("expected at least 1 root session")
	}
	rootSessionID := rootSessions[0].ID

	// Login as normal user.
	normalClient := loginClient(t, server.URL, "normal-user", normalPassword)

	// Try to revoke root's session as normal user.
	revokeResp := doJSON(t, normalClient, http.MethodDelete, server.URL+"/api/v1/auth/sessions/"+rootSessionID, nil)
	defer func() { _ = revokeResp.Body.Close() }()

	if revokeResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", revokeResp.StatusCode)
	}
}

func TestAuthRoutes_RevokeSession_NotFound(t *testing.T) {
	server, _, _, rootPassword, _ := setupAuthTestServer(t)

	client := loginClient(t, server.URL, "root", rootPassword)

	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/auth/sessions/nonexistent-session-id", nil)
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
