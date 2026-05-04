package authoidc

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// stubProvider is a minimal OIDC provider for use in tests. It serves
// a discovery document, a JWKS keyed off a generated RSA pair, and a
// /token endpoint that returns a freshly-signed ID token. Nothing
// here is production-quality — it exists solely to make go-oidc happy
// in unit tests.
type stubProvider struct {
	server   *httptest.Server
	priv     *rsa.PrivateKey
	keyID    string
	clientID string
	issuer   string

	// override-able test knobs
	subject       string
	extraClaims   map[string]any
	codeAccepted  string
	tokenAudience string
	tokenIssuer   string // when set, overrides default issuer in id_token
	expiry        time.Duration
}

func newStubProvider(t *testing.T, clientID string) *stubProvider {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa key: %v", err)
	}
	sp := &stubProvider{
		priv:         priv,
		keyID:        "test-key-1",
		clientID:     clientID,
		subject:      "user-42",
		codeAccepted: "valid-code",
		expiry:       time.Hour,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", sp.handleDiscovery)
	mux.HandleFunc("/jwks.json", sp.handleJWKS)
	mux.HandleFunc("/authorize", sp.handleAuthorize)
	mux.HandleFunc("/token", sp.handleToken)
	sp.server = httptest.NewServer(mux)
	sp.issuer = sp.server.URL
	t.Cleanup(sp.server.Close)
	return sp
}

func (s *stubProvider) handleDiscovery(w http.ResponseWriter, r *http.Request) {
	doc := map[string]any{
		"issuer":                                s.issuer,
		"authorization_endpoint":                s.issuer + "/authorize",
		"token_endpoint":                        s.issuer + "/token",
		"jwks_uri":                              s.issuer + "/jwks.json",
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(doc)
}

func (s *stubProvider) handleJWKS(w http.ResponseWriter, r *http.Request) {
	pub := s.priv.PublicKey
	n := base64.RawURLEncoding.EncodeToString(pub.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes())
	jwks := map[string]any{
		"keys": []map[string]any{{
			"kty": "RSA",
			"alg": "RS256",
			"use": "sig",
			"kid": s.keyID,
			"n":   n,
			"e":   e,
		}},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(jwks)
}

func (s *stubProvider) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	// Tests don't drive the authorize endpoint; the redirect URL is
	// the only thing we check.
	w.WriteHeader(http.StatusOK)
}

func (s *stubProvider) handleToken(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if r.Form.Get("code") != s.codeAccepted {
		http.Error(w, "bad code", http.StatusBadRequest)
		return
	}
	// Build ID token claims.
	now := time.Now()
	aud := s.tokenAudience
	if aud == "" {
		aud = s.clientID
	}
	iss := s.tokenIssuer
	if iss == "" {
		iss = s.issuer
	}
	claims := map[string]any{
		"iss": iss,
		"sub": s.subject,
		"aud": aud,
		"exp": now.Add(s.expiry).Unix(),
		"iat": now.Unix(),
	}
	for k, v := range s.extraClaims {
		claims[k] = v
	}
	idToken := signRS256(s.priv, s.keyID, claims)

	resp := map[string]any{
		"access_token": "stub-access",
		"token_type":   "Bearer",
		"expires_in":   3600,
		"id_token":     idToken,
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// signRS256 hand-rolls a minimal RS256 JWS; we want zero coupling to
// the JWT library inside the auth-oidc package itself, so the test
// builds the token from primitives.
func signRS256(priv *rsa.PrivateKey, kid string, claims map[string]any) string {
	header := map[string]any{"alg": "RS256", "typ": "JWT", "kid": kid}
	h, _ := json.Marshal(header)
	c, _ := json.Marshal(claims)
	enc := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	signingInput := enc(h) + "." + enc(c)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, digest[:])
	if err != nil {
		panic(fmt.Sprintf("sign: %v", err))
	}
	return signingInput + "." + enc(sig)
}

func provisioned(t *testing.T, o *OIDC) {
	t.Helper()
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := o.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := o.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

// nextOK returns 200 with a marker header so the test can confirm
// the OIDC handler called its successor.
var nextOK = caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("X-Test-Forwarded", "yes")
	w.WriteHeader(http.StatusOK)
	return nil
})

// stubOIDC builds a fully-provisioned OIDC handler against the
// supplied stub provider. The returned *OIDC is ready for ServeHTTP.
func stubOIDC(t *testing.T, sp *stubProvider) *OIDC {
	t.Helper()
	o := &OIDC{
		DiscoveryURL:       sp.issuer + "/.well-known/openid-configuration",
		ClientID:           sp.clientID,
		ClientSecretSource: "stub-secret",
		RedirectURL:        "http://gateway.example/oauth/callback",
		CallbackPath:       "/oauth/callback",
	}
	provisioned(t, o)
	return o
}

func TestOIDC_Provision_DiscoveryHappyPath(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	o := stubOIDC(t, sp)
	if o.provider == nil {
		t.Fatal("provider not set")
	}
	if o.oauth2Config == nil {
		t.Fatal("oauth2Config not set")
	}
	if got := o.oauth2Config.Endpoint.AuthURL; got != sp.issuer+"/authorize" {
		t.Fatalf("auth endpoint = %q, want %s/authorize", got, sp.issuer)
	}
}

func TestOIDC_UnauthenticatedRedirect_GoesToProvider(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	o := stubOIDC(t, sp)

	req := httptest.NewRequest("GET", "http://gateway.example/protected/page", nil)
	rec := httptest.NewRecorder()
	if err := o.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if !strings.HasPrefix(loc, sp.issuer+"/authorize") {
		t.Fatalf("redirect target = %q, want prefix %s/authorize", loc, sp.issuer)
	}
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("parse redirect: %v", err)
	}
	if got := u.Query().Get("client_id"); got != "rioku-app" {
		t.Fatalf("client_id query = %q, want rioku-app", got)
	}
	if got := u.Query().Get("redirect_uri"); got != "http://gateway.example/oauth/callback" {
		t.Fatalf("redirect_uri query = %q", got)
	}
	state := u.Query().Get("state")
	if state == "" {
		t.Fatal("state query missing")
	}
	// The state token must round-trip through our signer.
	decoded, err := o.state.decode(state)
	if err != nil {
		t.Fatalf("decode state: %v", err)
	}
	if decoded.OriginalURL != "/protected/page" {
		t.Fatalf("decoded original = %q, want /protected/page", decoded.OriginalURL)
	}
}

