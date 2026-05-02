package authjwt

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(JWT{})
	httpcaddyfile.RegisterHandlerDirective("rioku_jwt", parseCaddyfileHandler)
}

// JWT authenticates downstream requests by verifying a JSON Web Token
// in the Authorization header (or a configurable header / query param).
//
// Resolution order for the signing key:
//
//  1. SigningKeySource — a literal PEM/HMAC string. Supports vault
//     references like "{vault://env/JWT_SIGNING_KEY}". The daemon
//     resolves the reference at Caddy compile time (per D12) before
//     this module ever sees the value.
//  2. JWKSURL — a JWKS endpoint. The module fetches and caches the
//     keys, refreshing every JWKSRefreshInterval (default 5 minutes).
//
// At least one of SigningKeySource or JWKSURL must be set; both may
// be set simultaneously, in which case JWKS takes precedence when a
// token's `kid` header matches a key in the JWKS.
type JWT struct {
	// Issuer is the expected `iss` claim. Required. Tokens with a
	// different issuer are rejected.
	Issuer string `json:"issuer,omitempty"`

	// Audience is the expected `aud` claim. The token's `aud` must
	// contain at least one of the listed audiences. Required.
	Audience []string `json:"audience,omitempty"`

	// SigningKeySource is the literal signing key (PEM-encoded
	// public key for asymmetric algos, raw secret for HS256). When
	// the daemon resolves vault references this field will already
	// hold plaintext.
	SigningKeySource string `json:"signing_key_source,omitempty"`

	// JWKSURL is the URL of a JSON Web Key Set, used for rotation-
	// friendly verification with asymmetric algorithms. When set,
	// the module fetches the JWKS once at Provision and refreshes
	// every JWKSRefreshInterval.
	JWKSURL string `json:"jwks_url,omitempty"`

	// JWKSRefreshSeconds is the JWKS refresh interval. Zero defaults
	// to 300 (5 minutes). Negative disables refresh after the
	// initial fetch.
	JWKSRefreshSeconds int `json:"jwks_refresh_seconds,omitempty"`

	// Algos is the allow-list of accepted JWT algorithms. Empty
	// defaults to the asymmetric set [RS256, ES256, EdDSA] — HS256
	// is excluded by default because shared secrets are leak-prone
	// and most identity providers use asymmetric algorithms.
	Algos []string `json:"algos,omitempty"`

	// ClaimPrincipalPath names the claim that identifies the
	// authenticated principal. The resolved value is exposed in the
	// request context as caddyhttp `{http.auth.user.id}` and is
	// also stamped on the X-Rioku-Principal request header before
	// the request is proxied. Defaults to "sub".
	ClaimPrincipalPath string `json:"claim_principal_path,omitempty"`

	// ForwardClaims is the list of claim names whose values are
	// copied to request headers as X-Rioku-Claim-<name>. Useful for
	// passing tenant ids, role names, or any custom claim onto the
	// upstream service.
	ForwardClaims []string `json:"forward_claims,omitempty"`

	// HeaderName is the request header that carries the token.
	// Defaults to "Authorization" with the "Bearer " prefix.
	HeaderName string `json:"header_name,omitempty"`

	// QueryParam is an optional query-string parameter to read the
	// token from when the header is absent. Empty disables.
	QueryParam string `json:"query_param,omitempty"`

	// LeewaySeconds is the clock-skew tolerance for exp/nbf/iat
	// validation. Defaults to 60s; negative values are clamped to 0.
	LeewaySeconds int `json:"leeway_seconds,omitempty"`

	// Computed at Provision.
	keyResolver *keyResolver
	logger      *zap.Logger
	algoSet     map[string]struct{}
}

// CaddyModule registers this handler under the
// http.handlers.rioku_jwt namespace.
func (JWT) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_jwt",
		New: func() caddy.Module { return new(JWT) },
	}
}

