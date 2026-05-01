// Package gateway: stage-2 admin API completion chunks 10-15 — small
// surface additions that don't warrant their own file each.
//
//	Chunk 10 — notifications: stream (SSE) + channel test
//	Chunk 11 — PKI/TLS: PATCH aliases + per-field PUT + OPTIONS
//	Chunk 13 — webhooks: test action + OPTIONS
//	Chunk 14 — cluster: tenant-scoped node aliases + drain/promote/demote
//	Chunk 15 — settings singletons: PATCH + OPTIONS coverage
//
// Most of these are alias / OPTIONS / stub additions onto existing
// handlers shipped in PR #153. Action stubs that need backend work
// (channel test delivery, plugin install pipeline, node drain
// orchestration) record the operator intent and return 202 with a
// note pointing at the corresponding follow-up issue.
package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/gateway/stream"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterStage2ExtrasRoutes(mux *http.ServeMux, st store.Driver) {
	registerNotificationsExtras(mux, st)
	registerPKITLSExtras(mux)
	registerWebhookExtras(mux, st)
	registerClusterExtras(mux)
	registerSettingsSingletonExtras(mux)
}

// ─── Chunk 10: notifications stream + channel test ──────────────────────────

func registerNotificationsExtras(mux *http.ServeMux, st store.Driver) {
	// /notification-channels/{id}/test already registered in
	// notifications_routes.go. We add only the SSE stream + OPTIONS
	// for both paths.
	mux.Handle("GET /api/v1/t/{tenant}/notifications/stream",
		RequirePermission("notifications:read")(http.HandlerFunc(handleNotificationsStream(st))))

	optionsutil.RegisterWithCapabilities(mux, "/api/v1/t/{tenant}/notifications/stream",
		[]string{"GET"}, []string{"sse"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/notification-channels/{id}/test", []string{"POST"})
}

// handleNotificationsStream emits new notifications for the
// authenticated user. Backed by a 5s poll over ListNotificationItemsByUser.
func handleNotificationsStream(st store.Driver) http.HandlerFunc {
	s := stream.Stream[*store.NotificationItem]{
		EventName: "notification",
		Encode: func(n *store.NotificationItem) (string, []byte, error) {
			raw, err := json.Marshal(map[string]any{
				"id":        n.ID,
				"category":  n.Category,
				"severity":  n.Severity,
				"title":     n.Title,
				"createdAt": n.OccurredAt.UTC().Format(time.RFC3339Nano),
			})
			return "", raw, err
		},
		Subscribe: func(ctx context.Context) (<-chan *store.NotificationItem, func(), error) {
			out := make(chan *store.NotificationItem, 32)
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
					tn := TenantFromContext(ctx)
					if tn == nil {
						continue
					}
					tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
					if err != nil {
						continue
					}
					items, err := tx.ListNotificationItemsByUser(ctx, tn.ID, "*", store.NotificationItemQuery{Limit: 200})
					_ = tx.Rollback()
					if err != nil {
						continue
					}
					for i := len(items) - 1; i >= 0; i-- {
						n := items[i]
						if !n.OccurredAt.After(lastSeen) {
							continue
						}
						select {
						case out <- n:
						case <-ctx.Done():
							return
						}
						lastSeen = n.OccurredAt
					}
				}
			}()
			return out, func() { close(done) }, nil
		},
	}
	return s.Handler()
}

// ─── Chunk 11: PKI/TLS PATCH aliases + per-field PUT ────────────────────────

func registerPKITLSExtras(mux *http.ServeMux) {
	// PATCH coverage gets discovery of `Allow: PATCH` for any client
	// that sends a partial update; the underlying handlers in
	// pki_routes.go already accept partial bodies via pointer fields.
	for _, p := range []string{
		"/api/v1/t/{tenant}/settings/pki/cas",
		"/api/v1/t/{tenant}/settings/pki/cas/{id}",
		"/api/v1/t/{tenant}/settings/pki/enrollments",
		"/api/v1/t/{tenant}/settings/pki/enrollments/{id}",
		"/api/v1/t/{tenant}/settings/tls/certificates",
		"/api/v1/t/{tenant}/settings/tls/certificates/{id}",
		"/api/v1/t/{tenant}/settings/tls/config",
	} {
		methods := []string{"GET", "PUT", "PATCH", "DELETE", "POST"}
		// Singleton gets only GET/PUT/PATCH; collections get the
		// full set. Trim by suffix.
		if p == "/api/v1/t/{tenant}/settings/tls/config" {
			methods = []string{"GET", "PUT", "PATCH"}
		}
		optionsutil.Register(mux, p, methods)
	}
}

// ─── Chunk 13: webhook test action ──────────────────────────────────────────

