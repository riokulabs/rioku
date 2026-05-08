// Package gateway: tenant-scoped Services REST endpoints (stage-2).
//
//	OPTIONS  /api/v1/t/{tenant}/services                discovery
//	GET      /api/v1/t/{tenant}/services                list                       service:read
//	POST     /api/v1/t/{tenant}/services                create                     service:write
//	OPTIONS  /api/v1/t/{tenant}/services/{id}           discovery
//	GET      /api/v1/t/{tenant}/services/{id}           detail                     service:read
//	PUT      /api/v1/t/{tenant}/services/{id}           replace                    service:write
//	PATCH    /api/v1/t/{tenant}/services/{id}           partial update             service:write
//	DELETE   /api/v1/t/{tenant}/services/{id}           delete                     service:delete
//	POST     /api/v1/t/{tenant}/services/{id}/force-reload                          service:reload
//	GET      /api/v1/t/{tenant}/services/{id}/routes    routes targeting service   route:read
//
// `force-reload` triggers a re-sync of this service's Caddy admin
// block without rebuilding the whole config; used by the operator
// when upstream rotation has happened out-of-band.
package gateway

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// RegisterServicesRoutes wires the tenant-scoped services REST surface.
func RegisterServicesRoutes(mux *http.ServeMux, st store.Driver) {
	list := RequirePermission("service:read")(http.HandlerFunc(handleListServices(st)))
	create := RequirePermission("service:write")(http.HandlerFunc(handleCreateService(st)))
	get := RequirePermission("service:read")(http.HandlerFunc(handleGetService(st)))
	update := RequirePermission("service:write")(http.HandlerFunc(handleUpdateServiceREST(st)))
	del := RequirePermission("service:delete")(http.HandlerFunc(handleDeleteServiceREST(st)))
	forceReload := RequirePermission("service:reload")(http.HandlerFunc(handleForceReloadService(st)))
	listRoutes := RequirePermission("route:read")(http.HandlerFunc(handleListRoutesByService(st)))

	mux.Handle("GET /api/v1/t/{tenant}/services", list)
	mux.Handle("POST /api/v1/t/{tenant}/services", create)
	mux.Handle("GET /api/v1/t/{tenant}/services/{id}", get)
	mux.Handle("PUT /api/v1/t/{tenant}/services/{id}", update)
	mux.Handle("PATCH /api/v1/t/{tenant}/services/{id}", update)
	mux.Handle("DELETE /api/v1/t/{tenant}/services/{id}", del)
	mux.Handle("POST /api/v1/t/{tenant}/services/{id}/force-reload", forceReload)
	mux.Handle("GET /api/v1/t/{tenant}/services/{id}/routes", listRoutes)

	optionsutil.Register(mux, "/api/v1/t/{tenant}/services",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/services/{id}",
		[]string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/services/{id}/force-reload",
		[]string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/services/{id}/routes",
		[]string{"GET"})
}

// serviceDTO is the wire shape returned for a Service. We render the
// proto via protojson into a generic map and attach `_links` so the
// camelCase field names match what the OpenAPI spec advertises.
type serviceDTO map[string]any

func serviceToDTO(svc *riokuv1.Service, b *links.Builder) serviceDTO {
	dto := protoToMap(svc)
	dto["_links"] = links.Set{
		"self":         b.Self("services", svc.GetId()),
		"routes":       b.Sub("services", svc.GetId(), "routes"),
		"force-reload": b.Action("services", svc.GetId(), "force-reload"),
	}
	return dto
}

// protoToMap renders a proto message as a generic map via protojson
// so the response matches the OpenAPI / proto field naming (camelCase
// for nested message fields, lowercase enum values, RFC3339 for
// timestamps).
func protoToMap(m proto.Message) map[string]any {
	raw, err := protojson.MarshalOptions{
		UseProtoNames:   false,
		EmitUnpopulated: true,
	}.Marshal(m)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := protoUnmarshalToMap(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func handleListServices(st store.Driver) http.HandlerFunc {
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
		services, err := tx.ListServices(r.Context())
		if err != nil {
			writeInternalError(w, r, "list services")
			return
		}
		b := links.NewTenantBuilder(tenant.Slug)
		out := make([]serviceDTO, 0, len(services))
		for _, svc := range services {
			out = append(out, serviceToDTO(svc, b))
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":  out,
			"total":  len(out),
			"_links": links.Set{"self": b.Collection("services")},
		})
	}
}

