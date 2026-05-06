// Package gateway — access policy CEL test/dry-run endpoint (Stage-2 plan-02).
//
// REST surface:
//
//	POST /api/v1/t/{tenant}/access-policies/test-cel
//	POST /api/v1/auth/access-policies/test-cel
//
// Body (application/json):
//
//	{
//	  "expression": "request.method == \"GET\"",
//	  "sample":     { ... arbitrary JSON used as the activation map ... }
//	}
//
// Response 200:
//
//	{ "matched": bool, "durationMs": number, "error": string? }
//
// Response 400 — only when the request envelope itself is malformed
// (non-JSON, missing `expression`). CEL parse / type-check / runtime
// errors are surfaced inside the 200 response payload as `error` so the
// admin panel can render them inline against the CEL editor.
//
// Permission: `access-policies:read` — the endpoint is a side-effect-free
// dry-run and does not mutate persisted policies.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/cel-go/cel"
	"github.com/google/cel-go/common/types"
	"github.com/google/cel-go/common/types/ref"

	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
)

// testCelRequest is the JSON body accepted by the test-cel endpoint.
type testCelRequest struct {
	Expression string         `json:"expression"`
	Sample     map[string]any `json:"sample"`
}

// testCelResponse is the JSON body returned by the test-cel endpoint.
//
// Errors are reported in two distinct ways:
//   - HTTP 400 — request envelope problems (bad JSON, empty expression).
//   - HTTP 200 + `error` populated — CEL parse / check / eval problems.
//
// `Matched` is only meaningful when `Error` is empty.
type testCelResponse struct {
	Matched    bool    `json:"matched"`
	Error      string  `json:"error,omitempty"`
	DurationMs float64 `json:"durationMs"`
}

// RegisterAccessPolicyTestCelRoutes registers POST endpoints for the dry-run
// CEL evaluator on both the legacy and tenant-scoped paths.
func RegisterAccessPolicyTestCelRoutes(mux *http.ServeMux) {
	h := RequirePermission("access-policies:read")(http.HandlerFunc(handleTestCEL))
	mux.Handle("POST /api/v1/auth/access-policies/test-cel", h)
	mux.Handle("POST /api/v1/t/{tenant}/access-policies/test-cel", h)

	optionsutil.Register(mux, "/api/v1/auth/access-policies/test-cel", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/access-policies/test-cel", []string{"POST"})
}

// handleTestCEL parses, type-checks, and evaluates the supplied CEL
// expression against the sample activation map. The caller is the admin
// panel's "Test CEL" tab; latency is measured in milliseconds and reported
// back so the UI can surface it next to the match result.
//
// Sample handling:
//   - The sample is bound under the variable name `sample` AND, when it is
//     a non-nil map, each top-level key is also bound directly so authors
//     can write either `sample.foo == "bar"` or `foo == "bar"`. This
//     mirrors how production middleware will typically expose `request`,
//     `headers`, etc. as top-level identifiers.
//   - All bindings are typed as `dyn` because CEL's type system cannot
//     infer arbitrary JSON without a schema.
//
// Result handling:
//   - Non-bool results are flagged as an error (matched=false). Access
//     policies must evaluate to a boolean.
//   - Runtime errors (`*types.Err`) are surfaced via the `error` field.
func handleTestCEL(w http.ResponseWriter, r *http.Request) {
	var body testCelRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeBadRequest(w, r, "invalid JSON body")
		return
	}
	if body.Expression == "" {
		writeBadRequest(w, r, "expression is required")
		return
	}

	start := time.Now()
	matched, evalErr := evaluateCEL(body.Expression, body.Sample)
	dur := time.Since(start)

	resp := testCelResponse{
		Matched:    matched,
		DurationMs: float64(dur.Microseconds()) / 1000.0,
	}
	if evalErr != nil {
		resp.Error = evalErr.Error()
	}
	writeJSON(w, http.StatusOK, resp)
}

// evaluateCEL compiles and evaluates `expr` against `sample`. The returned
// error is non-nil on parse, type-check, or runtime failure; the bool is
// only meaningful when error is nil.
func evaluateCEL(expr string, sample map[string]any) (bool, error) {
	// Build the activation: always bind `sample`; additionally hoist each
	// top-level map key so policies can be written against `request`,
	// `headers`, etc. directly.
	declOpts := []cel.EnvOption{cel.Variable("sample", cel.DynType)}
	activation := map[string]any{"sample": sample}
	for k, v := range sample {
		// Skip `sample` itself if the user happened to put a key called
		// "sample" inside their sample — `cel.Variable` registered above
		// already wins, but we shouldn't double-register it on the env.
		if k == "sample" {
			continue
		}
		declOpts = append(declOpts, cel.Variable(k, cel.DynType))
		activation[k] = v
	}

	env, err := cel.NewEnv(declOpts...)
	if err != nil {
		return false, err
	}

	ast, iss := env.Compile(expr)
	if iss != nil && iss.Err() != nil {
		return false, iss.Err()
	}

	prg, err := env.Program(ast)
	if err != nil {
		return false, err
	}

	out, _, err := prg.Eval(activation)
	if err != nil {
		return false, err
	}
	if errVal, ok := out.(*types.Err); ok {
		return false, errors.New(errVal.String())
	}

	return celResultToBool(out)
}

// celResultToBool converts a CEL evaluation result into a Go bool.
// Anything that isn't a `types.Bool` (or doesn't convert to one) is
// rejected — access policies must be predicate expressions.
func celResultToBool(out ref.Val) (bool, error) {
	if b, ok := out.(types.Bool); ok {
		return bool(b), nil
	}
	conv := out.ConvertToType(types.BoolType)
	if errVal, ok := conv.(*types.Err); ok {
		return false, errors.New("expression must evaluate to a bool: " + errVal.String())
	}
	if b, ok := conv.(types.Bool); ok {
		return bool(b), nil
	}
	return false, errors.New("expression must evaluate to a bool")
}
