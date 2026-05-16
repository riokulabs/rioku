package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Route OAS validator config (#171)
// ---------------------------------------------------------------------------

func (t *tx) GetRouteOASConfig(ctx context.Context, routeID string) (*store.RouteOASConfig, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT route_id, tenant_id, oas_url, oas_inline, refresh_interval_seconds,
		        validate_request_body, validate_request_params, reject_unknown,
		        created_at, updated_at
		 FROM route_oas_configs WHERE route_id = ? AND tenant_id = ?`),
		routeID, tenantID)
	var (
		c                                                    store.RouteOASConfig
		validateBody, validateParams, rejectUnknown bool
		createdAt, updatedAt                        time.Time
	)
	if err := row.Scan(
		&c.RouteID, &c.TenantID, &c.OASURL, &c.OASInline, &c.RefreshIntervalSeconds,
		&validateBody, &validateParams, &rejectUnknown, &createdAt, &updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrRouteOASConfigNotFound
		}
		return nil, fmt.Errorf("postgres: get route_oas_config: %w", err)
	}
	c.ValidateRequestBody = validateBody
	c.ValidateRequestParams = validateParams
	c.RejectUnknown = rejectUnknown
	c.CreatedAt = createdAt.UTC()
	c.UpdatedAt = updatedAt.UTC()
	return &c, nil
}

func (t *tx) UpsertRouteOASConfig(ctx context.Context, c *store.RouteOASConfig) (*store.RouteOASConfig, error) {
	if c == nil || c.RouteID == "" {
		return nil, fmt.Errorf("postgres: route_oas_config requires route_id")
	}
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = c.TenantID
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO route_oas_configs (route_id, tenant_id, oas_url, oas_inline,
		     refresh_interval_seconds, validate_request_body, validate_request_params,
		     reject_unknown, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (route_id) DO UPDATE SET
		     oas_url = excluded.oas_url,
		     oas_inline = excluded.oas_inline,
		     refresh_interval_seconds = excluded.refresh_interval_seconds,
		     validate_request_body = excluded.validate_request_body,
		     validate_request_params = excluded.validate_request_params,
		     reject_unknown = excluded.reject_unknown,
		     updated_at = excluded.updated_at`),
		c.RouteID, tenantID, c.OASURL, c.OASInline,
		c.RefreshIntervalSeconds, c.ValidateRequestBody,
		c.ValidateRequestParams, c.RejectUnknown,
		now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: upsert route_oas_config: %w", err)
	}
	return t.GetRouteOASConfig(ctx, c.RouteID)
}

func (t *tx) DeleteRouteOASConfig(ctx context.Context, routeID string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM route_oas_configs WHERE route_id = ? AND tenant_id = ?`),
		routeID, tenantID,
	)
	if err != nil {
		return fmt.Errorf("postgres: delete route_oas_config: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrRouteOASConfigNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Route WAF config (#172)
// ---------------------------------------------------------------------------

func (t *tx) GetRouteWAFConfig(ctx context.Context, routeID string) (*store.RouteWAFConfig, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT route_id, tenant_id, enabled, mode, rule_set, paranoia_level,
		        excluded_rule_ids, request_body_limit, created_at, updated_at
		 FROM route_waf_configs WHERE route_id = ? AND tenant_id = ?`),
		routeID, tenantID)
	var (
		c            store.RouteWAFConfig
		enabled      bool
		mode         string
		excludedJSON string
		createdAt    time.Time
		updatedAt    time.Time
	)
	if err := row.Scan(
		&c.RouteID, &c.TenantID, &enabled, &mode, &c.RuleSet, &c.ParanoiaLevel,
		&excludedJSON, &c.RequestBodyLimit, &createdAt, &updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrRouteWAFConfigNotFound
		}
		return nil, fmt.Errorf("postgres: get route_waf_config: %w", err)
	}
	c.Enabled = enabled
	c.Mode = store.WAFMode(mode)
	if err := json.Unmarshal([]byte(excludedJSON), &c.ExcludedRuleIDs); err != nil {
		return nil, fmt.Errorf("postgres: parse excluded_rule_ids: %w", err)
	}
	c.CreatedAt = createdAt.UTC()
	c.UpdatedAt = updatedAt.UTC()
	return &c, nil
}

