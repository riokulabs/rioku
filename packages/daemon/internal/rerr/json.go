package rerr

import (
	"encoding/json"
	"net/http"
)

// JSON sets Content-Type to application/json, encodes v, and returns any
// encoding error. Handlers can tail-call this:
//
//	return rerr.JSON(w, body)
func JSON(w http.ResponseWriter, v any) error {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		return Wrap(err, "failed to encode response")
	}
	return nil
}
