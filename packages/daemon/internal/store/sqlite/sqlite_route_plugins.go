package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Route OAS validator config (#171)
// ---------------------------------------------------------------------------

func (t *tx) GetRouteOASConfig(ctx context.Context, routeID string) (*store.RouteOASConfig, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT route_id, tenant_id, oas_url, oas_inline, refresh_interval_seconds,
		        validate_request_body, validate_request_params, reject_unknown,
		        created_at, updated_at
		 FROM route_oas_configs WHERE route_id = ? AND tenant_id = ?`,
		routeID, tenantID)
	var (
		c                                                 store.RouteOASConfig
		validateBody, validateParams, rejectUnknown       int
		createdAt, updatedAt                              string
	)
	if err := row.Scan(
		&c.RouteID, &c.TenantID, &c.OASURL, &c.OASInline, &c.RefreshIntervalSeconds,
		&validateBody, &validateParams, &rejectUnknown, &createdAt, &updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrRouteOASConfigNotFound
		}
		return nil, fmt.Errorf("sqlite: get route_oas_config: %w", err)
	}
	c.ValidateRequestBody = validateBody == 1
	c.ValidateRequestParams = validateParams == 1
	c.RejectUnknown = rejectUnknown == 1
	c.CreatedAt = parseTime(createdAt)
	c.UpdatedAt = parseTime(updatedAt)
	return &c, nil
}

func (t *tx) UpsertRouteOASConfig(ctx context.Context, c *store.RouteOASConfig) (*store.RouteOASConfig, error) {
	if c == nil || c.RouteID == "" {
		return nil, fmt.Errorf("sqlite: route_oas_config requires route_id")
	}
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = c.TenantID
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
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
		     updated_at = excluded.updated_at`,
		c.RouteID, tenantID, c.OASURL, c.OASInline,
		c.RefreshIntervalSeconds, boolToInt(c.ValidateRequestBody),
		boolToInt(c.ValidateRequestParams), boolToInt(c.RejectUnknown),
		now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: upsert route_oas_config: %w", err)
	}
	t.emit("route_oas_configs", c.RouteID, "UPSERT")
	return t.GetRouteOASConfig(ctx, c.RouteID)
}

func (t *tx) DeleteRouteOASConfig(ctx context.Context, routeID string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM route_oas_configs WHERE route_id = ? AND tenant_id = ?`,
		routeID, tenantID,
	)
	if err != nil {
		return fmt.Errorf("sqlite: delete route_oas_config: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrRouteOASConfigNotFound
	}
	t.emit("route_oas_configs", routeID, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Route WAF config + denials (#172)
// ---------------------------------------------------------------------------

func (t *tx) GetRouteWAFConfig(ctx context.Context, routeID string) (*store.RouteWAFConfig, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT route_id, tenant_id, enabled, mode, rule_set, paranoia_level,
		        excluded_rule_ids, request_body_limit, created_at, updated_at
		 FROM route_waf_configs WHERE route_id = ? AND tenant_id = ?`,
		routeID, tenantID)
	var (
		c                          store.RouteWAFConfig
		enabledInt                 int
		mode                       string
		excludedJSON               string
		createdAt, updatedAt       string
	)
	if err := row.Scan(
		&c.RouteID, &c.TenantID, &enabledInt, &mode, &c.RuleSet, &c.ParanoiaLevel,
		&excludedJSON, &c.RequestBodyLimit, &createdAt, &updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrRouteWAFConfigNotFound
		}
		return nil, fmt.Errorf("sqlite: get route_waf_config: %w", err)
	}
	c.Enabled = enabledInt == 1
	c.Mode = store.WAFMode(mode)
	if err := json.Unmarshal([]byte(excludedJSON), &c.ExcludedRuleIDs); err != nil {
		return nil, fmt.Errorf("sqlite: parse excluded_rule_ids: %w", err)
	}
	c.CreatedAt = parseTime(createdAt)
	c.UpdatedAt = parseTime(updatedAt)
	return &c, nil
}

