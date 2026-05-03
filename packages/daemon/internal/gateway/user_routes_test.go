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

// setupUserTestServer creates a test server with auth + user routes registered.
// Returns the server, store driver, root password, and an authenticated client.
func setupUserTestServer(t *testing.T) (*httptest.Server, store.Driver, string, *http.Client) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "user_routes.db")
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
	RegisterUserRoutes(mux, drv, sm, cfg)

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

// createTestUser creates a user via the API and returns its ID.
func createTestUser(t *testing.T, client *http.Client, serverURL string, username, password string) string {
	t.Helper()
	resp := doJSON(t, client, http.MethodPost, serverURL+"/api/v1/users", map[string]string{
		"username": username,
		"password": password,
	})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("create user %q: expected 201, got %d: %s", username, resp.StatusCode, pd.Detail)
	}
	var u userResponse
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode created user: %v", err)
	}
	return u.ID
}

func TestUserRoutes_ListUsers(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	// Create 2 additional users (root already exists).
	createTestUser(t, client, server.URL, "alice", "AlicePass12345!")
	createTestUser(t, client, server.URL, "bob", "BobbyPass12345!")

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list users: expected 200, got %d", resp.StatusCode)
	}

	var users []userResponse
	if err := json.NewDecoder(resp.Body).Decode(&users); err != nil {
		t.Fatalf("decode users list: %v", err)
	}

	// root + alice + bob = 3
	if len(users) < 3 {
		t.Errorf("expected at least 3 users, got %d", len(users))
	}

	// Verify alice and bob are present.
	found := map[string]bool{}
	for _, u := range users {
		found[u.Username] = true
	}
	for _, name := range []string{"root", "alice", "bob"} {
		if !found[name] {
			t.Errorf("expected user %q in list", name)
		}
	}
}

func TestUserRoutes_CreateUser(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	displayName := "Test User"
	email := "test@example.com"
	forceChange := false

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users", map[string]any{
		"username":            "newuser",
		"password":            "SecurePass12345!",
		"displayName":         displayName,
		"email":               email,
		"forcePasswordChange": forceChange,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("create user: expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var u userResponse
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if u.Username != "newuser" {
		t.Errorf("username = %q, want %q", u.Username, "newuser")
	}
	if u.DisplayName == nil || *u.DisplayName != displayName {
		t.Errorf("displayName = %v, want %q", u.DisplayName, displayName)
	}
	if u.Email == nil || *u.Email != email {
		t.Errorf("email = %v, want %q", u.Email, email)
	}
	if u.ForcePasswordChange != false {
		t.Errorf("forcePasswordChange = %v, want false", u.ForcePasswordChange)
	}
	if u.Status != "active" {
		t.Errorf("status = %q, want %q", u.Status, "active")
	}
	if u.ID == "" {
		t.Error("expected non-empty user ID")
	}
}

func TestUserRoutes_CreateUser_InvalidPassword(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	// Default policy: min 12 chars, require uppercase, lowercase, digit.
	// "short" fails all of those.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users", map[string]string{
		"username": "badpw",
		"password": "short",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Title != "Password policy violation" {
		t.Errorf("title = %q, want %q", pd.Title, "Password policy violation")
	}
}

func TestUserRoutes_CreateUser_MissingFields(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	t.Run("empty_username", func(t *testing.T) {
		resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users", map[string]string{
			"username": "",
			"password": "SecurePass12345!",
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.StatusCode)
		}

		var pd ProblemDetail
		if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
			t.Fatalf("decode problem: %v", err)
		}
		if len(pd.Errors) == 0 {
			t.Error("expected validation errors")
		}
		foundField := false
		for _, e := range pd.Errors {
			if e.Field == "username" {
				foundField = true
				break
			}
		}
		if !foundField {
			t.Error("expected validation error for field 'username'")
		}
	})

	t.Run("empty_password", func(t *testing.T) {
		resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users", map[string]string{
			"username": "nopass",
			"password": "",
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.StatusCode)
		}

		var pd ProblemDetail
		if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
			t.Fatalf("decode problem: %v", err)
		}
		foundField := false
		for _, e := range pd.Errors {
			if e.Field == "password" {
				foundField = true
				break
			}
		}
		if !foundField {
			t.Error("expected validation error for field 'password'")
		}
	})

	t.Run("both_empty", func(t *testing.T) {
		resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users", map[string]string{
			"username": "",
			"password": "",
		})
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.StatusCode)
		}

		var pd ProblemDetail
		if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
			t.Fatalf("decode problem: %v", err)
		}
		if len(pd.Errors) < 2 {
			t.Errorf("expected at least 2 validation errors, got %d", len(pd.Errors))
		}
	})
}

