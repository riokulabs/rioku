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
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/proto"
)

// RegisterRoutesRoutes wires the tenant-scoped routes REST surface.
func RegisterRoutesRoutes(mux *http.ServeMux, st store.Driver) {
	list := RequirePermission("route:read")(http.HandlerFunc(handleListRoutes(st)))
	create := RequirePermission("route:write")(http.HandlerFunc(handleCreateRoute(st)))
	get := RequirePermission("route:read")(http.HandlerFunc(handleGetRoute(st)))
	update := RequirePermission("route:write")(http.HandlerFunc(handleUpdateRouteREST(st)))
	del := RequirePermission("route:delete")(http.HandlerFunc(handleDeleteRouteREST(st)))
	listPolicies := RequirePermission("route:read")(http.HandlerFunc(handleListPoliciesByRoute(st)))
	attachPolicy := RequirePermission("policy:attach")(http.HandlerFunc(handleAttachPolicyToRoute(st)))
	detachPolicy := RequirePermission("policy:attach")(http.HandlerFunc(handleDetachPolicyFromRoute(st)))

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

func handleListRoutes(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		all, err := tx.ListRoutes(r.Context())
		if err != nil {
			writeInternalError(w, r, "list routes")
			return
		}
		b := links.NewTenantBuilder(tenant.Slug)
		out := make([]routeDTO, 0, len(all))
		for _, rt := range all {
			out = append(out, routeToDTO(rt, b))
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":  out,
			"total":  len(out),
			"_links": links.Set{"self": b.Collection("routes")},
		})
	}
}

func handleCreateRoute(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var rt riokuv1.Route
		if err := unmarshalProtoJSON(r.Body, &rt); err != nil {
			writeBadRequest(w, r, "invalid JSON body: "+err.Error())
			return
		}
		if strings.TrimSpace(rt.GetName()) == "" {
			writeBadRequest(w, r, "name is required")
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		created, err := tx.CreateRoute(r.Context(), &rt)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "create route")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, routeToDTO(created, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleGetRoute(st store.Driver) http.HandlerFunc {
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
		rt, err := tx.GetRoute(r.Context(), id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Route not found",
				"No route with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, routeToDTO(rt, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleUpdateRouteREST(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		var rt *riokuv1.Route
		if r.Method == http.MethodPatch {
			existing, err := tx.GetRoute(r.Context(), id)
			if err != nil {
				_ = tx.Rollback()
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Route not found",
					"No route with id "+id, r.URL.Path, nil)
				return
			}
			// protojson.Unmarshal clears its destination, so decode the
			// patch into a fresh message and proto.Merge onto existing.
			// This preserves the route's `target` oneof + matchers
			// when the body only changes scalar fields like `name`.
			patch := &riokuv1.Route{}
			if err := unmarshalProtoJSON(r.Body, patch); err != nil {
				_ = tx.Rollback()
				writeBadRequest(w, r, "invalid JSON body: "+err.Error())
				return
			}
			proto.Merge(existing, patch)
			rt = existing
		} else {
			rt = &riokuv1.Route{}
			if err := unmarshalProtoJSON(r.Body, rt); err != nil {
				_ = tx.Rollback()
				writeBadRequest(w, r, "invalid JSON body: "+err.Error())
				return
			}
		}
		rt.Id = id

		updated, err := tx.UpdateRoute(r.Context(), rt)
		if err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Route not found",
					"No route with id "+id, r.URL.Path, nil)
				return
			}
			// Surface the underlying detail so the admin panel /
			// CLI can see WHY the update failed (invalid matchers,
			// dangling target, etc.). The error class is unprocessable
			// rather than internal because the caller's payload is at
			// fault.
			writeProblem(w, http.StatusUnprocessableEntity, errTypeUnprocess,
				"Update failed", err.Error(), r.URL.Path, nil)
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, routeToDTO(updated, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleDeleteRouteREST(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = TenantFromContext(r.Context())
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		if err := tx.DeleteRoute(r.Context(), id); err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Route not found",
					"No route with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete route")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleListPoliciesByRoute returns the access-policy IDs bound to a
// route via the policy_bindings table.
func handleListPoliciesByRoute(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		routeID := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		ids, err := tx.ListPoliciesByTarget(r.Context(), "route", routeID)
		if err != nil {
			writeInternalError(w, r, "list policies by target")
			return
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
		writeJSON(w, http.StatusOK, map[string]any{
			"items": items,
			"total": len(items),
			"_links": links.Set{
				"self":  b.Sub("routes", routeID, "policies"),
				"route": b.Self("routes", routeID),
			},
		})
	}
}

func handleAttachPolicyToRoute(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		routeID := r.PathValue("id")
		policyID := r.PathValue("policyId")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		if err := tx.AttachPolicy(r.Context(), policyID, "route", routeID); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "attach policy")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		b := links.NewTenantBuilder(tenant.Slug)
		writeJSON(w, http.StatusCreated, map[string]any{
			"routeId":  routeID,
			"policyId": policyID,
			"_links": links.Set{
				"route":  b.Self("routes", routeID),
				"policy": b.Self("policies", policyID),
			},
		})
	}
}

func handleDetachPolicyFromRoute(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = TenantFromContext(r.Context())
		routeID := r.PathValue("id")
		policyID := r.PathValue("policyId")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		if err := tx.DetachPolicy(r.Context(), policyID, "route", routeID); err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Binding not found",
					"No binding between route "+routeID+" and policy "+policyID, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "detach policy")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
