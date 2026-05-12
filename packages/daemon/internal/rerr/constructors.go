package rerr

import (
	"github.com/google/uuid"
)

// newError is the internal constructor that populates the correlation ID and
// captures the call stack. skip is the number of additional frames to skip so
// the top frame in the trace is the public constructor, not newError itself.
func newError(code Code, resource, detail string, cause error, skip int) *Error {
	return &Error{
		Code:          code,
		Resource:      resource,
		Detail:        detail,
		Cause:         cause,
		correlationID: uuid.New().String(),
		pcs:           captureStack(skip + 1),
	}
}

// NotFound returns a 404 error for a missing resource.
//
//	return rerr.NotFound("route", id)
func NotFound(resource, id string) *Error {
	detail := resource + " not found"
	if id != "" {
		detail = resource + " " + id + " not found"
	}
	e := newError(CodeNotFound, resource, detail, nil, 1)
	return e
}

// Conflict returns a 409 error.
func Conflict(detail string, cause error) *Error {
	return newError(CodeConflict, "", detail, cause, 1)
}

// Validation returns a 422 error with field-level details.
//
//	return rerr.Validation(map[string]string{"name": "required"})
func Validation(fields map[string]string) *Error {
	e := newError(CodeValidation, "", "request validation failed", nil, 1)
	e.Fields = fields
	return e
}

// Unauthenticated returns a 401 error.
func Unauthenticated() *Error {
	return newError(CodeUnauthenticated, "", "authentication required", nil, 1)
}

// Forbidden returns a 403 error referencing the missing permission.
func Forbidden(perm string) *Error {
	detail := "permission denied"
	if perm != "" {
		detail = "permission denied: " + perm
	}
	return newError(CodeForbidden, "", detail, nil, 1)
}

// RateLimited returns a 429 error. retryAfter is the suggested wait in seconds
// (0 means omit the header).
func RateLimited(retryAfter int) *Error {
	e := newError(CodeRateLimited, "", "rate limit exceeded", nil, 1)
	e.RetryAfter = retryAfter
	return e
}

// BadGateway returns a 502 error wrapping an upstream failure.
func BadGateway(cause error) *Error {
	return newError(CodeBadGateway, "", "bad gateway", cause, 1)
}

// Unavailable returns a 503 error. retryAfter sets the Retry-After header.
func Unavailable(cause error) *Error {
	e := newError(CodeUnavailable, "", "service unavailable", cause, 1)
	e.RetryAfter = 5
	return e
}

// Gone returns a 410 error for a resource that is no longer available
// (e.g. an already-consumed invite token).
func Gone(detail string) *Error {
	return newError(CodeGone, "", detail, nil, 1)
}

// Wrap promotes any error to a 500 Internal Server Error with a custom detail.
func Wrap(err error, detail string) *Error {
	if detail == "" {
		detail = "internal server error"
	}
	return newError(CodeInternal, "", detail, err, 1)
}
