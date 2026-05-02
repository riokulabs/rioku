package authapikey

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

// stubValidator satisfies the package-private validator interface
// for tests. records is keyed by keyHash; absent means
// {Valid:false, Reason:"missing"}. err, when non-nil, is returned
// before consulting records.
type stubValidator struct {
	records map[string]ValidationResult
	calls   int
	err     error
}

func (s *stubValidator) Validate(_ interface{ Done() <-chan struct{} }, keyHash string) (ValidationResult, error) {
	s.calls++
	if s.err != nil {
		return ValidationResult{}, s.err
	}
	if v, ok := s.records[keyHash]; ok {
		return v, nil
	}
	return ValidationResult{Valid: false, Reason: "missing"}, nil
}

var nextNoOp = caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("X-Test-Forwarded", "yes")
	w.WriteHeader(http.StatusOK)
	return nil
})

func provisioned(t *testing.T, a *APIKey, validator validator) {
	t.Helper()
	a.validator = validator
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := a.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := a.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func TestAPIKey_HappyPath_Header(t *testing.T) {
	a := &APIKey{
		Header:             "Authorization",
		ValidationEndpoint: "http://x", // not used; stub validator
	}
	hash := sha256Hex("sk-live-abc")
	v := &stubValidator{records: map[string]ValidationResult{
		hash: {Valid: true, Principal: "user-9", Scopes: []string{"read", "write"}},
	}}
	provisioned(t, a, v)

	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer sk-live-abc")
	rec := httptest.NewRecorder()
	if err := a.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := req.Header.Get("X-Rioku-Principal"); got != "user-9" {
		t.Fatalf("principal = %q, want user-9", got)
	}
	if got := req.Header.Get("X-Rioku-Scopes"); got != "read,write" {
		t.Fatalf("scopes = %q, want read,write", got)
	}
}

func TestAPIKey_Missing(t *testing.T) {
	a := &APIKey{
		Header:             "Authorization",
		ValidationEndpoint: "http://x",
	}
	v := &stubValidator{records: map[string]ValidationResult{}}
	provisioned(t, a, v)

	req := httptest.NewRequest("GET", "http://x/", nil)
	rec := httptest.NewRecorder()
	_ = a.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for missing key", rec.Code)
	}
	if v.calls != 0 {
		t.Fatalf("validator called %d times, want 0 (missing key short-circuits)", v.calls)
	}
}

func TestAPIKey_Invalid(t *testing.T) {
	a := &APIKey{
		Header:             "Authorization",
		ValidationEndpoint: "http://x",
	}
	v := &stubValidator{records: map[string]ValidationResult{}}
	provisioned(t, a, v)
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer unknown-key")
	rec := httptest.NewRecorder()
	_ = a.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for unknown key", rec.Code)
	}
}

func TestAPIKey_Expired(t *testing.T) {
	a := &APIKey{Header: "Authorization", ValidationEndpoint: "http://x"}
	hash := sha256Hex("sk-old")
	v := &stubValidator{records: map[string]ValidationResult{
		hash: {Valid: false, Reason: "expired"},
	}}
	provisioned(t, a, v)
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer sk-old")
	rec := httptest.NewRecorder()
	_ = a.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for expired", rec.Code)
	}
}

func TestAPIKey_Revoked(t *testing.T) {
	a := &APIKey{Header: "Authorization", ValidationEndpoint: "http://x"}
	hash := sha256Hex("sk-revoked")
	v := &stubValidator{records: map[string]ValidationResult{
		hash: {Valid: false, Reason: "revoked"},
	}}
	provisioned(t, a, v)
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer sk-revoked")
	rec := httptest.NewRecorder()
	_ = a.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for revoked", rec.Code)
	}
}

func TestAPIKey_BasicAuth(t *testing.T) {
	a := &APIKey{
		BasicAuthUsername:  "api",
		ValidationEndpoint: "http://x",
	}
	hash := sha256Hex("sk-basic")
	v := &stubValidator{records: map[string]ValidationResult{
		hash: {Valid: true, Principal: "u"},
	}}
	provisioned(t, a, v)

	req := httptest.NewRequest("GET", "http://x/", nil)
	req.SetBasicAuth("api", "sk-basic")
	rec := httptest.NewRecorder()
	if err := a.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body)
	}
}