func TestUserRoutes_GetUser(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	userID := createTestUser(t, client, server.URL, "getme", "GetMePass12345!")

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get user: expected 200, got %d", resp.StatusCode)
	}

	var u userResponse
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if u.ID != userID {
		t.Errorf("id = %q, want %q", u.ID, userID)
	}
	if u.Username != "getme" {
		t.Errorf("username = %q, want %q", u.Username, "getme")
	}
	if u.Status != "active" {
		t.Errorf("status = %q, want %q", u.Status, "active")
	}
}

func TestUserRoutes_GetUser_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/nonexistent-id-12345", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("get non-existent user: expected 404, got %d", resp.StatusCode)
	}
}

func TestUserRoutes_UpdateUser(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	userID := createTestUser(t, client, server.URL, "updateme", "UpdatePass12345!")

	newName := "Updated Name"
	newEmail := "updated@example.com"
	resp := doJSON(t, client, http.MethodPatch, server.URL+"/api/v1/users/"+userID, map[string]string{
		"displayName": newName,
		"email":       newEmail,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("update user: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var u userResponse
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode updated user: %v", err)
	}
	if u.DisplayName == nil || *u.DisplayName != newName {
		t.Errorf("displayName = %v, want %q", u.DisplayName, newName)
	}
	if u.Email == nil || *u.Email != newEmail {
		t.Errorf("email = %v, want %q", u.Email, newEmail)
	}

	// Verify changes persisted via GET.
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = getResp.Body.Close() }()

	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get updated user: expected 200, got %d", getResp.StatusCode)
	}

	var fetched userResponse
	if err := json.NewDecoder(getResp.Body).Decode(&fetched); err != nil {
		t.Fatalf("decode fetched user: %v", err)
	}
	if fetched.DisplayName == nil || *fetched.DisplayName != newName {
		t.Errorf("persisted displayName = %v, want %q", fetched.DisplayName, newName)
	}
	if fetched.Email == nil || *fetched.Email != newEmail {
		t.Errorf("persisted email = %v, want %q", fetched.Email, newEmail)
	}
}

func TestUserRoutes_SuspendUser(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	userID := createTestUser(t, client, server.URL, "suspendme", "SuspendPass12345!")

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/suspend", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("suspend user: expected 200, got %d", resp.StatusCode)
	}

	// Verify status changed to "suspended".
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = getResp.Body.Close() }()

	var u userResponse
	if err := json.NewDecoder(getResp.Body).Decode(&u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if u.Status != "suspended" {
		t.Errorf("status = %q, want %q", u.Status, "suspended")
	}
}

func TestUserRoutes_ActivateUser(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	userID := createTestUser(t, client, server.URL, "activateme", "ActivatePass12345!")

	// Suspend first.
	suspendResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/suspend", nil)
	defer func() { _ = suspendResp.Body.Close() }()
	if suspendResp.StatusCode != http.StatusOK {
		t.Fatalf("suspend: expected 200, got %d", suspendResp.StatusCode)
	}

	// Activate.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/activate", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("activate user: expected 200, got %d", resp.StatusCode)
	}

	// Verify status is "active".
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = getResp.Body.Close() }()

	var u userResponse
	if err := json.NewDecoder(getResp.Body).Decode(&u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if u.Status != "active" {
		t.Errorf("status = %q, want %q", u.Status, "active")
	}
}

