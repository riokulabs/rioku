// Package gateway: audit detail / stream / export / typeahead.
//
//	OPTIONS  /api/v1/t/{tenant}/audit                discovery
//	OPTIONS  /api/v1/t/{tenant}/audit/{id}           discovery
//	GET      /api/v1/t/{tenant}/audit/{id}           per-entry detail
//	GET      /api/v1/t/{tenant}/audit/stream         SSE — new entries
//	GET      /api/v1/t/{tenant}/audit/export/csv     CSV download
//	GET      /api/v1/t/{tenant}/audit/export/jsonl   JSONL download
//	GET      /api/v1/t/{tenant}/audit/actors         actor typeahead
//	GET      /api/v1/t/{tenant}/audit/resource-ids   resource-id typeahead
//
// Stream endpoint is poll-backed in v1 — re-runs the query every 5s
// and emits new entries since the last tick. A push-based watcher
// will land alongside the broader audit-events overhaul.
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/gateway/export"
	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/gateway/stream"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
	storeaudit "github.com/riokulabs/rioku/internal/store/audit"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// RegisterAuditExtraRoutes wires the new chunk-6 audit endpoints
// alongside the existing /audit list + /audit/entity surfaces.
func RegisterAuditExtraRoutes(mux *http.ServeMux, st store.Driver) {
	detail := RequirePermission("audit:read")(rerr.H(handleAuditDetail(st)))
	streamH := RequirePermission("audit:read")(http.HandlerFunc(handleAuditStream(st))) // rerr-skip: SSE via stream.Stream.Handler()
	csv := RequirePermission("audit:read")(rerr.H(handleAuditExportCSV(st)))
	jsonl := RequirePermission("audit:read")(rerr.H(handleAuditExportJSONL(st)))
	actors := RequirePermission("audit:read")(rerr.H(handleAuditActors(st)))
	resourceIDs := RequirePermission("audit:read")(rerr.H(handleAuditResourceIDs(st)))
	reveal := RequirePermission("audit:read-sensitive")(rerr.H(handleAuditReveal(st)))

	mux.Handle("GET /api/v1/t/{tenant}/audit/{id}", detail)
	mux.Handle("POST /api/v1/t/{tenant}/audit/{id}/reveal", reveal)
	mux.Handle("GET /api/v1/t/{tenant}/audit/stream", streamH)
	mux.Handle("GET /api/v1/t/{tenant}/audit/export/csv", csv)
	mux.Handle("GET /api/v1/t/{tenant}/audit/export/jsonl", jsonl)
	mux.Handle("GET /api/v1/t/{tenant}/audit/actors", actors)
	mux.Handle("GET /api/v1/t/{tenant}/audit/resource-ids", resourceIDs)

	optionsutil.RegisterWithCapabilities(mux, "/api/v1/t/{tenant}/audit",
		[]string{"GET"}, []string{"sse", "export-csv", "export-jsonl", "typeahead"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/audit/{id}", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/audit/{id}/reveal", []string{"POST"})
	optionsutil.RegisterWithCapabilities(mux, "/api/v1/t/{tenant}/audit/stream",
		[]string{"GET"}, []string{"sse"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/audit/export/csv", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/audit/export/jsonl", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/audit/actors", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/audit/resource-ids", []string{"GET"})
}

func handleAuditDetail(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant := TenantFromContext(r.Context())
		id := r.PathValue("id")
		// The legacy `/audit/entity/...` route also matches `/audit/{id}`
		// because Go ServeMux registers both — guard against the path
		// hitting the wrong handler when the second segment is one of
		// the reserved sub-paths.
		switch id {
		case "entity", "stream", "export", "actors", "resource-ids":
			http.NotFound(w, r)
			return nil
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		entry, err := tx.GetAuditEntry(r.Context(), id)
		if err != nil {
			return rerr.NotFound("audit_entry", id)
		}
		b := tenantBuilderOrRoot(tenant)
		return rerr.JSON(w, map[string]any{
			"id":            entry.GetId(),
			"actor":         entry.GetActor(),
			"entityType":    entry.GetEntityType(),
			"entityId":      entry.GetEntityId(),
			"operation":     entry.GetOperation(),
			"diff":          entry.GetDiff(),
			"configVersion": entry.GetConfigVersion(),
			"occurredAt":    entry.GetOccurredAt().AsTime().Format(time.RFC3339Nano),
			"_links":        auditEntryLinks(entry, b),
		})
	}
}

func auditEntryLinks(e *riokuv1.AuditEntry, b *links.Builder) links.Set {
	out := links.Set{
		"self": b.Self("audit", e.GetId()),
	}
	if e.GetEntityType() != "" && e.GetEntityId() != "" {
		out["entity"] = b.Path("/audit/entity/" + e.GetEntityType() + "/" + e.GetEntityId())
	}
	return out
}

// handleAuditReveal records a sensitive-fields reveal action against
// an existing audit entry and returns the original entry alongside
// the new follow-up audit row that captures the reveal. Requires
// `audit:read-sensitive`. The caller-supplied reason is persisted
// verbatim with the new audit row so subsequent compliance reviewers
// can verify the bypass was justified.
func handleAuditReveal(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")

		var body struct {
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return rerr.Validation(map[string]string{"body": "request body must be JSON with a `reason` field"})
		}
		reason := strings.TrimSpace(body.Reason)
		if len(reason) < 4 {
			return rerr.Validation(map[string]string{"reason": "reason must be at least 4 characters"})
		}

		actor := "system"
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil && sc.UserID != "" {
			actor = sc.UserID
		}

		// 1) read the original entry
		txr, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		entry, err := txr.GetAuditEntry(ctx, id)
		_ = txr.Rollback()
		if err != nil {
			return rerr.NotFound("audit_entry", id)
		}

		// 2) build + persist the follow-up reveal entry
		revealEntry, err := storeaudit.BuildEntry(
			storeaudit.DefaultRegistry,
			actor,
			"audit-entry",
			id,
			"reveal",
			&storeaudit.AuditSensitiveRevealed{
				RevealedEntryID: id,
				Reason:          reason,
			},
		)
		if err != nil {
			return rerr.Wrap(err, "build reveal audit entry")
		}

		txw, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		if err := txw.AppendAuditEntry(ctx, revealEntry); err != nil {
			_ = txw.Rollback()
			return rerr.Wrap(err, "persist reveal audit entry")
		}
		if err := txw.Commit(); err != nil {
			return rerr.Wrap(err, "commit reveal audit entry")
		}

		return rerr.JSON(w, map[string]any{
			"entry":       auditEntryToMap(entry),
			"revealEntry": auditEntryToMap(revealEntry),
		})
	}
}

func auditEntryToMap(e *riokuv1.AuditEntry) map[string]any {
	return map[string]any{
		"id":            e.GetId(),
		"actor":         e.GetActor(),
		"entityType":    e.GetEntityType(),
		"entityId":      e.GetEntityId(),
		"operation":     e.GetOperation(),
		"diff":          e.GetDiff(),
		"payloadSchema": e.GetPayloadSchema(),
		"payload":       e.GetPayload(),
		"configVersion": e.GetConfigVersion(),
		"occurredAt":    e.GetOccurredAt().AsTime().Format(time.RFC3339Nano),
	}
}

// handleAuditStream emits an SSE feed of new audit entries. Backed
// by a 5s poll loop; replace with a push watcher when one lands.
func handleAuditStream(st store.Driver) http.HandlerFunc {
	s := stream.Stream[*riokuv1.AuditEntry]{
		EventName: "audit",
		Encode: func(e *riokuv1.AuditEntry) (string, []byte, error) {
			raw, err := json.Marshal(map[string]any{
				"id":         e.GetId(),
				"actor":      e.GetActor(),
				"entityType": e.GetEntityType(),
				"entityId":   e.GetEntityId(),
				"operation":  e.GetOperation(),
				"occurredAt": e.GetOccurredAt().AsTime().Format(time.RFC3339Nano),
			})
			return "", raw, err
		},
		Subscribe: func(ctx context.Context) (<-chan *riokuv1.AuditEntry, func(), error) {
			out := make(chan *riokuv1.AuditEntry, 32)
			done := make(chan struct{})
			lastSeen := time.Now().UTC()
			go func() {
				defer close(out)
				ticker := time.NewTicker(5 * time.Second)
				defer ticker.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case <-done:
						return
					case <-ticker.C:
					}
					tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
					if err != nil {
						continue
					}
					since := lastSeen
					rows, err := tx.QueryAuditLog(ctx, store.AuditQuery{Since: &since, Limit: 200})
					_ = tx.Rollback()
					if err != nil {
						continue
					}
					// QueryAuditLog returns newest-first; reverse so we
					// emit in chronological order and the consumer's
					// view matches the natural log ordering.
					for i := len(rows) - 1; i >= 0; i-- {
						e := rows[i]
						ts := e.GetOccurredAt().AsTime()
						if !ts.After(lastSeen) {
							continue
						}
						select {
						case out <- e:
						case <-ctx.Done():
							return
						}
						if ts.After(lastSeen) {
							lastSeen = ts
						}
					}
				}
			}()
			return out, func() { close(done) }, nil
		},
	}
	return s.Handler()
}

