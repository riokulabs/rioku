// Package gateway: Middleware REST endpoints (stage-2).
//
// "Middleware" here means a per-tenant reusable handler-stack
// component (rate-limit, auth, transform, cors, cache, logging,
// custom). These get attached to routes by id elsewhere.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterMiddlewareRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("GET /api/v1/t/{tenant}/middlewares",
		RequirePermission("middleware:read")(http.HandlerFunc(handleListMiddlewares(st))))
	mux.Handle("POST /api/v1/t/{tenant}/middlewares",
		RequirePermission("middleware:write")(http.HandlerFunc(handleCreateMiddleware(st))))
	mux.Handle("GET /api/v1/t/{tenant}/middlewares/{id}",
		RequirePermission("middleware:read")(http.HandlerFunc(handleGetMiddleware(st))))
	// PUT and PATCH share the underlying handler — both accept the
	// pointer-field updateMiddlewareRequest where omitted fields are
	// unchanged. See sites_routes for the rationale.
	mux.Handle("PUT /api/v1/t/{tenant}/middlewares/{id}",
		RequirePermission("middleware:write")(http.HandlerFunc(handleUpdateMiddleware(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/middlewares/{id}",
		RequirePermission("middleware:write")(http.HandlerFunc(handleUpdateMiddleware(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/middlewares/{id}",
		RequirePermission("middleware:delete")(http.HandlerFunc(handleDeleteMiddleware(st))))

	optionsutil.Register(mux, "/api/v1/t/{tenant}/middlewares",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/middlewares/{id}",
		[]string{"GET", "PUT", "PATCH", "DELETE"})
}

type middlewareResponse struct {
	ID        string          `json:"id"`
	TenantID  string          `json:"tenantId"`
	Name      string          `json:"name"`
	Kind      string          `json:"kind"`
	Config    json.RawMessage `json:"config"`
	Enabled   bool            `json:"enabled"`
	OrderHint int32           `json:"orderHint"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

func middlewareToResponse(m *store.Middleware) middlewareResponse {
	cfg := json.RawMessage(m.Config)
	if len(cfg) == 0 {
		cfg = json.RawMessage("{}")
	}
	return middlewareResponse{
		ID:        m.ID,
		TenantID:  m.TenantID,
		Name:      m.Name,
		Kind:      m.Kind,
		Config:    cfg,
		Enabled:   m.Enabled,
		OrderHint: m.OrderHint,
		CreatedAt: m.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: m.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type createMiddlewareRequest struct {
	Name      string          `json:"name"`
	Kind      string          `json:"kind"`
	Config    json.RawMessage `json:"config,omitempty"`
	Enabled   bool            `json:"enabled,omitempty"`
	OrderHint int32           `json:"orderHint,omitempty"`
}

type updateMiddlewareRequest struct {
	Name      *string          `json:"name,omitempty"`
	Kind      *string          `json:"kind,omitempty"`
	Config    *json.RawMessage `json:"config,omitempty"`
	Enabled   *bool            `json:"enabled,omitempty"`
	OrderHint *int32           `json:"orderHint,omitempty"`
}

func handleListMiddlewares(st store.Driver) http.HandlerFunc {
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
		mws, err := tx.ListMiddlewaresByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list middlewares")
			return
		}
		out := make([]middlewareResponse, 0, len(mws))
		for _, m := range mws {
			out = append(out, middlewareToResponse(m))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateMiddleware(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req createMiddlewareRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" || req.Kind == "" {
			writeBadRequest(w, r, "name and kind are required")
			return
		}
		cfg := string(req.Config)
		if cfg == "" {
			cfg = "{}"
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		created, err := tx.CreateMiddleware(r.Context(), &store.Middleware{
			TenantID:  tenant.ID,
			Name:      req.Name,
			Kind:      req.Kind,
			Config:    cfg,
			Enabled:   true,
			OrderHint: req.OrderHint,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMiddlewareNameTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict,
					"Name already in use",
					"A middleware with that name already exists in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create middleware")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, middlewareToResponse(created))
	}
}

func handleGetMiddleware(st store.Driver) http.HandlerFunc {
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
		m, err := tx.GetMiddleware(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrMiddlewareNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Middleware not found", "No middleware with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get middleware")
			return
		}
		writeJSON(w, http.StatusOK, middlewareToResponse(m))
	}
}

func handleUpdateMiddleware(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		var req updateMiddlewareRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		var cfgPtr *string
		if req.Config != nil {
			s := string(*req.Config)
			cfgPtr = &s
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		updated, err := tx.UpdateMiddleware(r.Context(), tenant.ID, id, store.UpdateMiddlewareParams{
			Name:      req.Name,
			Kind:      req.Kind,
			Config:    cfgPtr,
			Enabled:   req.Enabled,
			OrderHint: req.OrderHint,
		})
		if err != nil {
			_ = tx.Rollback()
			switch {
			case errors.Is(err, store.ErrMiddlewareNotFound):
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Middleware not found", "No middleware with id "+id, r.URL.Path, nil)
			case errors.Is(err, store.ErrMiddlewareNameTaken):
				writeProblem(w, http.StatusConflict, errTypeConflict,
					"Name already in use",
					"Another middleware already uses that name", r.URL.Path, nil)
			default:
				writeInternalError(w, r, "update middleware")
			}
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, middlewareToResponse(updated))
	}
}

func handleDeleteMiddleware(st store.Driver) http.HandlerFunc {
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
		if err := tx.DeleteMiddleware(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMiddlewareNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Middleware not found", "No middleware with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete middleware")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