func TestAPIKey_BasicAuthRejectsWrongUsername(t *testing.T) {
	a := &APIKey{
		BasicAuthUsername:  "api",
		ValidationEndpoint: "http://x",
	}
	v := &stubValidator{records: map[string]ValidationResult{}}
	provisioned(t, a, v)

	req := httptest.NewRequest("GET", "http://x/", nil)
	// "anonymous" is not the configured BasicAuthUsername.
	header := "Basic " + base64.StdEncoding.EncodeToString([]byte("anonymous:sk-basic"))
	req.Header.Set("Authorization", header)
	rec := httptest.NewRecorder()
	_ = a.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestAPIKey_QueryParam(t *testing.T) {
	a := &APIKey{
		QueryParam:         "api_key",
		ValidationEndpoint: "http://x",
	}
	hash := sha256Hex("sk-q")
	v := &stubValidator{records: map[string]ValidationResult{
		hash: {Valid: true, Principal: "u"},
	}}
	provisioned(t, a, v)

	req := httptest.NewRequest("GET", "http://x/?api_key=sk-q", nil)
	rec := httptest.NewRecorder()
	if err := a.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestAPIKey_DisallowedQuery(t *testing.T) {
	a := &APIKey{
		QueryParam:          "api_key",
		ValidationEndpoint:  "http://x",
		DisallowedLocations: []string{"query"},
	}
	v := &stubValidator{records: map[string]ValidationResult{}}
	provisioned(t, a, v)

	req := httptest.NewRequest("GET", "http://x/?api_key=sk-q", nil)
	rec := httptest.NewRecorder()
	_ = a.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (disallowed location)", rec.Code)
	}
}

func TestAPIKey_CacheHit(t *testing.T) {
	a := &APIKey{
		Header:             "Authorization",
		ValidationEndpoint: "http://x",
		CacheTTLSeconds:    60,
		CacheSize:          16,
	}
	hash := sha256Hex("sk-cache")
	v := &stubValidator{records: map[string]ValidationResult{
		hash: {Valid: true, Principal: "u"},
	}}
	provisioned(t, a, v)

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("Authorization", "Bearer sk-cache")
		rec := httptest.NewRecorder()
		if err := a.ServeHTTP(rec, req, nextNoOp); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("iter %d status = %d, want 200", i, rec.Code)
		}
	}
	if v.calls != 1 {
		t.Fatalf("validator called %d times, want 1 (cache should serve the rest)", v.calls)
	}
}

func TestAPIKey_ValidatorErrorReturns502(t *testing.T) {
	a := &APIKey{
		Header:             "Authorization",
		ValidationEndpoint: "http://x",
	}
	v := &stubValidator{err: errors.New("boom")}
	provisioned(t, a, v)
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer sk-x")
	rec := httptest.NewRecorder()
	_ = a.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 when validator endpoint errors", rec.Code)
	}
}

func TestAPIKey_HTTPValidator_RoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "wrong method", http.StatusMethodNotAllowed)
			return
		}
		body := make([]byte, 1024)
		n, _ := r.Body.Read(body)
		if !strings.Contains(string(body[:n]), `"key_hash"`) {
			http.Error(w, "missing key_hash", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"valid":true,"principal":"u"}`))
	}))
	defer srv.Close()

	a := &APIKey{
		Header:                "Authorization",
		ValidationEndpoint:    srv.URL,
		RequestTimeoutSeconds: 2,
	}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	defer cancel()
	if err := a.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer sk-live")
	rec := httptest.NewRecorder()
	if err := a.ServeHTTP(rec, req, nextNoOp); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body)
	}
}

func TestAPIKey_Provision_RejectsMissingFields(t *testing.T) {
	cases := []struct {
		name string
		a    APIKey
	}{
		{"no_lookup", APIKey{ValidationEndpoint: "http://x"}},
		{"no_endpoint", APIKey{Header: "Authorization"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
			defer cancel()
			if err := tc.a.Provision(ctx); err == nil {
				t.Fatal("expected provision error")
			}
		})
	}
}

func TestAPIKey_FailureNotCached(t *testing.T) {
	a := &APIKey{
		Header:             "Authorization",
		ValidationEndpoint: "http://x",
		CacheTTLSeconds:    60,
	}
	v := &stubValidator{err: errors.New("transient")}
	provisioned(t, a, v)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("Authorization", "Bearer sk-x")
		rec := httptest.NewRecorder()
		_ = a.ServeHTTP(rec, req, nextNoOp)
	}
	if v.calls != 3 {
		t.Fatalf("validator called %d times, want 3 (failures must not be cached)", v.calls)
	}
}

func TestLookupCache_TTLExpiry(t *testing.T) {
	c := newLookupCache(8, 10*time.Millisecond)
	c.put("k", ValidationResult{Valid: true, Principal: "u"})
	if _, ok := c.get("k"); !ok {
		t.Fatal("immediate get failed")
	}
	time.Sleep(20 * time.Millisecond)
	if _, ok := c.get("k"); ok {
		t.Fatal("expected entry to expire")
	}
}
