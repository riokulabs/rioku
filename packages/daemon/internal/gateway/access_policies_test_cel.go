// Package gateway: test-CEL endpoint for the access-policies surface.
//
//	POST /api/v1/t/{tenant}/access-policies/test-cel
//	Body:  { expr: string, sample?: object }
//	Reply: { matched: bool, error?: string, durationMs: number }
//
// The frontend's policy-editor "Test condition" button uses this. The
// handler compiles and evaluates the expression with `cel-go` against the
// caller-supplied sample envelope. Top-level keys of `sample` are hoisted
// into the activation so authors can write either `service == "users"` or
// `sample.service == "users"`. Non-bool expression results are reported as
// validation errors (HTTP 200, matched=false, error explains the type),
// since the policy editor surfaces `error` as an inline hint rather than
// a transport failure. Bad request bodies return 400.
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/cel-go/cel"
)

type testCELBody struct {
	Expr   string                 `json:"expr"`
	Sample map[string]interface{} `json:"sample,omitempty"`
}

type testCELResult struct {
	Matched    bool    `json:"matched"`
	Error      string  `json:"error,omitempty"`
	DurationMs float64 `json:"durationMs"`
}

func handleTestAccessPolicyCEL() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body testCELBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		matched, durationMs, err := evaluateCEL(r.Context(), body.Expr, body.Sample)
		result := testCELResult{
			Matched:    matched,
			DurationMs: float64(durationMs),
		}
		if err != nil {
			result.Error = err.Error()
		}
		writeJSON(w, http.StatusOK, result)
	}
}

// evaluateCEL compiles and evaluates a CEL expression against a sample
// envelope. The activation exposes both the full envelope under `sample`
// and `envelope`, plus every top-level key of the sample as a free
// variable (e.g. `sample = {"service": "users"}` makes both
// `service == "users"` and `sample.service == "users"` valid). The
// returned duration is wall-clock time spent inside `prg.Eval`, in
// milliseconds; compilation time is excluded so the value reflects what
// runtime evaluation would cost.
func evaluateCEL(_ context.Context, expression string, sample map[string]any) (bool, int64, error) {
	if sample == nil {
		sample = map[string]any{}
	}
	// Build env: declare `sample`/`envelope` plus every top-level sample key
	// as a free DynType variable so unqualified field names compile.
	opts := []cel.EnvOption{
		cel.Variable("sample", cel.DynType),
		cel.Variable("envelope", cel.DynType),
	}
	for k := range sample {
		if k == "sample" || k == "envelope" {
			continue
		}
		opts = append(opts, cel.Variable(k, cel.DynType))
	}
	env, envErr := cel.NewEnv(opts...)
	if envErr != nil {
		return false, 0, envErr
	}
	ast, issues := env.Compile(expression)
	if issues != nil && issues.Err() != nil {
		return false, 0, issues.Err()
	}
	prg, prgErr := env.Program(ast)
	if prgErr != nil {
		return false, 0, prgErr
	}
	activation := map[string]any{"sample": sample, "envelope": sample}
	for k, v := range sample {
		if k == "sample" || k == "envelope" {
			continue
		}
		activation[k] = v
	}
	start := time.Now()
	result, _, evalErr := prg.Eval(activation)
	durationMs := time.Since(start).Milliseconds()
	if evalErr != nil {
		return false, durationMs, evalErr
	}
	boolVal, ok := result.Value().(bool)
	if !ok {
		return false, durationMs, fmt.Errorf("cel: expression must return bool, got %T", result.Value())
	}
	return boolVal, durationMs, nil
}
