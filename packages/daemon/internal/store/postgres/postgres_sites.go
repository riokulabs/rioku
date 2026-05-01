// Package postgres — Site + Middleware CRUD (stage-2).
//
// Both entities are tenant-scoped. Every read/write enforces the
// tenant_id constraint.
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
// Sites
// ---------------------------------------------------------------------------

func (t *tx) CreateSite(ctx context.Context, in *store.Site) (*store.Site, error) {
	if in == nil {
		return nil, fmt.Errorf("postgres: nil site")
	}
	if in.TenantID == "" || in.Name == "" || in.Domain == "" {
		return nil, fmt.Errorf("postgres: site requires tenant_id, name, domain")
	}
	id := in.ID
	if id == "" {
		id = "site_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	tlsMode := in.TLSMode
	if tlsMode == "" {
		tlsMode = "auto"
	}
	rateLimit := in.RateLimitPreset
	if rateLimit == "" {
		rateLimit = "none"
	}
	redirects := in.RedirectRules
	if redirects == "" {
		redirects = "[]"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO sites (id, tenant_id, name, domain, tls_mode, enabled, upstream_service_id,
		  basic_auth_enabled, basic_auth_realm, rate_limit_preset, redirect_rules, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.Name, in.Domain, tlsMode, in.Enabled, in.UpstreamServiceID,
		in.BasicAuthEnabled, in.BasicAuthRealm, rateLimit, redirects, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrSiteDomainTaken
		}
		return nil, fmt.Errorf("postgres: insert site: %w", err)
	}
	t.emit("sites", id, "INSERT")
	return t.GetSite(ctx, in.TenantID, id)
}

func (t *tx) GetSite(ctx context.Context, tenantID, id string) (*store.Site, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, domain, tls_mode, enabled, upstream_service_id,
		   basic_auth_enabled, basic_auth_realm, rate_limit_preset, redirect_rules, created_at, updated_at
		 FROM sites WHERE id = ? AND tenant_id = ?`), id, tenantID)
	site, err := scanSite(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrSiteNotFound
	}
	return site, err
}

func (t *tx) ListSitesByTenant(ctx context.Context, tenantID string) ([]*store.Site, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, domain, tls_mode, enabled, upstream_service_id,
		   basic_auth_enabled, basic_auth_realm, rate_limit_preset, redirect_rules, created_at, updated_at
		 FROM sites WHERE tenant_id = ? ORDER BY created_at ASC`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list sites: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var sites []*store.Site
	for rows.Next() {
		s, err := scanSite(rows)
		if err != nil {
			return nil, err
		}
		sites = append(sites, s)
	}
	return sites, rows.Err()
}

func (t *tx) UpdateSite(ctx context.Context, tenantID, id string, params store.UpdateSiteParams) (*store.Site, error) {
	current, err := t.GetSite(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if params.Name != nil {
		current.Name = *params.Name
	}
	if params.Domain != nil {
		current.Domain = *params.Domain
	}
	if params.TLSMode != nil {
		current.TLSMode = *params.TLSMode
	}
	if params.UpstreamServiceID != nil {
		current.UpstreamServiceID = params.UpstreamServiceID
	}
	if params.BasicAuthEnabled != nil {
		current.BasicAuthEnabled = *params.BasicAuthEnabled
	}
	if params.BasicAuthRealm != nil {
		current.BasicAuthRealm = params.BasicAuthRealm
	}
	if params.RateLimitPreset != nil {
		current.RateLimitPreset = *params.RateLimitPreset
	}
	if params.RedirectRules != nil {
		current.RedirectRules = *params.RedirectRules
	}

	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE sites SET name=?, domain=?, tls_mode=?, enabled=?, upstream_service_id=?,
		   basic_auth_enabled=?, basic_auth_realm=?, rate_limit_preset=?, redirect_rules=?, updated_at=?
		 WHERE id=? AND tenant_id=?`),
		current.Name, current.Domain, current.TLSMode, current.Enabled, current.UpstreamServiceID,
		current.BasicAuthEnabled, current.BasicAuthRealm, current.RateLimitPreset, current.RedirectRules, now,
		id, tenantID,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrSiteDomainTaken
		}
		return nil, fmt.Errorf("postgres: update site: %w", err)
	}
	t.emit("sites", id, "UPDATE")
	return t.GetSite(ctx, tenantID, id)
}

func (t *tx) ToggleSite(ctx context.Context, tenantID, id string, enabled bool) (*store.Site, error) {
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE sites SET enabled=?, updated_at=? WHERE id=? AND tenant_id=?`),
		enabled, now, id, tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: toggle site: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, store.ErrSiteNotFound
	}
	t.emit("sites", id, "UPDATE")
	return t.GetSite(ctx, tenantID, id)
}