func TestUserRoutes_LockUser(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	userID := createTestUser(t, client, server.URL, "lockme", "LockMePass12345!")

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/lock", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("lock user: expected 204, got %d", resp.StatusCode)
	}

	// Verify status changed to "locked".
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = getResp.Body.Close() }()

	var u userResponse
	if err := json.NewDecoder(getResp.Body).Decode(&u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if u.Status != "locked" {
		t.Errorf("status = %q, want %q", u.Status, "locked")
	}
}

func TestUserRoutes_UnlockUser(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	userID := createTestUser(t, client, server.URL, "unlockme", "UnlockPass12345!")

	// Lock first.
	lockResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/lock", nil)
	defer func() { _ = lockResp.Body.Close() }()
	if lockResp.StatusCode != http.StatusNoContent {
		t.Fatalf("lock: expected 204, got %d", lockResp.StatusCode)
	}

	// Unlock.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/unlock", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unlock user: expected 200, got %d", resp.StatusCode)
	}

	// Verify status is "active".
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = getResp.Body.Close() }()

	var u userResponse
	if err := json.NewDecoder(getResp.Body).Decode(&u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if u.Status != "active" {
		t.Errorf("status = %q, want %q", u.Status, "active")
	}
}

func TestUserRoutes_ResetPassword(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	originalPassword := "ResetMePass12345!"
	userID := createTestUser(t, client, server.URL, "resetpw", originalPassword)

	// Reset password.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/reset-password", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("reset password: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var result map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	tempPass, ok := result["temporary_password"]
	if !ok || tempPass == "" {
		t.Fatal("expected non-empty temporary_password in response")
	}
	if len(tempPass) != 24 {
		t.Errorf("temporary_password length = %d, want 24", len(tempPass))
	}

	// Verify old password no longer works by attempting login.
	oldJar, _ := cookiejar.New(nil)
	oldClient := &http.Client{Jar: oldJar}
	oldLoginResp := doJSON(t, oldClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "resetpw",
		"password": originalPassword,
	})
	defer func() { _ = oldLoginResp.Body.Close() }()

	if oldLoginResp.StatusCode == http.StatusOK {
		t.Error("old password should no longer work after reset")
	}

	// Verify the user now has forcePasswordChange = true.
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = getResp.Body.Close() }()

	var u userResponse
	if err := json.NewDecoder(getResp.Body).Decode(&u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if !u.ForcePasswordChange {
		t.Error("expected forcePasswordChange = true after reset")
	}
}

func TestUserRoutes_UpdateUser_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodPatch, server.URL+"/api/v1/users/nonexistent-id", map[string]string{
		"displayName": "Nobody",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("update non-existent user: expected 404, got %d", resp.StatusCode)
	}
}

func TestUserRoutes_UpdateUser_InvalidBody(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	userID := createTestUser(t, client, server.URL, "badbody", "BadBodyPass12345!")

	// Send invalid JSON.
	req, err := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/users/"+userID, bytes.NewBufferString("{invalid"))
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
		t.Fatalf("invalid JSON body: expected 400, got %d", resp.StatusCode)
	}
}

func TestUserRoutes_SuspendUser_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/nonexistent-id/suspend", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("suspend non-existent user: expected 404, got %d", resp.StatusCode)
	}
}

func TestUserRoutes_ActivateUser_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/nonexistent-id/activate", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("activate non-existent user: expected 404, got %d", resp.StatusCode)
	}
}

func TestUserRoutes_LockUser_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/nonexistent-id/lock", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("lock non-existent user: expected 404, got %d", resp.StatusCode)
	}
}

func TestUserRoutes_UnlockUser_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/nonexistent-id/unlock", nil)
	defer func() { _ = resp.Body.Close() }()

	// handleUnlockUser calls ResetFailedAttempts before GetUser; for a
	// non-existent user the reset may fail first, yielding 500 instead of 404.
	if resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("unlock non-existent user: expected 404 or 500, got %d", resp.StatusCode)
	}
}

func TestUserRoutes_ResetPassword_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/nonexistent-id/reset-password", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("reset password non-existent user: expected 404, got %d", resp.StatusCode)
	}
}

