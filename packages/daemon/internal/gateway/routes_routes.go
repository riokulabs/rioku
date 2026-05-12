// Package gateway: tenant-scoped Routes REST endpoints.
//
//	OPTIONS  /api/v1/t/{tenant}/routes                    discovery
//	GET      /api/v1/t/{tenant}/routes                    list                  route:read
//	POST     /api/v1/t/{tenant}/routes                    create                route:write
//	OPTIONS  /api/v1/t/{tenant}/routes/{id}               discovery
//	GET      /api/v1/t/{tenant}/routes/{id}               detail                route:read
//	PUT      /api/v1/t/{tenant}/routes/{id}               replace               route:write
//	PATCH    /api/v1/t/{tenant}/routes/{id}               partial               route:write
//	DELETE   /api/v1/t/{tenant}/routes/{id}               delete                route:delete
//	POST     /api/v1/t/{tenant}/routes/{id}/policies/{policyId}                  policy:attach
//	DELETE   /api/v1/t/{tenant}/routes/{id}/policies/{policyId}                  policy:detach
//	GET      /api/v1/t/{tenant}/routes/{id}/policies        list attached         route:read
//
// Policy attach/detach surface the existing `AttachPolicy` /
// `DetachPolicy` storage methods so the admin panel can manage route
// ↔ policy bindings without bulk-uploading the whole route record.
package gateway

import (
	"net/http"
	"strings"

	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/proto"
)

// RegisterRoutesRoutes wires the tenant-scoped routes REST surface.
func RegisterRoutesRoutes(mux *http.ServeMux, st store.Driver) {
	list := RequirePermission("route:read")(rerr.H(handleListRoutes(st)))
	create := RequirePermission("route:write")(rerr.H(handleCreateRoute(st)))
	get := RequirePermission("route:read")(rerr.H(handleGetRoute(st)))
	update := RequirePermission("route:write")(rerr.H(handleUpdateRouteREST(st)))
	del := RequirePermission("route:delete")(rerr.H(handleDeleteRouteREST(st)))
	listPolicies := RequirePermission("route:read")(rerr.H(handleListPoliciesByRoute(st)))
	attachPolicy := RequirePermission("policy:attach")(rerr.H(handleAttachPolicyToRoute(st)))
	detachPolicy := RequirePermission("policy:attach")(rerr.H(handleDetachPolicyFromRoute(st)))

	mux.Handle("GET /api/v1/t/{tenant}/routes", list)
	mux.Handle("POST /api/v1/t/{tenant}/routes", create)
	mux.Handle("GET /api/v1/t/{tenant}/routes/{id}", get)
	mux.Handle("PUT /api/v1/t/{tenant}/routes/{id}", update)
	mux.Handle("PATCH /api/v1/t/{tenant}/routes/{id}", update)
	mux.Handle("DELETE /api/v1/t/{tenant}/routes/{id}", del)
	mux.Handle("GET /api/v1/t/{tenant}/routes/{id}/policies", listPolicies)
	mux.Handle("POST /api/v1/t/{tenant}/routes/{id}/policies/{policyId}", attachPolicy)
	mux.Handle("DELETE /api/v1/t/{tenant}/routes/{id}/policies/{policyId}", detachPolicy)

	optionsutil.Register(mux, "/api/v1/t/{tenant}/routes",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/routes/{id}",
		[]string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/routes/{id}/policies",
		[]string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/routes/{id}/policies/{policyId}",
		[]string{"POST", "DELETE"})
}

// routeDTO mirrors serviceDTO — protojson rendering of the proto
// message merged with `_links` for navigation.
type routeDTO map[string]any

func routeToDTO(rt *riokuv1.Route, b *links.Builder) routeDTO {
	dto := protoToMap(rt)
	dto["_links"] = links.Set{
		"self":     b.Self("routes", rt.GetId()),
		"policies": b.Sub("routes", rt.GetId(), "policies"),
	}
	if t, ok := rt.GetTarget().(*riokuv1.Route_ServiceId); ok && t.ServiceId != "" {
		(dto["_links"].(links.Set))["service"] = b.Self("services", t.ServiceId)
	}
	return dto
}

func handleListRoutes(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		all, err := tx.ListRoutes(r.Context())
		if err != nil {
			return rerr.Wrap(err, "list routes")
		}
		b := links.NewTenantBuilder(tenant.Slug)
		out := make([]routeDTO, 0, len(all))
		for _, rt := range all {
			out = append(out, routeToDTO(rt, b))
		}
		return rerr.JSON(w, map[string]any{
			"items":  out,
			"total":  len(out),
			"_links": links.Set{"self": b.Collection("routes")},
		})
	}
}

