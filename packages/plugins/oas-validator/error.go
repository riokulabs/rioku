package oasvalidator

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
)

// problemTypeURI is the canonical "type" URI for OAS validation
// problems. Per RFC 7807 the URI may dereference to a documentation
// page describing the error class — the URI doesn't need to resolve
// today, but it should be stable so clients can match on it.
const problemTypeURI = "https://rioku.dev/errors/oas-validation"

// problem is the on-the-wire shape of an RFC 7807 problem document.
// The "errors" extension is non-standard but widely accepted (see
// JSON:API's similar pattern) and lets us return per-field detail
// without nesting another envelope.
type problem struct {
	Type   string         `json:"type"`
	Title  string         `json:"title"`
	Status int            `json:"status"`
	Detail string         `json:"detail,omitempty"`
	Errors []problemEntry `json:"errors,omitempty"`
}

// problemEntry describes a single validation failure. Path is a JSON
// pointer (RFC 6901) into the request — empty when the failure is not
// tied to a specific field (e.g., a missing path-level operation).
type problemEntry struct {
	Path    string `json:"path,omitempty"`
	Message string `json:"message"`
}

// writeProblem serialises the problem document and writes it to the
// response with the application/problem+json content type.
func writeProblem(w http.ResponseWriter, status int, p problem) {
	body, err := json.Marshal(p)
	if err != nil {
		// json.Marshal of our own struct cannot realistically fail.
		// Defend against the impossible by sending a minimal
		// fallback so the client still gets a structured error.
		body = []byte(`{"type":"about:blank","title":"Internal error","status":500}`)
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// buildValidationProblem unpacks an openapi3filter ValidateRequest
// error into the on-the-wire problem document. Validation errors come
// in three flavours:
//
//   - openapi3filter.RequestError — wraps a single failure (parameter
//     or body). The wrapped error may itself be a SchemaError carrying
//     a JSON pointer.
//   - openapi3.MultiError — list of the above (returned when
//     MultiError option is set).
//   - any other error — surfaced verbatim with no pointer.
func buildValidationProblem(err error) problem {
	p := problem{
		Type:   problemTypeURI,
		Title:  "OpenAPI request validation failed",
		Status: http.StatusBadRequest,
		Detail: err.Error(),
	}
	p.Errors = collectEntries(err)

	// Replace the noisy detail with a single-line summary when we
	// successfully extracted structured entries. Operators get the
	// full picture from `errors[]`; the detail stays human-readable.
	if len(p.Errors) > 0 {
		switch len(p.Errors) {
		case 1:
			p.Detail = p.Errors[0].Message
		default:
			p.Detail = fmt.Sprintf("%d validation errors", len(p.Errors))
		}
	}
	return p
}

// collectEntries flattens the (possibly nested) error tree into a
// slice of problemEntry. Recursion handles MultiError-of-MultiError
// constructs that occasionally arise when openapi3filter validates
// multiple parameters.
func collectEntries(err error) []problemEntry {
	return collectEntriesCtx(err, nil)
}

// collectEntriesCtx is the recursive helper for collectEntries. The
// outerParts slice carries the JSON-pointer prefix that should apply
// to any SchemaError discovered deeper in the error tree — e.g., the
// "/body" or "/query/<name>" prefix derived from the enclosing
// RequestError. Without this carry-through, a multi-error inside a
// RequestError would lose its parameter context and surface bare
// schema-internal pointers like "/count" instead of "/body/count".
func collectEntriesCtx(err error, outerParts []string) []problemEntry {
	if err == nil {
		return nil
	}

	// RequestError must be checked BEFORE MultiError, because
	// RequestError.Unwrap() returns the inner err — which may itself
	// be a MultiError — and `errors.As(err, &multiVar)` would otherwise
	// walk past the RequestError and lose its parameter/body context.
	// Standalone RequestErrors (no inner SchemaError or MultiError)
	// surface a single entry built from the request error itself.
	var reqErr *openapi3filter.RequestError
	if errors.As(err, &reqErr) {
		parts := parameterPathParts(reqErr)
		// Prefer the inner SchemaError when present so we can
		// surface its JSON pointer with full context.
		var schemaErr *openapi3.SchemaError
		if errors.As(reqErr.Err, &schemaErr) {
			return []problemEntry{{
				Path:    pointerFromParts(parts, schemaErr),
				Message: schemaErrorMessage(reqErr, schemaErr),
			}}
		}
		var inner openapi3.MultiError
		if errors.As(reqErr.Err, &inner) {
			out := make([]problemEntry, 0, len(inner))
			for _, child := range inner {
				out = append(out, collectEntriesCtx(child, parts)...)
			}
			if len(out) > 0 {
				return out
			}
		}
		return []problemEntry{{
			Path:    strings.Join(parts, ""),
			Message: reqErr.Error(),
		}}
	}

	// Top-level MultiError (no enclosing RequestError) — walk
	// children, propagating the outer context.
	if multi, ok := err.(openapi3.MultiError); ok {
		out := make([]problemEntry, 0, len(multi))
		for _, child := range multi {
			out = append(out, collectEntriesCtx(child, outerParts)...)
		}
		return out
	}

	// Standalone SchemaError — apply any outer context the caller
	// passed in (e.g., a "/body" prefix from an enclosing
	// RequestError).
	var schemaErr *openapi3.SchemaError
	if errors.As(err, &schemaErr) {
		return []problemEntry{{
			Path:    pointerFromParts(outerParts, schemaErr),
			Message: schemaErrorReason(schemaErr),
		}}
	}

	return []problemEntry{{Message: err.Error()}}
}

// schemaErrorReason returns the SchemaError's Reason if present,
// falling back to the full Error() string. Used when no enclosing
// RequestError supplied a contextual reason.
func schemaErrorReason(schemaErr *openapi3.SchemaError) string {
	if schemaErr.Reason != "" {
		return schemaErr.Reason
	}
	return schemaErr.Error()
}

// parameterPathParts produces the "outer" portion of the JSON pointer
// for parameter or body errors. For a body error this is empty (the
// SchemaError's pointer is rooted at the body itself). For a parameter
// error we lead with the parameter's "in" location ("query"/"path"/
// "header"/"cookie") and name.
func parameterPathParts(reqErr *openapi3filter.RequestError) []string {
	if reqErr == nil {
		return nil
	}
	if reqErr.Parameter != nil {
		return []string{"/" + reqErr.Parameter.In, "/" + reqErr.Parameter.Name}
	}
	if reqErr.RequestBody != nil {
		return []string{"/body"}
	}
	return nil
}

// pointerFromParts assembles a JSON pointer (RFC 6901) by stitching
// the outer parts onto the SchemaError's internal pointer.
func pointerFromParts(outer []string, schemaErr *openapi3.SchemaError) string {
	prefix := strings.Join(outer, "")
	if schemaErr == nil {
		return prefix
	}
	parts := schemaErr.JSONPointer()
	if len(parts) == 0 {
		return prefix
	}
	var sb strings.Builder
	sb.WriteString(prefix)
	for _, p := range parts {
		sb.WriteByte('/')
		sb.WriteString(escapeJSONPointer(p))
	}
	return sb.String()
}

// escapeJSONPointer escapes the two reserved characters per RFC 6901.
func escapeJSONPointer(seg string) string {
	seg = strings.ReplaceAll(seg, "~", "~0")
	seg = strings.ReplaceAll(seg, "/", "~1")
	return seg
}

// schemaErrorMessage produces a human-readable summary for a
// SchemaError nested inside a RequestError. The reqErr.Reason carries
// useful context ("doesn't match schema") — combine it with the
// schema-level reason when both are present.
func schemaErrorMessage(reqErr *openapi3filter.RequestError, schemaErr *openapi3.SchemaError) string {
	switch {
	case schemaErr.Reason != "" && reqErr.Reason != "":
		return reqErr.Reason + ": " + schemaErr.Reason
	case schemaErr.Reason != "":
		return schemaErr.Reason
	case reqErr.Reason != "":
		return reqErr.Reason
	default:
		return schemaErr.Error()
	}
}