func TestOIDC_Callback_ExchangesCodeAndSetsSession(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	sp.subject = "alice"
	sp.extraClaims = map[string]any{"email": "alice@example.com", "tenant_id": "acme"}
	o := stubOIDC(t, sp)
	o.ClaimTenantPath = "tenant_id"
	o.ForwardClaims = []string{"email"}

	state, err := o.state.encode("/landing")
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	// httptest.NewRequest's URL is relative-only when path-only, so
	// build a full URL to match the configured CallbackPath.
	req := httptest.NewRequest("GET", "http://gateway.example/oauth/callback?code=valid-code&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	if err := o.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body=%q", rec.Code, rec.Body)
	}
	if loc := rec.Header().Get("Location"); loc != "/landing" {
		t.Fatalf("post-callback redirect = %q, want /landing", loc)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != o.SessionCookieName {
		t.Fatalf("expected one %q cookie, got %+v", o.SessionCookieName, cookies)
	}
	sid := cookies[0].Value
	claims, ok := o.sessions.get(sid)
	if !ok {
		t.Fatal("session not stored")
	}
	if claims["sub"] != "alice" {
		t.Fatalf("session sub = %v, want alice", claims["sub"])
	}
}

func TestOIDC_ValidSession_ForwardsPrincipalAndClaims(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	o := stubOIDC(t, sp)
	o.ClaimTenantPath = "tenant_id"
	o.ForwardClaims = []string{"email", "groups"}

	// Manually inject a session — simulates a request that arrives
	// after a previous successful callback in the same process.
	sid, err := newSessionID()
	if err != nil {
		t.Fatalf("session id: %v", err)
	}
	o.sessions.put(sid, map[string]any{
		"sub":       "alice",
		"email":     "alice@example.com",
		"tenant_id": "acme",
		"groups":    []any{"admins", "ops"},
	}, time.Hour)

	req := httptest.NewRequest("GET", "http://gateway.example/api/things", nil)
	req.AddCookie(&http.Cookie{Name: o.SessionCookieName, Value: sid})
	rec := httptest.NewRecorder()
	if err := o.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body)
	}
	if rec.Header().Get("X-Test-Forwarded") != "yes" {
		t.Fatal("next handler not invoked")
	}
	if got := req.Header.Get("X-Rioku-Principal"); got != "alice" {
		t.Fatalf("principal = %q, want alice", got)
	}
	if got := req.Header.Get("X-Rioku-Tenant"); got != "acme" {
		t.Fatalf("tenant = %q, want acme", got)
	}
	if got := req.Header.Get("X-Rioku-Claim-Email"); got != "alice@example.com" {
		t.Fatalf("email claim = %q", got)
	}
	if got := req.Header.Get("X-Rioku-Claim-Groups"); got == "" {
		t.Fatalf("groups claim missing")
	}
}

