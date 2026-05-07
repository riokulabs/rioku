package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// setupInviteServer creates a full test server with all auth-related routes wired.
func setupInviteServer(t *testing.T, mailer auth.Mailer) (*httptest.Server, store.Driver, *auth.Auth, *auth.SessionManager) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "invite.db")
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
	cfg.Auth.RateLimit.RequestsPerMinute = 1000
	cfg.Auth.PasswordPolicy.MinLength = 8
	cfg.Auth.PasswordPolicy.RequireUppercase = false
	cfg.Auth.PasswordPolicy.RequireLowercase = false
	cfg.Auth.PasswordPolicy.RequireDigit = false
	cfg.Auth.PasswordPolicy.RequireSpecial = false

	encKey, _ := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	enc, _ := auth.NewEncryptor(encKey)

	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterBootstrapRoutes(mux, drv, sm, cfg)
	RegisterTenantRoutes(mux, drv)
	RegisterInviteRoutes(mux, drv, sm, mailer, cfg)

	var handler http.Handler = mux
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = TenantMiddleware(drv)(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv, drv, a, sm
}

// bootstrapAndLogin sets up the system and returns a cookie jar client logged in as admin.
func bootstrapAndLogin(t *testing.T, srv *httptest.Server, email, password, tenantSlug string) (*http.Client, string) {
	t.Helper()
	// Bootstrap.
	body := fmt.Sprintf(`{"email":%q,"password":%q,"tenantSlug":%q,"tenantName":"Test Tenant"}`,
		email, password, tenantSlug)
	resp := bootstrapDo(t, &http.Client{}, http.MethodPost, srv.URL+"/api/v1/auth/bootstrap", body)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("bootstrap failed: %d %s", resp.StatusCode, pd.Detail)
	}

	// Login to get session cookie.
	jar := newCookieJar(t)
	client := &http.Client{Jar: jar}
	username := strings.Split(email, "@")[0]
	loginBody := fmt.Sprintf(`{"username":%q,"password":%q}`, username, password)
	loginResp := bootstrapDo(t, client, http.MethodPost, srv.URL+"/api/v1/auth/login", loginBody)
	defer func() { _ = loginResp.Body.Close() }()
	if loginResp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(loginResp.Body).Decode(&pd)
		t.Fatalf("login failed: %d %s", loginResp.StatusCode, pd.Detail)
	}
	return client, tenantSlug
}

// newCookieJar returns a simple in-memory cookie jar for the test client.
func newCookieJar(t *testing.T) *simpleCookieJar {
	t.Helper()
	return &simpleCookieJar{cookies: make(map[string][]*http.Cookie)}
}

type simpleCookieJar struct {
	cookies map[string][]*http.Cookie
}

func (j *simpleCookieJar) SetCookies(u *url.URL, cookies []*http.Cookie) {
	j.cookies[u.Host] = append(j.cookies[u.Host], cookies...)
}
func (j *simpleCookieJar) Cookies(u *url.URL) []*http.Cookie {
	return j.cookies[u.Host]
}

// extractInviteToken extracts the invite token from the URL in the email body.
func extractInviteToken(t *testing.T, body string) string {
	t.Helper()
	re := regexp.MustCompile(`/invite/accept\?token=([^\s\n]+)`)
	m := re.FindStringSubmatch(body)
	if len(m) < 2 {
		t.Fatalf("extractInviteToken: no token found in body:\n%s", body)
	}
	return m[1]
}

func TestInviteAccept_full_flow(t *testing.T) {
	mailer := &captureMailer{}
	srv, _, _, _ := setupInviteServer(t, mailer)

	adminClient, tenantSlug := bootstrapAndLogin(t, srv, "admin@example.com", "AdminPass1", "test-tenant")

	// Admin creates invite.
	inviteBody := `{"email":"newuser@example.com","roleIds":[]}`
	req, _ := http.NewRequest(http.MethodPost,
		srv.URL+"/api/v1/t/"+tenantSlug+"/users/invite",
		strings.NewReader(inviteBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err := adminClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("invite create status = %d: %s", resp.StatusCode, pd.Detail)
	}
	if len(mailer.sent) != 1 {
		t.Fatalf("expected 1 invite email, got %d", len(mailer.sent))
	}

	token := extractInviteToken(t, mailer.sent[0].Body)

	// Unauthenticated client accepts the invite.
	acceptBody := fmt.Sprintf(`{"token":%q,"name":"New User","password":"NewPass1!"}`, token)
	acceptResp, _ := http.Post(srv.URL+"/api/v1/auth/invite/accept",
		"application/json", strings.NewReader(acceptBody))
	defer func() { _ = acceptResp.Body.Close() }()
	if acceptResp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(acceptResp.Body).Decode(&pd)
		t.Errorf("accept status = %d: %s", acceptResp.StatusCode, pd.Detail)
	}

	// Reusing the invite token returns 410.
	acceptResp2, _ := http.Post(srv.URL+"/api/v1/auth/invite/accept",
		"application/json", strings.NewReader(acceptBody))
	defer func() { _ = acceptResp2.Body.Close() }()
	if acceptResp2.StatusCode != http.StatusGone {
		t.Errorf("reused invite status = %d, want 410", acceptResp2.StatusCode)
	}
}

func TestInviteAccept_invalid_token_returns_410(t *testing.T) {
	mailer := &captureMailer{}
	srv, _, _, _ := setupInviteServer(t, mailer)
	bootstrapAndLogin(t, srv, "admin2@example.com", "AdminPass2", "t2")

	acceptBody := `{"token":"rku_inv_invalid","name":"X","password":"Pass12345"}`
	resp, _ := http.Post(srv.URL+"/api/v1/auth/invite/accept",
		"application/json", strings.NewReader(acceptBody))
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusGone {
		t.Errorf("invalid token status = %d, want 410", resp.StatusCode)
	}
}

// Keep unused time import required for store.Membership types used in test.
var _ = time.Now
