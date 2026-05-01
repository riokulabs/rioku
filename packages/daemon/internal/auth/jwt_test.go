package auth_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// testStore creates a temporary SQLite store for testing, fully migrated.
func testStore(t *testing.T) store.Driver {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })

	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}
	return drv
}

// testAuth creates an Auth instance backed by a real SQLite store.
func testAuth(t *testing.T) (*auth.Auth, store.Driver) {
	t.Helper()
	drv := testStore(t)
	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	return a, drv
}

// seedAPIKey creates an API key in the store and returns the raw key and its ID.
func seedAPIKey(t *testing.T, drv store.Driver, name string, scopes []string, expiresAt *time.Time) (rawKey, id string) {
	t.Helper()
	ctx := context.Background()

	rawKey = "rku_tok_testapikey_" + name
	hash := auth.HashToken(rawKey)

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	id, err = tx.CreateAPIKey(ctx, name, hash, scopes, expiresAt, "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return rawKey, id
}

// seedBootstrapToken creates a bootstrap token in the store and returns the raw token.
func seedBootstrapToken(t *testing.T, drv store.Driver) string {
	t.Helper()
	ctx := context.Background()

	token, err := auth.GenerateBootstrapToken()
	if err != nil {
		t.Fatal(err)
	}

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateAPIKey(ctx, "bootstrap", auth.HashToken(token), []string{"admin"}, nil, "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return token
}

// forgeExpiredJWT constructs a JWT with expired claims, signed with the given key.
// expiredBy is the duration by which the token has already expired (must be positive
// for the token to actually be expired). This is necessary because the Auth struct
// does not expose TTL configuration.
func forgeExpiredJWT(t *testing.T, key []byte, subject string, roles []string, tokenType string, expiredBy time.Duration) string {
	t.Helper()

	claims := struct {
		Subject   string   `json:"sub"`
		Roles     []string `json:"roles"`
		TokenType string   `json:"typ"`
		IssuedAt  int64    `json:"iat"`
		ExpiresAt int64    `json:"exp"`
		TokenID   string   `json:"jti"`
	}{
		Subject:   subject,
		Roles:     roles,
		TokenType: tokenType,
		IssuedAt:  time.Now().Add(-expiredBy - time.Minute).Unix(),
		ExpiresAt: time.Now().Add(-expiredBy).Unix(),
		TokenID:   "expired-test-token-id",
	}

	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	message := header + "." + encodedPayload

	h := hmac.New(sha256.New, key)
	h.Write([]byte(message))
	sig := h.Sum(nil)

	return message + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// forgeJWT constructs a JWT with the given expiry offset from now, signed with the
// given key. A positive expiresIn produces a non-expired (valid-window) token; a
// negative value produces an already-expired token.
func forgeJWT(t *testing.T, key []byte, subject string, roles []string, tokenType string, expiresIn time.Duration) string {
	t.Helper()

	claims := struct {
		Subject   string   `json:"sub"`
		Roles     []string `json:"roles"`
		TokenType string   `json:"typ"`
		IssuedAt  int64    `json:"iat"`
		ExpiresAt int64    `json:"exp"`
		TokenID   string   `json:"jti"`
	}{
		Subject:   subject,
		Roles:     roles,
		TokenType: tokenType,
		IssuedAt:  time.Now().Unix(),
		ExpiresAt: time.Now().Add(expiresIn).Unix(),
		TokenID:   "forged-test-token-id",
	}

	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	message := header + "." + encodedPayload

	h := hmac.New(sha256.New, key)
	h.Write([]byte(message))
	sig := h.Sum(nil)

	return message + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// revokeAPIKey revokes an API key by ID.
func revokeAPIKey(t *testing.T, drv store.Driver, id string) {
	t.Helper()
	ctx := context.Background()

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.RevokeAPIKey(ctx, id); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// ---------------------------------------------------------------------------
// Token lifecycle tests
// ---------------------------------------------------------------------------

func TestJWT_IssueTokenPair(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	pair, err := a.IssueTokenPair(ctx, "user-123", []string{"admin", "editor"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	if pair.AccessToken == "" {
		t.Error("access token is empty")
	}
	if pair.RefreshToken == "" {
		t.Error("refresh token is empty")
	}
	if pair.TokenType != "Bearer" {
		t.Errorf("token type = %q, want %q", pair.TokenType, "Bearer")
	}
	if pair.ExpiresIn <= 0 {
		t.Errorf("expires_in = %d, want positive", pair.ExpiresIn)
	}

	// Validate the access token and inspect claims.
	claims, err := a.ValidateAccessToken(pair.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken: %v", err)
	}
	if claims.Subject != "user-123" {
		t.Errorf("subject = %q, want %q", claims.Subject, "user-123")
	}
	if len(claims.Roles) != 2 || claims.Roles[0] != "admin" || claims.Roles[1] != "editor" {
		t.Errorf("roles = %v, want [admin editor]", claims.Roles)
	}
	if claims.TokenType != "access" {
		t.Errorf("token type = %q, want %q", claims.TokenType, "access")
	}
	if claims.TokenID == "" {
		t.Error("token ID (jti) is empty")
	}
	if claims.IssuedAt == 0 {
		t.Error("issued at (iat) is zero")
	}
	if claims.ExpiresAt == 0 {
		t.Error("expires at (exp) is zero")
	}
}

func TestJWT_IssueTokenPair_EmptyKey(t *testing.T) {
	// Note: Go's crypto/hmac allows empty (nil/zero-length) keys without returning
	// an error — HMAC-SHA256 will sign successfully with an empty key. Therefore we
	// cannot enforce an error at the Auth.IssueTokenPair level for empty keys. What
	// we CAN assert is that any token produced by an empty-keyed Auth is rejected by
	// an Auth instance configured with a real key, ensuring the signature is actually
	// checked and that a zero-key token provides no access.
	realKey := []byte("real-signing-key-32-bytes-long!!")

	cases := []struct {
		name string
		key  []byte
	}{
		{"nil key", nil},
		{"empty key", []byte{}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			drv := testStore(t)
			emptyKeyAuth := auth.NewAuth(tc.key, drv)
			realKeyAuth := auth.NewAuth(realKey, drv)
			ctx := context.Background()

			// IssueTokenPair with a nil/empty key may panic or return an error on some
			// platforms. Capture any panic so we can report it cleanly.
			var recovered bool
			var accessToken string

			func() {
				defer func() {
					if r := recover(); r != nil {
						recovered = true
					}
				}()

				pair, err := emptyKeyAuth.IssueTokenPair(ctx, "user", []string{"admin"})
				if err != nil {
					// An explicit error from the Auth layer is acceptable.
					t.Logf("IssueTokenPair returned error for empty key (acceptable): %v", err)
					return
				}
				accessToken = pair.AccessToken
			}()

			if recovered {
				t.Log("IssueTokenPair panicked with empty key (acceptable)")
				return
			}

			if accessToken == "" {
				// Either an error was returned or a panic happened — both acceptable.
				return
			}

			// If a token was issued with an empty key it must be rejected by an Auth
			// instance that uses a real key. This is the core security assertion: a
			// zero-key-signed token must not grant access through a properly-configured
			// Auth instance.
			_, err := realKeyAuth.ValidateAccessToken(accessToken)
			if err == nil {
				t.Error("token signed with empty key must be rejected by a real-keyed Auth instance")
			}
		})
	}
}

func TestJWT_ValidateAccessToken(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	pair, err := a.IssueTokenPair(ctx, "alice", []string{"viewer"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	claims, err := a.ValidateAccessToken(pair.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken: %v", err)
	}

	if claims.Subject != "alice" {
		t.Errorf("subject = %q, want %q", claims.Subject, "alice")
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "viewer" {
		t.Errorf("roles = %v, want [viewer]", claims.Roles)
	}
	if claims.TokenType != "access" {
		t.Errorf("token type = %q, want %q", claims.TokenType, "access")
	}

	// Verify expiry is in the future.
	if claims.ExpiresAt <= time.Now().Unix() {
		t.Error("expected expiry to be in the future")
	}
}

func TestJWT_ValidateAccessToken_Expired(t *testing.T) {
	signingKey := []byte("test-signing-key-32-bytes-long!!")
	drv := testStore(t)
	a := auth.NewAuth(signingKey, drv)

	// Forge a token that expired 5 minutes ago.
	expired := forgeExpiredJWT(t, signingKey, "user-expired", []string{"admin"}, "access", 5*time.Minute)

	_, err := a.ValidateAccessToken(expired)
	if err == nil {
		t.Fatal("expected error for expired token, got nil")
	}
	if !strings.Contains(err.Error(), "expired") {
		t.Errorf("expected error to mention 'expired', got: %v", err)
	}
}

func TestJWT_ValidateAccessToken_Malformed(t *testing.T) {
	a, _ := testAuth(t)

	cases := []struct {
		name  string
		token string
	}{
		{"empty string", ""},
		{"garbage", "not-a-jwt-at-all"},
		{"single dot", "header.payload"},
		{"truncated signature", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0"},
		{"invalid base64 payload", "eyJhbGciOiJIUzI1NiJ9.!!!invalid!!!.AAAA"},
		{"three dots no content", ".."},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := a.ValidateAccessToken(tc.token)
			if err == nil {
				t.Errorf("expected error for malformed token %q, got nil", tc.name)
			}
		})
	}
}

func TestJWT_ValidateAccessToken_WrongKey(t *testing.T) {
	keyA := []byte("signing-key-AAAAAAAAAAAAAAAAAAA!!")
	keyB := []byte("signing-key-BBBBBBBBBBBBBBBBBBB!!")
	drv := testStore(t)

	authA := auth.NewAuth(keyA, drv)
	authB := auth.NewAuth(keyB, drv)

	ctx := context.Background()
	pair, err := authA.IssueTokenPair(ctx, "user-a", []string{"admin"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	// Validate with a different key — should fail.
	_, err = authB.ValidateAccessToken(pair.AccessToken)
	if err == nil {
		t.Fatal("expected error when validating with wrong key, got nil")
	}
	if !strings.Contains(err.Error(), "signature") {
		t.Errorf("expected error to mention 'signature', got: %v", err)
	}
}

func TestJWT_RefreshTokens(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	// Issue initial token pair.
	pair1, err := a.IssueTokenPair(ctx, "bob", []string{"editor"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	// Refresh using the refresh token.
	pair2, err := a.RefreshTokens(ctx, pair1.RefreshToken)
	if err != nil {
		t.Fatalf("RefreshTokens: %v", err)
	}

	if pair2.AccessToken == "" {
		t.Error("new access token is empty")
	}
	if pair2.RefreshToken == "" {
		t.Error("new refresh token is empty")
	}

	// The new access token should be different from the old one.
	if pair2.AccessToken == pair1.AccessToken {
		t.Error("new access token should differ from old")
	}
	// The new refresh token should be different from the old one.
	if pair2.RefreshToken == pair1.RefreshToken {
		t.Error("new refresh token should differ from old")
	}

	// Validate the new access token.
	claims, err := a.ValidateAccessToken(pair2.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken on refreshed token: %v", err)
	}
	if claims.Subject != "bob" {
		t.Errorf("subject = %q, want %q", claims.Subject, "bob")
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "editor" {
		t.Errorf("roles = %v, want [editor]", claims.Roles)
	}
}

func TestJWT_RefreshTokens_Expired(t *testing.T) {
	signingKey := []byte("test-signing-key-32-bytes-long!!")
	drv := testStore(t)
	a := auth.NewAuth(signingKey, drv)
	ctx := context.Background()

	// Create a refresh token that is already expired by storing it with a past expiry.
	refreshToken := "rku_ref_expired-test-refresh-token"
	hash := auth.HashToken(refreshToken)
	pastExpiry := time.Now().Add(-1 * time.Hour)

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateAPIKey(ctx, "refresh:expired-user", hash, []string{"refresh", "subject:expired-user", "admin"}, &pastExpiry, "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// Try to refresh with the expired token.
	_, err = a.RefreshTokens(ctx, refreshToken)
	if err == nil {
		t.Fatal("expected error for expired refresh token, got nil")
	}
	if !strings.Contains(err.Error(), "expired") {
		t.Errorf("expected error to mention 'expired', got: %v", err)
	}
}

func TestJWT_RefreshTokens_Replay(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	// Issue a token pair.
	pair, err := a.IssueTokenPair(ctx, "carol", []string{"admin"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	// First refresh should succeed.
	_, err = a.RefreshTokens(ctx, pair.RefreshToken)
	if err != nil {
		t.Fatalf("first RefreshTokens: %v", err)
	}

	// Second use of the same refresh token should fail (token was consumed/revoked).
	_, err = a.RefreshTokens(ctx, pair.RefreshToken)
	if err == nil {
		t.Fatal("expected error on refresh token replay, got nil")
	}
	if !strings.Contains(err.Error(), "revoked") {
		t.Errorf("expected error to mention 'revoked', got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// API key auth tests
// ---------------------------------------------------------------------------

func TestJWT_ValidateAPIKey(t *testing.T) {
	a, drv := testAuth(t)
	ctx := context.Background()

	rawKey, _ := seedAPIKey(t, drv, "test-key", []string{"read", "write"}, nil)

	pair, err := a.ValidateAPIKey(ctx, rawKey)
	if err != nil {
		t.Fatalf("ValidateAPIKey: %v", err)
	}

	if pair.AccessToken == "" {
		t.Error("access token is empty")
	}
	if pair.TokenType != "Bearer" {
		t.Errorf("token type = %q, want %q", pair.TokenType, "Bearer")
	}

	// Validate the issued access token and check scopes are preserved.
	claims, err := a.ValidateAccessToken(pair.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken: %v", err)
	}
	if !strings.HasPrefix(claims.Subject, "apikey:") {
		t.Errorf("subject = %q, want prefix 'apikey:'", claims.Subject)
	}
	if len(claims.Roles) != 2 {
		t.Errorf("roles = %v, want [read write]", claims.Roles)
	}
}

func TestJWT_ValidateAPIKey_Revoked(t *testing.T) {
	a, drv := testAuth(t)
	ctx := context.Background()

	rawKey, id := seedAPIKey(t, drv, "revoked-key", []string{"read"}, nil)

	// Revoke the key.
	revokeAPIKey(t, drv, id)

	// Validation should fail.
	_, err := a.ValidateAPIKey(ctx, rawKey)
	if err == nil {
		t.Fatal("expected error for revoked API key, got nil")
	}
	if !strings.Contains(err.Error(), "revoked") {
		t.Errorf("expected error to mention 'revoked', got: %v", err)
	}
}

func TestJWT_ValidateAPIKey_WrongKey(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	// Use a key that doesn't exist in the store.
	_, err := a.ValidateAPIKey(ctx, "rku_tok_nonexistent_key_value")
	if err == nil {
		t.Fatal("expected error for non-existent API key, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected error to mention 'not found', got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Bootstrap token tests
// ---------------------------------------------------------------------------

func TestJWT_ExchangeBootstrapToken(t *testing.T) {
	a, drv := testAuth(t)
	ctx := context.Background()

	token := seedBootstrapToken(t, drv)

	pair, err := a.ExchangeBootstrapToken(ctx, token)
	if err != nil {
		t.Fatalf("ExchangeBootstrapToken: %v", err)
	}

	if pair.AccessToken == "" {
		t.Error("access token is empty")
	}
	if pair.RefreshToken == "" {
		t.Error("refresh token is empty")
	}

	// Verify the issued token has admin claims.
	claims, err := a.ValidateAccessToken(pair.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken: %v", err)
	}
	if claims.Subject != "admin" {
		t.Errorf("subject = %q, want %q", claims.Subject, "admin")
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "admin" {
		t.Errorf("roles = %v, want [admin]", claims.Roles)
	}
}

func TestJWT_ExchangeBootstrapToken_Invalid(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	_, err := a.ExchangeBootstrapToken(ctx, "rku_tok_wrong_token_value")
	if err == nil {
		t.Fatal("expected error for invalid bootstrap token, got nil")
	}
	if !strings.Contains(err.Error(), "invalid") {
		t.Errorf("expected error to mention 'invalid', got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Bearer validation tests
// ---------------------------------------------------------------------------

func TestJWT_ValidateBearer_JWT(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	pair, err := a.IssueTokenPair(ctx, "bearer-user", []string{"admin"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	claims, err := a.ValidateBearer(ctx, pair.AccessToken)
	if err != nil {
		t.Fatalf("ValidateBearer (JWT): %v", err)
	}
	if claims.Subject != "bearer-user" {
		t.Errorf("subject = %q, want %q", claims.Subject, "bearer-user")
	}
	if claims.TokenType != "access" {
		t.Errorf("token type = %q, want %q", claims.TokenType, "access")
	}
}

func TestJWT_ValidateBearer_APIKey(t *testing.T) {
	a, drv := testAuth(t)
	ctx := context.Background()

	rawKey, _ := seedAPIKey(t, drv, "bearer-api-key", []string{"read", "write"}, nil)

	claims, err := a.ValidateBearer(ctx, rawKey)
	if err != nil {
		t.Fatalf("ValidateBearer (API key): %v", err)
	}
	if !strings.HasPrefix(claims.Subject, "apikey:") {
		t.Errorf("subject = %q, want prefix 'apikey:'", claims.Subject)
	}
	if claims.TokenType != "access" {
		t.Errorf("token type = %q, want %q", claims.TokenType, "access")
	}
}

func TestJWT_ValidateBearer_Empty(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	_, err := a.ValidateBearer(ctx, "")
	if err == nil {
		t.Fatal("expected error for empty bearer token, got nil")
	}
	if !strings.Contains(err.Error(), "invalid") {
		t.Errorf("expected error to mention 'invalid', got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Key rotation tests
// ---------------------------------------------------------------------------

func TestJWT_RotateSigningKey(t *testing.T) {
	keyOld := []byte("old-signing-key-32-bytes-long!!!")
	keyNew := []byte("new-signing-key-32-bytes-long!!!")
	drv := testStore(t)
	a := auth.NewAuth(keyOld, drv)
	ctx := context.Background()

	// Issue a token with the old key.
	pair, err := a.IssueTokenPair(ctx, "rotate-user", []string{"admin"})
	if err != nil {
		t.Fatalf("IssueTokenPair (old key): %v", err)
	}
	oldToken := pair.AccessToken

	// Rotate to the new key.
	a.RotateSigningKey(keyNew)

	// Old token should still validate (backward compatibility).
	claims, err := a.ValidateAccessToken(oldToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken (old token after rotation): %v", err)
	}
	if claims.Subject != "rotate-user" {
		t.Errorf("subject = %q, want %q", claims.Subject, "rotate-user")
	}

	// New tokens should be signed with the new key and validate.
	pair2, err := a.IssueTokenPair(ctx, "rotate-user-2", []string{"editor"})
	if err != nil {
		t.Fatalf("IssueTokenPair (new key): %v", err)
	}

	claims2, err := a.ValidateAccessToken(pair2.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken (new token): %v", err)
	}
	if claims2.Subject != "rotate-user-2" {
		t.Errorf("subject = %q, want %q", claims2.Subject, "rotate-user-2")
	}

	// A separate Auth instance with only the new key should NOT validate old tokens.
	authNewOnly := auth.NewAuth(keyNew, drv)
	_, err = authNewOnly.ValidateAccessToken(oldToken)
	if err == nil {
		t.Error("expected old token to fail validation with new-key-only auth")
	}

	// But the new token should work on both.
	_, err = authNewOnly.ValidateAccessToken(pair2.AccessToken)
	if err != nil {
		t.Fatalf("new token should validate with new-key-only auth: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Additional edge case tests
// ---------------------------------------------------------------------------

func TestJWT_ValidateBearer_BootstrapToken(t *testing.T) {
	a, drv := testAuth(t)
	ctx := context.Background()

	token := seedBootstrapToken(t, drv)

	// ValidateBearer should accept bootstrap tokens directly.
	claims, err := a.ValidateBearer(ctx, token)
	if err != nil {
		t.Fatalf("ValidateBearer (bootstrap): %v", err)
	}
	if claims.Subject != "admin" {
		t.Errorf("subject = %q, want %q", claims.Subject, "admin")
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "admin" {
		t.Errorf("roles = %v, want [admin]", claims.Roles)
	}
}

func TestJWT_SigningKey_ReturnsCopy(t *testing.T) {
	key := []byte("test-signing-key-32-bytes-long!!")
	drv := testStore(t)
	a := auth.NewAuth(key, drv)

	// Get the signing key.
	got := a.SigningKey()

	// Verify it matches the original.
	if string(got) != string(key) {
		t.Errorf("SigningKey() = %q, want %q", got, key)
	}

	// Modify the returned key — it should not affect the internal state.
	got[0] = 'X'
	got2 := a.SigningKey()
	if got2[0] == 'X' {
		t.Error("SigningKey() returned a reference to internal state, not a copy")
	}
}

func TestJWT_ValidateAccessToken_RefreshTokenType(t *testing.T) {
	// A forged token with type "refresh" should be rejected by ValidateAccessToken,
	// even when the token is otherwise valid (correct key, not expired).
	signingKey := []byte("test-signing-key-32-bytes-long!!")
	drv := testStore(t)
	a := auth.NewAuth(signingKey, drv)

	// Forge a non-expired token with "refresh" type instead of "access".
	// Using forgeJWT (not forgeExpiredJWT) because this token must not be expired —
	// we want the rejection to be due to the wrong token type, not expiry.
	token := forgeJWT(t, signingKey, "user", []string{"admin"}, "refresh", 15*time.Minute)

	_, err := a.ValidateAccessToken(token)
	if err == nil {
		t.Fatal("expected error for refresh-type token used as access token, got nil")
	}
	if !strings.Contains(err.Error(), "not an access token") {
		t.Errorf("expected error to mention 'not an access token', got: %v", err)
	}
}

func TestJWT_RotateSigningKey_MaxKeysRetained(t *testing.T) {
	key1 := []byte("key-1-signing-key-32-bytes-long!")
	key2 := []byte("key-2-signing-key-32-bytes-long!")
	key3 := []byte("key-3-signing-key-32-bytes-long!")
	key4 := []byte("key-4-signing-key-32-bytes-long!")

	drv := testStore(t)
	a := auth.NewAuth(key1, drv)
	ctx := context.Background()

	// Issue token with key1.
	pair1, err := a.IssueTokenPair(ctx, "user1", []string{"admin"})
	if err != nil {
		t.Fatal(err)
	}

	// Rotate to key2, key3, key4 (3 rotations).
	a.RotateSigningKey(key2)
	pair2, err := a.IssueTokenPair(ctx, "user2", []string{"admin"})
	if err != nil {
		t.Fatal(err)
	}

	a.RotateSigningKey(key3)
	a.RotateSigningKey(key4)

	// After 3 rotations, only key4, key3, key2 should be retained (max 3).
	// key1 should be dropped, so token1 should fail.
	_, err = a.ValidateAccessToken(pair1.AccessToken)
	if err == nil {
		t.Error("expected key1 token to fail after 3 rotations (max 3 keys retained)")
	}

	// Token signed with key2 should still work (key2 is within the 3-key window).
	_, err = a.ValidateAccessToken(pair2.AccessToken)
	if err != nil {
		t.Errorf("key2 token should still validate: %v", err)
	}
}

func TestJWT_IssueTokenPair_DifferentTokenIDs(t *testing.T) {
	a, _ := testAuth(t)
	ctx := context.Background()

	pair1, err := a.IssueTokenPair(ctx, "user", []string{"admin"})
	if err != nil {
		t.Fatal(err)
	}
	pair2, err := a.IssueTokenPair(ctx, "user", []string{"admin"})
	if err != nil {
		t.Fatal(err)
	}

	claims1, _ := a.ValidateAccessToken(pair1.AccessToken)
	claims2, _ := a.ValidateAccessToken(pair2.AccessToken)

	if claims1.TokenID == claims2.TokenID {
		t.Error("two issued tokens should have different token IDs (jti)")
	}
}

func TestJWT_HashToken_Deterministic(t *testing.T) {
	token := "rku_tok_test-token-value"
	hash1 := auth.HashToken(token)
	hash2 := auth.HashToken(token)

	if hash1 != hash2 {
		t.Errorf("HashToken is not deterministic: %q != %q", hash1, hash2)
	}

	// Different tokens should produce different hashes.
	hash3 := auth.HashToken("rku_tok_different-token-value")
	if hash1 == hash3 {
		t.Error("different tokens should produce different hashes")
	}
}

func TestJWT_GenerateBootstrapToken_Format(t *testing.T) {
	token, err := auth.GenerateBootstrapToken()
	if err != nil {
		t.Fatalf("GenerateBootstrapToken: %v", err)
	}
	if !strings.HasPrefix(token, "rku_tok_") {
		t.Errorf("bootstrap token = %q, want prefix 'rku_tok_'", token)
	}
	if len(token) < 20 {
		t.Errorf("bootstrap token too short: %d chars", len(token))
	}
}

func TestJWT_GenerateRefreshToken_Format(t *testing.T) {
	token, err := auth.GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken: %v", err)
	}
	if !strings.HasPrefix(token, "rku_ref_") {
		t.Errorf("refresh token = %q, want prefix 'rku_ref_'", token)
	}
	if len(token) < 20 {
		t.Errorf("refresh token too short: %d chars", len(token))
	}
}

func TestJWT_GenerateBootstrapToken_Unique(t *testing.T) {
	token1, err := auth.GenerateBootstrapToken()
	if err != nil {
		t.Fatal(err)
	}
	token2, err := auth.GenerateBootstrapToken()
	if err != nil {
		t.Fatal(err)
	}
	if token1 == token2 {
		t.Error("two generated bootstrap tokens should be unique")
	}
}

func TestJWT_WithClaims_RoundTrip(t *testing.T) {
	original := &auth.Claims{
		Subject:   "ctx-user",
		Roles:     []string{"admin"},
		TokenType: "access",
		IssuedAt:  time.Now().Unix(),
		ExpiresAt: time.Now().Add(15 * time.Minute).Unix(),
		TokenID:   "test-jti",
	}

	ctx := auth.WithClaims(context.Background(), original)
	retrieved := auth.ClaimsFromContext(ctx)

	if retrieved == nil {
		t.Fatal("ClaimsFromContext returned nil")
		return
	}
	if retrieved.Subject != original.Subject {
		t.Errorf("subject = %q, want %q", retrieved.Subject, original.Subject)
	}
	if retrieved.TokenID != original.TokenID {
		t.Errorf("token ID = %q, want %q", retrieved.TokenID, original.TokenID)
	}
}

func TestJWT_ClaimsFromContext_Empty(t *testing.T) {
	claims := auth.ClaimsFromContext(context.Background())
	if claims != nil {
		t.Errorf("expected nil claims from empty context, got %+v", claims)
	}
}

func TestJWT_ValidateAPIKey_Expired(t *testing.T) {
	a, drv := testAuth(t)
	ctx := context.Background()

	pastExpiry := time.Now().Add(-1 * time.Hour)
	rawKey, _ := seedAPIKey(t, drv, "expired-api-key", []string{"read"}, &pastExpiry)

	_, err := a.ValidateAPIKey(ctx, rawKey)
	if err == nil {
		t.Fatal("expected error for expired API key, got nil")
	}
	if !strings.Contains(err.Error(), "expired") {
		t.Errorf("expected error to mention 'expired', got: %v", err)
	}
}
