// Package gateway: dedicated reorder endpoint for the middleware stack
// attached to a route.
//
//	PUT /api/v1/t/{tenant}/routes/{id}/middlewares/order   route:write
//
// Body:    { "order": ["mw-id-1", "mw-id-2", ...] }
// Effect:  the route's `rioku.admin/middleware-ids` label is replaced with
//
//	the supplied comma-separated list. Order is preserved exactly as
//	provided. Duplicates are rejected. After commit, the Caddy reload
//	hook fires with reason "route.middlewares.reorder".
//
// We intentionally do NOT validate that each middleware id refers to an
// existing tenant middleware here — middlewares are a separate resource
// stream and the order list can be authored ahead of binding (UX uses a
// picker that is fed from `useMiddlewareList`, so the IDs the daemon
// receives are already real). The list endpoint will surface stale ids
// transparently if a middleware is deleted out from under the route.
package gateway

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// LabelMiddlewareIDs is the route label key that stores the ordered
// middleware-id list as a comma-separated string. Mirrors
// `LBL_MIDDLEWARE_IDS` in the admin panel adapter.
const LabelMiddlewareIDs = "rioku.admin/middleware-ids"

// RegisterRouteMiddlewareOrderRoutes wires the dedicated reorder endpoint.
// Call this alongside RegisterRoutesRoutes.
func RegisterRouteMiddlewareOrderRoutes(mux *http.ServeMux, st store.Driver) {
	reorder := RequirePermission("route:write")(rerr.H(handleReorderRouteMiddlewares(st)))
	mux.Handle("PUT /api/v1/t/{tenant}/routes/{id}/middlewares/order", reorder)

	optionsutil.Register(mux, "/api/v1/t/{tenant}/routes/{id}/middlewares/order",
		[]string{"PUT"})
}

type reorderMiddlewaresRequest struct {
	Order []string `json:"order"`
}

func handleReorderRouteMiddlewares(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "route id required"})
		}

		var body reorderMiddlewaresRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body: " + err.Error()})
		}

		// Reject duplicates — they would break the linear reorder
		// semantic and silently drop a middleware on the next read
		// because the label split filters empties only, not dups.
		seen := make(map[string]struct{}, len(body.Order))
		clean := make([]string, 0, len(body.Order))
		for _, mw := range body.Order {
			mw = strings.TrimSpace(mw)
			if mw == "" {
				continue
			}
			if _, dup := seen[mw]; dup {
				return rerr.Validation(map[string]string{"order": "duplicate middleware id: " + mw})
			}
			seen[mw] = struct{}{}
			clean = append(clean, mw)
		}

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		existing, err := tx.GetRoute(r.Context(), id)
		if err != nil {
			return rerr.NotFound("route", id)
		}

		if existing.GetLabels() == nil {
			existing.Labels = &riokuv1.Labels{Labels: map[string]string{}}
		}
		if existing.GetLabels().GetLabels() == nil {
			existing.Labels.Labels = map[string]string{}
		}
		if len(clean) == 0 {
			delete(existing.Labels.Labels, LabelMiddlewareIDs)
		} else {
			existing.Labels.Labels[LabelMiddlewareIDs] = strings.Join(clean, ",")
		}

		updated, err := tx.UpdateRoute(r.Context(), existing)
		if err != nil {
			return rerr.Wrap(err, "update route")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		_ = triggerCaddyReload(r.Context(), "route.middlewares.reorder")

		b := links.NewTenantBuilder(tenant.Slug)
		return rerr.JSON(w, map[string]any{
			"id":            updated.GetId(),
			"order":         clean,
			"middlewareIds": clean,
			"_links": links.Set{
				"self":  b.Sub("routes", updated.GetId(), "middlewares/order"),
				"route": b.Self("routes", updated.GetId()),
			},
		})
	}
}
