// Package authoidc implements an OIDC (OpenID Connect) Caddy handler
// that authenticates downstream requests via an external identity
// provider and federates the verified claims onto the upstream
// service.
//
// The handler covers three execution paths:
//
//  1. Callback path (configured via CallbackPath). The IdP redirects
//     the user-agent here with `code` and `state`. The handler
//     exchanges the code, verifies the ID token, persists the claims
//     in the session store, sets the session cookie, and redirects
//     the browser back to the URL the user originally requested.
//
//  2. Authenticated request — a valid session cookie is present. The
//     handler pulls the verified claims from the session, stamps
//     X-Rioku-Principal / X-Rioku-Tenant / X-Rioku-Claim-<Name>
//     headers, and calls next.
//
//  3. Unauthenticated request — no cookie or invalid/expired session.
//     The handler builds a signed state token containing the
//     originally-requested URL and redirects the user-agent to the
//     IdP authorize endpoint.
//
// Sessions are stored in-process; restarting Caddy invalidates them.
// A persistent session store is a follow-up.
package authoidc

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/coreos/go-oidc/v3/oidc"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

func init() {
	caddy.RegisterModule(OIDC{})
	httpcaddyfile.RegisterHandlerDirective("rioku_oidc", parseCaddyfileHandler)
}

// OIDC is the Caddy handler module that performs an interactive
// OpenID Connect authorization-code flow against a configured IdP.
//
// All required credentials (ClientSecretSource) are expected to be
// vault-resolved by the daemon before this handler ever sees them
// (per D12). The handler treats ClientSecretSource as a literal.
type OIDC struct {
	// DiscoveryURL points at the IdP's
	// `.well-known/openid-configuration` document. Required.
	DiscoveryURL string `json:"discovery_url,omitempty"`

	// ClientID is the OAuth2 / OIDC client identifier registered
	// with the IdP. Required.
	ClientID string `json:"client_id,omitempty"`

	// ClientSecretSource is the OAuth2 client secret as a literal
	// string. The daemon resolves vault references before passing
	// the value to this module.
	ClientSecretSource string `json:"client_secret_source,omitempty"`

	// Scopes is the list of OIDC scopes requested at authorize.
	// Defaults to ["openid", "profile", "email"].
	Scopes []string `json:"scopes,omitempty"`

	// RedirectURL is the full URL the IdP redirects to after the
	// user authenticates. It must resolve to a path covered by this
	// handler's CallbackPath so the callback is intercepted.
	RedirectURL string `json:"redirect_url,omitempty"`

	// CallbackPath is the URL path on which to intercept the OAuth2
	// code-exchange callback. Requests to this path with a `code`
	// query parameter are treated as IdP redirects.
	CallbackPath string `json:"callback_path,omitempty"`

	// ClaimPrincipalPath names the claim to use as the request
	// principal (X-Rioku-Principal). Defaults to "sub".
	ClaimPrincipalPath string `json:"claim_principal_path,omitempty"`

	// ClaimTenantPath optionally names the claim mapped to the
	// X-Rioku-Tenant request header.
	ClaimTenantPath string `json:"claim_tenant_path,omitempty"`

	// ForwardClaims is the list of claim names whose values are
	// copied to request headers as X-Rioku-Claim-<name>.
	ForwardClaims []string `json:"forward_claims,omitempty"`

	// SessionCookieName is the cookie that carries the opaque
	// session ID. Defaults to "rioku_oidc_session".
	SessionCookieName string `json:"session_cookie_name,omitempty"`

	// SessionTTLSeconds bounds how long a session remains valid.
	// Defaults to 3600 (1 hour). Negative is clamped to 0 which
	// disables expiry — not recommended outside of tests.
	SessionTTLSeconds int `json:"session_ttl_seconds,omitempty"`

	// Computed at Provision.
	provider     *oidc.Provider
	verifier     *oidc.IDTokenVerifier
	oauth2Config *oauth2.Config
	sessions     *sessionStore
	state        *stateSigner
	logger       *zap.Logger
	sessionTTL   time.Duration
}

// CaddyModule registers this handler under the
// http.handlers.rioku_oidc namespace.
func (OIDC) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_oidc",
		New: func() caddy.Module { return new(OIDC) },
	}
}

