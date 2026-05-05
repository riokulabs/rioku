package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

func (t *tx) CreateRole(ctx context.Context, params store.CreateRoleParams) (*store.Role, error) {
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO roles (id, tenant_id, name, description, is_builtin, parent_role_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, FALSE, ?, ?, ?)`),
		params.ID, tenantID, params.Name, params.Description, params.ParentRoleID, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: create role: %w", err)
	}
	for _, permID := range params.Permissions {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`),
			params.ID, permID,
		); err != nil {
			return nil, fmt.Errorf("postgres: assign permission %s to role: %w", permID, err)
		}
	}
	t.emit("roles", params.ID, "INSERT")
	return t.GetRole(ctx, params.ID)
}

func (t *tx) GetRole(ctx context.Context, id string) (*store.Role, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, name, description, is_builtin, parent_role_id, created_at, updated_at
		 FROM roles WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?)`),
		id, tenantID,
	)
	r := &store.Role{}
	var parentRoleID sql.NullString
	var createdAt, updatedAt time.Time
	if err := row.Scan(&r.ID, &r.Name, &r.Description, &r.IsBuiltin, &parentRoleID, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrRoleNotFound
		}
		return nil, fmt.Errorf("postgres: get role: %w", err)
	}
	if parentRoleID.Valid {
		s := parentRoleID.String
		r.ParentRoleID = &s
	}
	r.CreatedAt = createdAt.UTC()
	r.UpdatedAt = updatedAt.UTC()
	perms, err := t.getRolePermissions(ctx, id)
	if err != nil {
		return nil, err
	}
	r.Permissions = perms
	return r, nil
}

func (t *tx) getRolePermissions(ctx context.Context, roleID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT permission_id FROM role_permissions WHERE role_id = ?`),
		roleID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: get role permissions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var perms []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}

func (t *tx) ListRoles(ctx context.Context) ([]*store.Role, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, name, description, is_builtin, parent_role_id, created_at, updated_at
		 FROM roles WHERE tenant_id IS NULL OR tenant_id = ? ORDER BY name`),
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list roles: %w", err)
	}
	// Materialize all rows BEFORE issuing any nested queries on the
	// same Tx — pgx in stdlib mode does not multiplex queries on a
	// single connection while a Rows iterator is open, so calling
	// getRolePermissions inside the for-rows loop deadlocks waiting
	// for the open cursor's results to be consumed.
	var roles []*store.Role
	for rows.Next() {
		r := &store.Role{}
		var parentRoleID sql.NullString
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.IsBuiltin, &parentRoleID, &createdAt, &updatedAt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if parentRoleID.Valid {
			s := parentRoleID.String
			r.ParentRoleID = &s
		}
		r.CreatedAt = createdAt.UTC()
		r.UpdatedAt = updatedAt.UTC()
		roles = append(roles, r)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	// Now safe to issue per-role permission lookups.
	for _, r := range roles {
		perms, err := t.getRolePermissions(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		r.Permissions = perms
	}
	return roles, nil
}

func (t *tx) UpdateRole(ctx context.Context, id string, params store.UpdateRoleParams) (*store.Role, error) {
	if id == "role_superadmin" {
		return nil, store.ErrRoleImmutable
	}
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	if params.Name != nil {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE roles SET name = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`),
			*params.Name, now, id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("postgres: update role name: %w", err)
		}
	}
	if params.Description != nil {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE roles SET description = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`),
			*params.Description, now, id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("postgres: update role description: %w", err)
		}
	}
	if params.ClearParent {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE roles SET parent_role_id = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?`),
			now, id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("postgres: clear parent_role_id: %w", err)
		}
	} else if params.ParentRoleID != nil {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE roles SET parent_role_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`),
			*params.ParentRoleID, now, id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("postgres: set parent_role_id: %w", err)
		}
	}
	for _, permID := range params.AddPerms {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON CONFLICT DO NOTHING`),
			id, permID,
		); err != nil {
			return nil, fmt.Errorf("postgres: add permission %s: %w", permID, err)
		}
	}
	for _, permID := range params.RemovePerms {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`),
			id, permID,
		); err != nil {
			return nil, fmt.Errorf("postgres: remove permission %s: %w", permID, err)
		}
	}
	t.emit("roles", id, "UPDATE")
	return t.GetRole(ctx, id)
}

// EffectivePermissions resolves the role's full permission set,
// walking the parent_role_id chain. Cycle and depth-limit detection
// per the store's escalation-prevention contract (#117).
func (t *tx) EffectivePermissions(ctx context.Context, roleID string) ([]string, error) {
	return store.ComputeEffectivePermissions(ctx, t.GetRole, roleID)
}

func (t *tx) DeleteRole(ctx context.Context, id string) error {
	if id == "role_superadmin" {
		return store.ErrRoleImmutable
	}
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM roles WHERE id = ? AND tenant_id = ?`),
		id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("postgres: delete role: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrRoleNotFound
	}
	t.emit("roles", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

func (t *tx) ListPermissions(ctx context.Context) ([]*store.Permission, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, resource, action, description, source, COALESCE(source_plugin_id, '') FROM permissions
		 WHERE id NOT LIKE '%:*' AND id != '*'
		 ORDER BY resource, action`,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list permissions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var perms []*store.Permission
	for rows.Next() {
		p := &store.Permission{}
		if err := rows.Scan(&p.ID, &p.Resource, &p.Action, &p.Description, &p.Source, &p.SourcePluginID); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}

func (t *tx) GetUserScopes(ctx context.Context, userID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT DISTINCT rp.permission_id
		 FROM user_roles ur
		 JOIN role_permissions rp ON ur.role_id = rp.role_id
		 WHERE ur.user_id = ?`),
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: get user scopes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var scopes []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		scopes = append(scopes, s)
	}
	return scopes, rows.Err()
}

