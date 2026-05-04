// Package postgres — Dashboard, Widget, and DashboardVersion CRUD (stage-2).
package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboard(ctx context.Context, in *store.Dashboard) (*store.Dashboard, error) {
	if in == nil {
		return nil, fmt.Errorf("postgres: nil dashboard")
	}
	if in.TenantID == "" || in.Name == "" {
		return nil, fmt.Errorf("postgres: dashboard requires tenant_id, name")
	}
	id := in.ID
	if id == "" {
		id = "dash_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	mode := in.Mode
	if mode == "" {
		mode = "metabase"
	}
	scope := in.Scope
	if scope == "" {
		scope = "personal"
	}
	shared := in.SharedRoleIDs
	if shared == "" {
		shared = "[]"
	}
	homes := in.HomeForUsers
	if homes == "" {
		homes = "[]"
	}
	vars := in.Variables
	if vars == "" {
		vars = "[]"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO dashboards (id, tenant_id, name, description, mode, scope, owner_user_id,
		   is_default, shared_role_ids, home_for_users, variables, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, false, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.Name, in.Description, mode, scope, in.OwnerUserID,
		shared, homes, vars, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert dashboard: %w", err)
	}
	t.emit("dashboards", id, "INSERT")
	return t.GetDashboard(ctx, in.TenantID, id)
}

func (t *tx) GetDashboard(ctx context.Context, tenantID, id string) (*store.Dashboard, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, description, mode, scope, owner_user_id,
		   is_default, shared_role_ids, home_for_users, variables, created_at, updated_at
		 FROM dashboards WHERE id = ? AND tenant_id = ?`), id, tenantID)
	d, err := scanDashboard(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrDashboardNotFound
	}
	return d, err
}

func (t *tx) ListDashboardsByTenant(ctx context.Context, tenantID string) ([]*store.Dashboard, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, description, mode, scope, owner_user_id,
		   is_default, shared_role_ids, home_for_users, variables, created_at, updated_at
		 FROM dashboards WHERE tenant_id = ? ORDER BY created_at ASC`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list dashboards: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Dashboard
	for rows.Next() {
		d, err := scanDashboard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (t *tx) UpdateDashboard(ctx context.Context, tenantID, id string, params store.UpdateDashboardParams) (*store.Dashboard, error) {
	current, err := t.GetDashboard(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if params.Name != nil {
		current.Name = *params.Name
	}
	if params.Description != nil {
		current.Description = *params.Description
	}
	if params.Mode != nil {
		current.Mode = *params.Mode
	}
	if params.Scope != nil {
		current.Scope = *params.Scope
	}
	if params.OwnerUserID != nil {
		current.OwnerUserID = params.OwnerUserID
	}
	if params.SharedRoleIDs != nil {
		current.SharedRoleIDs = *params.SharedRoleIDs
	}
	if params.Variables != nil {
		current.Variables = *params.Variables
	}

	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE dashboards SET name=?, description=?, mode=?, scope=?, owner_user_id=?,
		   shared_role_ids=?, variables=?, updated_at=?
		 WHERE id=? AND tenant_id=?`),
		current.Name, current.Description, current.Mode, current.Scope, current.OwnerUserID,
		current.SharedRoleIDs, current.Variables, now, id, tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: update dashboard: %w", err)
	}
	t.emit("dashboards", id, "UPDATE")
	return t.GetDashboard(ctx, tenantID, id)
}

func (t *tx) DeleteDashboard(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM dashboards WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete dashboard: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrDashboardNotFound
	}
	t.emit("dashboards", id, "DELETE")
	return nil
}

// SetDefaultDashboard atomically clears is_default on all dashboards in the
// tenant and sets it on id. Both statements execute within the same tx so
// concurrent flips cannot leave two defaults.
func (t *tx) SetDefaultDashboard(ctx context.Context, tenantID, id string) (*store.Dashboard, error) {
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE dashboards SET is_default = false WHERE tenant_id = ?`), tenantID); err != nil {
		return nil, fmt.Errorf("postgres: clear defaults: %w", err)
	}
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE dashboards SET is_default = true, updated_at = ? WHERE id = ? AND tenant_id = ?`),
		nowUTC(), id, tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: set default: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, store.ErrDashboardNotFound
	}
	t.emit("dashboards", id, "UPDATE")
	return t.GetDashboard(ctx, tenantID, id)
}

// SetDashboardHomeForUser appends userID to the target dashboard's
// home_for_users JSON array, removing it from every other dashboard in the
// tenant first. Per-user home is a uniqueness invariant.
//
// pgx connections are single-threaded per tx — the read result set MUST be
// fully consumed and closed before any UPDATE is issued.
func (t *tx) SetDashboardHomeForUser(ctx context.Context, tenantID, id, userID string) (*store.Dashboard, error) {
	if _, err := t.GetDashboard(ctx, tenantID, id); err != nil {
		return nil, err
	}

	// Read all (id, home_for_users) pairs into a slice first, then close.
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, home_for_users FROM dashboards WHERE tenant_id = ?`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: scan dashboards: %w", err)
	}
	type pair struct {
		id       string
		jsonData string
	}
	var dashboards []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.id, &p.jsonData); err != nil {
			_ = rows.Close()
			return nil, err
		}
		dashboards = append(dashboards, p)
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("postgres: scan dashboards rows: %w", err)
	}

	// Now run UPDATEs — no open result set in flight.
	for _, p := range dashboards {
		var users []string
		if err := json.Unmarshal([]byte(p.jsonData), &users); err != nil {
			users = nil
		}
		filtered := make([]string, 0, len(users))
		for _, u := range users {
			if u != userID {
				filtered = append(filtered, u)
			}
		}
		if p.id == id {
			filtered = append(filtered, userID)
		}
		raw, err := json.Marshal(filtered)
		if err != nil {
			return nil, err
		}
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE dashboards SET home_for_users = ?, updated_at = ? WHERE id = ?`),
			string(raw), nowUTC(), p.id); err != nil {
			return nil, fmt.Errorf("postgres: update home_for_users: %w", err)
		}
	}
	t.emit("dashboards", id, "UPDATE")
	return t.GetDashboard(ctx, tenantID, id)
}

func scanDashboard(s scanner) (*store.Dashboard, error) {
	var (
		id, tenantID, name, desc, mode, scope, sharedRoleIDs, homeForUsers, variables string
		ownerUserID                                                                   *string
		isDefault                                                                     bool
		createdAt, updatedAt                                                          time.Time
	)
	if err := s.Scan(&id, &tenantID, &name, &desc, &mode, &scope, &ownerUserID,
		&isDefault, &sharedRoleIDs, &homeForUsers, &variables, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.Dashboard{
		ID:            id,
		TenantID:      tenantID,
		Name:          name,
		Description:   desc,
		Mode:          mode,
		Scope:         scope,
		OwnerUserID:   ownerUserID,
		IsDefault:     isDefault,
		SharedRoleIDs: sharedRoleIDs,
		HomeForUsers:  homeForUsers,
		Variables:     variables,
		CreatedAt:     createdAt.UTC(),
		UpdatedAt:     updatedAt.UTC(),
	}, nil
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

func (t *tx) CreateWidget(ctx context.Context, in *store.Widget) (*store.Widget, error) {
	if in == nil {
		return nil, fmt.Errorf("postgres: nil widget")
	}
	if in.DashboardID == "" || in.Kind == "" || in.Title == "" {
		return nil, fmt.Errorf("postgres: widget requires dashboard_id, kind, title")
	}
	id := in.ID
	if id == "" {
		id = "widget_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	cfg := in.Config
	if cfg == "" {
		cfg = "{}"
	}
	layout := in.Layout
	if layout == "" {
		layout = `{"x":0,"y":0,"w":4,"h":3}`
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO widgets (id, dashboard_id, kind, title, data_source, config, raw_query,
		   locked_advanced, layout, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.DashboardID, in.Kind, in.Title, in.DataSource, cfg, in.RawQuery,
		in.LockedAdvanced, layout, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert widget: %w", err)
	}
	t.emit("widgets", id, "INSERT")
	return t.GetWidget(ctx, id)
}

func (t *tx) GetWidget(ctx context.Context, id string) (*store.Widget, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, dashboard_id, kind, title, data_source, config, raw_query,
		   locked_advanced, layout, created_at, updated_at
		 FROM widgets WHERE id = ?`), id)
	w, err := scanWidget(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrWidgetNotFound
	}
	return w, err
}

