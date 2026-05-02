package oasvalidator

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

// minimalSpec is a small OpenAPI 3 spec exercising the surface tests
// care about: a path with a required path parameter, a POST endpoint
// with a JSON body schema, and a query-parameter validation. Everything
// else (security, components, etc.) is intentionally omitted — this
// keeps test expectations focused on the validator's behaviour rather
// than on incidental schema features.
const minimalSpec = `
openapi: 3.0.3
info:
  title: Test API
  version: "1.0"
paths:
  /widgets:
    post:
      summary: Create a widget
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, count]
              properties:
                name:
                  type: string
                  minLength: 1
                count:
                  type: integer
                  minimum: 0
                tags:
                  type: array
                  items:
                    type: string
      responses:
        '201':
          description: created
  /widgets/{id}:
    get:
      summary: Get a widget
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: verbose
          in: query
          required: false
          schema:
            type: boolean
      responses:
        '200':
          description: ok
`

// nextOK is the trailing handler used in tests to confirm the request
// passed through validation. It sets a marker header and 200.
var nextOK = caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("X-Test-Forwarded", "yes")
	w.WriteHeader(http.StatusOK)
	return nil
})

// provisioned returns a freshly-provisioned Validator with caller-
// supplied configuration applied. It bails the test on provision or
// validate errors.
func provisioned(t *testing.T, v *Validator) {
	t.Helper()
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	t.Cleanup(func() {
		_ = v.Cleanup()
	})
	if err := v.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := v.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

// decodeProblem parses an RFC 7807 response into a problem struct.
func decodeProblem(t *testing.T, rec *httptest.ResponseRecorder) problem {
	t.Helper()
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", got)
	}
	var p problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode problem body: %v\nbody: %s", err, rec.Body.String())
	}
	return p
}

func TestValidator_InlineSpec_ValidPOSTRequestPasses(t *testing.T) {
	v := &Validator{OASInline: minimalSpec}
	provisioned(t, v)

	body := strings.NewReader(`{"name":"gizmo","count":3}`)
	req := httptest.NewRequest(http.MethodPost, "http://x/widgets", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Test-Forwarded") != "yes" {
		t.Fatal("next handler was not invoked for valid request")
	}
}

func TestValidator_InvalidBody_ReturnsRFC7807With400(t *testing.T) {
	v := &Validator{OASInline: minimalSpec}
	provisioned(t, v)

	// `count` is required but missing.
	body := strings.NewReader(`{"name":"gizmo"}`)
	req := httptest.NewRequest(http.MethodPost, "http://x/widgets", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if rec.Header().Get("X-Test-Forwarded") == "yes" {
		t.Fatal("next handler was invoked despite invalid body")
	}

	prob := decodeProblem(t, rec)
	if prob.Type != problemTypeURI {
		t.Errorf("problem.type = %q, want %q", prob.Type, problemTypeURI)
	}
	if prob.Status != http.StatusBadRequest {
		t.Errorf("problem.status = %d, want 400", prob.Status)
	}
	if prob.Title == "" {
		t.Error("problem.title is empty")
	}
	if len(prob.Errors) == 0 {
		t.Fatalf("problem.errors empty; want at least one entry. body=%s", rec.Body.String())
	}
	// The missing-required failure should surface a JSON pointer
	// somewhere in errors[].path (kin-openapi reports it on the
	// parent object with the missing field name in the message).
	if !anyPathContains(prob.Errors, "/body") {
		t.Errorf("expected at least one error path under /body, got %+v", prob.Errors)
	}
}

func TestValidator_TypeViolation_ReturnsJSONPointerInErrorsPath(t *testing.T) {
	v := &Validator{OASInline: minimalSpec}
	provisioned(t, v)

	// `count` is supposed to be an integer.
	body := strings.NewReader(`{"name":"gizmo","count":"three"}`)
	req := httptest.NewRequest(http.MethodPost, "http://x/widgets", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	prob := decodeProblem(t, rec)
	if !anyPathContains(prob.Errors, "/body/count") {
		t.Errorf("expected error path to include /body/count, got %+v", prob.Errors)
	}
}

func TestValidator_PathParamTypeMismatch_RejectedWith400(t *testing.T) {
	v := &Validator{OASInline: minimalSpec}
	provisioned(t, v)

	// id is declared as integer; "abc" is a string.
	req := httptest.NewRequest(http.MethodGet, "http://x/widgets/abc", nil)
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestValidator_UnknownPath_RejectUnknownTrue_Returns404(t *testing.T) {
	v := &Validator{OASInline: minimalSpec, RejectUnknown: true}
	provisioned(t, v)

	req := httptest.NewRequest(http.MethodGet, "http://x/nope", nil)
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if rec.Header().Get("X-Test-Forwarded") == "yes" {
		t.Fatal("next handler should not run when RejectUnknown rejects the request")
	}
	prob := decodeProblem(t, rec)
	if prob.Status != http.StatusNotFound {
		t.Errorf("problem.status = %d, want 404", prob.Status)
	}
}

func TestValidator_UnknownPath_RejectUnknownFalse_PassesThrough(t *testing.T) {
	v := &Validator{OASInline: minimalSpec, RejectUnknown: false}
	provisioned(t, v)

	req := httptest.NewRequest(http.MethodGet, "http://x/nope", nil)
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (next handler should run)", rec.Code)
	}
	if rec.Header().Get("X-Test-Forwarded") != "yes" {
		t.Fatal("next handler was not invoked for unknown path with RejectUnknown=false")
	}
}

func TestValidator_URLSpec_LoadsAndValidates(t *testing.T) {
	specServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		_, _ = w.Write([]byte(minimalSpec))
	}))
	t.Cleanup(specServer.Close)

	v := &Validator{OASURL: specServer.URL + "/openapi.yaml"}
	provisioned(t, v)

	body := strings.NewReader(`{"name":"gizmo","count":1}`)
	req := httptest.NewRequest(http.MethodPost, "http://x/widgets", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
}

