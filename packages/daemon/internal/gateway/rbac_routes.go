package gateway

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterRBACRoutes registers the RBAC management endpoints (roles,
// permissions, and user-role assignments) on the mux.
func RegisterRBACRoutes(mux *http.ServeMux, st store.Driver) {
	// Roles.
	mux.Handle("GET /api/v1/roles", RequirePermission("roles:read")(http.HandlerFunc(handleListRoles(st))))
	mux.Handle("POST /api/v1/roles", RequirePermission("roles:manage")(http.HandlerFunc(handleCreateRole(st))))
	mux.Handle("GET /api/v1/roles/{id}", RequirePermission("roles:read")(http.HandlerFunc(handleGetRole(st))))
	mux.Handle("PATCH /api/v1/roles/{id}", RequirePermission("roles:manage")(http.HandlerFunc(handleUpdateRole(st))))
	mux.Handle("DELETE /api/v1/roles/{id}", RequirePermission("roles:manage")(http.HandlerFunc(handleDeleteRole(st))))

	// Permissions.
	mux.Handle("GET /api/v1/permissions", RequirePermission("roles:read")(http.HandlerFunc(handleListPermissions(st))))

	// User role management.
	mux.Handle("GET /api/v1/users/{id}/roles", RequirePermission("users:read")(http.HandlerFunc(handleListUserRoles(st))))
	mux.Handle("POST /api/v1/users/{id}/roles", RequirePermission("users:manage")(http.HandlerFunc(handleAssignRole(st))))
	mux.Handle("DELETE /api/v1/users/{id}/roles/{roleId}", RequirePermission("users:manage")(http.HandlerFunc(handleRevokeRole(st))))
}

// ---------------------------------------------------------------------------
// Role CRUD
// ---------------------------------------------------------------------------

type roleResponse struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsBuiltin   bool     `json:"isBuiltin"`
	Permissions []string `json:"permissions"`
}

func toRoleResponse(role *store.Role) roleResponse {
	perms := role.Permissions
	if perms == nil {
		perms = []string{}
	}
	return roleResponse{
		ID:          role.ID,
		Name:        role.Name,
		Description: role.Description,
		IsBuiltin:   role.IsBuiltin,
		Permissions: perms,
	}
}

func handleListRoles(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		roles, err := tx.ListRoles(ctx)
		if err != nil {
			writeInternalError(w, r, "list roles")
			return
		}

		result := make([]roleResponse, 0, len(roles))
		for _, role := range roles {
			result = append(result, toRoleResponse(role))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}
}

type createRoleRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

func handleCreateRole(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req createRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON", r.URL.Path, nil)
			return
		}

		if req.Name == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Role name is required", r.URL.Path, []ValidationError{
					{Field: "name", Reason: "must not be empty"},
				})
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		role, err := tx.CreateRole(ctx, store.CreateRoleParams{
			ID:          uuid.New().String(),
			Name:        req.Name,
			Description: req.Description,
			Permissions: req.Permissions,
		})
		if err != nil {
			writeInternalError(w, r, "create role")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toRoleResponse(role))
	}
}

func handleGetRole(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Role ID is required", r.URL.Path, nil)
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		role, err := tx.GetRole(ctx, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Role not found",
				"No role exists with the given ID", r.URL.Path, nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toRoleResponse(role))
	}
}

type updateRoleRequest struct {
	Name        *string  `json:"name"`
	Description *string  `json:"description"`
	AddPerms    []string `json:"addPermissions"`
	RemovePerms []string `json:"removePermissions"`
}

func handleUpdateRole(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Role ID is required", r.URL.Path, nil)
			return
		}

		var req updateRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON", r.URL.Path, nil)
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		role, err := tx.UpdateRole(ctx, id, store.UpdateRoleParams{
			Name:        req.Name,
			Description: req.Description,
			AddPerms:    req.AddPerms,
			RemovePerms: req.RemovePerms,
		})
		if err != nil {
			if err == store.ErrRoleImmutable {
				writeProblem(w, http.StatusForbidden, errTypeForbidden, "Role immutable",
					"The superadmin role cannot be modified", r.URL.Path, nil)
				return
			}
			if err == store.ErrRoleNotFound {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Role not found",
					"No role exists with the given ID", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update role")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toRoleResponse(role))
	}
}

func handleDeleteRole(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Role ID is required", r.URL.Path, nil)
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.DeleteRole(ctx, id); err != nil {
			if err == store.ErrRoleImmutable {
				writeProblem(w, http.StatusForbidden, errTypeForbidden, "Role immutable",
					"The superadmin role cannot be deleted", r.URL.Path, nil)
				return
			}
			if err == store.ErrRoleNotFound {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Role not found",
					"No role exists with the given ID", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete role")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

type permissionResponse struct {
	ID          string `json:"id"`
	Resource    string `json:"resource"`
	Action      string `json:"action"`
	Description string `json:"description"`
}

func handleListPermissions(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		perms, err := tx.ListPermissions(ctx)
		if err != nil {
			writeInternalError(w, r, "list permissions")
			return
		}

		result := make([]permissionResponse, 0, len(perms))
		for _, p := range perms {
			result = append(result, permissionResponse{
				ID:          p.ID,
				Resource:    p.Resource,
				Action:      p.Action,
				Description: p.Description,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}
}

// ---------------------------------------------------------------------------
// User-role management
// ---------------------------------------------------------------------------

type userRoleResponse struct {
	RoleID    string `json:"roleId"`
	RoleName  string `json:"roleName"`
	GrantedBy string `json:"grantedBy,omitempty"`
	GrantedAt string `json:"grantedAt"`
}

func handleListUserRoles(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID := r.PathValue("id")
		if userID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"User ID is required", r.URL.Path, nil)
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		roles, err := tx.ListUserRoles(ctx, userID)
		if err != nil {
			writeInternalError(w, r, "list user roles")
			return
		}

		result := make([]userRoleResponse, 0, len(roles))
		for _, ur := range roles {
			result = append(result, userRoleResponse{
				RoleID:    ur.RoleID,
				RoleName:  ur.RoleName,
				GrantedBy: ur.GrantedBy,
				GrantedAt: ur.GrantedAt.Format("2006-01-02T15:04:05Z"),
			})
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}
}

type assignRoleRequest struct {
	RoleID string `json:"roleId"`
}

func handleAssignRole(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		userID := r.PathValue("id")
		if userID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"User ID is required", r.URL.Path, nil)
			return
		}

		var req assignRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON with a 'role_id' field", r.URL.Path, nil)
			return
		}

		if req.RoleID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Role ID is required", r.URL.Path, []ValidationError{
					{Field: "role_id", Reason: "must not be empty"},
				})
			return
		}

		// Determine the actor (who is granting the role).
		grantedBy := resolveActorID(r)

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.AssignRole(ctx, userID, req.RoleID, grantedBy); err != nil {
			writeInternalError(w, r, "assign role")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

func handleRevokeRole(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID := r.PathValue("id")
		roleID := r.PathValue("roleId")
		if userID == "" || roleID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"User ID and role ID are required", r.URL.Path, nil)
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.RevokeRole(ctx, userID, roleID); err != nil {
			writeInternalError(w, r, "revoke role")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// resolveActorID extracts the authenticated user's ID from the request context.
func resolveActorID(r *http.Request) string {
	if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil {
		return sc.UserID
	}
	if c := auth.ClaimsFromContext(r.Context()); c != nil {
		return c.Subject
	}
	return ""
}
