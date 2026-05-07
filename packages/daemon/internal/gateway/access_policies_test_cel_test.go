package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

func TestEvaluateCEL(t *testing.T) {
	cases := []struct {
		name    string
		expr    string
		sample  map[string]any
		matched bool
		errSub  string
	}{
		{
			name:    "matched true via sample.field",
			expr:    `sample.service == "users"`,
			sample:  map[string]any{"service": "users"},
			matched: true,
		},
		{
			name:    "matched false",
			expr:    `sample.service == "users"`,
			sample:  map[string]any{"service": "billing"},
			matched: false,
		},
		{
			name:    "top-level key hoisting",
			expr:    `service == "users"`,
			sample:  map[string]any{"service": "users"},
			matched: true,
		},
		{
			name:    "envelope alias",
			expr:    `envelope.service == "users"`,
			sample:  map[string]any{"service": "users"},
			matched: true,
		},
		{
			name:    "syntax error",
			expr:    `sample.service ==`,
			sample:  map[string]any{"service": "users"},
			matched: false,
			errSub:  "Syntax error",
		},
		{
			name:    "non-bool result",
			expr:    `1 + 2`,
			sample:  map[string]any{},
			matched: false,
			errSub:  "must return bool",
		},
		{
			name:    "nested field access",
			expr:    `sample.user.role == "admin"`,
			sample:  map[string]any{"user": map[string]any{"role": "admin"}},
			matched: true,
		},
		{
			name:    "logical or with hoisted keys",
			expr:    `service == "users" || service == "billing"`,
			sample:  map[string]any{"service": "billing"},
			matched: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			matched, err, durationMs := evaluateCEL(context.Background(), tc.expr, tc.sample)
			if matched != tc.matched {
				t.Errorf("matched=%v, want %v (err=%v)", matched, tc.matched, err)
			}
			if tc.errSub == "" && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if tc.errSub != "" {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tc.errSub)
				} else if !strings.Contains(err.Error(), tc.errSub) {
					t.Errorf("error=%q, want substring %q", err.Error(), tc.errSub)
				}
			}
			if durationMs < 0 {
				t.Errorf("durationMs=%d, want >= 0", durationMs)
			}
		})
	}
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
		"expr":   `sample.user.role == "admin"`,
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

func TestHandleTestAccessPolicyCEL_HoistedKey(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAccessPolicyRoutes(mux, drv)

	body := map[string]any{
		"expr":   `service == "users"`,
		"sample": map[string]any{"service": "users"},
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
	if !got.Matched || got.Error != "" {
		t.Errorf("hoisted-key eval: matched=%v error=%q, want matched=true error=\"\"", got.Matched, got.Error)
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

func TestHandleTestAccessPolicyCEL_SyntaxError(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAccessPolicyRoutes(mux, drv)

	body := map[string]any{"expr": `sample.service ==`}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/access-policies/test-cel", "default", body)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (syntax errors are non-transport), got %d body=%s", rec.Code, rec.Body.String())
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

func TestHandleTestAccessPolicyCEL_NonBool(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAccessPolicyRoutes(mux, drv)

	body := map[string]any{"expr": `1 + 2`}
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
	if got.Matched {
		t.Errorf("matched=true, want false (non-bool result)")
	}
	if !strings.Contains(got.Error, "must return bool") {
		t.Errorf("error=%q, want substring %q", got.Error, "must return bool")
	}
}