func handleCreateRoute(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var rt riokuv1.Route
		if err := unmarshalProtoJSON(r.Body, &rt); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body: " + err.Error()})
		}
		if strings.TrimSpace(rt.GetName()) == "" {
			return rerr.Validation(map[string]string{"name": "name is required"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		created, err := tx.CreateRoute(r.Context(), &rt)
		if err != nil {
			_ = tx.Rollback()
			return rerr.Wrap(err, "create route")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, routeToDTO(created, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleGetRoute(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		rt, err := tx.GetRoute(r.Context(), id)
		if err != nil {
			return rerr.NotFound("route", id)
		}
		return rerr.JSON(w, routeToDTO(rt, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleUpdateRouteREST(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		var rt *riokuv1.Route
		if r.Method == http.MethodPatch {
			existing, err := tx.GetRoute(r.Context(), id)
			if err != nil {
				_ = tx.Rollback()
				return rerr.NotFound("route", id)
			}
			// protojson.Unmarshal clears its destination, so decode the
			// patch into a fresh message and proto.Merge onto existing.
			// This preserves the route's `target` oneof + matchers
			// when the body only changes scalar fields like `name`.
			patch := &riokuv1.Route{}
			if err := unmarshalProtoJSON(r.Body, patch); err != nil {
				_ = tx.Rollback()
				return rerr.Validation(map[string]string{"body": "invalid JSON body: " + err.Error()})
			}
			proto.Merge(existing, patch)
			rt = existing
		} else {
			rt = &riokuv1.Route{}
			if err := unmarshalProtoJSON(r.Body, rt); err != nil {
				_ = tx.Rollback()
				return rerr.Validation(map[string]string{"body": "invalid JSON body: " + err.Error()})
			}
		}
		rt.Id = id

		updated, err := tx.UpdateRoute(r.Context(), rt)
		if err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				return rerr.NotFound("route", id)
			}
			// Surface the underlying detail so the admin panel /
			// CLI can see WHY the update failed (invalid matchers,
			// dangling target, etc.). The error class is unprocessable
			// rather than internal because the caller's payload is at
			// fault.
			return rerr.Validation(map[string]string{"body": err.Error()})
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, routeToDTO(updated, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleDeleteRouteREST(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		_ = TenantFromContext(r.Context())
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		if err := tx.DeleteRoute(r.Context(), id); err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				return rerr.NotFound("route", id)
			}
			return rerr.Wrap(err, "delete route")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// handleListPoliciesByRoute returns the access-policy IDs bound to a
// route via the policy_bindings table.
func handleListPoliciesByRoute(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		routeID := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		ids, err := tx.ListPoliciesByTarget(r.Context(), "route", routeID)
		if err != nil {
			return rerr.Wrap(err, "list policies by target")
		}
		b := links.NewTenantBuilder(tenant.Slug)
		items := make([]map[string]any, 0, len(ids))
		for _, id := range ids {
			items = append(items, map[string]any{
				"id": id,
				"_links": links.Set{
					"policy": b.Self("policies", id),
				},
			})
		}
		return rerr.JSON(w, map[string]any{
			"items": items,
			"total": len(items),
			"_links": links.Set{
				"self":  b.Sub("routes", routeID, "policies"),
				"route": b.Self("routes", routeID),
			},
		})
	}
}

func handleAttachPolicyToRoute(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		routeID := r.PathValue("id")
		policyID := r.PathValue("policyId")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		if err := tx.AttachPolicy(r.Context(), policyID, "route", routeID); err != nil {
			_ = tx.Rollback()
			return rerr.Wrap(err, "attach policy")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		b := links.NewTenantBuilder(tenant.Slug)
		return rerr.JSONStatus(w, http.StatusCreated, map[string]any{
			"routeId":  routeID,
			"policyId": policyID,
			"_links": links.Set{
				"route":  b.Self("routes", routeID),
				"policy": b.Self("policies", policyID),
			},
		})
	}
}

func handleDetachPolicyFromRoute(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		_ = TenantFromContext(r.Context())
		routeID := r.PathValue("id")
		policyID := r.PathValue("policyId")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		if err := tx.DetachPolicy(r.Context(), policyID, "route", routeID); err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				return rerr.NotFound("policy_binding", policyID)
			}
			return rerr.Wrap(err, "detach policy")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}
