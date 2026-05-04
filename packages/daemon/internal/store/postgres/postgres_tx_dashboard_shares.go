package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Dashboard Shares
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardShare(ctx context.Context, s *store.DashboardShare) (*store.DashboardShare, error) {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	tenantID := store.TenantIDFromContext(ctx)
	now := nowUTC()
	var expires *time.Time
	if s.ExpiresAt != nil {
		v := s.ExpiresAt.UTC()
		expires = &v
	}
	var createdBy *string
	if s.CreatedBy != nil && *s.CreatedBy != "" {
		v := *s.CreatedBy
		createdBy = &v
	}
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(`
		INSERT INTO dashboard_shares (id, tenant_id, dashboard_id, role_id, created_by, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`), s.ID, tenantID, s.DashboardID, s.RoleID, createdBy, expires, now)
	if err != nil {
		return nil, fmt.Errorf("postgres: create dashboard_share: %w", err)
	}
	t.emit("dashboard_shares", s.ID, "INSERT")
	return t.getDashboardShareByID(ctx, s.ID, tenantID)
}

func (t *tx) ListDashboardShares(ctx context.Context, dashboardID string) ([]*store.DashboardShare, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(`
		SELECT id, tenant_id, dashboard_id, role_id, created_by, expires_at, created_at
		FROM dashboard_shares
		WHERE tenant_id = ? AND dashboard_id = ?
		ORDER BY created_at, id
	`), tenantID, dashboardID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list dashboard_shares: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.DashboardShare
	for rows.Next() {
		ds, err := scanDashboardShare(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ds)
	}
	return out, rows.Err()
}

func (t *tx) DeleteDashboardShare(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM dashboard_shares WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete dashboard_share: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: dashboard_share %q not found", id)
	}
	t.emit("dashboard_shares", id, "DELETE")
	return nil
}

func (t *tx) getDashboardShareByID(ctx context.Context, id, tenantID string) (*store.DashboardShare, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(`
		SELECT id, tenant_id, dashboard_id, role_id, created_by, expires_at, created_at
		FROM dashboard_shares WHERE id = ? AND tenant_id = ?
	`), id, tenantID)
	return scanDashboardShare(row)
}

func scanDashboardShare(s scanner) (*store.DashboardShare, error) {
	var (
		ds        store.DashboardShare
		createdBy sql.NullString
		expiresAt sql.NullTime
		createdAt time.Time
	)
	if err := s.Scan(&ds.ID, &ds.TenantID, &ds.DashboardID, &ds.RoleID, &createdBy, &expiresAt, &createdAt); err != nil {
		return nil, err
	}
	ds.CreatedAt = createdAt.UTC()
	if createdBy.Valid {
		v := createdBy.String
		ds.CreatedBy = &v
	}
	if expiresAt.Valid {
		v := expiresAt.Time.UTC()
		ds.ExpiresAt = &v
	}
	return &ds, nil
}