// ---------------------------------------------------------------------------
// User Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignRole(ctx context.Context, userID, roleID, grantedBy string) error {
	var grantedByPtr *string
	if grantedBy != "" {
		grantedByPtr = &grantedBy
	}
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`),
		userID, roleID, grantedByPtr,
	)
	if err != nil {
		return fmt.Errorf("postgres: assign role: %w", err)
	}
	t.emit("user_roles", userID, "INSERT")
	return nil
}

func (t *tx) RevokeRole(ctx context.Context, userID, roleID string) error {
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`),
		userID, roleID,
	)
	if err != nil {
		return fmt.Errorf("postgres: revoke role: %w", err)
	}
	t.emit("user_roles", userID, "DELETE")
	return nil
}

func (t *tx) ListUserRoles(ctx context.Context, userID string) ([]*store.UserRole, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT ur.user_id, ur.role_id, r.name, COALESCE(ur.granted_by,''), ur.granted_at
		 FROM user_roles ur
		 JOIN roles r ON ur.role_id = r.id
		 WHERE ur.user_id = ?`),
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list user roles: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var result []*store.UserRole
	for rows.Next() {
		ur := &store.UserRole{}
		var grantedAt time.Time
		if err := rows.Scan(&ur.UserID, &ur.RoleID, &ur.RoleName, &ur.GrantedBy, &grantedAt); err != nil {
			return nil, err
		}
		ur.GrantedAt = grantedAt.UTC()
		result = append(result, ur)
	}
	return result, rows.Err()
}

func (t *tx) ListUsersWithRole(ctx context.Context, roleID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT user_id FROM user_roles WHERE role_id = ?`),
		roleID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list users with role: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---------------------------------------------------------------------------
// TOTP Backup Codes
// ---------------------------------------------------------------------------

func (t *tx) CreateTOTPBackupCodes(ctx context.Context, userID string, codeHashes []string) error {
	// Delete any existing codes first.
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM totp_backup_codes WHERE user_id = ?`),
		userID,
	); err != nil {
		return fmt.Errorf("postgres: clear backup codes: %w", err)
	}
	for _, h := range codeHashes {
		id := uuid.New().String()
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`INSERT INTO totp_backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)`),
			id, userID, h,
		); err != nil {
			return fmt.Errorf("postgres: insert backup code: %w", err)
		}
	}
	return nil
}

func (t *tx) ListUnusedTOTPBackupCodes(ctx context.Context, userID string) ([]*store.TOTPBackupCode, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, user_id, code_hash FROM totp_backup_codes
		 WHERE user_id = ? AND used_at IS NULL`),
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list backup codes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var codes []*store.TOTPBackupCode
	for rows.Next() {
		c := &store.TOTPBackupCode{}
		if err := rows.Scan(&c.ID, &c.UserID, &c.CodeHash); err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, rows.Err()
}

func (t *tx) MarkTOTPBackupCodeUsed(ctx context.Context, codeID string) error {
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE totp_backup_codes SET used_at = ? WHERE id = ?`),
		time.Now().UTC(), codeID,
	)
	if err != nil {
		return fmt.Errorf("postgres: mark backup code used: %w", err)
	}
	return nil
}

func (t *tx) DeleteTOTPBackupCodes(ctx context.Context, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM totp_backup_codes WHERE user_id = ?`),
		userID,
	)
	if err != nil {
		return fmt.Errorf("postgres: delete backup codes: %w", err)
	}
	return nil
}
