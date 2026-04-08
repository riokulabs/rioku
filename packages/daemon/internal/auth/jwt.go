// Package auth implements first-party JWT authentication for the
// admin REST API and daemon gRPC server. Bootstrap flow generates
// a root credential via `rioku init`.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/riokulabs/rioku/internal/store"
)

type authClaimsKey struct{}

// WithClaims attaches claims to a context.
func WithClaims(ctx context.Context, c *Claims) context.Context {
	return context.WithValue(ctx, authClaimsKey{}, c)
}

// ClaimsFromContext retrieves claims from a context.
func ClaimsFromContext(ctx context.Context) *Claims {
	c, _ := ctx.Value(authClaimsKey{}).(*Claims)
	return c
}

// Token type constants.
const (
	TokenTypeAccess  = "access"
	TokenTypeRefresh = "refresh"
)

// Default token lifetimes.
const (
	DefaultAccessTTL  = 15 * time.Minute
	DefaultRefreshTTL = 7 * 24 * time.Hour
)

// Claims represents the decoded JWT claims.
type Claims struct {
	Subject   string   `json:"sub"`
	Roles     []string `json:"roles"`
	TokenType string   `json:"typ"`
	IssuedAt  int64    `json:"iat"`
	ExpiresAt int64    `json:"exp"`
	TokenID   string   `json:"jti"`
}

// TokenPair contains an access token and refresh token.
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// Auth manages JWT signing, validation, and token lifecycle.
type Auth struct {
	mu          sync.RWMutex
	signingKeys [][]byte // current key at [0], previous keys for rotation
	store       store.Driver
	accessTTL   time.Duration
	refreshTTL  time.Duration
}

// NewAuth creates an Auth instance with the given signing key and store.
func NewAuth(signingKey []byte, st store.Driver) *Auth {
	return &Auth{
		signingKeys: [][]byte{signingKey},
		store:       st,
		accessTTL:   DefaultAccessTTL,
		refreshTTL:  DefaultRefreshTTL,
	}
}

// SigningKey returns a copy of the current (primary) signing key.
// This is used to derive encryption keys for TOTP secrets and other
// data-at-rest encryption.
func (a *Auth) SigningKey() []byte {
	a.mu.RLock()
	defer a.mu.RUnlock()
	key := make([]byte, len(a.signingKeys[0]))
	copy(key, a.signingKeys[0])
	return key
}

// RotateSigningKey adds a new signing key. The old key is kept for
// validating existing tokens until they expire.
func (a *Auth) RotateSigningKey(newKey []byte) {
	a.mu.Lock()
	defer a.mu.Unlock()
	// Prepend new key — current is always [0].
	a.signingKeys = append([][]byte{newKey}, a.signingKeys...)
	// Keep at most 3 keys (current + 2 previous).
	if len(a.signingKeys) > 3 {
		a.signingKeys = a.signingKeys[:3]
	}
}

// ---------------------------------------------------------------------------
// Token issuance
// ---------------------------------------------------------------------------

// IssueTokenPair creates a new access + refresh token pair.
func (a *Auth) IssueTokenPair(ctx context.Context, subject string, roles []string) (*TokenPair, error) {
	now := time.Now()

	accessClaims := &Claims{
		Subject:   subject,
		Roles:     roles,
		TokenType: TokenTypeAccess,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(a.accessTTL).Unix(),
		TokenID:   uuid.New().String(),
	}
	accessToken, err := a.sign(accessClaims)
	if err != nil {
		return nil, fmt.Errorf("sign access token: %w", err)
	}

	refreshToken, err := GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}

	// Store refresh token hash with metadata.
	if err := a.storeRefreshToken(ctx, refreshToken, subject, roles, now.Add(a.refreshTTL)); err != nil {
		return nil, fmt.Errorf("store refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(a.accessTTL.Seconds()),
		TokenType:    "Bearer",
	}, nil
}

// ExchangeBootstrapToken validates a bootstrap token and issues a token pair.
func (a *Auth) ExchangeBootstrapToken(ctx context.Context, token string) (*TokenPair, error) {
	if err := a.validateStoredToken(ctx, "bootstrap", HashToken(token)); err != nil {
		return nil, fmt.Errorf("invalid bootstrap token: %w", err)
	}
	return a.IssueTokenPair(ctx, "admin", []string{"admin"})
}

// RefreshTokens validates a refresh token and issues a new token pair.
// The old refresh token is invalidated (rotation).
func (a *Auth) RefreshTokens(ctx context.Context, refreshToken string) (*TokenPair, error) {
	hash := HashToken(refreshToken)

	// Look up the refresh token.
	subject, roles, err := a.consumeRefreshToken(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh token: %w", err)
	}

	return a.IssueTokenPair(ctx, subject, roles)
}

// validateAPIKeyOnly validates an API key and returns claims without issuing tokens.
// Used by ValidateBearer to avoid wasteful DB writes on every request.
func (a *Auth) validateAPIKeyOnly(ctx context.Context, key string) (*Claims, error) {
	hash := HashToken(key)

	tx, err := a.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	apiKey, err := tx.GetAPIKeyByHash(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("api key not found")
	}
	if apiKey.RevokedAt != nil {
		return nil, fmt.Errorf("api key has been revoked")
	}
	if apiKey.ExpiresAt != nil && time.Now().After(*apiKey.ExpiresAt) {
		return nil, fmt.Errorf("api key has expired")
	}

	return &Claims{
		Subject:   "apikey:" + apiKey.ID,
		Roles:     apiKey.Scopes,
		TokenType: TokenTypeAccess,
	}, nil
}

