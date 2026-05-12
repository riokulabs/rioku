// Package postgres — Plugins + PluginSigners CRUD.
//
// Both support per-tenant + global scope: tenant_id = NULL marks
// a global resource visible to every tenant.
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// pgScopeWhere builds a WHERE fragment for tenant_scope:
// - empty tenantID → "tenant_scope IS NULL" (global-only lookup)
// - non-empty tenantID → "tenant_scope = $N" (tenant-specific lookup)
// Returns the clause string and the arg (nil when no arg is needed).
func pgScopeWhere(tenantID string) (string, any) {
	if tenantID == "" {
		return "tenant_scope IS NULL", nil
	}
	return "tenant_scope = ?", tenantID
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

func (t *tx) CreatePlugin(ctx context.Context, in *store.Plugin) (*store.Plugin, error) {
	if in == nil || in.Slug == "" || in.Name == "" || in.Version == "" {
		return nil, fmt.Errorf("postgres: plugin requires slug, name, version")
	}
	id := in.ID
	if id == "" {
		id = newID("plug")
	}
	cfg := in.Config
	if cfg == "" {
		cfg = "{}"
	}
	meta := in.Metadata
	if meta == "" {
		meta = "{}"
	}
	state := in.BuildState
	if state == "" {
		state = "stable"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO plugins (id, tenant_scope, slug, name, version, enabled, build_state,
		   cosign_verified, signer_id, config, metadata, last_build_log, installed_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantScope, in.Slug, in.Name, in.Version, in.Enabled, state,
		in.CosignVerified, in.SignerID, cfg, meta, in.LastBuildLog, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "slug") {
			return nil, store.ErrPluginSlugTaken
		}
		return nil, fmt.Errorf("postgres: insert plugin: %w", err)
	}
	t.emit("plugins", id, "INSERT")
	tenantScopeStr := ""
	if in.TenantScope != nil {
		tenantScopeStr = *in.TenantScope
	}
	return t.GetPlugin(ctx, tenantScopeStr, id)
}

func (t *tx) GetPlugin(ctx context.Context, tenantID, id string) (*store.Plugin, error) {
	scopeClause, scopeArg := pgScopeWhere(tenantID)
	args := []any{id}
	if scopeArg != nil {
		args = append(args, scopeArg)
	}
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_scope, slug, name, version, enabled, build_state, cosign_verified,
		   signer_id, config, metadata, last_build_log, installed_at, updated_at
		 FROM plugins WHERE id = ? AND `+scopeClause), args...)
	p, err := scanPlugin(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrPluginNotFound
	}
	return p, err
}

func (t *tx) ListPluginsByScope(ctx context.Context, tenantID string) ([]*store.Plugin, error) {
	scopeClause, scopeArg := pgScopeWhere(tenantID)
	args := []any{}
	if scopeArg != nil {
		args = append(args, scopeArg)
	}
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_scope, slug, name, version, enabled, build_state, cosign_verified,
		   signer_id, config, metadata, last_build_log, installed_at, updated_at
		 FROM plugins WHERE `+scopeClause+` ORDER BY name ASC`), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: list plugins: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Plugin
	for rows.Next() {
		p, err := scanPlugin(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) UpdatePlugin(ctx context.Context, tenantID, id string, p store.UpdatePluginParams) (*store.Plugin, error) {
	c, err := t.GetPlugin(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.Version != nil {
		c.Version = *p.Version
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if p.BuildState != nil {
		c.BuildState = *p.BuildState
	}
	if p.CosignVerified != nil {
		c.CosignVerified = *p.CosignVerified
	}
	if p.SignerID != nil {
		c.SignerID = p.SignerID
	}
	if p.Config != nil {
		c.Config = *p.Config
	}
	if p.Metadata != nil {
		c.Metadata = *p.Metadata
	}
	if p.LastBuildLog != nil {
		c.LastBuildLog = p.LastBuildLog
	}
	scopeClause, scopeArg := pgScopeWhere(tenantID)
	args := []any{
		c.Name, c.Version, c.Enabled, c.BuildState, c.CosignVerified,
		c.SignerID, c.Config, c.Metadata, c.LastBuildLog, nowUTC(), id,
	}
	if scopeArg != nil {
		args = append(args, scopeArg)
	}
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE plugins SET name=?, version=?, enabled=?, build_state=?, cosign_verified=?,
		   signer_id=?, config=?, metadata=?, last_build_log=?, updated_at=?
		 WHERE id=? AND `+scopeClause), args...); err != nil {
		return nil, fmt.Errorf("postgres: update plugin: %w", err)
	}
	t.emit("plugins", id, "UPDATE")
	return t.GetPlugin(ctx, tenantID, id)
}

func (t *tx) DeletePlugin(ctx context.Context, tenantID, id string) error {
	scopeClause, scopeArg := pgScopeWhere(tenantID)
	args := []any{id}
	if scopeArg != nil {
		args = append(args, scopeArg)
	}
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM plugins WHERE id = ? AND `+scopeClause), args...)
	if err != nil {
		return fmt.Errorf("postgres: delete plugin: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrPluginNotFound
	}
	t.emit("plugins", id, "DELETE")
	return nil
}

func scanPlugin(s scanner) (*store.Plugin, error) {
	var (
		id, slug, name, version, buildState, config, metadata string
		tenantScope, signerID, lastBuildLog                   sql.NullString
		enabled, cosignVerified                               bool
		installedAt, updatedAt                                time.Time
	)
	if err := s.Scan(&id, &tenantScope, &slug, &name, &version, &enabled, &buildState,
		&cosignVerified, &signerID, &config, &metadata, &lastBuildLog, &installedAt, &updatedAt); err != nil {
		return nil, err
	}
	out := &store.Plugin{
		ID:             id,
		Slug:           slug,
		Name:           name,
		Version:        version,
		Enabled:        enabled,
		BuildState:     buildState,
		CosignVerified: cosignVerified,
		Config:         config,
		Metadata:       metadata,
		InstalledAt:    installedAt.UTC(),
		UpdatedAt:      updatedAt.UTC(),
	}
	if tenantScope.Valid {
		s := tenantScope.String
		out.TenantScope = &s
	}
	if signerID.Valid {
		s := signerID.String
		out.SignerID = &s
	}
	if lastBuildLog.Valid {
		s := lastBuildLog.String
		out.LastBuildLog = &s
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Plugin Signers
// ---------------------------------------------------------------------------

func (t *tx) CreatePluginSigner(ctx context.Context, in *store.PluginSigner) (*store.PluginSigner, error) {
	if in == nil || in.Name == "" || in.Fingerprint == "" {
		return nil, fmt.Errorf("postgres: plugin_signer requires name, fingerprint")
	}
	id := in.ID
	if id == "" {
		id = newID("psign")
	}
	status := in.Status
	if status == "" {
		status = "pending"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO plugin_signers (id, tenant_scope, name, fingerprint, status, notes, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantScope, in.Name, in.Fingerprint, status, in.Notes, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "fingerprint") {
			return nil, store.ErrPluginSignerFPTaken
		}
		return nil, fmt.Errorf("postgres: insert plugin_signer: %w", err)
	}
	t.emit("plugin_signers", id, "INSERT")
	tenantScopeStr := ""
	if in.TenantScope != nil {
		tenantScopeStr = *in.TenantScope
	}
	return t.GetPluginSigner(ctx, tenantScopeStr, id)
}

func (t *tx) GetPluginSigner(ctx context.Context, tenantID, id string) (*store.PluginSigner, error) {
	scopeClause, scopeArg := pgScopeWhere(tenantID)
	args := []any{id}
	if scopeArg != nil {
		args = append(args, scopeArg)
	}
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_scope, name, fingerprint, status, notes, created_at, updated_at
		 FROM plugin_signers WHERE id = ? AND `+scopeClause), args...)
	s, err := scanPluginSigner(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrPluginSignerNotFound
	}
	return s, err
}

func (t *tx) ListPluginSignersByScope(ctx context.Context, tenantID string) ([]*store.PluginSigner, error) {
	scopeClause, scopeArg := pgScopeWhere(tenantID)
	args := []any{}
	if scopeArg != nil {
		args = append(args, scopeArg)
	}
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_scope, name, fingerprint, status, notes, created_at, updated_at
		 FROM plugin_signers WHERE `+scopeClause+` ORDER BY name ASC`), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: list signers: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.PluginSigner
	for rows.Next() {
		s, err := scanPluginSigner(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *tx) UpdatePluginSigner(ctx context.Context, tenantID, id string, p store.UpdatePluginSignerParams) (*store.PluginSigner, error) {
	c, err := t.GetPluginSigner(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.Fingerprint != nil {
		c.Fingerprint = *p.Fingerprint
	}
	if p.Status != nil {
		c.Status = *p.Status
	}
	if p.Notes != nil {
		c.Notes = *p.Notes
	}
	scopeClause, scopeArg := pgScopeWhere(tenantID)
	args := []any{c.Name, c.Fingerprint, c.Status, c.Notes, nowUTC(), id}
	if scopeArg != nil {
		args = append(args, scopeArg)
	}
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE plugin_signers SET name=?, fingerprint=?, status=?, notes=?, updated_at=?
		 WHERE id=? AND `+scopeClause), args...); err != nil {
		if isPgUniqueViolation(err, "fingerprint") {
			return nil, store.ErrPluginSignerFPTaken
		}
		return nil, fmt.Errorf("postgres: update signer: %w", err)
	}
	t.emit("plugin_signers", id, "UPDATE")
	return t.GetPluginSigner(ctx, tenantID, id)
}

func (t *tx) DeletePluginSigner(ctx context.Context, tenantID, id string) error {
	scopeClause, scopeArg := pgScopeWhere(tenantID)
	args := []any{id}
	if scopeArg != nil {
		args = append(args, scopeArg)
	}
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM plugin_signers WHERE id = ? AND `+scopeClause), args...)
	if err != nil {
		return fmt.Errorf("postgres: delete signer: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrPluginSignerNotFound
	}
	t.emit("plugin_signers", id, "DELETE")
	return nil
}

func (t *tx) ListPluginsBySigner(ctx context.Context, signerID string) ([]*store.Plugin, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_scope, slug, name, version, enabled, build_state, cosign_verified,
		   signer_id, config, metadata, last_build_log, installed_at, updated_at
		 FROM plugins WHERE signer_id = ? ORDER BY name ASC`), signerID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list plugins by signer: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Plugin
	for rows.Next() {
		p, err := scanPlugin(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func scanPluginSigner(s scanner) (*store.PluginSigner, error) {
	var (
		id, name, fingerprint, status, notes string
		tenantScope                          sql.NullString
		createdAt, updatedAt                 time.Time
	)
	if err := s.Scan(&id, &tenantScope, &name, &fingerprint, &status, &notes, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	out := &store.PluginSigner{
		ID:          id,
		Name:        name,
		Fingerprint: fingerprint,
		Status:      status,
		Notes:       notes,
		CreatedAt:   createdAt.UTC(),
		UpdatedAt:   updatedAt.UTC(),
	}
	if tenantScope.Valid {
		s := tenantScope.String
		out.TenantScope = &s
	}
	return out, nil
}