// Provision sets up derived state (key resolver, algo allow-list,
// logger). It returns an error when the configuration is internally
// inconsistent — fail-fast at config load.
func (j *JWT) Provision(ctx caddy.Context) error {
	j.logger = ctx.Logger()

	if j.Issuer == "" {
		return fmt.Errorf("rioku_jwt: issuer is required")
	}
	if len(j.Audience) == 0 {
		return fmt.Errorf("rioku_jwt: audience is required")
	}
	if j.SigningKeySource == "" && j.JWKSURL == "" {
		return fmt.Errorf("rioku_jwt: one of signing_key_source or jwks_url is required")
	}
	if j.ClaimPrincipalPath == "" {
		j.ClaimPrincipalPath = "sub"
	}
	if j.HeaderName == "" {
		j.HeaderName = "Authorization"
	}
	if j.LeewaySeconds < 0 {
		j.LeewaySeconds = 0
	}

	algos := j.Algos
	if len(algos) == 0 {
		algos = []string{"RS256", "ES256", "EdDSA"}
	}
	j.algoSet = make(map[string]struct{}, len(algos))
	for _, a := range algos {
		j.algoSet[a] = struct{}{}
	}

	refreshInterval := time.Duration(j.JWKSRefreshSeconds) * time.Second
	if j.JWKSRefreshSeconds == 0 {
		refreshInterval = 5 * time.Minute
	}

	resolver, err := newKeyResolver(ctx, j.SigningKeySource, j.JWKSURL, refreshInterval, j.logger)
	if err != nil {
		return fmt.Errorf("rioku_jwt: build key resolver: %w", err)
	}
	j.keyResolver = resolver

	return nil
}

// Validate is invoked by Caddy after Provision. The Provision-time
// checks above already cover the same surface, so Validate is a
// no-op for now. Reserved for future "do everything at Validate so
// missing fields surface earlier" refactors.
func (j *JWT) Validate() error { return nil }

// ServeHTTP authenticates the inbound request. On successful
// validation the request is forwarded with X-Rioku-Principal and any
// ForwardClaims headers populated. On failure a 401 is returned and
// the upstream is never contacted.
func (j *JWT) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	tokenStr, err := j.extractToken(r)
	if err != nil {
		return j.deny(w, "missing token", err)
	}

	// Note: aud validation is handled below in validateAudience —
	// jwt/v5's WithAudience only accepts a single configured value
	// while we want any-of-N matching, so we skip the built-in aud
	// check and own the comparison.
	parser := jwt.NewParser(
		jwt.WithValidMethods(j.allowedMethods()),
		jwt.WithIssuer(j.Issuer),
		jwt.WithLeeway(time.Duration(j.LeewaySeconds)*time.Second),
		jwt.WithExpirationRequired(),
	)

	claims := jwt.MapClaims{}
	tok, err := parser.ParseWithClaims(tokenStr, claims, j.keyResolver.Keyfunc)
	if err != nil {
		return j.deny(w, "invalid token", err)
	}
	if !tok.Valid {
		return j.deny(w, "invalid token", errors.New("token marked invalid"))
	}

	if err := validateAudience(claims, j.Audience); err != nil {
		return j.deny(w, "audience mismatch", err)
	}

	principal, err := extractPrincipal(claims, j.ClaimPrincipalPath)
	if err != nil {
		return j.deny(w, "missing principal", err)
	}

	// Stamp principal + forwarded claims onto the request headers
	// before passing to the next handler. caddyhttp's auth.user.id
	// placeholder is also populated for consistency with Caddy's
	// other auth modules. The replacer is absent in unit-test rigs
	// that drive ServeHTTP directly — guard against that.
	r.Header.Set("X-Rioku-Principal", principal)
	if repl, ok := r.Context().Value(caddy.ReplacerCtxKey).(*caddy.Replacer); ok && repl != nil {
		repl.Set("http.auth.user.id", principal)
	}

	for _, name := range j.ForwardClaims {
		if v, ok := claims[name]; ok {
			r.Header.Set("X-Rioku-Claim-"+http.CanonicalHeaderKey(name), fmt.Sprintf("%v", v))
		}
	}

	return next.ServeHTTP(w, r)
}

// extractToken pulls the JWT from the configured header or query
// parameter. Returns the raw token string (no "Bearer " prefix).
func (j *JWT) extractToken(r *http.Request) (string, error) {
	if v := r.Header.Get(j.HeaderName); v != "" {
		// Bearer prefix is conventional but optional (some
		// providers issue tokens via custom headers without it).
		if strings.HasPrefix(v, "Bearer ") {
			return strings.TrimPrefix(v, "Bearer "), nil
		}
		return v, nil
	}
	if j.QueryParam != "" {
		if v := r.URL.Query().Get(j.QueryParam); v != "" {
			return v, nil
		}
	}
	return "", fmt.Errorf("token not found in header %q or query param %q", j.HeaderName, j.QueryParam)
}

