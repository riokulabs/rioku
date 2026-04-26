// Package sqlite — Site + Middleware CRUD (stage-2).
//
// Both entities are tenant-scoped. Every read/write enforces the
// tenant_id constraint to prevent cross-tenant access via guessed
// IDs — handlers above shouldn't have to do that themselves.
package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

func (t *tx) CreateSite(ctx context.Context, in *store.Site) (*store.Site, error) {
	if in == nil {
		return nil, fmt.Errorf("sqlite: nil site")
	}
	if in.TenantID == "" || in.Name == "" || in.Domain == "" {
		return nil, fmt.Errorf("sqlite: site requires tenant_id, name, domain")
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
	enabled := 1
	if !in.Enabled && in.Name != "" {
		// Default enabled=true unless caller explicitly disabled. We
		// distinguish "default zero value" from "explicit false" by
		// checking that other required fields are populated.
	}
	if !in.Enabled {
		enabled = 0
	} else {
		enabled = 1
	}
	basicAuth := 0
	if in.BasicAuthEnabled {
		basicAuth = 1
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO sites (id, tenant_id, name, domain, tls_mode, enabled, upstream_service_id,
		  basic_auth_enabled, basic_auth_realm, rate_limit_preset, redirect_rules, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, in.Domain, tlsMode, enabled, in.UpstreamServiceID,
		basicAuth, in.BasicAuthRealm, rateLimit, redirects, now, now,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "domain") {
			return nil, store.ErrSiteDomainTaken
		}
		return nil, fmt.Errorf("sqlite: insert site: %w", err)
	}
	t.emit("sites", id, "INSERT")
	return t.GetSite(ctx, in.TenantID, id)
}

func (t *tx) GetSite(ctx context.Context, tenantID, id string) (*store.Site, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, domain, tls_mode, enabled, upstream_service_id,
		   basic_auth_enabled, basic_auth_realm, rate_limit_preset, redirect_rules, created_at, updated_at
		 FROM sites WHERE id = ? AND tenant_id = ?`, id, tenantID)
	site, err := scanSite(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrSiteNotFound
	}
	return site, err
}

func (t *tx) ListSitesByTenant(ctx context.Context, tenantID string) ([]*store.Site, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, domain, tls_mode, enabled, upstream_service_id,
		   basic_auth_enabled, basic_auth_realm, rate_limit_preset, redirect_rules, created_at, updated_at
		 FROM sites WHERE tenant_id = ? ORDER BY created_at ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list sites: %w", err)
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

	enabled := 0
	if current.Enabled {
		enabled = 1
	}
	basicAuth := 0
	if current.BasicAuthEnabled {
		basicAuth = 1
	}
	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx,
		`UPDATE sites SET name=?, domain=?, tls_mode=?, enabled=?, upstream_service_id=?,
		   basic_auth_enabled=?, basic_auth_realm=?, rate_limit_preset=?, redirect_rules=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		current.Name, current.Domain, current.TLSMode, enabled, current.UpstreamServiceID,
		basicAuth, current.BasicAuthRealm, current.RateLimitPreset, current.RedirectRules, now,
		id, tenantID,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "domain") {
			return nil, store.ErrSiteDomainTaken
		}
		return nil, fmt.Errorf("sqlite: update site: %w", err)
	}
	t.emit("sites", id, "UPDATE")
	return t.GetSite(ctx, tenantID, id)
}

func (t *tx) ToggleSite(ctx context.Context, tenantID, id string, enabled bool) (*store.Site, error) {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE sites SET enabled=?, updated_at=? WHERE id=? AND tenant_id=?`,
		enabledInt, now, id, tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: toggle site: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, store.ErrSiteNotFound
	}
	t.emit("sites", id, "UPDATE")
	return t.GetSite(ctx, tenantID, id)
}

func (t *tx) DeleteSite(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM sites WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: delete site: %w", err)
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
		enabled, basicAuthEnabled                                           int
		createdAt, updatedAt                                                string
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
		Enabled:           enabled == 1,
		UpstreamServiceID: upstreamServiceID,
		BasicAuthEnabled:  basicAuthEnabled == 1,
		BasicAuthRealm:    basicAuthRealm,
		RateLimitPreset:   rateLimitPreset,
		RedirectRules:     redirectRules,
		CreatedAt:         parseTime(createdAt),
		UpdatedAt:         parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

func (t *tx) CreateMiddleware(ctx context.Context, in *store.Middleware) (*store.Middleware, error) {
	if in == nil {
		return nil, fmt.Errorf("sqlite: nil middleware")
	}
	if in.TenantID == "" || in.Name == "" || in.Kind == "" {
		return nil, fmt.Errorf("sqlite: middleware requires tenant_id, name, kind")
	}
	id := in.ID
	if id == "" {
		id = "mw_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	cfg := in.Config
	if cfg == "" {
		cfg = "{}"
	}
	enabled := 1
	if !in.Enabled {
		enabled = 0
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO middlewares (id, tenant_id, name, kind, config, enabled, order_hint, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, in.Kind, cfg, enabled, in.OrderHint, now, now,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "name") {
			return nil, store.ErrMiddlewareNameTaken
		}
		return nil, fmt.Errorf("sqlite: insert middleware: %w", err)
	}
	t.emit("middlewares", id, "INSERT")
	return t.GetMiddleware(ctx, in.TenantID, id)
}

func (t *tx) GetMiddleware(ctx context.Context, tenantID, id string) (*store.Middleware, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, kind, config, enabled, order_hint, created_at, updated_at
		 FROM middlewares WHERE id = ? AND tenant_id = ?`, id, tenantID)
	m, err := scanMiddleware(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrMiddlewareNotFound
	}
	return m, err
}

func (t *tx) ListMiddlewaresByTenant(ctx context.Context, tenantID string) ([]*store.Middleware, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, kind, config, enabled, order_hint, created_at, updated_at
		 FROM middlewares WHERE tenant_id = ? ORDER BY order_hint ASC, name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list middlewares: %w", err)
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

	enabled := 0
	if current.Enabled {
		enabled = 1
	}
	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx,
		`UPDATE middlewares SET name=?, kind=?, config=?, enabled=?, order_hint=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		current.Name, current.Kind, current.Config, enabled, current.OrderHint, now, id, tenantID,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "name") {
			return nil, store.ErrMiddlewareNameTaken
		}
		return nil, fmt.Errorf("sqlite: update middleware: %w", err)
	}
	t.emit("middlewares", id, "UPDATE")
	return t.GetMiddleware(ctx, tenantID, id)
}

func (t *tx) DeleteMiddleware(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM middlewares WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: delete middleware: %w", err)
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
		enabled                       int
		orderHint                     int32
		createdAt, updatedAt          string
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
		Enabled:   enabled == 1,
		OrderHint: orderHint,
		CreatedAt: parseTime(createdAt),
		UpdatedAt: parseTime(updatedAt),
	}, nil
}