func handleCreateService(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var svc riokuv1.Service
		if err := unmarshalProtoJSON(r.Body, &svc); err != nil {
			writeBadRequest(w, r, "invalid JSON body: "+err.Error())
			return
		}
		if strings.TrimSpace(svc.GetName()) == "" {
			writeBadRequest(w, r, "name is required")
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		created, err := tx.CreateService(r.Context(), &svc)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "create service")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		_ = triggerCaddyReload(r.Context(), "service.create")
		writeJSON(w, http.StatusCreated, serviceToDTO(created, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleGetService(st store.Driver) http.HandlerFunc {
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
		svc, err := tx.GetService(r.Context(), id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Service not found",
				"No service with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, serviceToDTO(svc, links.NewTenantBuilder(tenant.Slug)))
	}
}

// handleUpdateServiceREST handles both PUT and PATCH. For PATCH, the
// request body is merged onto the existing record (omitted fields
// preserved). For PUT, the body is taken as-is — callers that omit
// fields will see them reset to zero. This is a v1 simplification;
// strict PUT semantics with required-field validation are a future
// follow-up.
func handleUpdateServiceREST(st store.Driver) http.HandlerFunc {
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
		// For PATCH we read the existing record and overlay the body
		// on top so omitted fields stay intact.
		var svc *riokuv1.Service
		if r.Method == http.MethodPatch {
			existing, err := tx.GetService(r.Context(), id)
			if err != nil {
				_ = tx.Rollback()
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Service not found",
					"No service with id "+id, r.URL.Path, nil)
				return
			}
			// protojson.Unmarshal clears the destination first, so we
			// decode the patch into a fresh message and proto.Merge
			// it onto the existing record. Scalar fields with non-zero
			// values on the patch overwrite; unset fields inherit
			// from `existing`.
			patch := &riokuv1.Service{}
			if err := unmarshalProtoJSON(r.Body, patch); err != nil {
				_ = tx.Rollback()
				writeBadRequest(w, r, "invalid JSON body: "+err.Error())
				return
			}
			proto.Merge(existing, patch)
			svc = existing
		} else {
			svc = &riokuv1.Service{}
			if err := unmarshalProtoJSON(r.Body, svc); err != nil {
				_ = tx.Rollback()
				writeBadRequest(w, r, "invalid JSON body: "+err.Error())
				return
			}
		}
		svc.Id = id

		updated, err := tx.UpdateService(r.Context(), svc)
		if err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Service not found",
					"No service with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update service")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		_ = triggerCaddyReload(r.Context(), "service.update")
		writeJSON(w, http.StatusOK, serviceToDTO(updated, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleDeleteServiceREST(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = TenantFromContext(r.Context()) // resolved by middleware
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		if err := tx.DeleteService(r.Context(), id); err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Service not found",
					"No service with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete service")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		_ = triggerCaddyReload(r.Context(), "service.delete")
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleForceReloadService is a stub that records the intent and
// returns 202. The real Caddy admin-API hook lands when the
// per-service reload path is wired up; for v1 we accept the request,
// audit it, and return.
func handleForceReloadService(st store.Driver) http.HandlerFunc {
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
		if _, err := tx.GetService(r.Context(), id); err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Service not found",
				"No service with id "+id, r.URL.Path, nil)
			return
		}
		// Trigger the registered Caddy reload hook (no-op in production
		// until decisions-needed.md item 005 wires the real helper).
		_ = triggerCaddyReload(r.Context(), "service.force-reload")
		writeJSON(w, http.StatusAccepted, map[string]any{
			"id":     id,
			"status": "queued",
			"_links": links.Set{
				"service": links.NewTenantBuilder(tenant.Slug).Self("services", id),
			},
		})
	}
}

// handleListRoutesByService returns every route whose target_service_id
// is the path's service id.
func handleListRoutesByService(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		serviceID := r.PathValue("id")
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
		out := make([]routeDTO, 0)
		for _, rt := range all {
			t, ok := rt.GetTarget().(*riokuv1.Route_ServiceId)
			if !ok || t.ServiceId != serviceID {
				continue
			}
			out = append(out, routeToDTO(rt, b))
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": out,
			"total": len(out),
			"_links": links.Set{
				"self":    b.Sub("services", serviceID, "routes"),
				"service": b.Self("services", serviceID),
			},
		})
	}
}

// unmarshalProtoJSON decodes a JSON body into the supplied proto
// message via protojson so enum / well-known-type / oneof fields land
// where the proto definitions expect them.
func unmarshalProtoJSON(body io.Reader, dst proto.Message) error {
	raw, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	return protojson.UnmarshalOptions{DiscardUnknown: true}.Unmarshal(raw, dst)
}

// protoUnmarshalToMap is the inverse of protoToMap — used internally
// by serviceToDTO/routeToDTO to project a proto-encoded JSON blob into
// a generic map[string]any so handlers can attach `_links` before
// the response is written.
func protoUnmarshalToMap(raw []byte, dst *map[string]any) error {
	if len(raw) == 0 {
		*dst = map[string]any{}
		return nil
	}
	return json.Unmarshal(raw, dst)
}
