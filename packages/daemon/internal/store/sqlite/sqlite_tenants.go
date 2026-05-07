package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Tenants (stage-2)
// ---------------------------------------------------------------------------

// defaultTenantID is the immutable id of the seed tenant created by
// migration 13. Operations that target the default tenant by id (e.g.
// blocking deletion) reference this constant.
const defaultTenantID = "tenant_default"

func (t *tx) CreateTenant(ctx context.Context, in *store.Tenant) (*store.Tenant, error) {
	if in == nil {
		return nil, fmt.Errorf("sqlite: nil tenant")
	}
	if in.Slug == "" || in.Name == "" {
		return nil, fmt.Errorf("sqlite: tenant requires slug and name")
	}
	id := in.ID
	if id == "" {
		id = "tenant_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	plan := in.Plan
	if plan == "" {
		plan = "community"
	}
	urlMode := in.URLMode
	if urlMode == "" {
		urlMode = "path"
	}
	now := nowUTC()

	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO tenants (id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.Slug, in.Name, plan, urlMode, in.Accent, in.LogoURL, in.DefaultDashboardID, now, now,
	)
	if err != nil {
		// SQLite reports "UNIQUE constraint failed: tenants.slug" — surface
		// a typed sentinel so handlers can return 409 instead of 500.
		if strings.Contains(err.Error(), "tenants.slug") {
			return nil, store.ErrTenantSlugTaken
		}
		return nil, fmt.Errorf("sqlite: insert tenant: %w", err)
	}

	t.emit("tenants", id, "INSERT")
	return t.GetTenant(ctx, id)
}

func (t *tx) GetTenant(ctx context.Context, id string) (*store.Tenant, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants WHERE id = ?`, id)
	tenant, err := scanTenant(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrTenantNotFound
	}
	return tenant, err
}

func (t *tx) GetTenantBySlug(ctx context.Context, slug string) (*store.Tenant, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants WHERE slug = ?`, slug)
	tenant, err := scanTenant(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrTenantNotFound
	}
	return tenant, err
}

func (t *tx) ListTenants(ctx context.Context) ([]*store.Tenant, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list tenants: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var tenants []*store.Tenant
	for rows.Next() {
		tn, err := scanTenant(rows)
		if err != nil {
			return nil, err
		}
		tenants = append(tenants, tn)
	}
	return tenants, rows.Err()
}

func (t *tx) UpdateTenant(ctx context.Context, id string, params store.UpdateTenantParams) (*store.Tenant, error) {
	current, err := t.GetTenant(ctx, id)
	if err != nil {
		return nil, err
	}
	// Apply non-nil fields. Slug is intentionally absent from
	// UpdateTenantParams — it appears in URLs and changing it would
	// break every persisted dashboard / bookmark.
	if params.Name != nil {
		current.Name = *params.Name
	}
	if params.Plan != nil {
		current.Plan = *params.Plan
	}
	if params.URLMode != nil {
		current.URLMode = *params.URLMode
	}
	if params.Accent != nil {
		current.Accent = params.Accent
	}
	if params.LogoURL != nil {
		current.LogoURL = params.LogoURL
	}
	if params.DefaultDashboardID != nil {
		current.DefaultDashboardID = params.DefaultDashboardID
	}

	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx,
		`UPDATE tenants SET name=?, plan=?, url_mode=?, accent=?, logo_url=?, default_dashboard_id=?, updated_at=?
		 WHERE id=?`,
		current.Name, current.Plan, current.URLMode, current.Accent, current.LogoURL, current.DefaultDashboardID, now, id,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: update tenant: %w", err)
	}
	t.emit("tenants", id, "UPDATE")
	return t.GetTenant(ctx, id)
}

func (t *tx) DeleteTenant(ctx context.Context, id string) error {
	if id == defaultTenantID {
		return store.ErrTenantImmutable
	}
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM tenants WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete tenant: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrTenantNotFound
	}
	t.emit("tenants", id, "DELETE")
	return nil
}

