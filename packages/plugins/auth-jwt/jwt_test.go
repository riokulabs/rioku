package authjwt

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/golang-jwt/jwt/v5"
)

// rsaTestKey returns an RSA private key + a PEM-encoded public key
// (PKIX) for plug-and-play testing.
func rsaTestKey(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA: %v", err)
	}
	pubDer, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("marshal pub: %v", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDer})
	return priv, string(pubPEM)
}

func ecdsaTestKey(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate EC: %v", err)
	}
	pubDer, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("marshal pub: %v", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDer})
	return priv, string(pubPEM)
}

// signJWT returns a signed token using the named algorithm and the
// supplied key. claims are merged with the registered iss/aud/exp.
func signJWT(t *testing.T, alg jwt.SigningMethod, key any, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(alg, claims)
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

// nextNoOp is the trailing handler for ServeHTTP; it sets a marker
// header so tests can confirm the JWT module called it.
var nextNoOp = caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("X-Test-Forwarded", "yes")
	w.WriteHeader(http.StatusOK)
	return nil
})

func provisionedJWT(t *testing.T, j *JWT) {
	t.Helper()
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := j.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := j.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func TestJWT_RS256_HappyPath(t *testing.T) {
	priv, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"RS256"},
		ForwardClaims:    []string{"role"},
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodRS256, priv, jwt.MapClaims{
		"iss":  "https://issuer.example",
		"aud":  "my-api",
		"sub":  "user-42",
		"role": "admin",
		"exp":  time.Now().Add(time.Hour).Unix(),
		"iat":  time.Now().Unix(),
	})

	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	if err := j.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body)
	}
	if rec.Header().Get("X-Test-Forwarded") != "yes" {
		t.Fatal("next handler not invoked")
	}
	if got := req.Header.Get("X-Rioku-Principal"); got != "user-42" {
		t.Fatalf("principal header = %q, want user-42", got)
	}
	if got := req.Header.Get("X-Rioku-Claim-Role"); got != "admin" {
		t.Fatalf("forwarded role claim = %q, want admin", got)
	}
}

func TestJWT_ES256_HappyPath(t *testing.T) {
	priv, pubPEM := ecdsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"ES256"},
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodES256, priv, jwt.MapClaims{
		"iss": "https://issuer.example",
		"aud": "my-api",
		"sub": "user-1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	if err := j.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestJWT_HS256_RejectedByDefaultAlgos(t *testing.T) {
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: "shared-secret",
		// No Algos -> defaults to asymmetric set, HS256 not allowed.
	}
	provisionedJWT(t, j)
	token := signJWT(t, jwt.SigningMethodHS256, []byte("shared-secret"), jwt.MapClaims{
		"iss": "https://issuer.example",
		"aud": "my-api",
		"sub": "u",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	_ = j.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for HS256 token under default algo allow-list", rec.Code)
	}
}

func TestJWT_HS256_AllowedExplicitly(t *testing.T) {
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: "shared-secret",
		Algos:            []string{"HS256"},
	}
	provisionedJWT(t, j)
	token := signJWT(t, jwt.SigningMethodHS256, []byte("shared-secret"), jwt.MapClaims{
		"iss": "https://issuer.example",
		"aud": "my-api",
		"sub": "u",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	if err := j.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body)
	}
}

func TestJWT_WrongIssuer(t *testing.T) {
	priv, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"RS256"},
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodRS256, priv, jwt.MapClaims{
		"iss": "https://attacker.example",
		"aud": "my-api",
		"sub": "u",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	_ = j.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestJWT_WrongAudience(t *testing.T) {
	priv, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"RS256"},
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodRS256, priv, jwt.MapClaims{
		"iss": "https://issuer.example",
		"aud": "other-api",
		"sub": "u",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	_ = j.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestJWT_AudienceList_AcceptsAnyMember(t *testing.T) {
	priv, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"primary-api", "fallback-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"RS256"},
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodRS256, priv, jwt.MapClaims{
		"iss": "https://issuer.example",
		"aud": []string{"unrelated", "fallback-api"},
		"sub": "u",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	if err := j.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestJWT_ExpiredToken(t *testing.T) {
	priv, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"RS256"},
		LeewaySeconds:    0,
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodRS256, priv, jwt.MapClaims{
		"iss": "https://issuer.example",
		"aud": "my-api",
		"sub": "u",
		"exp": time.Now().Add(-time.Hour).Unix(),
		"iat": time.Now().Add(-2 * time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	_ = j.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for expired token", rec.Code)
	}
}

func TestJWT_MissingToken(t *testing.T) {
	priv, _ := rsaTestKey(t)
	_ = priv
	_, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"RS256"},
	}
	provisionedJWT(t, j)

	req := httptest.NewRequest("GET", "http://x/", nil)
	rec := httptest.NewRecorder()
	_ = j.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 with no Authorization header", rec.Code)
	}
}

func TestJWT_QueryParamFallback(t *testing.T) {
	priv, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"RS256"},
		QueryParam:       "access_token",
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodRS256, priv, jwt.MapClaims{
		"iss": "https://issuer.example",
		"aud": "my-api",
		"sub": "u",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "http://x/?access_token="+token, nil)
	rec := httptest.NewRecorder()
	if err := j.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (token via query param)", rec.Code)
	}
}

func TestJWT_PrincipalCustomPath(t *testing.T) {
	priv, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:             "https://issuer.example",
		Audience:           []string{"my-api"},
		SigningKeySource:   pubPEM,
		Algos:              []string{"RS256"},
		ClaimPrincipalPath: "email",
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodRS256, priv, jwt.MapClaims{
		"iss":   "https://issuer.example",
		"aud":   "my-api",
		"sub":   "user-id",
		"email": "alice@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	if err := j.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if got := req.Header.Get("X-Rioku-Principal"); got != "alice@example.com" {
		t.Fatalf("principal = %q, want alice@example.com", got)
	}
}

func TestJWT_Provision_RejectsMissingFields(t *testing.T) {
	cases := []struct {
		name string
		j    JWT
	}{
		{"no_issuer", JWT{Audience: []string{"a"}, SigningKeySource: "x"}},
		{"no_audience", JWT{Issuer: "i", SigningKeySource: "x"}},
		{"no_key_or_jwks", JWT{Issuer: "i", Audience: []string{"a"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
			defer cancel()
			if err := tc.j.Provision(ctx); err == nil {
				t.Fatal("expected provision error")
			}
		})
	}
}

func TestJWT_TamperedSignatureRejected(t *testing.T) {
	priv, pubPEM := rsaTestKey(t)
	j := &JWT{
		Issuer:           "https://issuer.example",
		Audience:         []string{"my-api"},
		SigningKeySource: pubPEM,
		Algos:            []string{"RS256"},
	}
	provisionedJWT(t, j)

	token := signJWT(t, jwt.SigningMethodRS256, priv, jwt.MapClaims{
		"iss": "https://issuer.example",
		"aud": "my-api",
		"sub": "u",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	// Flip the last byte of the signature.
	tampered := token[:len(token)-1] + "X"
	if tampered == token {
		t.Fatal("tampering produced same string")
	}

	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer "+tampered)
	rec := httptest.NewRecorder()
	_ = j.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for tampered signature", rec.Code)
	}
}