func (t *tx) ListWidgetsByDashboard(ctx context.Context, dashboardID string) ([]*store.Widget, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, dashboard_id, kind, title, data_source, config, raw_query,
		   locked_advanced, layout, created_at, updated_at
		 FROM widgets WHERE dashboard_id = ? ORDER BY created_at ASC`), dashboardID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list widgets: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Widget
	for rows.Next() {
		w, err := scanWidget(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (t *tx) UpdateWidget(ctx context.Context, id string, params store.UpdateWidgetParams) (*store.Widget, error) {
	current, err := t.GetWidget(ctx, id)
	if err != nil {
		return nil, err
	}
	if params.Kind != nil {
		current.Kind = *params.Kind
	}
	if params.Title != nil {
		current.Title = *params.Title
	}
	if params.DataSource != nil {
		current.DataSource = *params.DataSource
	}
	if params.Config != nil {
		current.Config = *params.Config
	}
	if params.RawQuery != nil {
		current.RawQuery = params.RawQuery
	}
	if params.LockedAdvanced != nil {
		current.LockedAdvanced = *params.LockedAdvanced
	}
	if params.Layout != nil {
		current.Layout = *params.Layout
	}

	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE widgets SET kind=?, title=?, data_source=?, config=?, raw_query=?,
		   locked_advanced=?, layout=?, updated_at=?
		 WHERE id=?`),
		current.Kind, current.Title, current.DataSource, current.Config, current.RawQuery,
		current.LockedAdvanced, current.Layout, now, id,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: update widget: %w", err)
	}
	t.emit("widgets", id, "UPDATE")
	return t.GetWidget(ctx, id)
}

