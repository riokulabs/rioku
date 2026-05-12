package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/store/audit"
)

// RegisterRBACRoutes registers the RBAC management endpoints (roles,
// permissions, and user-role assignments). Both legacy `/api/v1/roles`
// and tenant-scoped `/api/v1/t/{tenant}/roles` paths are exposed;
// storage's `tenant_id IS NULL OR tenant_id = ?` filter keeps built-in
// roles visible from every tenant alongside tenant-scoped custom ones.
func RegisterRBACRoutes(mux *http.ServeMux, st store.Driver) {
	listRolesH := RequirePermission("roles:read")(http.HandlerFunc(handleListRoles(st)))
	createRoleH := RequirePermission("roles:manage")(http.HandlerFunc(handleCreateRole(st)))
	getRoleH := RequirePermission("roles:read")(http.HandlerFunc(handleGetRole(st)))
	updateRoleH := RequirePermission("roles:manage")(http.HandlerFunc(handleUpdateRole(st)))
	deleteRoleH := RequirePermission("roles:manage")(http.HandlerFunc(handleDeleteRole(st)))
	listPermsH := RequirePermission("roles:read")(http.HandlerFunc(handleListPermissions(st)))
	listUserRolesH := RequirePermission("users:read")(http.HandlerFunc(handleListUserRoles(st)))
	assignRoleH := RequirePermission("users:manage")(http.HandlerFunc(handleAssignRole(st)))
	revokeRoleH := RequirePermission("users:manage")(http.HandlerFunc(handleRevokeRole(st)))

	for _, base := range []string{"/api/v1", "/api/v1/t/{tenant}"} {
		mux.Handle("GET "+base+"/roles", listRolesH)
		mux.Handle("POST "+base+"/roles", createRoleH)
		mux.Handle("GET "+base+"/roles/{id}", getRoleH)
		mux.Handle("PATCH "+base+"/roles/{id}", updateRoleH)
		mux.Handle("PUT "+base+"/roles/{id}", updateRoleH)
		mux.Handle("DELETE "+base+"/roles/{id}", deleteRoleH)

		mux.Handle("GET "+base+"/permissions", listPermsH)

		mux.Handle("GET "+base+"/users/{id}/roles", listUserRolesH)
		mux.Handle("POST "+base+"/users/{id}/roles", assignRoleH)
		mux.Handle("DELETE "+base+"/users/{id}/roles/{roleId}", revokeRoleH)

		optionsutil.Register(mux, base+"/roles", []string{"GET", "POST"})
		optionsutil.Register(mux, base+"/roles/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})
		optionsutil.Register(mux, base+"/permissions", []string{"GET"})
		optionsutil.Register(mux, base+"/users/{id}/roles", []string{"GET", "POST"})
		optionsutil.Register(mux, base+"/users/{id}/roles/{roleId}", []string{"DELETE"})
	}
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
	UserCount   *int     `json:"userCount,omitempty"`
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

		// OpenAPI declares this endpoint returns
		// `{roles: [...], nextPageToken: ""}` (see ListRoles200 in
		// packages/proto/gen/openapi). Returning a bare array made the
		// admin SPA's `useRoleList` read `data.data.roles` and silently
		// resolve to `undefined → []`, so the Roles page rendered
		// "No roles" on every tenant. Pagination is not implemented yet
		// — emit an empty `nextPageToken` placeholder.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"roles":         result,
			"nextPageToken": "",
		})
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

		// Role-escalation guard (#117/#187). Reject grants that exceed
		// the actor's own effective permission set and audit the rejection
		// in the same tx so the trail commits even though the role does
		// not.
		if err := store.ValidateNoEscalation(actorPermissions(r), req.Permissions); err != nil {
			actorID := resolveActorID(r)
			offending := offendingPermission(err)
			if auditErr := emitRoleEscalationAudit(ctx, tx, actorID, "", req.Name, offending, "create"); auditErr != nil {
				writeInternalError(w, r, "audit role escalation")
				return
			}
			if commitErr := tx.Commit(); commitErr != nil {
				writeInternalError(w, r, "commit audit")
				return
			}
			writeProblem(w, http.StatusForbidden, errTypeForbidden, "Role escalation rejected",
				"Cannot grant permission '"+offending+"' that exceeds the actor's effective permission set",
				r.URL.Path, nil)
			return
		}

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

		userIDs, err := tx.ListUsersWithRole(ctx, id)
		if err != nil {
			writeInternalError(w, r, "list users with role")
			return
		}

		resp := toRoleResponse(role)
		count := len(userIDs)
		resp.UserCount = &count

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
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

		// Role-escalation guard (#117/#187). Only AddPerms is checked —
		// removing permissions doesn't escalate. RemovePerms therefore
		// passes through unchecked.
		if len(req.AddPerms) > 0 {
			if err := store.ValidateNoEscalation(actorPermissions(r), req.AddPerms); err != nil {
				actorID := resolveActorID(r)
				offending := offendingPermission(err)
				targetName := ""
				if req.Name != nil {
					targetName = *req.Name
				}
				if auditErr := emitRoleEscalationAudit(ctx, tx, actorID, id, targetName, offending, "update"); auditErr != nil {
					writeInternalError(w, r, "audit role escalation")
					return
				}
				if commitErr := tx.Commit(); commitErr != nil {
					writeInternalError(w, r, "commit audit")
					return
				}
				writeProblem(w, http.StatusForbidden, errTypeForbidden, "Role escalation rejected",
					"Cannot grant permission '"+offending+"' that exceeds the actor's effective permission set",
					r.URL.Path, nil)
				return
			}
		}

		role, err := tx.UpdateRole(ctx, id, store.UpdateRoleParams{
			Name:        req.Name,
			Description: req.Description,
			AddPerms:    req.AddPerms,
			RemovePerms: req.RemovePerms,
		})
		if err != nil {
			if errors.Is(err, store.ErrRoleEscalation) {
				// Defensive: the store can also raise escalation if the
				// caller bypassed our pre-check (e.g. fields composed
				// during a follow-on Tx mutation).
				actorID := resolveActorID(r)
				offending := offendingPermission(err)
				targetName := ""
				if req.Name != nil {
					targetName = *req.Name
				}
				if auditErr := emitRoleEscalationAudit(ctx, tx, actorID, id, targetName, offending, "update"); auditErr != nil {
					writeInternalError(w, r, "audit role escalation")
					return
				}
				if commitErr := tx.Commit(); commitErr != nil {
					writeInternalError(w, r, "commit audit")
					return
				}
				writeProblem(w, http.StatusForbidden, errTypeForbidden, "Role escalation rejected",
					"Cannot grant permission '"+offending+"' that exceeds the actor's effective permission set",
					r.URL.Path, nil)
				return
			}
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

// permissionResponse is the JSON shape returned by GET /api/v1/permissions.
// The source field indicates permission origin: "built-in", "plugin-manifest",
// or "plugin-dynamic". sourcePluginId is omitted when empty (built-in perms).
//
// TODO(plugins): permissionRegistry.Register interface for plugin-side
// permission registration — plugins will call Register at init time and the
// daemon will persist source="plugin-manifest" rows on first boot.
type permissionResponse struct {
	ID             string `json:"id"`
	Resource       string `json:"resource"`
	Action         string `json:"action"`
	Description    string `json:"description"`
	Source         string `json:"source"`
	SourcePluginID string `json:"sourcePluginId,omitempty"`
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
				ID:             p.ID,
				Resource:       p.Resource,
				Action:         p.Action,
				Description:    p.Description,
				Source:         p.Source,
				SourcePluginID: p.SourcePluginID,
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

// actorPermissions returns the authenticated actor's effective permission
// set, sourced from SessionClaims.Scopes (populated at session-validation
// time via auth.ResolvePermissions). Returns an empty slice when no
// session is present so ValidateNoEscalation rejects every grant.
func actorPermissions(r *http.Request) []string {
	if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil {
		return sc.Scopes
	}
	return nil
}

// emitRoleEscalationAudit appends a typed RoleEscalationRejected audit
// entry under the active tx. Uses the package-default registry which
// pre-registers auth.role_escalation_rejected.v1.
func emitRoleEscalationAudit(ctx context.Context, tx store.Tx, actorID, targetID, targetName, offending, op string) error {
	entry, err := audit.BuildEntry(
		audit.DefaultRegistry,
		actorID,
		"role",
		targetID,
		op,
		&audit.RoleEscalationRejected{
			ActorUserID:         actorID,
			TargetRoleID:        targetID,
			TargetRoleName:      targetName,
			OffendingPermission: offending,
			Operation:           op,
		},
	)
	if err != nil {
		return err
	}
	return tx.AppendAuditEntry(ctx, entry)
}

// offendingPermission extracts the missing permission name from a
// ValidateNoEscalation error. The store wraps ErrRoleEscalation with
// "actor lacks <perm>"; we strip the prefix so the audit row carries
// just the permission identifier.
func offendingPermission(err error) string {
	const sentinelSuffix = ": actor lacks "
	msg := err.Error()
	if i := strings.Index(msg, sentinelSuffix); i >= 0 {
		return msg[i+len(sentinelSuffix):]
	}
	return ""
}
