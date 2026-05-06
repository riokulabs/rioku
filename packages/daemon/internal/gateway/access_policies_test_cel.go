// Package gateway: test-CEL endpoint for the access-policies surface.
//
// Plan-03 Task 6 / decisions-needed.md item 004:
//
//	POST /api/v1/t/{tenant}/access-policies/test-cel
//	Body:  { expr: string, sample?: object }
//	Reply: { matched: bool, error?: string, durationMs: number }
//
// The frontend's policy-editor "Test condition" button uses this. A full
// cel-go evaluator is out of scope for this slice (cel-go is not yet in
// `go.mod`, and the daemon's auth-middleware will pull it in alongside
// runtime evaluation). The current handler performs structural parse-only
// validation:
//
//   - Non-empty expression after trim
//   - Balanced parentheses
//   - Balanced double-quotes (no escape handling — fine for parse-only)
//
// On success the handler returns `{ matched: true, durationMs: <d> }`. On
// structural failure it returns `{ matched: false, error: "<reason>",
// durationMs: <d> }` with HTTP 200 — the frontend treats `error` as a
// validation hint, not a transport failure. Bad request bodies return 400.
package gateway

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
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
		start := time.Now()
		result := evaluateCELStub(body.Expr)
		result.DurationMs = float64(time.Since(start).Microseconds()) / 1000.0
		writeJSON(w, http.StatusOK, result)
	}
}

// evaluateCELStub is a parse-only validator. It returns matched=true when
// the expression looks structurally well-formed; matched=false with an
// error string otherwise. This is replaced by a real cel.NewEnv + Compile +
// Eval when cel-go lands in the daemon (tracked in decisions-needed.md
// item 004).
func evaluateCELStub(expr string) testCELResult {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" {
		return testCELResult{Matched: false, Error: "expression is empty"}
	}

	// Balanced parentheses (ignoring quoted regions).
	depth := 0
	inDouble := false
	inSingle := false
	for _, r := range trimmed {
		switch r {
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
		case '(':
			if !inDouble && !inSingle {
				depth++
			}
		case ')':
			if !inDouble && !inSingle {
				depth--
				if depth < 0 {
					return testCELResult{Matched: false, Error: "unbalanced ')'"}
				}
			}
		}
	}
	if depth != 0 {
		return testCELResult{Matched: false, Error: "unbalanced '('"}
	}
	if inDouble {
		return testCELResult{Matched: false, Error: `unterminated double-quoted string`}
	}
	if inSingle {
		return testCELResult{Matched: false, Error: "unterminated single-quoted string"}
	}

	return testCELResult{Matched: true}
}
