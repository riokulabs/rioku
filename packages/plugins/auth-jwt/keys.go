package authjwt

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/caddyserver/caddy/v2"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

// keyResolver hands the right key to the JWT parser given a
// token's header. Static keys (PEM/HMAC) are resolved once at
// Provision; JWKS keys are kept fresh by the keyfunc package's
// background refresh.
//
// When both static and JWKS sources are configured, JWKS wins for
// any token whose `kid` header matches a key in the JWKS — the
// static key acts as a fallback for tokens with no `kid` (e.g.,
// a legacy signing key during a rollover).
type keyResolver struct {
	staticKey any
	jwks      keyfunc.Keyfunc
	logger    *zap.Logger
}

func newKeyResolver(ctx caddy.Context, sourceLiteral, jwksURL string, refresh time.Duration, logger *zap.Logger) (*keyResolver, error) {
	r := &keyResolver{logger: logger}

	if sourceLiteral != "" {
		key, err := parseStaticKey(sourceLiteral)
		if err != nil {
			return nil, fmt.Errorf("parse signing_key_source: %w", err)
		}
		r.staticKey = key
	}

	if jwksURL != "" {
		// keyfunc/v3 expresses the refresh cadence through its
		// Override struct rather than Options. Default interval is
		// 1h upstream; we drop to the configured value when caller
		// supplied refresh > 0.
		var jw keyfunc.Keyfunc
		var err error
		if refresh > 0 {
			jw, err = keyfunc.NewDefaultOverrideCtx(ctx, []string{jwksURL}, keyfunc.Override{
				RefreshInterval: refresh,
			})
		} else {
			jw, err = keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
		}
		if err != nil {
			return nil, fmt.Errorf("init JWKS from %q: %w", jwksURL, err)
		}
		r.jwks = jw
	}

	return r, nil
}

// Keyfunc is the jwt/v5 jwt.Keyfunc implementation. It dispatches to
// JWKS when the token has a `kid`, otherwise falls back to the
// configured static key.
func (r *keyResolver) Keyfunc(t *jwt.Token) (any, error) {
	if r == nil {
		return nil, errors.New("rioku_jwt: key resolver not provisioned")
	}

	if r.jwks != nil {
		if kid, _ := t.Header["kid"].(string); kid != "" {
			key, err := r.jwks.Keyfunc(t)
			if err == nil {
				return key, nil
			}
			// JWKS lookup failed but a static key may still
			// match. Fall through.
			if r.staticKey == nil {
				return nil, fmt.Errorf("jwks lookup failed for kid=%q: %w", kid, err)
			}
		}
	}

	if r.staticKey == nil {
		return nil, errors.New("no signing key available for token")
	}
	return r.staticKey, nil
}

// parseStaticKey reads a static signing-key string and returns the
// concrete key type the jwt package expects.
//
//   - PEM-encoded RSA / EC / Ed25519 public keys: returned as
//     *rsa.PublicKey, *ecdsa.PublicKey, ed25519.PublicKey.
//   - PEM-encoded RSA / EC / Ed25519 private keys: returned as the
//     pointer type (verification still uses the public half — the
//     jwt package handles that).
//   - Anything that doesn't parse as PEM is returned as raw bytes,
//     which the jwt package treats as the HMAC secret for HS256/384/512.
func parseStaticKey(literal string) (any, error) {
	if literal == "" {
		return nil, errors.New("empty key literal")
	}

	block, _ := pem.Decode([]byte(literal))
	if block == nil {
		// Not PEM — treat as raw HMAC secret.
		return []byte(literal), nil
	}

	// Try public key formats first (the common case for JWT
	// verification).
	if pub, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		return pub, nil
	}
	// PKCS#1 RSA public.
	if pub, err := x509.ParsePKCS1PublicKey(block.Bytes); err == nil {
		return pub, nil
	}
	// Private key formats — usually only present in test fixtures.
	if priv, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		return priv, nil
	}
	if priv, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return priv, nil
	}
	if priv, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return priv, nil
	}

	return nil, fmt.Errorf("PEM block %q did not parse as a known key format", block.Type)
}
