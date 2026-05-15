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
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/store/audit"
)

// RegisterRBACRoutes registers the RBAC management endpoints (roles,
// permissions, and user-role assignments). Both legacy `/api/v1/roles`
// and tenant-scoped `/api/v1/t/{tenant}/roles` paths are exposed;
// storage's `tenant_id IS NULL OR tenant_id = ?` filter keeps built-in
// roles visible from every tenant alongside tenant-scoped custom ones.
func RegisterRBACRoutes(mux *http.ServeMux, st store.Driver, sm *auth.SessionManager) {
	listRolesH := RequirePermission("roles:read")(rerr.H(handleListRoles(st)))
	createRoleH := RequirePermission("roles:manage")(rerr.H(handleCreateRole(st)))
	getRoleH := RequirePermission("roles:read")(rerr.H(handleGetRole(st)))
	updateRoleH := RequirePermission("roles:manage")(rerr.H(handleUpdateRole(st, sm)))
	deleteRoleH := RequirePermission("roles:manage")(rerr.H(handleDeleteRole(st)))
	listPermsH := RequirePermission("roles:read")(rerr.H(handleListPermissions(st)))
	listUserRolesH := RequirePermission("users:read")(rerr.H(handleListUserRoles(st)))
	assignRoleH := RequirePermission("users:manage")(rerr.H(handleAssignRole(st)))
	revokeRoleH := RequirePermission("users:manage")(rerr.H(handleRevokeRole(st)))

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

func handleListRoles(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		roles, err := tx.ListRoles(ctx)
		if err != nil {
			return rerr.Wrap(err, "list roles")
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
		return rerr.JSON(w, map[string]any{
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

func handleCreateRole(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req createRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		if req.Name == "" {
			return rerr.Validation(map[string]string{"name": "must not be empty"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
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
				return rerr.Wrap(auditErr, "audit role escalation")
			}
			if commitErr := tx.Commit(); commitErr != nil {
				return rerr.Wrap(commitErr, "commit audit")
			}
			return rerr.Forbidden("Cannot grant permission '" + offending + "' that exceeds the actor's effective permission set")
		}

		role, err := tx.CreateRole(ctx, store.CreateRoleParams{
			ID:          uuid.New().String(),
			Name:        req.Name,
			Description: req.Description,
			Permissions: req.Permissions,
		})
		if err != nil {
			return rerr.Wrap(err, "create role")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSONStatus(w, http.StatusCreated, toRoleResponse(role))
	}
}

func handleGetRole(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "role ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		role, err := tx.GetRole(ctx, id)
		if err != nil {
			return rerr.NotFound("role", id)
		}

		userIDs, err := tx.ListUsersWithRole(ctx, id)
		if err != nil {
			return rerr.Wrap(err, "list users with role")
		}

		resp := toRoleResponse(role)
		count := len(userIDs)
		resp.UserCount = &count

		return rerr.JSON(w, resp)
	}
}

type updateRoleRequest struct {
	Name         *string  `json:"name"`
	Description  *string  `json:"description"`
	AddPerms     []string `json:"addPermissions"`
	RemovePerms  []string `json:"removePermissions"`
	ParentRoleID *string  `json:"parentRoleId"` // non-nil → set parent
	ClearParent  bool     `json:"clearParent"`   // true → set parent_role_id to NULL
}

func handleUpdateRole(st store.Driver, sm *auth.SessionManager) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "role ID is required"})
		}

		var req updateRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
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
					return rerr.Wrap(auditErr, "audit role escalation")
				}
				if commitErr := tx.Commit(); commitErr != nil {
					return rerr.Wrap(commitErr, "commit audit")
				}
				return rerr.Forbidden("Cannot grant permission '" + offending + "' that exceeds the actor's effective permission set")
			}
		}

		role, err := tx.UpdateRole(ctx, id, store.UpdateRoleParams{
			Name:         req.Name,
			Description:  req.Description,
			AddPerms:     req.AddPerms,
			RemovePerms:  req.RemovePerms,
			ParentRoleID: req.ParentRoleID,
			ClearParent:  req.ClearParent,
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
					return rerr.Wrap(auditErr, "audit role escalation")
				}
				if commitErr := tx.Commit(); commitErr != nil {
					return rerr.Wrap(commitErr, "commit audit")
				}
				return rerr.Forbidden("Cannot grant permission '" + offending + "' that exceeds the actor's effective permission set")
			}
			if err == store.ErrRoleImmutable {
				return rerr.Forbidden("The superadmin role cannot be modified")
			}
			if err == store.ErrRoleNotFound {
				return rerr.NotFound("role", id)
			}
			return rerr.Wrap(err, "update role")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Evict cached sessions for users assigned to this role so they
		// reload effective permissions on the next request (#210).
		if sm != nil {
			if rtx, txErr := st.Begin(ctx, store.TxOptions{ReadOnly: true}); txErr == nil {
				if affectedUsers, listErr := rtx.ListUsersWithRole(ctx, id); listErr == nil {
					for _, uid := range affectedUsers {
						sm.EvictSessionsByUser(ctx, uid)
					}
				}
				_ = rtx.Rollback()
			}
		}

		return rerr.JSON(w, toRoleResponse(role))
	}
}

func handleDeleteRole(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "role ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.DeleteRole(ctx, id); err != nil {
			if err == store.ErrRoleImmutable {
				return rerr.Forbidden("The superadmin role cannot be deleted")
			}
			if err == store.ErrRoleNotFound {
				return rerr.NotFound("role", id)
			}
			return rerr.Wrap(err, "delete role")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		w.WriteHeader(http.StatusNoContent)
		return nil
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

func handleListPermissions(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		perms, err := tx.ListPermissions(ctx)
		if err != nil {
			return rerr.Wrap(err, "list permissions")
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

		return rerr.JSON(w, result)
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

func handleListUserRoles(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		userID := r.PathValue("id")
		if userID == "" {
			return rerr.Validation(map[string]string{"id": "user ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		roles, err := tx.ListUserRoles(ctx, userID)
		if err != nil {
			return rerr.Wrap(err, "list user roles")
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

		return rerr.JSON(w, result)
	}
}

type assignRoleRequest struct {
	RoleID string `json:"roleId"`
}

func handleAssignRole(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		userID := r.PathValue("id")
		if userID == "" {
			return rerr.Validation(map[string]string{"id": "user ID is required"})
		}

		var req assignRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		if req.RoleID == "" {
			return rerr.Validation(map[string]string{"roleId": "must not be empty"})
		}

		// Determine the actor (who is granting the role).
		grantedBy := resolveActorID(r)

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.AssignRole(ctx, userID, req.RoleID, grantedBy); err != nil {
			return rerr.Wrap(err, "assign role")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSONStatus(w, http.StatusCreated, map[string]bool{"ok": true})
	}
}

func handleRevokeRole(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		userID := r.PathValue("id")
		roleID := r.PathValue("roleId")
		if userID == "" || roleID == "" {
			return rerr.Validation(map[string]string{"id": "user ID and role ID are required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.RevokeRole(ctx, userID, roleID); err != nil {
			return rerr.Wrap(err, "revoke role")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		w.WriteHeader(http.StatusNoContent)
		return nil
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