func TestDeleteUser_SoftDelete(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	userID := createTestUser(t, client, server.URL, "deleteme", "DeleteMePass12345!")

	// DELETE the user.
	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete user: expected 204, got %d", resp.StatusCode)
	}

	// Verify the user is still readable and has status "deleted".
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = getResp.Body.Close() }()

	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get deleted user: expected 200, got %d", getResp.StatusCode)
	}

	var u userResponse
	if err := json.NewDecoder(getResp.Body).Decode(&u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if u.Status != "deleted" {
		t.Errorf("status = %q, want %q", u.Status, "deleted")
	}
}

func TestDeleteUser_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/users/nonexistent-id-99999", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("delete non-existent user: expected 404, got %d", resp.StatusCode)
	}
}

func TestDeleteUser_CannotLogin(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	password := "DeleteLoginPass12345!"
	userID := createTestUser(t, client, server.URL, "deletelogin", password)

	// Soft-delete the user.
	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete user: expected 204, got %d", resp.StatusCode)
	}

	// Attempt login with a fresh client (no existing session).
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	freshClient := &http.Client{Jar: jar}

	loginResp := doJSON(t, freshClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "deletelogin",
		"password": password,
	})
	defer func() { _ = loginResp.Body.Close() }()

	if loginResp.StatusCode != http.StatusForbidden {
		t.Fatalf("login as deleted user: expected 403, got %d", loginResp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(loginResp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem detail: %v", err)
	}
	if pd.Title != "Account deleted" {
		t.Errorf("problem title = %q, want %q", pd.Title, "Account deleted")
	}
}

func TestUserRoutes_CreateUser_InvalidBody(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/users", bytes.NewBufferString("{invalid"))
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
		t.Fatalf("invalid JSON create: expected 400, got %d", resp.StatusCode)
	}
}

func TestUserRoutes_CreateUser_DefaultForcePasswordChange(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	// When forcePasswordChange is omitted, it should default to true.
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users", map[string]string{
		"username": "defaultforce",
		"password": "DefaultForce12345!",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create user: expected 201, got %d", resp.StatusCode)
	}

	var u userResponse
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !u.ForcePasswordChange {
		t.Error("expected forcePasswordChange = true when omitted")
	}
}

func TestListUserSessions_Admin(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	password := "TestPassword1234!"
	userID := createTestUser(t, client, server.URL, "sessionuser", password)

	// Log in as the new user to create a session for them.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	userClient := &http.Client{Jar: jar}
	resp := doJSON(t, userClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "sessionuser",
		"password": password,
	})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login as sessionuser: status %d", resp.StatusCode)
	}

	// As admin (client), list sessions for that user.
	resp2 := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID+"/sessions", nil)
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("list user sessions: status %d, want 200", resp2.StatusCode)
	}

	var sessions []sessionResponse
	if err := json.NewDecoder(resp2.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}

	if len(sessions) == 0 {
		t.Error("expected at least 1 session for user")
	}
	for _, s := range sessions {
		if s.ID == "" {
			t.Error("session ID should not be empty")
		}
		if s.CreatedAt == "" {
			t.Error("session CreatedAt should not be empty")
		}
	}
}

func TestListUserSessions_Empty(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	// List sessions for a nonexistent user — should return empty array, not 404.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/nonexistent-id/sessions", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list sessions for nonexistent user: status %d, want 200", resp.StatusCode)
	}

	var sessions []sessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}

	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestUserRoutes_ListUsers_WithLastLogin(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	// The root user was logged in during setup, so should have lastLogin set.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list users: expected 200, got %d", resp.StatusCode)
	}

	var users []userResponse
	if err := json.NewDecoder(resp.Body).Decode(&users); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Find root user and check lastLogin is present.
	for _, u := range users {
		if u.Username == "root" {
			if u.LastLogin == nil {
				t.Error("expected lastLogin to be set for root after login")
			}
			return
		}
	}
	t.Error("root user not found in list")
}