func handleAuditExportCSV(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		query, err := buildAuditQueryFromRequest(r)
		if err != nil {
			return rerr.Validation(map[string]string{"query": err.Error()})
		}
		query.Limit = 0 // export pulls everything matching the filter
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		entries, err := tx.QueryAuditLog(r.Context(), query)
		if err != nil {
			return rerr.Wrap(err, "query audit")
		}
		rows := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			rows = append(rows, map[string]any{
				"id":            e.GetId(),
				"actor":         e.GetActor(),
				"entityType":    e.GetEntityType(),
				"entityId":      e.GetEntityId(),
				"operation":     e.GetOperation(),
				"diff":          e.GetDiff(),
				"configVersion": e.GetConfigVersion(),
				"occurredAt":    e.GetOccurredAt().AsTime(),
			})
		}
		// rerr-skip: export.WriteCSV sets its own Content-Type/Content-Disposition headers
		_ = export.WriteCSV(w, r, "audit.csv",
			[]string{"id", "occurredAt", "actor", "entityType", "entityId", "operation", "configVersion", "diff"},
			export.FromSlice(r.Context(), rows))
		return nil
	}
}

func handleAuditExportJSONL(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		query, err := buildAuditQueryFromRequest(r)
		if err != nil {
			return rerr.Validation(map[string]string{"query": err.Error()})
		}
		query.Limit = 0
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		entries, err := tx.QueryAuditLog(r.Context(), query)
		if err != nil {
			return rerr.Wrap(err, "query audit")
		}
		rows := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			rows = append(rows, map[string]any{
				"id":            e.GetId(),
				"actor":         e.GetActor(),
				"entityType":    e.GetEntityType(),
				"entityId":      e.GetEntityId(),
				"operation":     e.GetOperation(),
				"diff":          e.GetDiff(),
				"configVersion": e.GetConfigVersion(),
				"occurredAt":    e.GetOccurredAt().AsTime().Format(time.RFC3339Nano),
			})
		}
		// rerr-skip: export.WriteJSONL sets its own Content-Type/Content-Disposition headers
		_ = export.WriteJSONL(w, r, "audit.jsonl", export.FromSlice(r.Context(), rows))
		return nil
	}
}

