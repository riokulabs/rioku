package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// OAS + WAF config CRUD on routes is stubbed for postgres until the
// SQLite v1 implementation soaks. Migrations 41-42 land across all
// three dialects so the schema is ready; the Go-side queries for the
// per-route config tables follow as their own commit. The denial
// surface (Append / Query / Prune) is fully implemented because the
// data-plane Coraza audit logger writes through this path on every
// rule match in production.

func (t *tx) GetRouteOASConfig(_ context.Context, _ string) (*store.RouteOASConfig, error) {
	return nil, fmt.Errorf("postgres: GetRouteOASConfig not implemented")
}
func (t *tx) UpsertRouteOASConfig(_ context.Context, _ *store.RouteOASConfig) (*store.RouteOASConfig, error) {
	return nil, fmt.Errorf("postgres: UpsertRouteOASConfig not implemented")
}
func (t *tx) DeleteRouteOASConfig(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeleteRouteOASConfig not implemented")
}
func (t *tx) GetRouteWAFConfig(_ context.Context, _ string) (*store.RouteWAFConfig, error) {
	return nil, fmt.Errorf("postgres: GetRouteWAFConfig not implemented")
}
func (t *tx) UpsertRouteWAFConfig(_ context.Context, _ *store.RouteWAFConfig) (*store.RouteWAFConfig, error) {
	return nil, fmt.Errorf("postgres: UpsertRouteWAFConfig not implemented")
}
func (t *tx) DeleteRouteWAFConfig(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeleteRouteWAFConfig not implemented")
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
