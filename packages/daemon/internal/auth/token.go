// Package auth implements first-party JWT authentication for the
// admin REST API and daemon gRPC server. Bootstrap flow generates
// a root credential via `rioku init`.
package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

const (
	tokenPrefix    = "rku_tok_"
	tokenRandBytes = 32
)

// GenerateBootstrapToken generates a cryptographically random bootstrap token.
// Format: rku_tok_<32 random bytes base64url encoded>
func GenerateBootstrapToken() (string, error) {
	b := make([]byte, tokenRandBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: generate token: %w", err)
	}
	return tokenPrefix + base64.RawURLEncoding.EncodeToString(b), nil
}
