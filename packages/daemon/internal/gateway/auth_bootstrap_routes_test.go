package gateway

import (
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

// setupBootstrapTestServer creates an empty store + test server with only the
// bootstrap routes wired.
func setupBootstrapTestServer(t *testing.T) (*httptest.Server, store.Driver) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "bootstrap.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	sm := auth.NewSessionManager(drv, true)
	cfg := config.Default()
	cfg.Auth.RateLimit.RequestsPerMinute = 1000
	// Relax password policy for tests.
	cfg.Auth.PasswordPolicy.MinLength = 8
	cfg.Auth.PasswordPolicy.RequireUppercase = false
	cfg.Auth.PasswordPolicy.RequireLowercase = false
	cfg.Auth.PasswordPolicy.RequireDigit = false
	cfg.Auth.PasswordPolicy.RequireSpecial = false

	a := auth.NewAuth(signingKey, drv)

	mux := http.NewServeMux()
	RegisterBootstrapRoutes(mux, drv, sm, cfg)
	RegisterAuthRoutes(mux, a, sm, drv, cfg, nil) // enc=nil; not needed for login if no TOTP

	var handler http.Handler = mux
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv, drv
}

func bootstrapDo(t *testing.T, client *http.Client, method, url, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestBootstrapStatus_returns_required_when_no_users(t *testing.T) {
	srv, _ := setupBootstrapTestServer(t)
	resp, err := http.Get(srv.URL + "/api/v1/auth/bootstrap-status")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		Required bool `json:"required"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.Required {
		t.Error("required = false on empty store, want true")
	}
}

func TestBootstrap_creates_root_and_first_tenant(t *testing.T) {
	srv, _ := setupBootstrapTestServer(t)
	client := &http.Client{}

	body := `{"email":"root@example.com","password":"RootPass1","tenantSlug":"main","tenantName":"Main Tenant"}`
	resp := bootstrapDo(t, client, http.MethodPost, srv.URL+"/api/v1/auth/bootstrap", body)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("bootstrap status = %d, want 201: %s", resp.StatusCode, pd.Detail)
	}

	var out struct {
		TenantID string `json:"tenantId"`
		UserID   string `json:"userId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.TenantID == "" {
		t.Error("tenantId empty")
	}
	if out.UserID == "" {
		t.Error("userId empty")
	}

	// bootstrap-status should now return required=false
	resp2, err := http.Get(srv.URL + "/api/v1/auth/bootstrap-status")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp2.Body.Close() }()
	var status struct {
		Required bool `json:"required"`
	}
	_ = json.NewDecoder(resp2.Body).Decode(&status)
	if status.Required {
		t.Error("required = true after bootstrap, want false")
	}

	// Login should now succeed — note: login uses username (local part of email).
	loginBody := `{"username":"root","password":"RootPass1"}`
	loginResp := bootstrapDo(t, client, http.MethodPost, srv.URL+"/api/v1/auth/login", loginBody)
	defer func() { _ = loginResp.Body.Close() }()
	if loginResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(loginResp.Body).Decode(&pd)
		t.Errorf("login after bootstrap status = %d, want 200: %s", loginResp.StatusCode, pd.Detail)
	}

	// Second bootstrap should return 409.
	resp3 := bootstrapDo(t, client, http.MethodPost, srv.URL+"/api/v1/auth/bootstrap", body)
	defer func() { _ = resp3.Body.Close() }()
	if resp3.StatusCode != http.StatusConflict {
		t.Errorf("second bootstrap status = %d, want 409", resp3.StatusCode)
	}
}

// setupBootstrapTestServerWithRoot creates a store that already has a root user.
func setupBootstrapTestServerWithRoot(t *testing.T) *httptest.Server {
	t.Helper()
	srv, drv := setupBootstrapTestServer(t)

	// Pre-create a user so bootstrap-status returns required=false.
	ctx := context.Background()
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	hash := cachedHashPassword(t, "TestPass1!")
	_, err = tx.CreateUser(ctx, &store.User{
		Username:          "preexisting",
		PasswordHash:      hash,
		Status:            "active",
		PasswordChangedAt: time.Now().UTC(),
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return srv
}

func TestBootstrapStatus_returns_not_required_after_user_exists(t *testing.T) {
	srv := setupBootstrapTestServerWithRoot(t)
	resp, err := http.Get(srv.URL + "/api/v1/auth/bootstrap-status")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	var body struct {
		Required bool `json:"required"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if body.Required {
		t.Error("required = true after root user exists, want false")
	}
}
