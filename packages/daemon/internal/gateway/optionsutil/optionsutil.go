// Package optionsutil registers OPTIONS handlers for resource paths.
//
// Every collection / item / sub-collection in the daemon's REST surface
// exposes an OPTIONS verb that returns the supported methods via the
// `Allow` header along with capability hints. This is the canonical
// place to wire those handlers so registration stays uniform.
//
// Usage:
//
//	optionsutil.Register(mux,
//	    "/api/v1/t/{tenant}/api-keys",
//	    []string{"GET", "POST"})
//	optionsutil.Register(mux,
//	    "/api/v1/t/{tenant}/api-keys/{id}",
//	    []string{"GET", "PUT", "PATCH", "DELETE"})
//
// The handler emits 204 No Content with:
//
//	Allow: GET, PUT, PATCH, DELETE, OPTIONS
//	Accept-Patch: application/json, application/merge-patch+json
//	X-Rioku-Capabilities: pagination, filtering, _links
//
// "OPTIONS" is appended automatically — callers list the resource
// methods only.
package optionsutil

import (
	"net/http"
	"sort"
	"strings"
)

// AcceptPatchValue is the standard Accept-Patch header value emitted by
// every OPTIONS response. Exported so tests in other packages can lock
// the contract.
const AcceptPatchValue = "application/json, application/merge-patch+json"

// CapabilitiesValue lists daemon-wide capabilities. Per-resource
// capabilities can extend this list via WithCapabilities.
const CapabilitiesValue = "pagination, filtering, _links"

// Register installs an OPTIONS handler for `path` that reports
// `methods` (plus OPTIONS) in the Allow header.
//
// `methods` is normalised: duplicates removed, OPTIONS always appended,
// alphabetical ordering applied so the header value is stable for
// tests.
func Register(mux *http.ServeMux, path string, methods []string) {
	value := buildAllow(methods)
	mux.HandleFunc("OPTIONS "+path, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Allow", value)
		w.Header().Set("Accept-Patch", AcceptPatchValue)
		w.Header().Set("X-Rioku-Capabilities", CapabilitiesValue)
		w.WriteHeader(http.StatusNoContent)
	})
}

// RegisterWithCapabilities is like Register but appends extra capability
// strings to the X-Rioku-Capabilities header. Use for resource-specific
// hints like "sse", "export-csv", or "idempotency-key".
func RegisterWithCapabilities(mux *http.ServeMux, path string, methods []string, extra []string) {
	allow := buildAllow(methods)
	caps := CapabilitiesValue
	if len(extra) > 0 {
		caps = caps + ", " + strings.Join(extra, ", ")
	}
	mux.HandleFunc("OPTIONS "+path, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Allow", allow)
		w.Header().Set("Accept-Patch", AcceptPatchValue)
		w.Header().Set("X-Rioku-Capabilities", caps)
		w.WriteHeader(http.StatusNoContent)
	})
}

// buildAllow normalises a method list and returns its Allow-header
// representation.
func buildAllow(methods []string) string {
	seen := map[string]struct{}{"OPTIONS": {}}
	out := []string{"OPTIONS"}
	for _, m := range methods {
		m = strings.ToUpper(strings.TrimSpace(m))
		if m == "" {
			continue
		}
		if _, ok := seen[m]; ok {
			continue
		}
		seen[m] = struct{}{}
		out = append(out, m)
	}
	sort.Strings(out)
	return strings.Join(out, ", ")
}