// Provision discovers the OIDC provider, builds the oauth2.Config,
// and seeds the session store + state signer.
func (o *OIDC) Provision(ctx caddy.Context) error {
	o.logger = ctx.Logger()

	if o.DiscoveryURL == "" {
		return fmt.Errorf("rioku_oidc: discovery_url is required")
	}
	if o.ClientID == "" {
		return fmt.Errorf("rioku_oidc: client_id is required")
	}
	if o.ClientSecretSource == "" {
		return fmt.Errorf("rioku_oidc: client_secret_source is required")
	}
	if o.RedirectURL == "" {
		return fmt.Errorf("rioku_oidc: redirect_url is required")
	}
	if o.CallbackPath == "" {
		return fmt.Errorf("rioku_oidc: callback_path is required")
	}

	if len(o.Scopes) == 0 {
		o.Scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}
	if o.ClaimPrincipalPath == "" {
		o.ClaimPrincipalPath = "sub"
	}
	if o.SessionCookieName == "" {
		o.SessionCookieName = "rioku_oidc_session"
	}
	switch {
	case o.SessionTTLSeconds < 0:
		o.sessionTTL = 0
	case o.SessionTTLSeconds == 0:
		o.sessionTTL = time.Hour
	default:
		o.sessionTTL = time.Duration(o.SessionTTLSeconds) * time.Second
	}

	// go-oidc derives the issuer URL from the supplied "issuer"
	// argument; pass the discovery URL with the well-known suffix
	// stripped so the library can re-fetch the document itself.
	issuer := strings.TrimSuffix(o.DiscoveryURL, "/.well-known/openid-configuration")
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return fmt.Errorf("rioku_oidc: discover provider at %q: %w", issuer, err)
	}
	o.provider = provider
	o.verifier = provider.Verifier(&oidc.Config{ClientID: o.ClientID})
	o.oauth2Config = &oauth2.Config{
		ClientID:     o.ClientID,
		ClientSecret: o.ClientSecretSource,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  o.RedirectURL,
		Scopes:       o.Scopes,
	}

	o.sessions = newSessionStore()
	signer, err := newStateSigner(0)
	if err != nil {
		return fmt.Errorf("rioku_oidc: state signer: %w", err)
	}
	o.state = signer

	return nil
}

// Validate is a no-op; configuration consistency is enforced in
// Provision so errors surface at config-load time.
func (o *OIDC) Validate() error { return nil }

// ServeHTTP dispatches between the three OIDC request branches. See
// the package doc for the contract.
func (o *OIDC) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	if r.URL.Path == o.CallbackPath && r.URL.Query().Get("code") != "" {
		return o.handleCallback(w, r)
	}

	if claims := o.activeSession(r); claims != nil {
		o.applyClaimsToRequest(r, claims)
		return next.ServeHTTP(w, r)
	}

	return o.redirectToProvider(w, r)
}

// stateCookieName is the HttpOnly cookie used to bind the OAuth2
// state token to the user-agent that initiated the authorize
// redirect. It defends against state-replay across user-agents
// within the state TTL window.
const stateCookieName = "rioku_oidc_state"

