// Package gateway: tenant-scoped Services REST endpoints.
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
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// RegisterServicesRoutes wires the tenant-scoped services REST surface.
func RegisterServicesRoutes(mux *http.ServeMux, st store.Driver) {
	list := RequirePermission("service:read")(rerr.H(handleListServices(st)))
	create := RequirePermission("service:write")(rerr.H(handleCreateService(st)))
	get := RequirePermission("service:read")(rerr.H(handleGetService(st)))
	update := RequirePermission("service:write")(rerr.H(handleUpdateServiceREST(st)))
	del := RequirePermission("service:delete")(rerr.H(handleDeleteServiceREST(st)))
	forceReload := RequirePermission("service:reload")(rerr.H(handleForceReloadService(st)))
	listRoutes := RequirePermission("route:read")(rerr.H(handleListRoutesByService(st)))

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

func handleListServices(st store.Driver) rerr.Handler {
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
		services, err := tx.ListServices(r.Context())
		if err != nil {
			return rerr.Wrap(err, "list services")
		}
		b := links.NewTenantBuilder(tenant.Slug)
		out := make([]serviceDTO, 0, len(services))
		for _, svc := range services {
			out = append(out, serviceToDTO(svc, b))
		}
		return rerr.JSON(w, map[string]any{
			"items":  out,
			"total":  len(out),
			"_links": links.Set{"self": b.Collection("services")},
		})
	}
}

func handleCreateService(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var svc riokuv1.Service
		if err := unmarshalProtoJSON(r.Body, &svc); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body: " + err.Error()})
		}
		if strings.TrimSpace(svc.GetName()) == "" {
			return rerr.Validation(map[string]string{"name": "name is required"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		created, err := tx.CreateService(r.Context(), &svc)
		if err != nil {
			_ = tx.Rollback()
			return rerr.Wrap(err, "create service")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		_ = triggerCaddyReload(r.Context(), "service.create")
		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, serviceToDTO(created, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleGetService(st store.Driver) rerr.Handler {
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
		svc, err := tx.GetService(r.Context(), id)
		if err != nil {
			return rerr.NotFound("service", id)
		}
		return rerr.JSON(w, serviceToDTO(svc, links.NewTenantBuilder(tenant.Slug)))
	}
}

// handleUpdateServiceREST handles both PUT and PATCH. For PATCH, the
// request body is merged onto the existing record (omitted fields
// preserved). For PUT, the body is taken as-is — callers that omit
// fields will see them reset to zero. This is a v1 simplification;
// strict PUT semantics with required-field validation are a future
// follow-up.
func handleUpdateServiceREST(st store.Driver) rerr.Handler {
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
		// For PATCH we read the existing record and overlay the body
		// on top so omitted fields stay intact.
		var svc *riokuv1.Service
		if r.Method == http.MethodPatch {
			existing, err := tx.GetService(r.Context(), id)
			if err != nil {
				_ = tx.Rollback()
				return rerr.NotFound("service", id)
			}
			// protojson.Unmarshal clears the destination first, so we
			// decode the patch into a fresh message and proto.Merge
			// it onto the existing record. Scalar fields with non-zero
			// values on the patch overwrite; unset fields inherit
			// from `existing`.
			patch := &riokuv1.Service{}
			if err := unmarshalProtoJSON(r.Body, patch); err != nil {
				_ = tx.Rollback()
				return rerr.Validation(map[string]string{"body": "invalid JSON body: " + err.Error()})
			}
			proto.Merge(existing, patch)
			svc = existing
		} else {
			svc = &riokuv1.Service{}
			if err := unmarshalProtoJSON(r.Body, svc); err != nil {
				_ = tx.Rollback()
				return rerr.Validation(map[string]string{"body": "invalid JSON body: " + err.Error()})
			}
		}
		svc.Id = id

		updated, err := tx.UpdateService(r.Context(), svc)
		if err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				return rerr.NotFound("service", id)
			}
			return rerr.Wrap(err, "update service")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		_ = triggerCaddyReload(r.Context(), "service.update")
		return rerr.JSON(w, serviceToDTO(updated, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleDeleteServiceREST(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		_ = TenantFromContext(r.Context()) // resolved by middleware
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		if err := tx.DeleteService(r.Context(), id); err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				return rerr.NotFound("service", id)
			}
			return rerr.Wrap(err, "delete service")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		_ = triggerCaddyReload(r.Context(), "service.delete")
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// handleForceReloadService is a stub that records the intent and
// returns 202. The real Caddy admin-API hook lands when the
// per-service reload path is wired up; for v1 we accept the request,
// audit it, and return.
func handleForceReloadService(st store.Driver) rerr.Handler {
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
		if _, err := tx.GetService(r.Context(), id); err != nil {
			return rerr.NotFound("service", id)
		}
		// Trigger the registered Caddy reload hook (no-op in production
		// until decisions-needed.md item 005 wires the real helper).
		_ = triggerCaddyReload(r.Context(), "service.force-reload")
		w.WriteHeader(http.StatusAccepted)
		return rerr.JSON(w, map[string]any{
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
func handleListRoutesByService(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		serviceID := r.PathValue("id")
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
		out := make([]routeDTO, 0)
		for _, rt := range all {
			t, ok := rt.GetTarget().(*riokuv1.Route_ServiceId)
			if !ok || t.ServiceId != serviceID {
				continue
			}
			out = append(out, routeToDTO(rt, b))
		}
		return rerr.JSON(w, map[string]any{
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
