package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

func TestEvaluateCELStub(t *testing.T) {
	cases := []struct {
		name     string
		expr     string
		matched  bool
		errSub   string
	}{
		{name: "simple equality", expr: `user.role == "admin"`, matched: true},
		{name: "balanced parens", expr: `(a == b) || (c == d)`, matched: true},
		{name: "empty", expr: "   ", matched: false, errSub: "empty"},
		{name: "unbalanced open paren", expr: `(a == b`, matched: false, errSub: "unbalanced '('"},
		{name: "unbalanced close paren", expr: `a == b)`, matched: false, errSub: "unbalanced ')'"},
		{name: "unterminated double quote", expr: `user.name == "alice`, matched: false, errSub: "double-quoted"},
		{name: "parens in quotes do not count", expr: `user.name == "(admin)"`, matched: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := evaluateCELStub(tc.expr)
			if res.Matched != tc.matched {
				t.Errorf("matched=%v, want %v (err=%q)", res.Matched, tc.matched, res.Error)
			}
			if tc.errSub != "" && !contains(res.Error, tc.errSub) {
				t.Errorf("error=%q, want substring %q", res.Error, tc.errSub)
			}
		})
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && bytes.Contains([]byte(haystack), []byte(needle)))
}

// rawAuthedTenantRequest mirrors authedTenantRequest but accepts a raw body
// so callers can send malformed JSON to exercise 400 paths.
func rawAuthedTenantRequest(t *testing.T, st store.Driver, method, target, slug string, raw []byte) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	claims := &auth.SessionClaims{
		SessionID: "test-session",
		UserID:    "test-user",
		Username:  "tester",
		Roles:     []string{"superadmin"},
		Scopes:    []string{"*"},
	}
	ctx := auth.WithSessionClaims(req.Context(), claims)
	if slug != "" {
		tx, _ := st.Begin(context.Background(), store.TxOptions{ReadOnly: true})
		tn, err := tx.GetTenantBySlug(context.Background(), slug)
		_ = tx.Rollback()
		if err != nil {
			t.Fatalf("resolve tenant %s: %v", slug, err)
		}
		ctx = WithTenant(ctx, tn)
	}
	return req.WithContext(ctx)
}

func TestHandleTestAccessPolicyCEL_Endpoint(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAccessPolicyRoutes(mux, drv)

	body := map[string]any{
		"expr":   `user.role == "admin"`,
		"sample": map[string]any{"user": map[string]any{"role": "admin"}},
	}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/access-policies/test-cel", "default", body)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got testCELResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !got.Matched {
		t.Errorf("matched=false, want true (err=%q)", got.Error)
	}
	if got.DurationMs < 0 {
		t.Errorf("durationMs=%v, want >= 0", got.DurationMs)
	}
}

func TestHandleTestAccessPolicyCEL_BadRequest(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAccessPolicyRoutes(mux, drv)

	req := rawAuthedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/access-policies/test-cel", "default",
		[]byte("not json at all"))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandleTestAccessPolicyCEL_StructuralError(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAccessPolicyRoutes(mux, drv)

	body := map[string]any{"expr": `(a == b`}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/access-policies/test-cel", "default", body)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (structural errors are non-transport), got %d body=%s", rec.Code, rec.Body.String())
	}
	var got testCELResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Matched {
		t.Errorf("matched=true, want false")
	}
	if got.Error == "" {
		t.Errorf("error empty, want explanation")
	}
}