func TestOIDC_ExpiredSession_RedirectsToProvider(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	o := stubOIDC(t, sp)

	sid, err := newSessionID()
	if err != nil {
		t.Fatalf("session id: %v", err)
	}
	// Insert an entry that's already past its TTL.
	o.sessions.sessions[sid] = &session{
		claims:    map[string]any{"sub": "alice"},
		createdAt: time.Now().Add(-2 * time.Hour),
		ttl:       time.Hour,
	}

	req := httptest.NewRequest("GET", "http://gateway.example/protected", nil)
	req.AddCookie(&http.Cookie{Name: o.SessionCookieName, Value: sid})
	rec := httptest.NewRecorder()
	if err := o.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	if !strings.HasPrefix(rec.Header().Get("Location"), sp.issuer+"/authorize") {
		t.Fatalf("expired-session redirect target = %q", rec.Header().Get("Location"))
	}
	if _, ok := o.sessions.get(sid); ok {
		t.Fatal("expired session not evicted on read")
	}
}

func TestOIDC_InvalidStateRejected(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	o := stubOIDC(t, sp)
	req := httptest.NewRequest("GET", "http://gateway.example/oauth/callback?code=valid-code&state=garbage.value.here.signature", nil)
	rec := httptest.NewRecorder()
	_ = o.ServeHTTP(rec, req, nextOK)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for invalid state", rec.Code)
	}
}

func TestOIDC_MissingStateOnCallbackRejected(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	o := stubOIDC(t, sp)
	req := httptest.NewRequest("GET", "http://gateway.example/oauth/callback?code=valid-code", nil)
	rec := httptest.NewRecorder()
	_ = o.ServeHTTP(rec, req, nextOK)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 when state missing", rec.Code)
	}
}

func TestOIDC_MissingCodeFallsThroughToRedirect(t *testing.T) {
	// The handler treats CallbackPath WITHOUT a `code` query as a
	// regular unauthenticated request — it redirects to the provider.
	// This avoids special-casing direct hits to the callback path.
	sp := newStubProvider(t, "rioku-app")
	o := stubOIDC(t, sp)
	req := httptest.NewRequest("GET", "http://gateway.example/oauth/callback", nil)
	rec := httptest.NewRecorder()
	_ = o.ServeHTTP(rec, req, nextOK)
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302 (no code -> redirect)", rec.Code)
	}
}

func TestOIDC_OptionalTenantClaimMappingDisabled(t *testing.T) {
	// With ClaimTenantPath empty, X-Rioku-Tenant must not be set
	// even if the session carries a tenant_id-shaped claim.
	sp := newStubProvider(t, "rioku-app")
	o := stubOIDC(t, sp)
	sid, err := newSessionID()
	if err != nil {
		t.Fatalf("session id: %v", err)
	}
	o.sessions.put(sid, map[string]any{"sub": "alice", "tenant_id": "acme"}, time.Hour)

	req := httptest.NewRequest("GET", "http://gateway.example/api/x", nil)
	req.AddCookie(&http.Cookie{Name: o.SessionCookieName, Value: sid})
	rec := httptest.NewRecorder()
	if err := o.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if got := req.Header.Get("X-Rioku-Tenant"); got != "" {
		t.Fatalf("X-Rioku-Tenant = %q with no claim_tenant_path; want empty", got)
	}
}