func (t *tx) UpsertRouteWAFConfig(ctx context.Context, c *store.RouteWAFConfig) (*store.RouteWAFConfig, error) {
	if c == nil || c.RouteID == "" {
		return nil, fmt.Errorf("postgres: route_waf_config requires route_id")
	}
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = c.TenantID
	}
	if c.Mode == "" {
		c.Mode = store.WAFModeBlock
	}
	if c.RuleSet == "" {
		c.RuleSet = "crs"
	}
	if c.ParanoiaLevel == 0 {
		c.ParanoiaLevel = 1
	}
	if c.RequestBodyLimit == 0 {
		c.RequestBodyLimit = 131072
	}
	excluded := c.ExcludedRuleIDs
	if excluded == nil {
		excluded = []string{}
	}
	excludedJSON, err := json.Marshal(excluded)
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal excluded_rule_ids: %w", err)
	}
	now := nowUTC()
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO route_waf_configs (route_id, tenant_id, enabled, mode, rule_set,
		     paranoia_level, excluded_rule_ids, request_body_limit, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (route_id) DO UPDATE SET
		     enabled = excluded.enabled,
		     mode = excluded.mode,
		     rule_set = excluded.rule_set,
		     paranoia_level = excluded.paranoia_level,
		     excluded_rule_ids = excluded.excluded_rule_ids,
		     request_body_limit = excluded.request_body_limit,
		     updated_at = excluded.updated_at`),
		c.RouteID, tenantID, c.Enabled, string(c.Mode), c.RuleSet,
		c.ParanoiaLevel, string(excludedJSON), c.RequestBodyLimit,
		now, now,
	); err != nil {
		return nil, fmt.Errorf("postgres: upsert route_waf_config: %w", err)
	}
	return t.GetRouteWAFConfig(ctx, c.RouteID)
}

func (t *tx) DeleteRouteWAFConfig(ctx context.Context, routeID string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM route_waf_configs WHERE route_id = ? AND tenant_id = ?`),
		routeID, tenantID,
	)
	if err != nil {
		return fmt.Errorf("postgres: delete route_waf_config: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrRouteWAFConfigNotFound
	}
	return nil
}

func (t *tx) AppendWAFDenial(ctx context.Context, d *store.WAFDenial) error {
	if d == nil || d.ID == "" || d.RuleID == "" {
		return fmt.Errorf("postgres: waf_denial requires id + rule_id")
	}
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = d.TenantID
	}
	matchedAt := d.MatchedAt.UTC()
	if matchedAt.IsZero() {
		matchedAt = nowUTC()
	}
	metadata := d.Metadata
	if metadata == "" {
		metadata = "{}"
	}
	var routeID *string
	if d.RouteID != nil && *d.RouteID != "" {
		routeID = d.RouteID
	}
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO waf_denials (id, tenant_id, route_id, rule_id, severity, action,
		     request_uri, client_ip, matched_at, metadata)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		d.ID, tenantID, routeID, d.RuleID, d.Severity, d.Action,
		d.RequestURI, d.ClientIP, matchedAt, metadata,
	)
	if err != nil {
		return fmt.Errorf("postgres: append waf_denial: %w", err)
	}
	return nil
}

func (t *tx) QueryWAFDenials(ctx context.Context, q store.WAFDenialQuery) ([]*store.WAFDenial, error) {
	tenantID := store.TenantIDFromContext(ctx)
	var b strings.Builder
	b.WriteString(`SELECT id, tenant_id, route_id, rule_id, severity, action, request_uri,
	                      client_ip, matched_at, metadata
	               FROM waf_denials WHERE tenant_id = ?`)
	args := []any{tenantID}
	if q.RouteID != "" {
		b.WriteString(` AND route_id = ?`)
		args = append(args, q.RouteID)
	}
	if q.RuleID != "" {
		b.WriteString(` AND rule_id = ?`)
		args = append(args, q.RuleID)
	}
	if q.Severity != "" {
		b.WriteString(` AND severity = ?`)
		args = append(args, q.Severity)
	}
	if q.Since != nil {
		b.WriteString(` AND matched_at >= ?`)
		args = append(args, q.Since.UTC())
	}
	if q.Until != nil {
		b.WriteString(` AND matched_at <= ?`)
		args = append(args, q.Until.UTC())
	}
	b.WriteString(` ORDER BY matched_at DESC`)
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	b.WriteString(` LIMIT ?`)
	args = append(args, limit)
	if q.Offset > 0 {
		b.WriteString(` OFFSET ?`)
		args = append(args, q.Offset)
	}
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(b.String()), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: query waf_denials: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.WAFDenial
	for rows.Next() {
		var (
			d         store.WAFDenial
			routeID   sql.NullString
			matchedAt time.Time
		)
		if err := rows.Scan(
			&d.ID, &d.TenantID, &routeID, &d.RuleID, &d.Severity, &d.Action,
			&d.RequestURI, &d.ClientIP, &matchedAt, &d.Metadata,
		); err != nil {
			return nil, fmt.Errorf("postgres: scan waf_denial: %w", err)
		}
		if routeID.Valid {
			s := routeID.String
			d.RouteID = &s
		}
		d.MatchedAt = matchedAt.UTC()
		out = append(out, &d)
	}
	return out, rows.Err()
}

func (t *tx) PruneWAFDenials(ctx context.Context, before time.Time) (int64, error) {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM waf_denials WHERE matched_at < ?`),
		before.UTC(),
	)
	if err != nil {
		return 0, fmt.Errorf("postgres: prune waf_denials: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}
