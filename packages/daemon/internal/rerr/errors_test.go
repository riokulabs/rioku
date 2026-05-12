package rerr

import (
	"errors"
	"net/http"
	"testing"
)

func TestCode_ToHTTPStatus(t *testing.T) {
	cases := []struct {
		code       Code
		wantStatus int
	}{
		{CodeNotFound, http.StatusNotFound},
		{CodeConflict, http.StatusConflict},
		{CodeValidation, http.StatusUnprocessableEntity},
		{CodeUnauthenticated, http.StatusUnauthorized},
		{CodeForbidden, http.StatusForbidden},
		{CodeRateLimited, http.StatusTooManyRequests},
		{CodeBadGateway, http.StatusBadGateway},
		{CodeUnavailable, http.StatusServiceUnavailable},
		{CodeInternal, http.StatusInternalServerError},
		{CodeUnprocessable, http.StatusUnprocessableEntity},
		{CodeLocked, http.StatusLocked},
		{CodeTimeout, http.StatusGatewayTimeout},
	}
	for _, tc := range cases {
		got, _, _ := codeToHTTP(tc.code)
		if got != tc.wantStatus {
			t.Errorf("codeToHTTP(%d): got %d, want %d", tc.code, got, tc.wantStatus)
		}
	}
}

func TestConstructors_CorrelationIDPresent(t *testing.T) {
	errs := []*Error{
		NotFound("route", "abc"),
		Conflict("already exists", nil),
		Validation(map[string]string{"name": "required"}),
		Unauthenticated(),
		Forbidden("admin.write"),
		RateLimited(5),
		BadGateway(errors.New("upstream down")),
		Unavailable(errors.New("db unreachable")),
		Wrap(errors.New("boom"), "internal failure"),
	}
	for _, e := range errs {
		if e.correlationID == "" {
			t.Errorf("constructor %T detail=%q: missing correlationID", e, e.Detail)
		}
	}
}

func TestConstructors_Uniqueness(t *testing.T) {
	a := NotFound("route", "1")
	b := NotFound("route", "1")
	if a.correlationID == b.correlationID {
		t.Error("two separate errors should have distinct correlation IDs")
	}
}

func TestConstructors_StackCaptured(t *testing.T) {
	e := NotFound("route", "x")
	if len(e.pcs) == 0 {
		t.Error("expected non-empty stack capture")
	}
	stack := e.Stack()
	if stack == "" {
		t.Error("Stack() returned empty string")
	}
}

func TestError_Unwrap(t *testing.T) {
	cause := errors.New("root cause")
	e := Wrap(cause, "wrapped")
	if !errors.Is(e, cause) {
		t.Error("errors.Is should traverse Unwrap to cause")
	}
}

func TestError_ErrorString(t *testing.T) {
	e := NotFound("route", "abc")
	s := e.Error()
	if s == "" {
		t.Error("Error() returned empty string")
	}
}

func TestNotFound_Detail(t *testing.T) {
	e := NotFound("route", "abc")
	if e.Code != CodeNotFound {
		t.Errorf("code = %v, want CodeNotFound", e.Code)
	}
	if e.Resource != "route" {
		t.Errorf("resource = %q, want route", e.Resource)
	}
}

func TestValidation_Fields(t *testing.T) {
	fields := map[string]string{"name": "required", "email": "invalid"}
	e := Validation(fields)
	if e.Code != CodeValidation {
		t.Errorf("code = %v, want CodeValidation", e.Code)
	}
	if len(e.Fields) != 2 {
		t.Errorf("fields len = %d, want 2", len(e.Fields))
	}
}

func TestRateLimited_RetryAfter(t *testing.T) {
	e := RateLimited(10)
	if e.RetryAfter != 10 {
		t.Errorf("RetryAfter = %d, want 10", e.RetryAfter)
	}
}

func TestUnavailable_RetryAfterDefault(t *testing.T) {
	e := Unavailable(nil)
	if e.RetryAfter <= 0 {
		t.Errorf("Unavailable should set a positive RetryAfter, got %d", e.RetryAfter)
	}
}