func TestOIDC_Provision_RejectsMissingFields(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	cases := []struct {
		name string
		o    OIDC
	}{
		{"no_discovery_url", OIDC{ClientID: "c", ClientSecretSource: "s", RedirectURL: "u", CallbackPath: "/cb"}},
		{"no_client_id", OIDC{DiscoveryURL: sp.issuer + "/.well-known/openid-configuration", ClientSecretSource: "s", RedirectURL: "u", CallbackPath: "/cb"}},
		{"no_secret", OIDC{DiscoveryURL: sp.issuer + "/.well-known/openid-configuration", ClientID: "c", RedirectURL: "u", CallbackPath: "/cb"}},
		{"no_redirect_url", OIDC{DiscoveryURL: sp.issuer + "/.well-known/openid-configuration", ClientID: "c", ClientSecretSource: "s", CallbackPath: "/cb"}},
		{"no_callback_path", OIDC{DiscoveryURL: sp.issuer + "/.well-known/openid-configuration", ClientID: "c", ClientSecretSource: "s", RedirectURL: "u"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
			defer cancel()
			if err := tc.o.Provision(ctx); err == nil {
				t.Fatal("expected provision error")
			}
		})
	}
}

func TestOIDC_StateSigner_RoundTrip(t *testing.T) {
	signer, err := newStateSigner(time.Minute)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	tok, err := signer.encode("/some/path?q=1")
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := signer.decode(tok)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.OriginalURL != "/some/path?q=1" {
		t.Fatalf("round-trip URL = %q", got.OriginalURL)
	}
}

func TestOIDC_StateSigner_TamperedRejected(t *testing.T) {
	signer, _ := newStateSigner(time.Minute)
	tok, _ := signer.encode("/x")
	// Flip the last char of the HMAC segment.
	tampered := tok[:len(tok)-1] + "0"
	if tampered == tok {
		tampered = tok[:len(tok)-1] + "1"
	}
	if _, err := signer.decode(tampered); err == nil {
		t.Fatal("decode succeeded on tampered token")
	}
}

func TestOIDC_StateSigner_ExpiredRejected(t *testing.T) {
	signer, _ := newStateSigner(time.Millisecond)
	tok, _ := signer.encode("/x")
	time.Sleep(5 * time.Millisecond)
	if _, err := signer.decode(tok); err == nil {
		t.Fatal("decode accepted expired state")
	}
}

func TestOIDC_SessionStore_TTLEvictsOnRead(t *testing.T) {
	store := newSessionStore()
	store.put("sid-1", map[string]any{"sub": "u"}, 5*time.Millisecond)
	if _, ok := store.get("sid-1"); !ok {
		t.Fatal("fresh session not retrievable")
	}
	time.Sleep(10 * time.Millisecond)
	if _, ok := store.get("sid-1"); ok {
		t.Fatal("expired session still retrievable")
	}
	if store.size() != 0 {
		t.Fatalf("store size = %d after lazy eviction, want 0", store.size())
	}
}

func TestOIDC_SessionStore_Delete(t *testing.T) {
	store := newSessionStore()
	store.put("sid-1", map[string]any{"sub": "u"}, time.Hour)
	store.delete("sid-1")
	if _, ok := store.get("sid-1"); ok {
		t.Fatal("session still retrievable after delete")
	}
}

// Sanity check that we still link against the real go-oidc package
// (not a vendored fork) and that our oauth2 endpoint matches what the
// provider advertises.
func TestOIDC_DiscoveryEndpointMatchesProvider(t *testing.T) {
	sp := newStubProvider(t, "rioku-app")
	ctx, cancel := caddy.NewContext(caddy.Context{Context: context.Background()})
	defer cancel()
	provider, err := oidc.NewProvider(ctx, sp.issuer)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	cfg := &oauth2.Config{
		ClientID: "rioku-app",
		Endpoint: provider.Endpoint(),
	}
	if cfg.Endpoint.TokenURL != sp.issuer+"/token" {
		t.Fatalf("token endpoint = %q, want %s/token", cfg.Endpoint.TokenURL, sp.issuer)
	}
}
