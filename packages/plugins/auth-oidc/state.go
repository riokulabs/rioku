package authoidc

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// stateToken is the structure encoded into the OAuth2 `state`
// parameter on the authorize redirect. It carries the user's
// originally-requested URL across the IdP round-trip, a random
// state nonce that prevents replay / CSRF on the state token
// itself, and the OIDC `nonce` claim value that we expect to see
// echoed back in the verified id_token.
//
// Wire format (base64url, no padding):
//
//	<nonce-hex>.<issued-unix>.<original-url-b64>.<oidc-nonce-b64>.<hmac-hex>
//
// The HMAC covers the first four segments using a per-process
// secret. A fresh secret is generated at module Provision; sessions
// already in flight at the time of a Caddy reload will fail state
// validation and be redirected back to the IdP, which is acceptable
// for an SSO interactive flow.
type stateToken struct {
	Nonce       string
	OriginalURL string
	OIDCNonce   string
	IssuedAt    time.Time
}

// stateSigner produces and verifies state tokens. The secret is
// generated once per module instance; rotating the secret invalidates
// every in-flight authorize request, which is fine because the user
// will simply be re-redirected.
type stateSigner struct {
	secret []byte
	maxAge time.Duration
}

// newStateSigner returns a signer with a fresh 32-byte secret. maxAge
// bounds how long a state token remains valid (defaults to 10 minutes
// when zero).
func newStateSigner(maxAge time.Duration) (*stateSigner, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("generate state secret: %w", err)
	}
	if maxAge <= 0 {
		maxAge = 10 * time.Minute
	}
	return &stateSigner{secret: secret, maxAge: maxAge}, nil
}

// encode produces a signed state token for the given original URL
// and OIDC nonce value.
func (s *stateSigner) encode(originalURL, oidcNonce string) (string, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}
	parts := []string{
		hex.EncodeToString(nonce),
		fmt.Sprintf("%d", time.Now().Unix()),
		base64.RawURLEncoding.EncodeToString([]byte(originalURL)),
		base64.RawURLEncoding.EncodeToString([]byte(oidcNonce)),
	}
	mac := s.sign(parts)
	parts = append(parts, mac)
	return strings.Join(parts, "."), nil
}

// decode verifies the signature and TTL on a state token and returns
// the embedded original URL plus expected OIDC nonce.
func (s *stateSigner) decode(raw string) (*stateToken, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 5 {
		return nil, errors.New("state token: malformed")
	}
	expected := s.sign(parts[:4])
	// constant-time compare to avoid timing leakage on the HMAC.
	if !hmac.Equal([]byte(expected), []byte(parts[4])) {
		return nil, errors.New("state token: bad signature")
	}

	var issuedUnix int64
	if _, err := fmt.Sscanf(parts[1], "%d", &issuedUnix); err != nil {
		return nil, fmt.Errorf("state token: bad timestamp: %w", err)
	}
	issuedAt := time.Unix(issuedUnix, 0)
	if s.maxAge > 0 && time.Since(issuedAt) > s.maxAge {
		return nil, errors.New("state token: expired")
	}

	urlBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("state token: bad url segment: %w", err)
	}
	nonceBytes, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return nil, fmt.Errorf("state token: bad nonce segment: %w", err)
	}

	return &stateToken{
		Nonce:       parts[0],
		OriginalURL: string(urlBytes),
		OIDCNonce:   string(nonceBytes),
		IssuedAt:    issuedAt,
	}, nil
}

// newOIDCNonce returns a fresh, URL-safe OIDC nonce (16 random bytes
// → 22 chars base64url, no padding).
func newOIDCNonce() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("oidc nonce: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *stateSigner) sign(parts []string) string {
	h := hmac.New(sha256.New, s.secret)
	h.Write([]byte(strings.Join(parts, ".")))
	return hex.EncodeToString(h.Sum(nil))
}

// newSessionID returns an opaque, URL-safe session identifier. 32
// random bytes -> 43 chars base64url.
func newSessionID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("session id: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
