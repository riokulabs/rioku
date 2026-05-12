// Package rerr provides typed HTTP errors and a handler wrapper that renders
// RFC 7807 Problem Details responses with correlation IDs and structured logging.
package rerr

import (
	"fmt"
	"runtime"
	"strings"
)

// Code identifies the category of a request error.
type Code int

const (
	CodeNotFound        Code = iota // 404
	CodeConflict                    // 409
	CodeValidation                  // 422 (unprocessable per RFC 9110)
	CodeUnauthenticated             // 401
	CodeForbidden                   // 403
	CodeRateLimited                 // 429
	CodeBadGateway                  // 502
	CodeUnavailable                 // 503
	CodeInternal                    // 500
	CodeUnprocessable               // 422
	CodeLocked                      // 423
	CodeTimeout                     // 504
	CodeGone                        // 410
)

// Error is a typed request error that carries enough metadata to produce a
// complete RFC 7807 response without any additional context at the call site.
type Error struct {
	Code          Code
	Resource      string            // e.g. "route", "api-key"
	Detail        string            // human-readable detail
	Cause         error             // underlying error (never sent to client)
	Fields        map[string]string // field-level validation errors
	RetryAfter    int               // seconds; set by RateLimited / Unavailable
	correlationID string            // UUID v4, set at construction time
	pcs           []uintptr         // stack capture (lazy render)
}

// Error implements the error interface.
func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("rerr[%d]: %s: %v", e.Code, e.Detail, e.Cause)
	}
	return fmt.Sprintf("rerr[%d]: %s", e.Code, e.Detail)
}

// Unwrap returns the underlying cause so errors.Is / errors.As work.
func (e *Error) Unwrap() error { return e.Cause }

// CorrelationID returns the correlation ID attached to this error.
func (e *Error) CorrelationID() string { return e.correlationID }

// Stack returns a human-readable stack trace captured at construction time.
// The rendering is done lazily so construction stays cheap.
func (e *Error) Stack() string {
	if len(e.pcs) == 0 {
		return ""
	}
	frames := runtime.CallersFrames(e.pcs)
	var b strings.Builder
	for {
		f, more := frames.Next()
		// Skip runtime internals.
		if !strings.HasPrefix(f.Function, "runtime.") {
			fmt.Fprintf(&b, "%s\n\t%s:%d\n", f.Function, f.File, f.Line)
		}
		if !more {
			break
		}
	}
	return b.String()
}

// captureStack records up to 32 program counters, skipping the first `skip`
// frames (skip=0 means starting from the caller of captureStack itself).
func captureStack(skip int) []uintptr {
	pcs := make([]uintptr, 32)
	n := runtime.Callers(skip+2, pcs) // +2: runtime.Callers + captureStack
	return pcs[:n]
}
