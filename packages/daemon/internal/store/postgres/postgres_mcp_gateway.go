package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// MCP teams
// ---------------------------------------------------------------------------

func (t *tx) CreateMCPTeam(ctx context.Context, p store.CreateMCPTeamParams) (*store.MCPTeam, error) {
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = p.TenantID
	}
	if p.Status == "" {
		p.Status = store.MCPTeamStatusActive
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO mcp_teams (id, tenant_id, name, description, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`),
		p.ID, tenantID, p.Name, p.Description, string(p.Status), now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrMCPTeamNameTaken
		}
		return nil, fmt.Errorf("postgres: create mcp_team: %w", err)
	}
	t.emit("mcp_teams", p.ID, "INSERT")
	return t.GetMCPTeam(ctx, p.ID)
}

const mcpTeamCols = `id, tenant_id, name, description, status, created_at, updated_at`

func (t *tx) GetMCPTeam(ctx context.Context, id string) (*store.MCPTeam, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT `+mcpTeamCols+` FROM mcp_teams WHERE id = ? AND tenant_id = ?`),
		id, tenantID)
	team, err := scanMCPTeam(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrMCPTeamNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get mcp_team: %w", err)
	}
	return team, nil
}

func (t *tx) ListMCPTeams(ctx context.Context) ([]*store.MCPTeam, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+mcpTeamCols+` FROM mcp_teams WHERE tenant_id = ? ORDER BY name`),
		tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list mcp_teams: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.MCPTeam
	for rows.Next() {
		team, err := scanMCPTeam(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, team)
	}
	return out, rows.Err()
}

func (t *tx) UpdateMCPTeam(ctx context.Context, id string, p store.UpdateMCPTeamParams) (*store.MCPTeam, error) {
	tenantID := store.TenantIDFromContext(ctx)
	sets := []string{}
	args := []any{}
	if p.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *p.Name)
	}
	if p.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *p.Description)
	}
	if p.Status != nil {
		sets = append(sets, "status = ?")
		args = append(args, string(*p.Status))
	}
	if len(sets) == 0 {
		return t.GetMCPTeam(ctx, id)
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, nowUTC(), id, tenantID)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE mcp_teams SET `+strings.Join(sets, ", ")+` WHERE id = ? AND tenant_id = ?`),
		args...)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrMCPTeamNameTaken
		}
		return nil, fmt.Errorf("postgres: update mcp_team: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.ErrMCPTeamNotFound
	}
	t.emit("mcp_teams", id, "UPDATE")
	return t.GetMCPTeam(ctx, id)
}

func (t *tx) DeleteMCPTeam(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM mcp_teams WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete mcp_team: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrMCPTeamNotFound
	}
	t.emit("mcp_teams", id, "DELETE")
	return nil
}

func scanMCPTeam(s scanner) (*store.MCPTeam, error) {
	var (
		team                 store.MCPTeam
		status               string
		createdAt, updatedAt time.Time
	)
	if err := s.Scan(&team.ID, &team.TenantID, &team.Name, &team.Description,
		&status, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	team.Status = store.MCPTeamStatus(status)
	team.CreatedAt = createdAt.UTC()
	team.UpdatedAt = updatedAt.UTC()
	return &team, nil
}

// ---------------------------------------------------------------------------
// MCP team permissions
// ---------------------------------------------------------------------------

func (t *tx) AddMCPTeamPermission(ctx context.Context, perm *store.MCPTeamPermission) (*store.MCPTeamPermission, error) {
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = perm.TenantID
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO mcp_team_permissions (id, tenant_id, team_id, mcp_server_id, tool_name, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`),
		perm.ID, tenantID, perm.TeamID, perm.MCPServerID, perm.ToolName, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrMCPTeamPermissionDup
		}
		return nil, fmt.Errorf("postgres: add mcp_team_permission: %w", err)
	}
	t.emit("mcp_team_permissions", perm.ID, "INSERT")
	out := *perm
	out.TenantID = tenantID
	out.CreatedAt = now
	return &out, nil
}