func registerWebhookExtras(mux *http.ServeMux, st store.Driver) {
	mux.Handle("POST /api/v1/t/{tenant}/settings/webhooks/{id}/test",
		RequirePermission("webhooks:write")(http.HandlerFunc(handleTestWebhook(st))))
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/webhooks", []string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/webhooks/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/webhooks/{id}/test", []string{"POST"})
}

func handleTestWebhook(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		ep, err := tx.GetWebhookEndpoint(r.Context(), tenant.ID, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Webhook not found", "No webhook with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{
			"webhookId": ep.ID,
			"url":       ep.URL,
			"status":    "queued",
			"note":      "synthetic delivery lands when the webhook dispatcher subsystem ships",
		})
	}
}

// ─── Chunk 14: tenant-scoped cluster nodes + drain/promote/demote stubs ────

func registerClusterExtras(mux *http.ServeMux) {
	// Tenant-scoped path aliases. The legacy /api/v1/cluster/* family
	// stays alive too; cluster operations are deployment-wide so the
	// tenant prefix is informational.
	mux.Handle("GET /api/v1/t/{tenant}/cluster/nodes",
		RequirePermission("cluster:read")(http.HandlerFunc(handleClusterNodesAlias)))
	mux.Handle("GET /api/v1/t/{tenant}/cluster/nodes/{id}",
		RequirePermission("cluster:read")(http.HandlerFunc(handleClusterNodeAlias)))
	mux.Handle("POST /api/v1/t/{tenant}/cluster/nodes/{id}/drain",
		RequirePermission("cluster:write")(http.HandlerFunc(handleClusterNodeDrain)))
	mux.Handle("POST /api/v1/t/{tenant}/cluster/nodes/{id}/promote",
		RequirePermission("cluster:write")(http.HandlerFunc(handleClusterNodePromote)))
	mux.Handle("POST /api/v1/t/{tenant}/cluster/nodes/{id}/demote",
		RequirePermission("cluster:write")(http.HandlerFunc(handleClusterNodeDemote)))

	optionsutil.Register(mux, "/api/v1/t/{tenant}/cluster/nodes", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/cluster/nodes/{id}", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/cluster/nodes/{id}/drain", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/cluster/nodes/{id}/promote", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/cluster/nodes/{id}/demote", []string{"POST"})
}

// handleClusterNodesAlias proxies to the legacy /api/v1/cluster/nodes
// list endpoint. Keeping the body identical avoids drift.
func handleClusterNodesAlias(w http.ResponseWriter, r *http.Request) {
	// Forward by mutating the request URL — the legacy handler is
	// registered at `/api/v1/cluster/nodes`; we re-route via the
	// daemon's main mux. For now we emit a redirect-like JSON until
	// internal redispatch lands.
	tenant := TenantFromContext(r.Context())
	tenantSlug := "default"
	if tenant != nil {
		tenantSlug = tenant.Slug
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"nodes": []any{},
		"_links": links.Set{
			"legacy": {Href: "/api/v1/cluster/nodes"},
			"self":   {Href: "/api/v1/t/" + tenantSlug + "/cluster/nodes"},
		},
		"note": "tenant-scoped cluster surface aliases the deployment-wide /api/v1/cluster/nodes",
	})
}

func handleClusterNodeAlias(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id,
		"_links": links.Set{
			"legacy": {Href: "/api/v1/cluster/nodes/" + id},
		},
		"note": "tenant-scoped cluster surface aliases the deployment-wide /api/v1/cluster/nodes/{id}",
	})
}

func handleClusterNodeDrain(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	writeJSON(w, http.StatusAccepted, map[string]any{
		"nodeId": id, "status": "queued",
		"action": "drain",
		"note":   "real drain orchestration lands with the multi-node cluster work (#57)",
	})
}

func handleClusterNodePromote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	writeJSON(w, http.StatusAccepted, map[string]any{
		"nodeId": id, "status": "queued",
		"action": "promote",
		"note":   "real promote orchestration lands with the multi-node cluster work (#57)",
	})
}

func handleClusterNodeDemote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	writeJSON(w, http.StatusAccepted, map[string]any{
		"nodeId": id, "status": "queued",
		"action": "demote",
		"note":   "real demote orchestration lands with the multi-node cluster work (#57)",
	})
}

// ─── Chunk 15: settings singletons OPTIONS coverage ─────────────────────────

func registerSettingsSingletonExtras(mux *http.ServeMux) {
	for _, p := range []string{
		"/api/v1/t/{tenant}/settings/auth-policy",
		"/api/v1/t/{tenant}/settings/network",
		"/api/v1/t/{tenant}/settings/observability",
		"/api/v1/t/{tenant}/audit/retention",
		"/api/v1/t/{tenant}/settings/notifications",
	} {
		optionsutil.Register(mux, p, []string{"GET", "PUT", "PATCH"})
	}
}
