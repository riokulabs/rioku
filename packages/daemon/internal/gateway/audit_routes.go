package gateway

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
	"google.golang.org/protobuf/encoding/protojson"
)

// RegisterAuditRoutes registers the hand-written REST audit endpoints.
// gRPC-gateway cannot translate server-streaming RPCs in in-process mode,
// so these handlers query the store directly and return a JSON array.
//
// Routes:
//
//	GET /api/v1/audit                                      generic query (filters via query string)
//	GET /api/v1/audit/entity/{entityType}/{entityId}       per-entity convenience (#82)
//
// Both routes require `audit:read`. Both honor the same filter set
// (actor, entity_type, entity_id, range, since, until, limit, offset);
// the per-entity route just pre-fills entity_type and entity_id from
// the path. Both set X-Total-Count to the unpaginated match count so
// UIs can render "Page 1 of N" without a separate count call.
func RegisterAuditRoutes(mux *http.ServeMux, st store.Driver) {
	generic := RequirePermission("audit:read")(rerr.H(handleAuditQuery(st, false)))
	perEntity := RequirePermission("audit:read")(rerr.H(handleAuditQuery(st, true)))

	mux.Handle("GET /api/v1/audit", generic)
	mux.Handle("GET /api/v1/audit/entity/{entityType}/{entityId}", perEntity)

	mux.Handle("GET /api/v1/t/{tenant}/audit", generic)
	mux.Handle("GET /api/v1/t/{tenant}/audit/entity/{entityType}/{entityId}", perEntity)
}

// handleAuditQuery serves both the generic and per-entity routes. When
// pathScoped is true, EntityType and EntityID are sourced from the
// URL path — and conflicting values in the query string are rejected
// rather than silently overridden, so callers don't get surprised.
func handleAuditQuery(st store.Driver, pathScoped bool) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		q := r.URL.Query()

		query := store.AuditQuery{
			Actor:      q.Get("actor"),
			EntityType: q.Get("entity_type"),
			EntityID:   q.Get("entity_id"),
		}

		if pathScoped {
			pt, pid := r.PathValue("entityType"), r.PathValue("entityId")
			// Reject query-string conflicts so a caller's intent is
			// unambiguous. Letting one silently override the other
			// would obscure copy-paste mistakes.
			if query.EntityType != "" && query.EntityType != pt {
				return rerr.Validation(map[string]string{"entity_type": "entity_type query parameter conflicts with path"})
			}
			if query.EntityID != "" && query.EntityID != pid {
				return rerr.Validation(map[string]string{"entity_id": "entity_id query parameter conflicts with path"})
			}
			query.EntityType = pt
			query.EntityID = pid
		}

		// Parse range (e.g. "24h", "7d") into a Since timestamp.
		if rangeStr := q.Get("range"); rangeStr != "" {
			dur, err := parseRange(rangeStr)
			if err != nil {
				return rerr.Validation(map[string]string{"range": "must be a duration like '24h' or '7d'"})
			}
			since := time.Now().UTC().Add(-dur)
			query.Since = &since
		}

		// Parse explicit since/until (RFC3339). These take precedence
		// over `range` if both are supplied — the operator presumably
		// knows what they want when they pass an absolute timestamp.
		if sinceStr := q.Get("since"); sinceStr != "" {
			ts, err := time.Parse(time.RFC3339, sinceStr)
			if err != nil {
				return rerr.Validation(map[string]string{"since": "must be an RFC3339 timestamp"})
			}
			query.Since = &ts
		}
		if untilStr := q.Get("until"); untilStr != "" {
			ts, err := time.Parse(time.RFC3339, untilStr)
			if err != nil {
				return rerr.Validation(map[string]string{"until": "must be an RFC3339 timestamp"})
			}
			query.Until = &ts
		}

		// Parse limit.
		if limitStr := q.Get("limit"); limitStr != "" {
			n, err := strconv.Atoi(limitStr)
			if err != nil || n < 0 {
				return rerr.Validation(map[string]string{"limit": "must be a non-negative integer"})
			}
			query.Limit = n
		}

		// Parse offset.
		if offsetStr := q.Get("offset"); offsetStr != "" {
			n, err := strconv.Atoi(offsetStr)
			if err != nil || n < 0 {
				return rerr.Validation(map[string]string{"offset": "must be a non-negative integer"})
			}
			query.Offset = n
		}

		// Execute query in a read-only transaction.
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin audit tx")
		}
		defer func() { _ = tx.Rollback() }()

		entries, err := tx.QueryAuditLog(ctx, query)
		if err != nil {
			return rerr.Wrap(err, "query audit log")
		}
		// Total ignores Limit/Offset — UIs use it to render "X of Y".
		total, err := tx.CountAuditLog(ctx, query)
		if err != nil {
			return rerr.Wrap(err, "count audit log")
		}

		// Marshal each entry with protojson and build a JSON array.
		// rerr-skip: response headers already written; streaming JSON array.
		marshaler := protojson.MarshalOptions{EmitUnpopulated: true}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Total-Count", strconv.Itoa(total))
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
		return nil
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
