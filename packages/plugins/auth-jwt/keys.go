package authjwt

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
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

func newKeyResolver(ctx caddy.Context, sourceLiteral, jwksURL string, refresh time.Duration, observabilityEndpoint string, logger *zap.Logger) (*keyResolver, error) {
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
		override := keyfunc.Override{}
		if refresh > 0 {
			override.RefreshInterval = refresh
		}

		// Wire the daemon-side observability reporter (#191) when an
		// endpoint was supplied. RefreshErrorHandlerFunc fires on
		// every refresh failure; we forward the error to the daemon
		// so operators can see a stale JWKS without tailing logs.
		if observabilityEndpoint != "" {
			client := &http.Client{Timeout: 3 * time.Second}
			override.RefreshErrorHandlerFunc = func(u string) func(ctx context.Context, err error) {
				return func(_ context.Context, refreshErr error) {
					reportJWKSEvent(client, observabilityEndpoint, u, "error", refreshErr.Error(), logger)
					if logger != nil {
						logger.Warn("rioku_jwt: JWKS refresh failed", zap.String("url", u), zap.Error(refreshErr))
					}
				}
			}
		}

		var jw keyfunc.Keyfunc
		var err error
		// NewDefaultCtx vs NewDefaultOverrideCtx: keep the original
		// branch so we don't change the no-override default behavior.
		if refresh > 0 || observabilityEndpoint != "" {
			jw, err = keyfunc.NewDefaultOverrideCtx(ctx, []string{jwksURL}, override)
		} else {
			jw, err = keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
		}
		if err != nil {
			return nil, fmt.Errorf("init JWKS from %q: %w", jwksURL, err)
		}
		r.jwks = jw

		// Stamp an initial "registered" event so the registry has a
		// row before the first refresh outcome arrives. Best-effort:
		// ignore errors so daemon-side observability is never on the
		// data plane's hot path.
		if observabilityEndpoint != "" {
			client := &http.Client{Timeout: 3 * time.Second}
			go reportJWKSEvent(client, observabilityEndpoint, jwksURL, "registered", "", logger)
		}
	}

	return r, nil
}

// reportJWKSEvent fires-and-forgets a JWKS observability event to
// the daemon-side ingress. Errors are logged at debug level only —
// observability gaps must not affect data-plane verification.
func reportJWKSEvent(client *http.Client, endpoint, url, status, errMsg string, logger *zap.Logger) {
	body, err := json.Marshal(map[string]any{
		"url":    url,
		"status": status,
		"error":  errMsg,
		"at":     time.Now().UTC(),
	})
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		if logger != nil {
			logger.Debug("rioku_jwt: observability endpoint unreachable", zap.Error(err))
		}
		return
	}
	_ = resp.Body.Close()
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