func (t *tx) UpsertRouteWAFConfig(ctx context.Context, c *store.RouteWAFConfig) (*store.RouteWAFConfig, error) {
	if c == nil || c.RouteID == "" {
		return nil, fmt.Errorf("sqlite: route_waf_config requires route_id")
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
		return nil, fmt.Errorf("sqlite: marshal excluded_rule_ids: %w", err)
	}
	now := nowUTC()
	if _, err := t.sqlTx.ExecContext(ctx,
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
		     updated_at = excluded.updated_at`,
		c.RouteID, tenantID, boolToInt(c.Enabled), string(c.Mode), c.RuleSet,
		c.ParanoiaLevel, string(excludedJSON), c.RequestBodyLimit,
		now, now,
	); err != nil {
		return nil, fmt.Errorf("sqlite: upsert route_waf_config: %w", err)
	}
	t.emit("route_waf_configs", c.RouteID, "UPSERT")
	return t.GetRouteWAFConfig(ctx, c.RouteID)
}

func (t *tx) DeleteRouteWAFConfig(ctx context.Context, routeID string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM route_waf_configs WHERE route_id = ? AND tenant_id = ?`,
		routeID, tenantID,
	)
	if err != nil {
		return fmt.Errorf("sqlite: delete route_waf_config: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrRouteWAFConfigNotFound
	}
	t.emit("route_waf_configs", routeID, "DELETE")
	return nil
}

// PruneWAFDenials drops WAF denial rows older than `before` (#203).
// Returns the number of rows removed.
func (t *tx) PruneWAFDenials(ctx context.Context, before time.Time) (int64, error) {
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM waf_denials WHERE matched_at < ?`,
		before.UTC().Format(timeFormat),
	)
	if err != nil {
		return 0, fmt.Errorf("sqlite: prune waf_denials: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (t *tx) AppendWAFDenial(ctx context.Context, d *store.WAFDenial) error {
	if d == nil || d.ID == "" || d.RuleID == "" {
		return fmt.Errorf("sqlite: waf_denial requires id + rule_id")
	}
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = d.TenantID
	}
	matchedAt := nowUTC()
	if !d.MatchedAt.IsZero() {
		matchedAt = d.MatchedAt.UTC().Format(timeFormat)
	}
	metadata := d.Metadata
	if metadata == "" {
		metadata = "{}"
	}
	var routeID *string
	if d.RouteID != nil && *d.RouteID != "" {
		routeID = d.RouteID
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO waf_denials (id, tenant_id, route_id, rule_id, severity, action,
		     request_uri, client_ip, matched_at, metadata)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.ID, tenantID, routeID, d.RuleID, d.Severity, d.Action,
		d.RequestURI, d.ClientIP, matchedAt, metadata,
	)
	if err != nil {
		return fmt.Errorf("sqlite: append waf_denial: %w", err)
	}
	return nil
}

func (t *tx) QueryWAFDenials(ctx context.Context, q store.WAFDenialQuery) ([]*store.WAFDenial, error) {
	tenantID := store.TenantIDFromContext(ctx)
	sqlStr := `SELECT id, tenant_id, route_id, rule_id, severity, action, request_uri,
	                  client_ip, matched_at, metadata
	           FROM waf_denials WHERE tenant_id = ?`
	args := []any{tenantID}
	if q.RouteID != "" {
		sqlStr += ` AND route_id = ?`
		args = append(args, q.RouteID)
	}
	if q.RuleID != "" {
		sqlStr += ` AND rule_id = ?`
		args = append(args, q.RuleID)
	}
	if q.Severity != "" {
		sqlStr += ` AND severity = ?`
		args = append(args, q.Severity)
	}
	if q.Since != nil {
		sqlStr += ` AND matched_at >= ?`
		args = append(args, q.Since.UTC().Format(timeFormat))
	}
	if q.Until != nil {
		sqlStr += ` AND matched_at <= ?`
		args = append(args, q.Until.UTC().Format(timeFormat))
	}
	sqlStr += ` ORDER BY matched_at DESC`
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	sqlStr += ` LIMIT ?`
	args = append(args, limit)
	if q.Offset > 0 {
		sqlStr += ` OFFSET ?`
		args = append(args, q.Offset)
	}
	rows, err := t.sqlTx.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: query waf_denials: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.WAFDenial
	for rows.Next() {
		var (
			d         store.WAFDenial
			routeID   sql.NullString
			matchedAt string
		)
		if err := rows.Scan(
			&d.ID, &d.TenantID, &routeID, &d.RuleID, &d.Severity, &d.Action,
			&d.RequestURI, &d.ClientIP, &matchedAt, &d.Metadata,
		); err != nil {
			return nil, fmt.Errorf("sqlite: scan waf_denial: %w", err)
		}
		if routeID.Valid {
			s := routeID.String
			d.RouteID = &s
		}
		d.MatchedAt = parseTime(matchedAt)
		out = append(out, &d)
	}
	return out, rows.Err()
}