// handleCallback exchanges the code for tokens, verifies the ID
// token, mints a session, and redirects back to the original URL.
func (o *OIDC) handleCallback(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	rawState := q.Get("state")
	if rawState == "" {
		return o.deny(w, http.StatusBadRequest, "missing state parameter", nil)
	}

	// State must be bound to a cookie set on the outbound redirect.
	stateCookie, err := r.Cookie(stateCookieName)
	if err != nil || stateCookie.Value == "" {
		return o.deny(w, http.StatusBadRequest, "missing state cookie", err)
	}
	if subtle.ConstantTimeCompare([]byte(rawState), []byte(stateCookie.Value)) != 1 {
		return o.deny(w, http.StatusBadRequest, "state cookie mismatch", nil)
	}

	st, err := o.state.decode(rawState)
	if err != nil {
		return o.deny(w, http.StatusBadRequest, "invalid state token", err)
	}

	code := q.Get("code")
	tok, err := o.oauth2Config.Exchange(r.Context(), code)
	if err != nil {
		return o.deny(w, http.StatusBadGateway, "token exchange failed", err)
	}

	rawIDToken, ok := tok.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return o.deny(w, http.StatusBadGateway, "id_token missing from provider response", nil)
	}

	idToken, err := o.verifier.Verify(r.Context(), rawIDToken)
	if err != nil {
		return o.deny(w, http.StatusUnauthorized, "id_token verification failed", err)
	}

	// OIDC nonce binding: the id_token MUST echo the nonce we sent
	// on authorize. Reject if missing or mismatched.
	if idToken.Nonce == "" || idToken.Nonce != st.OIDCNonce {
		return o.deny(w, http.StatusBadRequest, "id_token nonce mismatch", nil)
	}

	var claims map[string]any
	if err := idToken.Claims(&claims); err != nil {
		return o.deny(w, http.StatusBadGateway, "id_token claim decode failed", err)
	}

	sessionID, err := newSessionID()
	if err != nil {
		return o.deny(w, http.StatusInternalServerError, "session id generation", err)
	}
	o.sessions.put(sessionID, claims, o.sessionTTL)
	http.SetCookie(w, &http.Cookie{
		Name:     o.SessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   o.SessionTTLSeconds,
	})
	// Clear the one-shot state cookie now that it has served its
	// purpose. MaxAge=-1 instructs the user-agent to delete it.
	http.SetCookie(w, &http.Cookie{
		Name:     stateCookieName,
		Value:    "",
		Path:     o.CallbackPath,
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	dest := safeRedirectPath(st.OriginalURL)
	if dest == "" {
		dest = "/"
	}
	http.Redirect(w, r, dest, http.StatusFound)
	return nil
}

// safeRedirectPath returns dest if it is a same-origin absolute path,
// or "" otherwise. Rejects scheme-relative ("//evil"), backslash
// tricks ("/\\evil"), absolute URLs, and non-path schemes
// (javascript:, data:, etc.).
func safeRedirectPath(dest string) string {
	if dest == "" {
		return ""
	}
	// Must start with a single forward slash.
	if dest[0] != '/' {
		return ""
	}
	// Reject "//host" and "/\host" (some browsers normalize "\" to "/").
	if len(dest) > 1 && (dest[1] == '/' || dest[1] == '\\') {
		return ""
	}
	// Reject any backslash anywhere — these are non-standard path
	// separators that some user-agents normalize, opening the door
	// to crafted redirects like "/\\\\evil.com".
	for i := 0; i < len(dest); i++ {
		if dest[i] == '\\' {
			return ""
		}
	}
	return dest
}

// activeSession returns the verified claims for the inbound request
// when the session cookie maps to a live entry, else nil.
func (o *OIDC) activeSession(r *http.Request) map[string]any {
	c, err := r.Cookie(o.SessionCookieName)
	if err != nil || c.Value == "" {
		return nil
	}
	claims, ok := o.sessions.get(c.Value)
	if !ok {
		return nil
	}
	return claims
}

// applyClaimsToRequest stamps X-Rioku-Principal, X-Rioku-Tenant (if
// configured), and the per-claim X-Rioku-Claim-<Name> headers on the
// outbound request.
func (o *OIDC) applyClaimsToRequest(r *http.Request, claims map[string]any) {
	if v, ok := stringClaim(claims, o.ClaimPrincipalPath); ok && v != "" {
		r.Header.Set("X-Rioku-Principal", v)
		if repl, ok := r.Context().Value(caddy.ReplacerCtxKey).(*caddy.Replacer); ok && repl != nil {
			repl.Set("http.auth.user.id", v)
		}
	}
	if o.ClaimTenantPath != "" {
		if v, ok := stringClaim(claims, o.ClaimTenantPath); ok && v != "" {
			r.Header.Set("X-Rioku-Tenant", v)
		}
	}
	for _, name := range o.ForwardClaims {
		if v, ok := claims[name]; ok {
			r.Header.Set("X-Rioku-Claim-"+http.CanonicalHeaderKey(name), formatClaim(v))
		}
	}
}

// redirectToProvider issues a 302 to the IdP authorize endpoint with
// our signed state token encoding the original URL and a fresh
// OIDC nonce. The state token is mirrored into an HttpOnly cookie
// scoped to the callback path, binding the callback to the same
// user-agent that initiated the flow.
func (o *OIDC) redirectToProvider(w http.ResponseWriter, r *http.Request) error {
	original := r.URL.RequestURI()
	nonce, err := newOIDCNonce()
	if err != nil {
		return o.deny(w, http.StatusInternalServerError, "encode nonce", err)
	}
	stateToken, err := o.state.encode(original, nonce)
	if err != nil {
		return o.deny(w, http.StatusInternalServerError, "encode state", err)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     stateCookieName,
		Value:    stateToken,
		Path:     o.CallbackPath,
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600,
	})
	authURL := o.oauth2Config.AuthCodeURL(stateToken, oidc.Nonce(nonce))
	http.Redirect(w, r, authURL, http.StatusFound)
	return nil
}