func TestValidator_URLSpec_RefreshPicksUpUpdatedSpec(t *testing.T) {
	// Build a spec server whose response mutates between calls.
	// First fetch: minimalSpec (allows /widgets). Subsequent
	// fetches: a spec without /widgets — refresh flips the router.
	var hits int32
	specV2 := strings.Replace(minimalSpec, "/widgets:", "/things:", 1)

	specServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		n := atomic.AddInt32(&hits, 1)
		if n == 1 {
			_, _ = w.Write([]byte(minimalSpec))
			return
		}
		_, _ = w.Write([]byte(specV2))
	}))
	t.Cleanup(specServer.Close)

	v := &Validator{
		OASURL:                 specServer.URL + "/openapi.yaml",
		RefreshIntervalSeconds: 1,
		RejectUnknown:          true,
	}
	provisioned(t, v)

	// Initial state: /widgets is in the spec → POST should be
	// validated and pass.
	body := strings.NewReader(`{"name":"gizmo","count":1}`)
	req := httptest.NewRequest(http.MethodPost, "http://x/widgets", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("initial status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	// Wait for at least one refresh tick. The ticker is 1s so
	// give it a healthy margin.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&hits) >= 2 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if atomic.LoadInt32(&hits) < 2 {
		t.Fatal("spec server was not re-hit by the refresh loop within 5s")
	}

	// Post-refresh: /widgets is no longer in the spec. With
	// RejectUnknown=true the request should now be rejected as 404.
	// Allow a brief settling window for the atomic swap.
	settle := time.Now().Add(2 * time.Second)
	for time.Now().Before(settle) {
		body := strings.NewReader(`{"name":"gizmo","count":1}`)
		req := httptest.NewRequest(http.MethodPost, "http://x/widgets", body)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		if err := v.ServeHTTP(rec, req, nextOK); err != nil {
			t.Fatalf("post-refresh ServeHTTP: %v", err)
		}
		if rec.Code == http.StatusNotFound {
			return // success
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("router did not pick up refreshed spec within settling window")
}

func TestValidator_ValidateRequestBodyDisabled_AllowsInvalidBody(t *testing.T) {
	v := &Validator{
		OASInline:             minimalSpec,
		ValidateRequestBody:   false,
		ValidateRequestParams: true,
	}
	provisioned(t, v)

	// Missing required field — would normally fail.
	body := strings.NewReader(`{}`)
	req := httptest.NewRequest(http.MethodPost, "http://x/widgets", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body validation disabled); body=%s", rec.Code, rec.Body.String())
	}
}

func TestValidator_ValidateRequestParamsDisabled_AllowsBadParams(t *testing.T) {
	v := &Validator{
		OASInline:             minimalSpec,
		ValidateRequestBody:   true,
		ValidateRequestParams: false,
	}
	provisioned(t, v)

	// `verbose` is declared as boolean; "maybe" is neither true nor
	// false. With params validation disabled this should pass.
	req := httptest.NewRequest(http.MethodGet, "http://x/widgets/42?verbose=maybe", nil)
	rec := httptest.NewRecorder()

	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (params validation disabled); body=%s", rec.Code, rec.Body.String())
	}
}

