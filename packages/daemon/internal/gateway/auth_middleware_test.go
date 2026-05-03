package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// setupAuthMiddlewareTest creates a minimal Auth + SessionManager backed by a
// real SQLite store, plus an active user and a bootstrap API key. It returns
// the Auth, SessionManager, store driver, the root user ID, and the
// bootstrap token string.
func setupAuthMiddlewareTest(t *testing.T) (*auth.Auth, *auth.SessionManager, store.Driver, string, string) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "auth_mw.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	// Create root user.
	hash := cachedHashPassword(t, "TestPassword123!")
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	rootUser, err := tx.CreateUser(ctx, &store.User{
		Username:          "root",
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

	return a, sm, drv, rootUser.ID, bootstrapToken
}

// newOKHandler returns a handler that writes 200 and the claims Subject to the body.
func newOKHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c := auth.ClaimsFromContext(r.Context())
		if c != nil {
			w.Header().Set("X-Subject", c.Subject)
		}
		w.WriteHeader(http.StatusOK)
	}
}

func TestAuthMiddleware_ValidSession(t *testing.T) {
	a, sm, _, userID, _ := setupAuthMiddlewareTest(t)

	// Create a session.
	createReq := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	sess, err := sm.CreateSession(context.Background(), userID, createReq)
	if err != nil {
		t.Fatal(err)
	}

	handler := AuthMiddleware(a, sm)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.AddCookie(&http.Cookie{
		Name:  auth.SessionCookieName,
		Value: sess.ID,
	})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-Subject"); got != userID {
		t.Errorf("X-Subject = %q, want %q", got, userID)
	}
}

func TestAuthMiddleware_BearerToken(t *testing.T) {
	a, sm, _, _, bootstrapToken := setupAuthMiddlewareTest(t)

	// Exchange bootstrap token for a real access token.
	pair, err := a.ExchangeBootstrapToken(context.Background(), bootstrapToken)
	if err != nil {
		t.Fatal(err)
	}

	handler := AuthMiddleware(a, sm)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-Subject"); got != "admin" {
		t.Errorf("X-Subject = %q, want %q", got, "admin")
	}
}

func TestAuthMiddleware_BearerTokenCaseInsensitive(t *testing.T) {
	a, sm, _, _, bootstrapToken := setupAuthMiddlewareTest(t)

	pair, err := a.ExchangeBootstrapToken(context.Background(), bootstrapToken)
	if err != nil {
		t.Fatal(err)
	}

	handler := AuthMiddleware(a, sm)(newOKHandler())

	// Use "BEARER" in uppercase to verify case-insensitive prefix stripping.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.Header.Set("Authorization", "BEARER "+pair.AccessToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for case-insensitive Bearer, got %d", rec.Code)
	}
}

func TestAuthMiddleware_Unauthenticated(t *testing.T) {
	a, sm, _, _, _ := setupAuthMiddlewareTest(t)

	handler := AuthMiddleware(a, sm)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}

	// Verify ProblemDetail response.
	var pd ProblemDetail
	if err := json.NewDecoder(rec.Body).Decode(&pd); err != nil {
		t.Fatalf("decode ProblemDetail: %v", err)
	}
	if pd.Status != 401 {
		t.Errorf("ProblemDetail.Status = %d, want 401", pd.Status)
	}
	if pd.Type != errTypeUnauth {
		t.Errorf("ProblemDetail.Type = %q, want %q", pd.Type, errTypeUnauth)
	}

	// Verify WWW-Authenticate header.
	if got := rec.Header().Get("WWW-Authenticate"); got != "Bearer" {
		t.Errorf("WWW-Authenticate = %q, want Bearer", got)
	}
}

func TestAuthMiddleware_InvalidBearerToken(t *testing.T) {
	a, sm, _, _, _ := setupAuthMiddlewareTest(t)

	handler := AuthMiddleware(a, sm)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.Header.Set("Authorization", "Bearer totally-invalid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for invalid bearer, got %d", rec.Code)
	}
}

func TestAuthMiddleware_PublicPaths(t *testing.T) {
	a, sm, _, _, _ := setupAuthMiddlewareTest(t)

	handler := AuthMiddleware(a, sm)(newOKHandler())

	publicPaths := []string{
		"/api/v1/health",
		"/api/v1/health/caddy",
		"/api/v1/auth/token",
		"/api/v1/auth/refresh",
		"/api/v1/auth/login",
	}

	for _, path := range publicPaths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("path %s: expected 200, got %d", path, rec.Code)
			}
		})
	}
}