func (t *tx) DeleteWidget(ctx context.Context, dashboardID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM widgets WHERE id = ? AND dashboard_id = ?`), id, dashboardID)
	if err != nil {
		return fmt.Errorf("postgres: delete widget: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrWidgetNotFound
	}
	t.emit("widgets", id, "DELETE")
	return nil
}

// UpdateDashboardLayout applies a per-widget layout JSON map. Widget IDs not
// belonging to the dashboard are silently ignored — the handler verified
// ownership before calling.
func (t *tx) UpdateDashboardLayout(ctx context.Context, dashboardID string, layouts map[string]string) error {
	now := nowUTC()
	for widgetID, layout := range layouts {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE widgets SET layout = ?, updated_at = ? WHERE id = ? AND dashboard_id = ?`),
			layout, now, widgetID, dashboardID); err != nil {
			return fmt.Errorf("postgres: update layout for %s: %w", widgetID, err)
		}
	}
	return nil
}

func scanWidget(s scanner) (*store.Widget, error) {
	var (
		id, dashboardID, kind, title, dataSource, cfg, layout string
		rawQuery                                              *string
		lockedAdvanced                                        bool
		createdAt, updatedAt                                  time.Time
	)
	if err := s.Scan(&id, &dashboardID, &kind, &title, &dataSource, &cfg, &rawQuery,
		&lockedAdvanced, &layout, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.Widget{
		ID:             id,
		DashboardID:    dashboardID,
		Kind:           kind,
		Title:          title,
		DataSource:     dataSource,
		Config:         cfg,
		RawQuery:       rawQuery,
		LockedAdvanced: lockedAdvanced,
		Layout:         layout,
		CreatedAt:      createdAt.UTC(),
		UpdatedAt:      updatedAt.UTC(),
	}, nil
}

// ---------------------------------------------------------------------------
// Dashboard versions
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardVersion(ctx context.Context, in *store.DashboardVersion) (*store.DashboardVersion, error) {
	if in == nil {
		return nil, fmt.Errorf("postgres: nil version")
	}
	if in.DashboardID == "" || in.SnapshotJSON == "" {
		return nil, fmt.Errorf("postgres: version requires dashboard_id, snapshot_json")
	}
	id := in.ID
	if id == "" {
		id = "ver_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}

	// Compute next version number atomically — read MAX(version) + 1.
	var maxVer sql.NullInt32
	if err := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT MAX(version) FROM dashboard_versions WHERE dashboard_id = ?`),
		in.DashboardID).Scan(&maxVer); err != nil {
		return nil, fmt.Errorf("postgres: max version: %w", err)
	}
	next := int32(1)
	if maxVer.Valid {
		next = maxVer.Int32 + 1
	}

	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO dashboard_versions (id, dashboard_id, version, created_by, created_at, note, snapshot_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`),
		id, in.DashboardID, next, in.CreatedBy, now, in.Note, in.SnapshotJSON,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert version: %w", err)
	}
	t.emit("dashboard_versions", id, "INSERT")
	return t.GetDashboardVersion(ctx, id)
}

func (t *tx) GetDashboardVersion(ctx context.Context, id string) (*store.DashboardVersion, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, dashboard_id, version, created_by, created_at, note, snapshot_json
		 FROM dashboard_versions WHERE id = ?`), id)
	v, err := scanDashboardVersion(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrVersionNotFound
	}
	return v, err
}

func (t *tx) ListDashboardVersions(ctx context.Context, dashboardID string) ([]*store.DashboardVersion, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, dashboard_id, version, created_by, created_at, note, snapshot_json
		 FROM dashboard_versions WHERE dashboard_id = ? ORDER BY version DESC`), dashboardID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list versions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.DashboardVersion
	for rows.Next() {
		v, err := scanDashboardVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func scanDashboardVersion(s scanner) (*store.DashboardVersion, error) {
	var (
		id, dashboardID, note, snapshot string
		version                         int32
		createdBy                       *string
		createdAt                       time.Time
	)
	if err := s.Scan(&id, &dashboardID, &version, &createdBy, &createdAt, &note, &snapshot); err != nil {
		return nil, err
	}
	return &store.DashboardVersion{
		ID:           id,
		DashboardID:  dashboardID,
		Version:      version,
		CreatedBy:    createdBy,
		CreatedAt:    createdAt.UTC(),
		Note:         note,
		SnapshotJSON: snapshot,
	}, nil
}
