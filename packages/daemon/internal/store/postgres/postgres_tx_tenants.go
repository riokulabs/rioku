package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

// defaultTenantID is the immutable seed tenant; mirrors the SQLite constant.
const defaultTenantID = "tenant_default"

func (t *tx) CreateTenant(ctx context.Context, in *store.Tenant) (*store.Tenant, error) {
	if in == nil {
		return nil, fmt.Errorf("postgres: nil tenant")
	}
	if in.Slug == "" || in.Name == "" {
		return nil, fmt.Errorf("postgres: tenant requires slug and name")
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
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO tenants (id, slug, name, plan, url_mode, parent_domain, accent, logo_url, default_dashboard_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.Slug, in.Name, plan, urlMode, in.ParentDomain, in.Accent, in.LogoURL, in.DefaultDashboardID, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrTenantSlugTaken
		}
		return nil, fmt.Errorf("postgres: insert tenant: %w", err)
	}
	t.emit("tenants", id, "INSERT")
	return t.GetTenant(ctx, id)
}

func (t *tx) GetTenant(ctx context.Context, id string) (*store.Tenant, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, slug, name, plan, url_mode, parent_domain, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants WHERE id = ?`), id)
	tenant, err := scanTenant(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrTenantNotFound
	}
	return tenant, err
}

func (t *tx) GetTenantBySlug(ctx context.Context, slug string) (*store.Tenant, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, slug, name, plan, url_mode, parent_domain, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants WHERE slug = ?`), slug)
	tenant, err := scanTenant(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrTenantNotFound
	}
	return tenant, err
}

func (t *tx) ListTenants(ctx context.Context) ([]*store.Tenant, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, slug, name, plan, url_mode, parent_domain, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants ORDER BY created_at ASC`))
	if err != nil {
		return nil, fmt.Errorf("postgres: list tenants: %w", err)
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
	if params.Name != nil {
		current.Name = *params.Name
	}
	if params.Plan != nil {
		current.Plan = *params.Plan
	}
	if params.URLMode != nil {
		current.URLMode = *params.URLMode
	}
	if params.ParentDomain != nil {
		current.ParentDomain = *params.ParentDomain
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
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE tenants SET name=?, plan=?, url_mode=?, parent_domain=?, accent=?, logo_url=?, default_dashboard_id=?, updated_at=?
		 WHERE id=?`),
		current.Name, current.Plan, current.URLMode, current.ParentDomain, current.Accent, current.LogoURL, current.DefaultDashboardID, now, id,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: update tenant: %w", err)
	}
	t.emit("tenants", id, "UPDATE")
	return t.GetTenant(ctx, id)
}

func (t *tx) DeleteTenant(ctx context.Context, id string) error {
	if id == defaultTenantID {
		return store.ErrTenantImmutable
	}
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM tenants WHERE id = ?`), id)
	if err != nil {
		return fmt.Errorf("postgres: delete tenant: %w", err)
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
		id, slug, name, plan, urlMode, parentDomain string
		accent, logoURL, defDashID                  *string
		createdAt, updatedAt                         time.Time
	)
	if err := s.Scan(&id, &slug, &name, &plan, &urlMode, &parentDomain, &accent, &logoURL, &defDashID, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.Tenant{
		ID:                 id,
		Slug:               slug,
		Name:               name,
		Plan:               plan,
		URLMode:            urlMode,
		ParentDomain:       parentDomain,
		Accent:             accent,
		LogoURL:            logoURL,
		DefaultDashboardID: defDashID,
		CreatedAt:          createdAt.UTC(),
		UpdatedAt:          updatedAt.UTC(),
	}, nil
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

func (t *tx) CreateMembership(ctx context.Context, in *store.Membership) (*store.Membership, error) {
	if in == nil {
		return nil, fmt.Errorf("postgres: nil membership")
	}
	if in.TenantID == "" || in.UserID == "" {
		return nil, fmt.Errorf("postgres: membership requires tenant_id and user_id")
	}
	id := in.ID
	if id == "" {
		id = "m_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	state := in.State
	if state == "" {
		state = "active"
	}
	now := nowUTC()
	joinedAt := in.JoinedAt
	if joinedAt == nil && state == "active" {
		nowT := time.Now().UTC()
		joinedAt = &nowT
	}
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO memberships (id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.UserID, state,
		in.InvitedBy, in.InvitedAt, joinedAt,
		in.InviteTokenHash, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrMembershipExists
		}
		return nil, fmt.Errorf("postgres: insert membership: %w", err)
	}
	t.emit("memberships", id, "INSERT")
	return t.GetMembership(ctx, id)
}

func (t *tx) GetMembership(ctx context.Context, id string) (*store.Membership, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE id = ?`), id)
	m, err := scanMembership(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrMembershipNotFound
	}
	return m, err
}