func scanTenant(s scanner) (*store.Tenant, error) {
	var (
		id, slug, name, plan, urlMode string
		accent, logoURL, defDashID    *string
		createdAt, updatedAt          string
	)
	if err := s.Scan(&id, &slug, &name, &plan, &urlMode, &accent, &logoURL, &defDashID, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.Tenant{
		ID:                 id,
		Slug:               slug,
		Name:               name,
		Plan:               plan,
		URLMode:            urlMode,
		Accent:             accent,
		LogoURL:            logoURL,
		DefaultDashboardID: defDashID,
		CreatedAt:          parseTime(createdAt),
		UpdatedAt:          parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// Memberships (stage-2)
// ---------------------------------------------------------------------------

func (t *tx) CreateMembership(ctx context.Context, in *store.Membership) (*store.Membership, error) {
	if in == nil {
		return nil, fmt.Errorf("sqlite: nil membership")
	}
	if in.TenantID == "" {
		return nil, fmt.Errorf("sqlite: membership requires tenant_id")
	}
	// UserID is required for active memberships but may be empty for pending invites.
	state := in.State
	if state == "" {
		state = "active"
	}
	if in.UserID == "" && state != "pending" {
		return nil, fmt.Errorf("sqlite: membership requires user_id for state %q", state)
	}
	id := in.ID
	if id == "" {
		id = "m_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	now := nowUTC()
	joinedAt := in.JoinedAt
	if joinedAt == nil && state == "active" {
		nowT := time.Now().UTC()
		joinedAt = &nowT
	}
	// Use nil for user_id when empty (pending invite has no user yet).
	var userIDVal interface{}
	if in.UserID != "" {
		userIDVal = in.UserID
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO memberships (id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, userIDVal, state,
		in.InvitedBy, formatNullableTime(in.InvitedAt), formatNullableTime(joinedAt),
		in.InviteTokenHash, now, now,
	)
	if err != nil {
		if strings.Contains(err.Error(), "memberships") && strings.Contains(err.Error(), "UNIQUE") {
			return nil, store.ErrMembershipExists
		}
		return nil, fmt.Errorf("sqlite: insert membership: %w", err)
	}
	t.emit("memberships", id, "INSERT")
	return t.GetMembership(ctx, id)
}

func (t *tx) GetMembership(ctx context.Context, id string) (*store.Membership, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE id = ?`, id)
	m, err := scanMembership(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrMembershipNotFound
	}
	return m, err
}

func (t *tx) AcceptInvite(ctx context.Context, membershipID, userID string) error {
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE memberships
		 SET user_id=?, state='active', invite_token_hash=NULL, joined_at=?, updated_at=?
		 WHERE id=? AND state='pending'`,
		userID, now, now, membershipID,
	)
	if err != nil {
		return fmt.Errorf("sqlite: accept invite: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrMembershipNotFound
	}
	return nil
}

func (t *tx) GetMembershipByInviteToken(ctx context.Context, tokenHash string) (*store.Membership, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE invite_token_hash = ?`, tokenHash)
	m, err := scanMembership(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrMembershipNotFound
	}
	return m, err
}

func (t *tx) GetMembershipByTenantUser(ctx context.Context, tenantID, userID string) (*store.Membership, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE tenant_id = ? AND user_id = ?`, tenantID, userID)
	m, err := scanMembership(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrMembershipNotFound
	}
	return m, err
}

func (t *tx) ListMembershipsByTenant(ctx context.Context, tenantID string) ([]*store.Membership, error) {
	return t.queryMemberships(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE tenant_id = ? ORDER BY created_at ASC`,
		tenantID)
}

func (t *tx) ListMembershipsByUser(ctx context.Context, userID string) ([]*store.Membership, error) {
	return t.queryMemberships(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE user_id = ? ORDER BY created_at ASC`,
		userID)
}

func (t *tx) queryMemberships(ctx context.Context, q string, args ...any) ([]*store.Membership, error) {
	rows, err := t.sqlTx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list memberships: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Membership
	for rows.Next() {
		m, err := scanMembership(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (t *tx) UpdateMembershipState(ctx context.Context, id, state string) (*store.Membership, error) {
	current, err := t.GetMembership(ctx, id)
	if err != nil {
		return nil, err
	}
	// State machine: pending -> active -> deactivated -> removed.
	// Re-activation (deactivated -> active) is allowed; "removed"
	// is terminal — operators must delete and recreate to re-add.
	if !validMembershipTransition(current.State, state) {
		return nil, store.ErrMembershipInvalidState
	}

	now := nowUTC()
	args := []any{state, now}
	q := `UPDATE memberships SET state=?, updated_at=?`
	if state == "active" && current.JoinedAt == nil {
		q += `, joined_at=?`
		args = append(args, now)
	}
	q += ` WHERE id=?`
	args = append(args, id)

	if _, err := t.sqlTx.ExecContext(ctx, q, args...); err != nil {
		return nil, fmt.Errorf("sqlite: update membership state: %w", err)
	}
	t.emit("memberships", id, "UPDATE")
	return t.GetMembership(ctx, id)
}

func (t *tx) DeleteMembership(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM memberships WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete membership: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrMembershipNotFound
	}
	t.emit("memberships", id, "DELETE")
	return nil
}

// validMembershipTransition allows: pending->active, pending->removed,
// active->deactivated, active->removed, deactivated->active,
// deactivated->removed. Removed is terminal. Same-state is a no-op
// allowed so callers can be idempotent.
func validMembershipTransition(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case "pending":
		return to == "active" || to == "removed"
	case "active":
		return to == "deactivated" || to == "removed"
	case "deactivated":
		return to == "active" || to == "removed"
	case "removed":
		return false
	}
	return false
}

func scanMembership(s scanner) (*store.Membership, error) {
	var (
		id, tenantID, state        string
		userID                     sql.NullString
		invitedBy, inviteTokenHash *string
		invitedAt, joinedAt        *string
		createdAt, updatedAt       string
	)
	if err := s.Scan(&id, &tenantID, &userID, &state, &invitedBy, &invitedAt, &joinedAt, &inviteTokenHash, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	m := &store.Membership{
		ID:              id,
		TenantID:        tenantID,
		UserID:          userID.String, // empty string when NULL (pending invite)
		State:           state,
		InvitedBy:       invitedBy,
		InviteTokenHash: inviteTokenHash,
		CreatedAt:       parseTime(createdAt),
		UpdatedAt:       parseTime(updatedAt),
	}
	if invitedAt != nil {
		ts := parseTime(*invitedAt)
		m.InvitedAt = &ts
	}
	if joinedAt != nil {
		ts := parseTime(*joinedAt)
		m.JoinedAt = &ts
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// Membership Roles (stage-2)
// ---------------------------------------------------------------------------

func (t *tx) AssignMembershipRole(ctx context.Context, membershipID, roleID, grantedBy string) error {
	now := nowUTC()
	var grantedByVal *string
	if grantedBy != "" {
		grantedByVal = &grantedBy
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT OR IGNORE INTO membership_roles (membership_id, role_id, granted_at, granted_by)
		 VALUES (?, ?, ?, ?)`,
		membershipID, roleID, now, grantedByVal,
	)
	if err != nil {
		return fmt.Errorf("sqlite: assign membership role: %w", err)
	}
	return nil
}

func (t *tx) RevokeMembershipRole(ctx context.Context, membershipID, roleID string) error {
	if _, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM membership_roles WHERE membership_id = ? AND role_id = ?`,
		membershipID, roleID); err != nil {
		return fmt.Errorf("sqlite: revoke membership role: %w", err)
	}
	return nil
}

func (t *tx) ListMembershipRoles(ctx context.Context, membershipID string) ([]store.Role, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT r.id, r.name, r.description, r.is_builtin, r.created_at, r.updated_at
		 FROM roles r
		 JOIN membership_roles mr ON mr.role_id = r.id
		 WHERE mr.membership_id = ?
		 ORDER BY r.name ASC`, membershipID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list membership roles: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var roles []store.Role
	for rows.Next() {
		var r store.Role
		var desc sql.NullString
		var createdAt, updatedAt string
		var isBuiltin int
		if err := rows.Scan(&r.ID, &r.Name, &desc, &isBuiltin, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if desc.Valid {
			r.Description = desc.String
		}
		r.IsBuiltin = isBuiltin == 1
		r.CreatedAt = parseTime(createdAt)
		r.UpdatedAt = parseTime(updatedAt)
		roles = append(roles, r)
	}
	return roles, rows.Err()
}