func (t *tx) DeleteSite(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM sites WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete site: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrSiteNotFound
	}
	t.emit("sites", id, "DELETE")
	return nil
}

func scanSite(s scanner) (*store.Site, error) {
	var (
		id, tenantID, name, domain, tlsMode, rateLimitPreset, redirectRules string
		upstreamServiceID, basicAuthRealm                                   *string
		enabled, basicAuthEnabled                                           bool
		createdAt, updatedAt                                                time.Time
	)
	if err := s.Scan(&id, &tenantID, &name, &domain, &tlsMode, &enabled, &upstreamServiceID,
		&basicAuthEnabled, &basicAuthRealm, &rateLimitPreset, &redirectRules, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.Site{
		ID:                id,
		TenantID:          tenantID,
		Name:              name,
		Domain:            domain,
		TLSMode:           tlsMode,
		Enabled:           enabled,
		UpstreamServiceID: upstreamServiceID,
		BasicAuthEnabled:  basicAuthEnabled,
		BasicAuthRealm:    basicAuthRealm,
		RateLimitPreset:   rateLimitPreset,
		RedirectRules:     redirectRules,
		CreatedAt:         createdAt.UTC(),
		UpdatedAt:         updatedAt.UTC(),
	}, nil
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

func (t *tx) CreateMiddleware(ctx context.Context, in *store.Middleware) (*store.Middleware, error) {
	if in == nil {
		return nil, fmt.Errorf("postgres: nil middleware")
	}
	if in.TenantID == "" || in.Name == "" || in.Kind == "" {
		return nil, fmt.Errorf("postgres: middleware requires tenant_id, name, kind")
	}
	id := in.ID
	if id == "" {
		id = "mw_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	cfg := in.Config
	if cfg == "" {
		cfg = "{}"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO middlewares (id, tenant_id, name, kind, config, enabled, order_hint, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.Name, in.Kind, cfg, in.Enabled, in.OrderHint, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrMiddlewareNameTaken
		}
		return nil, fmt.Errorf("postgres: insert middleware: %w", err)
	}
	t.emit("middlewares", id, "INSERT")
	return t.GetMiddleware(ctx, in.TenantID, id)
}

func (t *tx) GetMiddleware(ctx context.Context, tenantID, id string) (*store.Middleware, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, kind, config, enabled, order_hint, created_at, updated_at
		 FROM middlewares WHERE id = ? AND tenant_id = ?`), id, tenantID)
	m, err := scanMiddleware(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrMiddlewareNotFound
	}
	return m, err
}

func (t *tx) ListMiddlewaresByTenant(ctx context.Context, tenantID string) ([]*store.Middleware, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, kind, config, enabled, order_hint, created_at, updated_at
		 FROM middlewares WHERE tenant_id = ? ORDER BY order_hint ASC, name ASC`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list middlewares: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []*store.Middleware
	for rows.Next() {
		m, err := scanMiddleware(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (t *tx) UpdateMiddleware(ctx context.Context, tenantID, id string, params store.UpdateMiddlewareParams) (*store.Middleware, error) {
	current, err := t.GetMiddleware(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if params.Name != nil {
		current.Name = *params.Name
	}
	if params.Kind != nil {
		current.Kind = *params.Kind
	}
	if params.Config != nil {
		current.Config = *params.Config
	}
	if params.Enabled != nil {
		current.Enabled = *params.Enabled
	}
	if params.OrderHint != nil {
		current.OrderHint = *params.OrderHint
	}

	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE middlewares SET name=?, kind=?, config=?, enabled=?, order_hint=?, updated_at=?
		 WHERE id=? AND tenant_id=?`),
		current.Name, current.Kind, current.Config, current.Enabled, current.OrderHint, now, id, tenantID,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrMiddlewareNameTaken
		}
		return nil, fmt.Errorf("postgres: update middleware: %w", err)
	}
	t.emit("middlewares", id, "UPDATE")
	return t.GetMiddleware(ctx, tenantID, id)
}

func (t *tx) DeleteMiddleware(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM middlewares WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete middleware: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrMiddlewareNotFound
	}
	t.emit("middlewares", id, "DELETE")
	return nil
}

func scanMiddleware(s scanner) (*store.Middleware, error) {
	var (
		id, tenantID, name, kind, cfg string
		enabled                       bool
		orderHint                     int32
		createdAt, updatedAt          time.Time
	)
	if err := s.Scan(&id, &tenantID, &name, &kind, &cfg, &enabled, &orderHint, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.Middleware{
		ID:        id,
		TenantID:  tenantID,
		Name:      name,
		Kind:      kind,
		Config:    cfg,
		Enabled:   enabled,
		OrderHint: orderHint,
		CreatedAt: createdAt.UTC(),
		UpdatedAt: updatedAt.UTC(),
	}, nil
}