func (t *tx) ListMCPTeamPermissions(ctx context.Context, teamID string) ([]*store.MCPTeamPermission, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, team_id, mcp_server_id, tool_name, created_at
		 FROM mcp_team_permissions WHERE tenant_id = ? AND team_id = ?
		 ORDER BY mcp_server_id, tool_name`),
		tenantID, teamID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list mcp_team_permissions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.MCPTeamPermission
	for rows.Next() {
		var (
			p         store.MCPTeamPermission
			createdAt time.Time
		)
		if err := rows.Scan(&p.ID, &p.TenantID, &p.TeamID, &p.MCPServerID, &p.ToolName, &createdAt); err != nil {
			return nil, err
		}
		p.CreatedAt = createdAt.UTC()
		out = append(out, &p)
	}
	return out, rows.Err()
}

func (t *tx) RemoveMCPTeamPermission(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM mcp_team_permissions WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: remove mcp_team_permission: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrMCPTeamNotFound
	}
	t.emit("mcp_team_permissions", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// MCP routes
// ---------------------------------------------------------------------------

func (t *tx) CreateMCPRoute(ctx context.Context, p store.CreateMCPRouteParams) (*store.MCPRoute, error) {
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = p.TenantID
	}
	if p.PathPrefix == "" {
		p.PathPrefix = "/"
	}
	if p.AuthPassthrough == "" {
		p.AuthPassthrough = store.MCPAuthPassthroughForward
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO mcp_routes (id, tenant_id, name, hostname, path_prefix, mcp_server_id,
		   auth_passthrough, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		p.ID, tenantID, p.Name, p.Hostname, p.PathPrefix, p.MCPServerID,
		string(p.AuthPassthrough), p.Enabled, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrMCPRouteHostPathTaken
		}
		return nil, fmt.Errorf("postgres: create mcp_route: %w", err)
	}
	t.emit("mcp_routes", p.ID, "INSERT")
	return t.GetMCPRoute(ctx, p.ID)
}

const mcpRouteCols = `id, tenant_id, name, hostname, path_prefix, mcp_server_id,
	auth_passthrough, enabled, created_at, updated_at`

func (t *tx) GetMCPRoute(ctx context.Context, id string) (*store.MCPRoute, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT `+mcpRouteCols+` FROM mcp_routes WHERE id = ? AND tenant_id = ?`),
		id, tenantID)
	r, err := scanMCPRoute(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrMCPRouteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get mcp_route: %w", err)
	}
	return r, nil
}

func (t *tx) ListAllMCPRoutes(ctx context.Context) ([]*store.MCPRoute, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+mcpRouteCols+` FROM mcp_routes ORDER BY tenant_id, hostname, path_prefix`))
	if err != nil {
		return nil, fmt.Errorf("postgres: list all mcp_routes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.MCPRoute
	for rows.Next() {
		r, err := scanMCPRoute(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (t *tx) ListMCPRoutes(ctx context.Context) ([]*store.MCPRoute, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+mcpRouteCols+` FROM mcp_routes WHERE tenant_id = ? ORDER BY hostname, path_prefix`),
		tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list mcp_routes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.MCPRoute
	for rows.Next() {
		r, err := scanMCPRoute(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (t *tx) UpdateMCPRoute(ctx context.Context, id string, p store.UpdateMCPRouteParams) (*store.MCPRoute, error) {
	tenantID := store.TenantIDFromContext(ctx)
	sets := []string{}
	args := []any{}
	if p.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *p.Name)
	}
	if p.Hostname != nil {
		sets = append(sets, "hostname = ?")
		args = append(args, *p.Hostname)
	}
	if p.PathPrefix != nil {
		sets = append(sets, "path_prefix = ?")
		args = append(args, *p.PathPrefix)
	}
	if p.MCPServerID != nil {
		sets = append(sets, "mcp_server_id = ?")
		args = append(args, *p.MCPServerID)
	}
	if p.AuthPassthrough != nil {
		sets = append(sets, "auth_passthrough = ?")
		args = append(args, string(*p.AuthPassthrough))
	}
	if p.Enabled != nil {
		sets = append(sets, "enabled = ?")
		args = append(args, *p.Enabled)
	}
	if len(sets) == 0 {
		return t.GetMCPRoute(ctx, id)
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, nowUTC(), id, tenantID)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE mcp_routes SET `+strings.Join(sets, ", ")+` WHERE id = ? AND tenant_id = ?`),
		args...)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrMCPRouteHostPathTaken
		}
		return nil, fmt.Errorf("postgres: update mcp_route: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.ErrMCPRouteNotFound
	}
	t.emit("mcp_routes", id, "UPDATE")
	return t.GetMCPRoute(ctx, id)
}

func (t *tx) DeleteMCPRoute(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM mcp_routes WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete mcp_route: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrMCPRouteNotFound
	}
	t.emit("mcp_routes", id, "DELETE")
	return nil
}

func scanMCPRoute(s scanner) (*store.MCPRoute, error) {
	var (
		r                    store.MCPRoute
		auth                 string
		enabled              bool
		createdAt, updatedAt time.Time
	)
	if err := s.Scan(&r.ID, &r.TenantID, &r.Name, &r.Hostname, &r.PathPrefix, &r.MCPServerID,
		&auth, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	r.AuthPassthrough = store.MCPAuthPassthrough(auth)
	r.Enabled = enabled
	r.CreatedAt = createdAt.UTC()
	r.UpdatedAt = updatedAt.UTC()
	return &r, nil
}