func TestValidator_Provision_RequiresOneOfURLOrInline(t *testing.T) {
	v := &Validator{}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := v.Provision(ctx); err == nil {
		t.Fatal("expected provision to fail when neither oas_url nor oas_inline is set")
	}
}

func TestValidator_Provision_RejectsBothURLAndInline(t *testing.T) {
	v := &Validator{OASURL: "http://x", OASInline: minimalSpec}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := v.Provision(ctx); err == nil {
		t.Fatal("expected provision to reject simultaneous oas_url + oas_inline")
	}
}

func TestValidator_Provision_RejectsMalformedSpec(t *testing.T) {
	v := &Validator{OASInline: "not: valid: yaml: at: all\n  - and: also: not"}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := v.Provision(ctx); err == nil {
		t.Fatal("expected provision to reject malformed inline spec")
	}
}

func TestValidator_Provision_FetchFailureFailsFast(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)

	v := &Validator{OASURL: server.URL + "/openapi.yaml"}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := v.Provision(ctx); err == nil {
		t.Fatal("expected provision to fail when the spec endpoint returns 500")
	}
}

func TestValidator_RefreshFailure_KeepsExistingSpec(t *testing.T) {
	// Spec server: first call succeeds, subsequent calls return 500.
	var hits int32
	specServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		if n == 1 {
			w.Header().Set("Content-Type", "application/yaml")
			_, _ = w.Write([]byte(minimalSpec))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(specServer.Close)

	v := &Validator{
		OASURL:                 specServer.URL + "/openapi.yaml",
		RefreshIntervalSeconds: 1,
	}
	provisioned(t, v)

	// Wait for at least one failed refresh tick.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&hits) >= 2 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if atomic.LoadInt32(&hits) < 2 {
		t.Fatal("spec server was not re-hit by the refresh loop")
	}

	// Validator should still validate against the original spec
	// because the refresh failed — previous router stays installed.
	body := strings.NewReader(`{"name":"gizmo","count":1}`)
	req := httptest.NewRequest(http.MethodPost, "http://x/widgets", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	if err := v.ServeHTTP(rec, req, nextOK); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (router should still serve previous spec); body=%s", rec.Code, rec.Body.String())
	}
}

func TestValidator_Caddyfile_ParsesAllDirectives(t *testing.T) {
	// Round-trip a Caddyfile block through UnmarshalCaddyfile and
	// confirm the resulting Validator has the expected fields.
	cfg := fmt.Sprintf(`rioku_oas_validator {
        oas_inline %q
        refresh_interval_seconds 600
        validate_request_body false
        validate_request_params true
        reject_unknown true
    }`, minimalSpec)

	d := caddyfile.NewTestDispenser(cfg)
	var v Validator
	if err := v.UnmarshalCaddyfile(d); err != nil {
		t.Fatalf("UnmarshalCaddyfile: %v", err)
	}
	if v.OASInline == "" {
		t.Error("oas_inline not parsed")
	}
	if v.RefreshIntervalSeconds != 600 {
		t.Errorf("refresh_interval_seconds = %d, want 600", v.RefreshIntervalSeconds)
	}
	if v.ValidateRequestBody {
		t.Error("validate_request_body should be false")
	}
	if !v.ValidateRequestParams {
		t.Error("validate_request_params should be true")
	}
	if !v.RejectUnknown {
		t.Error("reject_unknown should be true")
	}
}

// anyPathContains reports whether any problemEntry's Path contains
// the supplied substring. Useful for asserting JSON-pointer prefixes
// without locking tests to an exact pointer string (kin-openapi's
// pointer format may shift across minor versions).
func anyPathContains(entries []problemEntry, sub string) bool {
	for _, e := range entries {
		if strings.Contains(e.Path, sub) {
			return true
		}
	}
	return false
}
