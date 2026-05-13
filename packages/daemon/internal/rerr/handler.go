package rerr

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/riokulabs/rioku/internal/logging"
)

// Handler is the function signature for error-returning HTTP handlers.
// Registering via H() converts a Handler into a standard http.Handler.
type Handler func(http.ResponseWriter, *http.Request) error

// H wraps a Handler so that:
//   - A nil return writes nothing extra (the handler already wrote its response).
//   - A *Error return renders RFC 7807 Problem Details, sets X-Correlation-Id,
//     and logs at WARN (4xx) or ERROR (5xx).
//   - Any other error is promoted to a 500 Internal Server Error.
func H(h Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := h(w, r)
		if err == nil {
			return
		}

		var re *Error
		switch v := err.(type) {
		case *Error:
			re = v
		default:
			re = Wrap(err, "internal server error")
		}

		renderError(w, r, re)
	})
}

// renderError writes the RFC 7807 response for re and logs appropriately.
func renderError(w http.ResponseWriter, r *http.Request, re *Error) {
	status, typ, title := codeToHTTP(re.Code)

	problem := ProblemDetail{
		Type:     typ,
		Title:    title,
		Status:   status,
		Instance: r.URL.Path,
	}

	log := logging.From(r.Context())

	if status >= 500 {
		// Never expose internal details to the client.
		problem.Detail = "An unexpected error occurred. Reference: " + re.correlationID
		log.Error("request failed",
			"path", r.URL.Path,
			"method", r.Method,
			"status", status,
			"error", re.Detail,
			"cause", re.Cause,
			"correlation_id", re.correlationID,
		)
	} else {
		problem.Detail = re.Detail
		log.Warn("client error",
			"path", r.URL.Path,
			"method", r.Method,
			"status", status,
			"error", re.Detail,
			"correlation_id", re.correlationID,
		)
	}

	// Field-level validation errors.
	if len(re.Fields) > 0 {
		errs := make([]ValidationError, 0, len(re.Fields))
		for field, reason := range re.Fields {
			errs = append(errs, ValidationError{Field: field, Reason: reason})
		}
		problem.Errors = errs
	}

	// RFC-required extra headers.
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	if re.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(re.RetryAfter))
	}

	w.Header().Set("X-Correlation-Id", re.correlationID)
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(problem)
}

// CodeHTTP maps a Code to an HTTP status, RFC 7807 type URI, and title.
// Exported so middleware that cannot use H() can still render consistent
// problem details.
func CodeHTTP(c Code) (status int, typ, title string) {
	return codeToHTTP(c)
}

// codeToHTTP maps a Code to an HTTP status, RFC 7807 type URI, and title.
func codeToHTTP(c Code) (status int, typ, title string) {
	switch c {
	case CodeNotFound:
		return http.StatusNotFound, "https://rioku.dev/errors/not-found", "Resource not found"
	case CodeConflict:
		return http.StatusConflict, "https://rioku.dev/errors/version-conflict", "Resource conflict"
	case CodeValidation:
		return http.StatusUnprocessableEntity, "https://rioku.dev/errors/validation-failed", "Validation failed"
	case CodeUnauthenticated:
		return http.StatusUnauthorized, "https://rioku.dev/errors/unauthenticated", "Authentication required"
	case CodeForbidden:
		return http.StatusForbidden, "https://rioku.dev/errors/forbidden", "Permission denied"
	case CodeRateLimited:
		return http.StatusTooManyRequests, "https://rioku.dev/errors/rate-limited", "Rate limit exceeded"
	case CodeBadGateway:
		return http.StatusBadGateway, "https://rioku.dev/errors/bad-gateway", "Bad gateway"
	case CodeUnavailable:
		return http.StatusServiceUnavailable, "https://rioku.dev/errors/unavailable", "Service unavailable"
	case CodeUnprocessable:
		return http.StatusUnprocessableEntity, "https://rioku.dev/errors/unprocessable", "Unprocessable entity"
	case CodeLocked:
		return http.StatusLocked, "https://rioku.dev/errors/account-locked", "Resource locked"
	case CodeTimeout:
		return http.StatusGatewayTimeout, "https://rioku.dev/errors/gateway-timeout", "Gateway timeout"
	case CodeGone:
		return http.StatusGone, "https://rioku.dev/errors/gone", "Resource gone"
	default: // CodeInternal and anything unknown
		return http.StatusInternalServerError, "https://rioku.dev/errors/internal", "Internal server error"
	}
}