func TestAuthMiddleware_NonAPIPaths(t *testing.T) {
	a, sm, _, _, _ := setupAuthMiddlewareTest(t)

	handler := AuthMiddleware(a, sm)(newOKHandler())

	// Non-API paths (admin panel static assets) should skip auth.
	nonAPIPaths := []string{
		"/",
		"/dashboard",
		"/assets/main.js",
		"/favicon.ico",
	}

	for _, path := range nonAPIPaths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("non-API path %s: expected 200, got %d", path, rec.Code)
			}
		})
	}
}

func TestAuthMiddleware_OptionsSkipsAuth(t *testing.T) {
	a, sm, _, _, _ := setupAuthMiddlewareTest(t)

	handler := AuthMiddleware(a, sm)(newOKHandler())

	// CORS preflight (OPTIONS) should skip auth even for protected API paths.
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/routes", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("OPTIONS /api/v1/routes: expected 200, got %d", rec.Code)
	}
}

func TestAuthMiddleware_ExpiredSession(t *testing.T) {
	a, _, drv, userID, _ := setupAuthMiddlewareTest(t)
	ctx := context.Background()

	// Create a fresh SessionManager so the cache is empty (the session we
	// manually insert below won't be cached).
	sm := auth.NewSessionManager(drv, true)

	// Insert an already-expired session directly into the DB, bypassing the
	// SessionManager so it is NOT cached.
	expiredID := "expired-session-id-for-test"
	fp := auth.ComputeFingerprint("", "") // match default test request fingerprint
	ip := "192.0.2.1:1234"
	ua := ""
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateSession(ctx, &store.Session{
		ID:          expiredID,
		UserID:      userID,
		Fingerprint: fp,
		ExpiresAt:   time.Now().Add(-time.Hour), // already expired
		LastActive:  time.Now().Add(-2 * time.Hour),
		IPAddress:   &ip,
		UserAgent:   &ua,
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	handler := AuthMiddleware(a, sm)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.AddCookie(&http.Cookie{
		Name:  auth.SessionCookieName,
		Value: expiredID,
	})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for expired session, got %d", rec.Code)
	}
}

func TestAuthMiddleware_NilSessionManager(t *testing.T) {
	a, _, _, _, bootstrapToken := setupAuthMiddlewareTest(t)

	// When sm is nil, only Bearer auth should be attempted.
	pair, err := a.ExchangeBootstrapToken(context.Background(), bootstrapToken)
	if err != nil {
		t.Fatal(err)
	}

	handler := AuthMiddleware(a, nil)(newOKHandler())

	// Bearer token should still work.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 with nil sm + bearer, got %d", rec.Code)
	}

	// Session cookie should be ignored when sm is nil.
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req2.AddCookie(&http.Cookie{
		Name:  auth.SessionCookieName,
		Value: "some-session-id",
	})
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	// Should fall through to bearer check, which is missing, so 401.
	if rec2.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 with nil sm + cookie only, got %d", rec2.Code)
	}
}

func TestSessionClaimsToLegacy(t *testing.T) {
	sc := &auth.SessionClaims{
		SessionID: "sess-123",
		UserID:    "user-456",
		Username:  "testuser",
		Roles:     []string{"admin", "viewer"},
		Scopes:    []string{"config:read", "config:write"},
	}

	legacy := sessionClaimsToLegacy(sc)

	if legacy.Subject != sc.UserID {
		t.Errorf("Subject = %q, want %q", legacy.Subject, sc.UserID)
	}
	if len(legacy.Roles) != len(sc.Roles) {
		t.Errorf("Roles count = %d, want %d", len(legacy.Roles), len(sc.Roles))
	}
	for i, r := range legacy.Roles {
		if r != sc.Roles[i] {
			t.Errorf("Roles[%d] = %q, want %q", i, r, sc.Roles[i])
		}
	}
	if legacy.TokenType != auth.TokenTypeAccess {
		t.Errorf("TokenType = %q, want %q", legacy.TokenType, auth.TokenTypeAccess)
	}
}

func TestWriteAuthError(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	rec := httptest.NewRecorder()

	writeAuthError(rec, req, "test error detail")

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	if got := rec.Header().Get("WWW-Authenticate"); got != "Bearer" {
		t.Errorf("WWW-Authenticate = %q, want Bearer", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", got)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(rec.Body).Decode(&pd); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if pd.Detail != "test error detail" {
		t.Errorf("Detail = %q, want %q", pd.Detail, "test error detail")
	}
	if pd.Instance != "/api/v1/routes" {
		t.Errorf("Instance = %q, want %q", pd.Instance, "/api/v1/routes")
	}
}