func (t *tx) GetMembershipByTenantUser(ctx context.Context, tenantID, userID string) (*store.Membership, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE tenant_id = ? AND user_id = ?`), tenantID, userID)
	m, err := scanMembership(row)
	if errors.Is(err, sql.ErrNoRows) {
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
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(q), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: list memberships: %w", err)
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

	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(q), args...); err != nil {
		return nil, fmt.Errorf("postgres: update membership state: %w", err)
	}
	t.emit("memberships", id, "UPDATE")
	return t.GetMembership(ctx, id)
}

func (t *tx) DeleteMembership(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM memberships WHERE id = ?`), id)
	if err != nil {
		return fmt.Errorf("postgres: delete membership: %w", err)
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
		id, tenantID, userID, state string
		invitedBy, inviteTokenHash  sql.NullString
		invitedAt, joinedAt         sql.NullTime
		createdAt, updatedAt        time.Time
	)
	if err := s.Scan(&id, &tenantID, &userID, &state, &invitedBy, &invitedAt, &joinedAt, &inviteTokenHash, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	m := &store.Membership{
		ID:        id,
		TenantID:  tenantID,
		UserID:    userID,
		State:     state,
		CreatedAt: createdAt.UTC(),
		UpdatedAt: updatedAt.UTC(),
	}
	if invitedBy.Valid {
		m.InvitedBy = &invitedBy.String
	}
	if inviteTokenHash.Valid {
		m.InviteTokenHash = &inviteTokenHash.String
	}
	if invitedAt.Valid {
		t := invitedAt.Time.UTC()
		m.InvitedAt = &t
	}
	if joinedAt.Valid {
		t := joinedAt.Time.UTC()
		m.JoinedAt = &t
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// Membership Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignMembershipRole(ctx context.Context, membershipID, roleID, grantedBy string) error {
	now := nowUTC()
	var grantedByVal *string
	if grantedBy != "" {
		grantedByVal = &grantedBy
	}
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO membership_roles (membership_id, role_id, granted_at, granted_by)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT DO NOTHING`),
		membershipID, roleID, now, grantedByVal,
	)
	if err != nil {
		return fmt.Errorf("postgres: assign membership role: %w", err)
	}
	return nil
}

func (t *tx) RevokeMembershipRole(ctx context.Context, membershipID, roleID string) error {
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM membership_roles WHERE membership_id = ? AND role_id = ?`),
		membershipID, roleID); err != nil {
		return fmt.Errorf("postgres: revoke membership role: %w", err)
	}
	return nil
}

func (t *tx) ListMembershipRoles(ctx context.Context, membershipID string) ([]store.Role, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT r.id, r.name, r.description, r.is_builtin, r.created_at, r.updated_at
		 FROM roles r
		 JOIN membership_roles mr ON mr.role_id = r.id
		 WHERE mr.membership_id = ?
		 ORDER BY r.name ASC`), membershipID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list membership roles: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var roles []store.Role
	for rows.Next() {
		var r store.Role
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.IsBuiltin, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		r.CreatedAt = createdAt.UTC()
		r.UpdatedAt = updatedAt.UTC()
		roles = append(roles, r)
	}
	return roles, rows.Err()
}
