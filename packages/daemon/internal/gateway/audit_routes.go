package gateway

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/store"
	"google.golang.org/protobuf/encoding/protojson"
)

// RegisterAuditRoutes registers the hand-written REST audit endpoint.
// gRPC-gateway cannot translate server-streaming RPCs in in-process mode,
// so this handler queries the store directly and returns a JSON array.
func RegisterAuditRoutes(mux *http.ServeMux, st store.Driver) {
	mux.HandleFunc("GET /api/v1/audit", handleAuditQuery(st))
}

func handleAuditQuery(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		q := r.URL.Query()

		query := store.AuditQuery{
			Actor:      q.Get("actor"),
			EntityType: q.Get("entity_type"),
			EntityID:   q.Get("entity_id"),
		}

		// Parse range (e.g. "24h", "7d") into a Since timestamp.
		if rangeStr := q.Get("range"); rangeStr != "" {
			dur, err := parseRange(rangeStr)
			if err != nil {
				writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid range",
					"Range must be a duration like '24h' or '7d'", r.URL.Path, nil)
				return
			}
			since := time.Now().UTC().Add(-dur)
			query.Since = &since
		}

		// Parse limit.
		if limitStr := q.Get("limit"); limitStr != "" {
			n, err := strconv.Atoi(limitStr)
			if err != nil || n < 0 {
				writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid limit",
					"Limit must be a non-negative integer", r.URL.Path, nil)
				return
			}
			query.Limit = n
		}

		// Parse offset.
		if offsetStr := q.Get("offset"); offsetStr != "" {
			n, err := strconv.Atoi(offsetStr)
			if err != nil || n < 0 {
				writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid offset",
					"Offset must be a non-negative integer", r.URL.Path, nil)
				return
			}
			query.Offset = n
		}

		// Execute query in a read-only transaction.
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to query audit log", r.URL.Path, nil)
			return
		}
		defer func() { _ = tx.Rollback() }()

		entries, err := tx.QueryAuditLog(ctx, query)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to query audit log", r.URL.Path, nil)
			return
		}

		// Marshal each entry with protojson and build a JSON array.
		marshaler := protojson.MarshalOptions{EmitUnpopulated: true}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("["))
		for i, entry := range entries {
			if i > 0 {
				_, _ = w.Write([]byte(","))
			}
			data, err := marshaler.Marshal(entry)
			if err != nil {
				// Best effort — skip malformed entries.
				continue
			}
			_, _ = w.Write(data)
		}
		_, _ = w.Write([]byte("]"))
	}
}

// parseRange converts a human-friendly range string like "24h" or "7d" into
// a time.Duration. Supported suffixes: h (hours), d (days).
func parseRange(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}

	suffix := s[len(s)-1]
	numStr := s[:len(s)-1]

	n, err := strconv.Atoi(numStr)
	if err != nil {
		return 0, err
	}

	switch suffix {
	case 'h':
		return time.Duration(n) * time.Hour, nil
	case 'd':
		return time.Duration(n) * 24 * time.Hour, nil
	default:
		// Fall back to time.ParseDuration for standard Go durations.
		return time.ParseDuration(s)
	}
}
