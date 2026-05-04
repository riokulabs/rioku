package postgres

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

func (t *tx) CreateRoute(ctx context.Context, route *riokuv1.Route) (*riokuv1.Route, error) {
	id := uuid.New().String()
	now := nowUTC()

	matchersJSON, err := store.MarshalMatchersJSON(route.GetMatchers())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal matchers: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(route.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal labels: %w", err)
	}

	var targetServiceID *string
	var targetUpstreamJSON *string
	switch tgt := route.Target.(type) {
	case *riokuv1.Route_ServiceId:
		s := tgt.ServiceId
		targetServiceID = &s
	case *riokuv1.Route_Upstream:
		j, err := marshalDirectUpstreamJSON(tgt.Upstream)
		if err != nil {
			return nil, fmt.Errorf("postgres: marshal upstream: %w", err)
		}
		targetUpstreamJSON = &j
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO routes (id, tenant_id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, tenantID, route.GetName(), matchersJSON, targetServiceID, targetUpstreamJSON, route.GetEnabled(), labelsJSON, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert route: %w", err)
	}

	t.emit("routes", id, "INSERT")

	return t.GetRoute(ctx, id)
}

func (t *tx) GetRoute(ctx context.Context, id string) (*riokuv1.Route, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at
		 FROM routes WHERE id = ? AND tenant_id = ?`), id, tenantID)
	return scanRoute(row)
}

func (t *tx) ListRoutes(ctx context.Context) ([]*riokuv1.Route, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at
		 FROM routes WHERE tenant_id = ? ORDER BY id`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list routes: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var routes []*riokuv1.Route
	for rows.Next() {
		r, err := scanRouteRows(rows)
		if err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	return routes, rows.Err()
}

func (t *tx) UpdateRoute(ctx context.Context, route *riokuv1.Route) (*riokuv1.Route, error) {
	now := nowUTC()

	matchersJSON, err := store.MarshalMatchersJSON(route.GetMatchers())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal matchers: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(route.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal labels: %w", err)
	}

	var targetServiceID *string
	var targetUpstreamJSON *string
	switch tgt := route.Target.(type) {
	case *riokuv1.Route_ServiceId:
		s := tgt.ServiceId
		targetServiceID = &s
	case *riokuv1.Route_Upstream:
		j, err := marshalDirectUpstreamJSON(tgt.Upstream)
		if err != nil {
			return nil, fmt.Errorf("postgres: marshal upstream: %w", err)
		}
		targetUpstreamJSON = &j
	}

	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE routes SET name=?, matchers=?, target_service_id=?, target_upstream=?, enabled=?, labels=?, updated_at=?
		 WHERE id=? AND tenant_id=?`),
		route.GetName(), matchersJSON, targetServiceID, targetUpstreamJSON, route.GetEnabled(), labelsJSON, now, route.GetId(), tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: update route: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("postgres: route %q not found", route.GetId())
	}

	t.emit("routes", route.GetId(), "UPDATE")

	return t.GetRoute(ctx, route.GetId())
}

func (t *tx) DeleteRoute(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM routes WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete route: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: route %q not found", id)
	}
	// Clean up orphaned policy bindings for this route.
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM policy_bindings WHERE target_type = 'route' AND target_id = ?`), id,
	); err != nil {
		return fmt.Errorf("postgres: cleanup route policy_bindings: %w", err)
	}
	t.emit("routes", id, "DELETE")
	return nil
}
