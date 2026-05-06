// Package auth implements first-party JWT authentication for the
// admin REST API and daemon gRPC server. Bootstrap flow generates
// a root credential via `rioku init`.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

const (
	tokenPrefix      = "rku_tok_"
	refreshPrefix    = "rku_ref_"
	signingKeyPrefix = "rku_key_"
	tokenRandBytes   = 32
)

// GenerateBootstrapToken generates a cryptographically random bootstrap token.
// Format: rku_tok_<32 random bytes base64url encoded>
func GenerateBootstrapToken() (string, error) {
	return generateToken(tokenPrefix)
}

// GenerateRefreshToken generates a cryptographically random refresh token.
// Format: rku_ref_<32 random bytes base64url encoded>
func GenerateRefreshToken() (string, error) {
	return generateToken(refreshPrefix)
}

// GenerateSigningKey generates a cryptographically random signing key.
// Format: rku_key_<32 random bytes base64url encoded>
func GenerateSigningKey() (string, error) {
	return generateToken(signingKeyPrefix)
}

func generateToken(prefix string) (string, error) {
	b := make([]byte, tokenRandBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: generate token: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken returns the SHA-256 hex hash of a token.
// Used for storing tokens securely — the raw token is never persisted.
func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// KeyPrefixLen is the number of leading characters of the raw API key
// that we persist as a non-secret display prefix. Twelve chars is long
// enough to be unambiguous in a list of human-readable keys; small
// enough that the visible portion alone is not a usable secret.
const KeyPrefixLen = 12

// KeyPrefix returns the non-secret display prefix of a raw token.
// Returns the whole token when shorter than KeyPrefixLen.
func KeyPrefix(rawKey string) string {
	if len(rawKey) <= KeyPrefixLen {
		return rawKey
	}
	return rawKey[:KeyPrefixLen]
}