// allowedMethods turns Algos into a string list jwt/v5 accepts.
func (j *JWT) allowedMethods() []string {
	out := make([]string, 0, len(j.algoSet))
	for k := range j.algoSet {
		out = append(out, k)
	}
	return out
}

// deny writes a 401 response with no body (don't leak the underlying
// validation error to the client) and logs the cause for debugging.
func (j *JWT) deny(w http.ResponseWriter, reason string, cause error) error {
	if j.logger != nil {
		j.logger.Debug("jwt auth denied",
			zap.String("reason", reason),
			zap.Error(cause),
		)
	}
	w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer realm=%q`, j.Issuer))
	w.WriteHeader(http.StatusUnauthorized)
	return nil
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_jwt {
//	    issuer https://issuer.example.com
//	    audience my-api
//	    signing_key_source {env.JWT_SIGNING_KEY}
//	    jwks_url https://issuer.example.com/.well-known/jwks.json
//	    algos RS256 ES256
//	    claim_principal_path sub
//	    forward_claims sub email role tenant_id
//	    header_name Authorization
//	    query_param access_token
//	    leeway_seconds 60
//	    jwks_refresh_seconds 300
//	}
func (j *JWT) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "issuer":
				if !d.Args(&j.Issuer) {
					return d.ArgErr()
				}
			case "audience":
				j.Audience = append(j.Audience, d.RemainingArgs()...)
			case "signing_key_source":
				if !d.Args(&j.SigningKeySource) {
					return d.ArgErr()
				}
			case "jwks_url":
				if !d.Args(&j.JWKSURL) {
					return d.ArgErr()
				}
			case "algos":
				j.Algos = append(j.Algos, d.RemainingArgs()...)
			case "claim_principal_path":
				if !d.Args(&j.ClaimPrincipalPath) {
					return d.ArgErr()
				}
			case "forward_claims":
				j.ForwardClaims = append(j.ForwardClaims, d.RemainingArgs()...)
			case "header_name":
				if !d.Args(&j.HeaderName) {
					return d.ArgErr()
				}
			case "query_param":
				if !d.Args(&j.QueryParam) {
					return d.ArgErr()
				}
			case "leeway_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &j.LeewaySeconds); err != nil {
					return d.Errf("invalid leeway_seconds %q: %v", v, err)
				}
			case "jwks_refresh_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &j.JWKSRefreshSeconds); err != nil {
					return d.Errf("invalid jwks_refresh_seconds %q: %v", v, err)
				}
			default:
				return d.Errf("unknown rioku_jwt directive: %q", d.Val())
			}
		}
	}
	return nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var j JWT
	if err := j.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &j, nil
}

// validateAudience checks that the token's `aud` claim contains at
// least one of the configured audiences. jwt/v5's WithAudience only
// supports a single audience per parser instance.
func validateAudience(claims jwt.MapClaims, allowed []string) error {
	rawAud, ok := claims["aud"]
	if !ok {
		return fmt.Errorf("aud claim missing")
	}
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, a := range allowed {
		allowedSet[a] = struct{}{}
	}
	switch v := rawAud.(type) {
	case string:
		if _, ok := allowedSet[v]; ok {
			return nil
		}
	case []any:
		for _, e := range v {
			if s, ok := e.(string); ok {
				if _, ok := allowedSet[s]; ok {
					return nil
				}
			}
		}
	}
	return fmt.Errorf("token audience does not include any of %v", allowed)
}

// extractPrincipal pulls the principal value from the claims by name.
// Empty/missing values produce an error (the request must have an
// authenticated principal to be admitted).
func extractPrincipal(claims jwt.MapClaims, path string) (string, error) {
	v, ok := claims[path]
	if !ok {
		return "", fmt.Errorf("principal claim %q not present", path)
	}
	switch x := v.(type) {
	case string:
		if x == "" {
			return "", fmt.Errorf("principal claim %q is empty", path)
		}
		return x, nil
	default:
		return fmt.Sprintf("%v", x), nil
	}
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*JWT)(nil)
	_ caddy.Validator             = (*JWT)(nil)
	_ caddyhttp.MiddlewareHandler = (*JWT)(nil)
	_ caddyfile.Unmarshaler       = (*JWT)(nil)
)