// deny writes a status code, logs the reason at debug, and returns
// nil so Caddy considers the request handled. We intentionally do
// not surface the underlying error to the client.
func (o *OIDC) deny(w http.ResponseWriter, status int, reason string, cause error) error {
	if o.logger != nil {
		o.logger.Debug("oidc denied",
			zap.String("reason", reason),
			zap.Error(cause),
		)
	}
	w.WriteHeader(status)
	return nil
}

// stringClaim returns claims[key] coerced to string, or ("", false)
// when the key is missing or holds a non-string non-numeric value.
func stringClaim(claims map[string]any, key string) (string, bool) {
	v, ok := claims[key]
	if !ok {
		return "", false
	}
	switch x := v.(type) {
	case string:
		return x, true
	case float64, int, int64, bool:
		return formatClaim(x), true
	default:
		return "", false
	}
}

// formatClaim renders an arbitrary claim value as a string for the
// X-Rioku-Claim-<Name> header. JSON-encoded for composite types.
func formatClaim(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", x), "0"), ".")
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(b)
	}
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_oidc {
//	    discovery_url https://accounts.example.com/.well-known/openid-configuration
//	    client_id rioku-app
//	    client_secret_source {env.OIDC_CLIENT_SECRET}
//	    scopes openid profile email groups
//	    redirect_url https://gateway.example.com/oauth/callback
//	    callback_path /oauth/callback
//	    claim_principal_path sub
//	    claim_tenant_path tenant_id
//	    forward_claims sub email groups tenant_id
//	    session_cookie_name rioku_oidc_session
//	    session_ttl_seconds 3600
//	}
func (o *OIDC) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "discovery_url":
				if !d.Args(&o.DiscoveryURL) {
					return d.ArgErr()
				}
			case "client_id":
				if !d.Args(&o.ClientID) {
					return d.ArgErr()
				}
			case "client_secret_source":
				if !d.Args(&o.ClientSecretSource) {
					return d.ArgErr()
				}
			case "scopes":
				o.Scopes = append(o.Scopes, d.RemainingArgs()...)
			case "redirect_url":
				if !d.Args(&o.RedirectURL) {
					return d.ArgErr()
				}
			case "callback_path":
				if !d.Args(&o.CallbackPath) {
					return d.ArgErr()
				}
			case "claim_principal_path":
				if !d.Args(&o.ClaimPrincipalPath) {
					return d.ArgErr()
				}
			case "claim_tenant_path":
				if !d.Args(&o.ClaimTenantPath) {
					return d.ArgErr()
				}
			case "forward_claims":
				o.ForwardClaims = append(o.ForwardClaims, d.RemainingArgs()...)
			case "session_cookie_name":
				if !d.Args(&o.SessionCookieName) {
					return d.ArgErr()
				}
			case "session_ttl_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &o.SessionTTLSeconds); err != nil {
					return d.Errf("invalid session_ttl_seconds %q: %v", v, err)
				}
			default:
				return d.Errf("unknown rioku_oidc directive: %q", d.Val())
			}
		}
	}
	return nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var o OIDC
	if err := o.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &o, nil
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*OIDC)(nil)
	_ caddy.Validator             = (*OIDC)(nil)
	_ caddyhttp.MiddlewareHandler = (*OIDC)(nil)
	_ caddyfile.Unmarshaler       = (*OIDC)(nil)
)