// ValidateAPIKey validates an API key and issues a token pair.
func (a *Auth) ValidateAPIKey(ctx context.Context, key string) (*TokenPair, error) {
	hash := HashToken(key)

	tx, err := a.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	apiKey, err := tx.GetAPIKeyByHash(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("api key not found")
	}
	if apiKey.RevokedAt != nil {
		return nil, fmt.Errorf("api key has been revoked")
	}
	if apiKey.ExpiresAt != nil && time.Now().After(*apiKey.ExpiresAt) {
		return nil, fmt.Errorf("api key has expired")
	}

	return a.IssueTokenPair(ctx, "apikey:"+apiKey.ID, apiKey.Scopes)
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

// ValidateAccessToken validates a JWT access token and returns its claims.
func (a *Auth) ValidateAccessToken(tokenStr string) (*Claims, error) {
	claims, err := a.verify(tokenStr)
	if err != nil {
		return nil, err
	}

	if claims.TokenType != TokenTypeAccess {
		return nil, fmt.Errorf("not an access token")
	}

	if time.Now().Unix() > claims.ExpiresAt {
		return nil, fmt.Errorf("token has expired")
	}

	return claims, nil
}

// ValidateBearer validates a Bearer token string. It accepts both
// JWT access tokens and raw bootstrap/API key tokens.
func (a *Auth) ValidateBearer(ctx context.Context, bearer string) (*Claims, error) {
	// Try JWT first (most common path).
	if claims, err := a.ValidateAccessToken(bearer); err == nil {
		return claims, nil
	}

	// Try as bootstrap token.
	if strings.HasPrefix(bearer, tokenPrefix) {
		if err := a.validateStoredToken(ctx, "bootstrap", HashToken(bearer)); err == nil {
			return &Claims{
				Subject:   "admin",
				Roles:     []string{"admin"},
				TokenType: TokenTypeAccess,
			}, nil
		}
	}

	// Try as API key (validate only, don't issue tokens).
	if claims, err := a.validateAPIKeyOnly(ctx, bearer); err == nil {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid bearer token")
}

// ---------------------------------------------------------------------------
// JWT encoding/decoding (HMAC-SHA256, no external dependency)
// ---------------------------------------------------------------------------

var jwtHeader = base64url([]byte(`{"alg":"HS256","typ":"JWT"}`))

func (a *Auth) sign(claims *Claims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	a.mu.RLock()
	key := a.signingKeys[0]
	a.mu.RUnlock()

	encoded := jwtHeader + "." + base64url(payload)
	sig := hmacSHA256([]byte(encoded), key)
	return encoded + "." + base64url(sig), nil
}

func (a *Auth) verify(tokenStr string) (*Claims, error) {
	parts := strings.SplitN(tokenStr, ".", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed JWT")
	}

	sigBytes, err := base64urlDecode(parts[2])
	if err != nil {
		return nil, fmt.Errorf("decode signature: %w", err)
	}

	message := parts[0] + "." + parts[1]

	// Try each signing key (supports key rotation).
	a.mu.RLock()
	keys := make([][]byte, len(a.signingKeys))
	copy(keys, a.signingKeys)
	a.mu.RUnlock()

	valid := false
	for _, key := range keys {
		expected := hmacSHA256([]byte(message), key)
		if hmac.Equal(sigBytes, expected) {
			valid = true
			break
		}
	}
	if !valid {
		return nil, fmt.Errorf("invalid signature")
	}

	payload, err := base64urlDecode(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}

	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("unmarshal claims: %w", err)
	}

	return &claims, nil
}

func hmacSHA256(message, key []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(message)
	return h.Sum(nil)
}

func base64url(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

func base64urlDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// ---------------------------------------------------------------------------
// Refresh token storage (uses config store API keys table for now)
// ---------------------------------------------------------------------------

func (a *Auth) storeRefreshToken(ctx context.Context, token, subject string, roles []string, expiresAt time.Time) error {
	tx, err := a.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return err
	}

	hash := HashToken(token)
	scopes := append([]string{"refresh", "subject:" + subject}, roles...)

	_, err = tx.CreateAPIKey(ctx, "refresh:"+subject, hash, scopes, &expiresAt)
	if err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (a *Auth) consumeRefreshToken(ctx context.Context, hash string) (string, []string, error) {
	tx, err := a.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return "", nil, err
	}

	key, err := tx.GetAPIKeyByHash(ctx, hash)
	if err != nil {
		tx.Rollback()
		return "", nil, fmt.Errorf("refresh token not found")
	}
	if key.RevokedAt != nil {
		tx.Rollback()
		return "", nil, fmt.Errorf("refresh token has been revoked")
	}
	if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
		tx.Rollback()
		return "", nil, fmt.Errorf("refresh token has expired")
	}

	// Revoke the used refresh token (one-time use / rotation).
	if err := tx.RevokeAPIKey(ctx, key.ID); err != nil {
		tx.Rollback()
		return "", nil, err
	}
	if err := tx.Commit(); err != nil {
		return "", nil, err
	}

	// Extract subject and roles from scopes.
	var subject string
	var roles []string
	for _, s := range key.Scopes {
		if strings.HasPrefix(s, "subject:") {
			subject = strings.TrimPrefix(s, "subject:")
		} else if s != "refresh" {
			roles = append(roles, s)
		}
	}

	return subject, roles, nil
}

func (a *Auth) validateStoredToken(ctx context.Context, name, hash string) error {
	tx, err := a.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()

	key, err := tx.GetAPIKeyByHash(ctx, hash)
	if err != nil {
		return fmt.Errorf("token not found")
	}
	if key.RevokedAt != nil {
		return fmt.Errorf("token has been revoked")
	}

	// Constant-time comparison of the name to prevent timing attacks.
	if subtle.ConstantTimeCompare([]byte(key.Name), []byte(name)) != 1 {
		return fmt.Errorf("token type mismatch")
	}

	return nil
}