func handleAuditActors(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		prefix := q.Get("q")
		limit := 50
		if v := q.Get("limit"); v != "" {
			if n, err := atoiDefault(v, 50); err == nil {
				limit = n
			}
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		actors, err := tx.ListAuditActors(r.Context(), prefix, limit)
		if err != nil {
			return rerr.Wrap(err, "list audit actors")
		}
		return rerr.JSON(w, map[string]any{
			"items": actors,
			"total": len(actors),
		})
	}
}

func handleAuditResourceIDs(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		entityType := q.Get("entity_type")
		prefix := q.Get("q")
		limit := 50
		if v := q.Get("limit"); v != "" {
			if n, err := atoiDefault(v, 50); err == nil {
				limit = n
			}
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		ids, err := tx.ListAuditResourceIDs(r.Context(), entityType, prefix, limit)
		if err != nil {
			return rerr.Wrap(err, "list audit resource_ids")
		}
		return rerr.JSON(w, map[string]any{
			"items":      ids,
			"total":      len(ids),
			"entityType": entityType,
		})
	}
}

// buildAuditQueryFromRequest mirrors the existing handleAuditQuery
// filter parsing but produces a store.AuditQuery without writing a
// response. Used by the export endpoints so they share the same
// filter set as the list endpoint.
func buildAuditQueryFromRequest(r *http.Request) (store.AuditQuery, error) {
	q := r.URL.Query()
	out := store.AuditQuery{
		Actor:      q.Get("actor"),
		EntityType: q.Get("entity_type"),
		EntityID:   q.Get("entity_id"),
	}
	if rangeStr := q.Get("range"); rangeStr != "" {
		dur, err := parseRange(rangeStr)
		if err != nil {
			return out, fmt.Errorf("range must be a duration like '24h' or '7d'")
		}
		since := time.Now().UTC().Add(-dur)
		out.Since = &since
	}
	if sinceStr := q.Get("since"); sinceStr != "" {
		ts, err := time.Parse(time.RFC3339, sinceStr)
		if err != nil {
			return out, fmt.Errorf("since must be RFC3339")
		}
		out.Since = &ts
	}
	if untilStr := q.Get("until"); untilStr != "" {
		ts, err := time.Parse(time.RFC3339, untilStr)
		if err != nil {
			return out, fmt.Errorf("until must be RFC3339")
		}
		out.Until = &ts
	}
	return out, nil
}

func atoiDefault(s string, fallback int) (int, error) {
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return fallback, err
	}
	return n, nil
}
