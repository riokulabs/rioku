package mysql

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/store"
)

// tx wraps *sql.Tx and implements store.Tx. All CRUD methods are stubs
// returning "not implemented" errors until filled in by Phase 3c.
//
// MySQL uses ? placeholders natively (same as SQLite) — no placeholder
// rewriting is needed. Pass SQL directly to ExecContext/QueryContext/
// QueryRowContext without any transformation.
type tx struct {
	sqlTx  *sql.Tx
	notify chan store.ChangeEvent
}

func (t *tx) Commit() error   { return t.sqlTx.Commit() }
func (t *tx) Rollback() error { return t.sqlTx.Rollback() }

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

func (t *tx) CreateRoute(ctx context.Context, route *riokuv1.Route) (*riokuv1.Route, error) {
	id := uuid.New().String()
	now := nowUTC()

	matchersJSON, err := marshalMatchersJSON(route.GetMatchers())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal matchers: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(route.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal labels: %w", err)
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
			return nil, fmt.Errorf("mysql: marshal upstream: %w", err)
		}
		targetUpstreamJSON = &j
	}

	enabled := 1
	if !route.GetEnabled() {
		enabled = 0
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO routes (id, tenant_id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, route.GetName(), matchersJSON, targetServiceID, targetUpstreamJSON, enabled, labelsJSON, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert route: %w", err)
	}

	t.emit("routes", id, "INSERT")

	return t.GetRoute(ctx, id)
}

func (t *tx) GetRoute(ctx context.Context, id string) (*riokuv1.Route, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at
		 FROM routes WHERE id = ? AND tenant_id = ?`, id, tenantID)
	return scanRoute(row)
}

func (t *tx) ListRoutes(ctx context.Context) ([]*riokuv1.Route, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at
		 FROM routes WHERE tenant_id = ? ORDER BY id`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list routes: %w", err)
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

	matchersJSON, err := marshalMatchersJSON(route.GetMatchers())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal matchers: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(route.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal labels: %w", err)
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
			return nil, fmt.Errorf("mysql: marshal upstream: %w", err)
		}
		targetUpstreamJSON = &j
	}

	enabled := 1
	if !route.GetEnabled() {
		enabled = 0
	}

	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE routes SET name=?, matchers=?, target_service_id=?, target_upstream=?, enabled=?, labels=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		route.GetName(), matchersJSON, targetServiceID, targetUpstreamJSON, enabled, labelsJSON, now, route.GetId(), tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: update route: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("mysql: route %q not found", route.GetId())
	}

	t.emit("routes", route.GetId(), "UPDATE")

	return t.GetRoute(ctx, route.GetId())
}

func (t *tx) DeleteRoute(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM routes WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete route: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: route %q not found", id)
	}
	// Clean up orphaned policy bindings for this route.
	if _, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM policy_bindings WHERE target_type = 'route' AND target_id = ?`, id,
	); err != nil {
		return fmt.Errorf("mysql: cleanup route policy_bindings: %w", err)
	}
	t.emit("routes", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

func (t *tx) CreateService(ctx context.Context, svc *riokuv1.Service) (*riokuv1.Service, error) {
	id := uuid.New().String()
	now := nowUTC()

	hcJSON, err := marshalHealthCheckJSON(svc.GetHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal health_check: %w", err)
	}
	phcJSON, err := marshalPassiveHealthCheckJSON(svc.GetPassiveHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal passive_health_check: %w", err)
	}
	rpJSON, err := marshalRetryPolicyJSON(svc.GetRetryPolicy())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal retry_policy: %w", err)
	}
	utJSON, err := marshalUpstreamTLSJSON(svc.GetUpstreamTls())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal upstream_tls: %w", err)
	}
	cpJSON, err := marshalConnectionPoolJSON(svc.GetConnectionPool())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal connection_pool: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(svc.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO services (id, tenant_id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
		phcJSON, rpJSON, utJSON, cpJSON,
		svc.GetLbCookieName(), svc.GetLbHeaderName(),
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert service: %w", err)
	}

	// Insert upstreams.
	for _, u := range svc.GetUpstreams() {
		uid := uuid.New().String()
		healthy := 1
		if !u.GetHealthy() {
			healthy = 0
		}
		_, err = t.sqlTx.ExecContext(ctx,
			`INSERT INTO upstreams (id, service_id, address, weight, tls_mode, healthy, dial_err)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			uid, id, u.GetAddress(), u.GetWeight(), int32(u.GetTls()), healthy, u.GetDialErr(),
		)
		if err != nil {
			return nil, fmt.Errorf("mysql: insert upstream: %w", err)
		}
	}

	t.emit("services", id, "INSERT")

	return t.GetService(ctx, id)
}

func (t *tx) GetService(ctx context.Context, id string) (*riokuv1.Service, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name
		 FROM services WHERE id = ? AND tenant_id = ?`, id, tenantID)

	svc, err := scanService(row)
	if err != nil {
		return nil, err
	}

	upstreams, err := t.fetchUpstreams(ctx, svc.GetId())
	if err != nil {
		return nil, err
	}
	svc.Upstreams = upstreams
	return svc, nil
}

func (t *tx) ListServices(ctx context.Context) ([]*riokuv1.Service, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name FROM services WHERE tenant_id = ? ORDER BY id`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list services: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var services []*riokuv1.Service
	serviceIndex := make(map[string]*riokuv1.Service)
	for rows.Next() {
		svc, err := scanServiceRows(rows)
		if err != nil {
			return nil, err
		}
		services = append(services, svc)
		serviceIndex[svc.GetId()] = svc
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Batch-fetch all upstreams in a single query (fixes N+1).
	// Upstreams are scoped through their parent service's tenant.
	if len(services) > 0 {
		uRows, err := t.sqlTx.QueryContext(ctx,
			`SELECT u.id, u.service_id, u.address, u.weight, u.tls_mode, u.healthy, u.dial_err
			 FROM upstreams u JOIN services s ON s.id = u.service_id
			 WHERE s.tenant_id = ? ORDER BY u.service_id, u.id`, tenantID)
		if err != nil {
			return nil, fmt.Errorf("mysql: fetch all upstreams: %w", err)
		}
		defer func() { _ = uRows.Close() }()

		for uRows.Next() {
			var (
				uid       string
				serviceID string
				address   string
				weight    int32
				tlsMode   int32
				healthy   int
				dialErr   string
			)
			if err := uRows.Scan(&uid, &serviceID, &address, &weight, &tlsMode, &healthy, &dialErr); err != nil {
				return nil, fmt.Errorf("mysql: scan upstream: %w", err)
			}
			if svc, ok := serviceIndex[serviceID]; ok {
				svc.Upstreams = append(svc.Upstreams, &riokuv1.Upstream{
					Id:      uid,
					Address: address,
					Weight:  weight,
					Tls:     riokuv1.TLSMode(tlsMode),
					Healthy: healthy != 0,
					DialErr: dialErr,
				})
			}
		}
		if err := uRows.Err(); err != nil {
			return nil, err
		}
	}

	return services, nil
}

func (t *tx) UpdateService(ctx context.Context, svc *riokuv1.Service) (*riokuv1.Service, error) {
	now := nowUTC()

	hcJSON, err := marshalHealthCheckJSON(svc.GetHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal health_check: %w", err)
	}
	phcJSON, err := marshalPassiveHealthCheckJSON(svc.GetPassiveHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal passive_health_check: %w", err)
	}
	rpJSON, err := marshalRetryPolicyJSON(svc.GetRetryPolicy())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal retry_policy: %w", err)
	}
	utJSON, err := marshalUpstreamTLSJSON(svc.GetUpstreamTls())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal upstream_tls: %w", err)
	}
	cpJSON, err := marshalConnectionPoolJSON(svc.GetConnectionPool())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal connection_pool: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(svc.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE services SET name=?, lb_policy=?, health_check=?, labels=?, updated_at=?, dial_timeout_seconds=?, response_header_timeout_seconds=?, idle_timeout_seconds=?, passive_health_check=?, retry_policy=?, upstream_tls=?, connection_pool=?, lb_cookie_name=?, lb_header_name=?
		 WHERE id=? AND tenant_id=?`,
		svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
		phcJSON, rpJSON, utJSON, cpJSON,
		svc.GetLbCookieName(), svc.GetLbHeaderName(),
		svc.GetId(), tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: update service: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("mysql: service %q not found", svc.GetId())
	}

	// Replace upstreams: delete existing, insert new.
	if _, err := t.sqlTx.ExecContext(ctx, `DELETE FROM upstreams WHERE service_id = ?`, svc.GetId()); err != nil {
		return nil, fmt.Errorf("mysql: delete old upstreams: %w", err)
	}
	for _, u := range svc.GetUpstreams() {
		uid := u.GetId()
		if uid == "" {
			uid = uuid.New().String()
		}
		healthy := 1
		if !u.GetHealthy() {
			healthy = 0
		}
		_, err = t.sqlTx.ExecContext(ctx,
			`INSERT INTO upstreams (id, service_id, address, weight, tls_mode, healthy, dial_err)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			uid, svc.GetId(), u.GetAddress(), u.GetWeight(), int32(u.GetTls()), healthy, u.GetDialErr(),
		)
		if err != nil {
			return nil, fmt.Errorf("mysql: insert upstream: %w", err)
		}
	}

	t.emit("services", svc.GetId(), "UPDATE")

	return t.GetService(ctx, svc.GetId())
}

func (t *tx) DeleteService(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM services WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete service: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: service %q not found", id)
	}
	// Clean up orphaned policy bindings for this service.
	if _, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM policy_bindings WHERE target_type = 'service' AND target_id = ?`, id,
	); err != nil {
		return fmt.Errorf("mysql: cleanup service policy_bindings: %w", err)
	}
	t.emit("services", id, "DELETE")
	return nil
}

func (t *tx) fetchUpstreams(ctx context.Context, serviceID string) ([]*riokuv1.Upstream, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, address, weight, tls_mode, healthy, dial_err
		 FROM upstreams WHERE service_id = ?`, serviceID)
	if err != nil {
		return nil, fmt.Errorf("mysql: fetch upstreams: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var upstreams []*riokuv1.Upstream
	for rows.Next() {
		var (
			id      string
			address string
			weight  int32
			tlsMode int32
			healthy int
			dialErr string
		)
		if err := rows.Scan(&id, &address, &weight, &tlsMode, &healthy, &dialErr); err != nil {
			return nil, fmt.Errorf("mysql: scan upstream: %w", err)
		}
		upstreams = append(upstreams, &riokuv1.Upstream{
			Id:      id,
			Address: address,
			Weight:  weight,
			Tls:     riokuv1.TLSMode(tlsMode),
			Healthy: healthy != 0,
			DialErr: dialErr,
		})
	}
	return upstreams, rows.Err()
}

// ---------------------------------------------------------------------------
// Policies (proto)
// ---------------------------------------------------------------------------

func (t *tx) CreatePolicy(ctx context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error) {
	id := uuid.New().String()
	now := nowUTC()

	configJSON, err := marshalStructJSON(pol.GetConfig())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal policy config: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(pol.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO policies (id, tenant_id, name, type, config, labels, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, pol.GetName(), int32(pol.GetType()), configJSON, labelsJSON, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert policy: %w", err)
	}

	t.emit("policies", id, "INSERT")

	return t.GetPolicy(ctx, id)
}

func (t *tx) GetPolicy(ctx context.Context, id string) (*riokuv1.Policy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, type, config, labels, created_at, updated_at
		 FROM policies WHERE id = ? AND tenant_id = ?`, id, tenantID)
	return scanPolicy(row)
}

func (t *tx) ListPolicies(ctx context.Context) ([]*riokuv1.Policy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, type, config, labels, created_at, updated_at FROM policies WHERE tenant_id = ? ORDER BY id`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list policies: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var policies []*riokuv1.Policy
	for rows.Next() {
		p, err := scanPolicyRows(rows)
		if err != nil {
			return nil, err
		}
		policies = append(policies, p)
	}
	return policies, rows.Err()
}

func (t *tx) UpdatePolicy(ctx context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error) {
	now := nowUTC()

	configJSON, err := marshalStructJSON(pol.GetConfig())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal policy config: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(pol.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE policies SET name=?, type=?, config=?, labels=?, updated_at=? WHERE id=? AND tenant_id=?`,
		pol.GetName(), int32(pol.GetType()), configJSON, labelsJSON, now, pol.GetId(), tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: update policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("mysql: policy %q not found", pol.GetId())
	}

	t.emit("policies", pol.GetId(), "UPDATE")

	return t.GetPolicy(ctx, pol.GetId())
}

func (t *tx) DeletePolicy(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM policies WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: policy %q not found", id)
	}
	t.emit("policies", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Policy bindings
// ---------------------------------------------------------------------------

var validTargetTypes = map[string]bool{"route": true, "service": true}

func (t *tx) AttachPolicy(ctx context.Context, policyID, targetType, targetID string) error {
	if !validTargetTypes[targetType] {
		return fmt.Errorf("mysql: invalid target_type %q (must be 'route' or 'service')", targetType)
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO policy_bindings (policy_id, target_type, target_id) VALUES (?, ?, ?)`,
		policyID, targetType, targetID,
	)
	if err != nil {
		return fmt.Errorf("mysql: attach policy: %w", err)
	}
	t.emit("policy_bindings", policyID, "INSERT")
	return nil
}

func (t *tx) DetachPolicy(ctx context.Context, policyID, targetType, targetID string) error {
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM policy_bindings WHERE policy_id=? AND target_type=? AND target_id=?`,
		policyID, targetType, targetID,
	)
	if err != nil {
		return fmt.Errorf("mysql: detach policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: policy binding not found")
	}
	t.emit("policy_bindings", policyID, "DELETE")
	return nil
}

func (t *tx) ListPoliciesByTarget(ctx context.Context, targetType, targetID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT policy_id FROM policy_bindings WHERE target_type=? AND target_id=?`,
		targetType, targetID,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: list policies by target: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("mysql: scan policy_id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

func (t *tx) CreateAPIKey(_ context.Context, _, _ string, _ []string, _ *time.Time, _ string) (string, error) {
	return "", errors.New("mysql: CreateAPIKey not implemented")
}

func (t *tx) GetAPIKey(_ context.Context, _ string) (*store.APIKey, error) {
	return nil, errors.New("mysql: GetAPIKey not implemented")
}

func (t *tx) GetAPIKeyByHash(_ context.Context, _ string) (*store.APIKey, error) {
	return nil, errors.New("mysql: GetAPIKeyByHash not implemented")
}

func (t *tx) ListAPIKeys(_ context.Context) ([]*store.APIKey, error) {
	return nil, errors.New("mysql: ListAPIKeys not implemented")
}

func (t *tx) ListAPIKeysByOwner(_ context.Context, _ string) ([]*store.APIKey, error) {
	return nil, errors.New("mysql: ListAPIKeysByOwner not implemented")
}

func (t *tx) RevokeAPIKey(_ context.Context, _ string) error {
	return errors.New("mysql: RevokeAPIKey not implemented")
}

func (t *tx) UpdateAPIKey(_ context.Context, _ string, _ store.UpdateAPIKeyParams) (*store.APIKey, error) {
	return nil, errors.New("mysql: UpdateAPIKey not implemented")
}

func (t *tx) RecordAPIKeyUse(_ context.Context, _ string, _ time.Time) error {
	return errors.New("mysql: RecordAPIKeyUse not implemented")
}

// ---------------------------------------------------------------------------
// Config Versions
// ---------------------------------------------------------------------------

func (t *tx) SaveConfigVersion(_ context.Context, _ []byte, _ string) (int64, error) {
	return 0, errors.New("mysql: SaveConfigVersion not implemented")
}

func (t *tx) GetConfigVersion(_ context.Context, _ int64) (*store.ConfigVersion, error) {
	return nil, errors.New("mysql: GetConfigVersion not implemented")
}

func (t *tx) ListConfigVersions(_ context.Context, _ int) ([]*store.ConfigVersion, error) {
	return nil, errors.New("mysql: ListConfigVersions not implemented")
}

func (t *tx) LatestConfigVersion(_ context.Context) (int64, error) {
	return 0, errors.New("mysql: LatestConfigVersion not implemented")
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

func (t *tx) AppendAuditEntry(_ context.Context, _ *riokuv1.AuditEntry) error {
	return errors.New("mysql: AppendAuditEntry not implemented")
}

func (t *tx) QueryAuditLog(_ context.Context, _ store.AuditQuery) ([]*riokuv1.AuditEntry, error) {
	return nil, errors.New("mysql: QueryAuditLog not implemented")
}

func (t *tx) CountAuditLog(_ context.Context, _ store.AuditQuery) (int, error) {
	return 0, errors.New("mysql: CountAuditLog not implemented")
}

func (t *tx) GetAuditEntry(_ context.Context, _ string) (*riokuv1.AuditEntry, error) {
	return nil, errors.New("mysql: GetAuditEntry not implemented")
}

func (t *tx) ListAuditActors(_ context.Context, _ string, _ int) ([]string, error) {
	return nil, errors.New("mysql: ListAuditActors not implemented")
}

func (t *tx) ListAuditResourceIDs(_ context.Context, _, _ string, _ int) ([]string, error) {
	return nil, errors.New("mysql: ListAuditResourceIDs not implemented")
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

func (t *tx) CreateUser(_ context.Context, _ *store.User) (*store.User, error) {
	return nil, errors.New("mysql: CreateUser not implemented")
}

func (t *tx) GetUser(_ context.Context, _ string) (*store.User, error) {
	return nil, errors.New("mysql: GetUser not implemented")
}

func (t *tx) GetUserByUsername(_ context.Context, _ string) (*store.User, error) {
	return nil, errors.New("mysql: GetUserByUsername not implemented")
}

func (t *tx) ListUsers(_ context.Context) ([]*store.User, error) {
	return nil, errors.New("mysql: ListUsers not implemented")
}

func (t *tx) UpdateUser(_ context.Context, _ *store.User) (*store.User, error) {
	return nil, errors.New("mysql: UpdateUser not implemented")
}

func (t *tx) DeleteUser(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteUser not implemented")
}

func (t *tx) IncrementFailedAttempts(_ context.Context, _ string, _ *time.Time) error {
	return errors.New("mysql: IncrementFailedAttempts not implemented")
}

func (t *tx) ResetFailedAttempts(_ context.Context, _ string) error {
	return errors.New("mysql: ResetFailedAttempts not implemented")
}

func (t *tx) UpdateLastLogin(_ context.Context, _ string) error {
	return errors.New("mysql: UpdateLastLogin not implemented")
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

func (t *tx) CreateSession(_ context.Context, _ *store.Session) (*store.Session, error) {
	return nil, errors.New("mysql: CreateSession not implemented")
}

func (t *tx) GetSession(_ context.Context, _ string) (*store.Session, error) {
	return nil, errors.New("mysql: GetSession not implemented")
}

func (t *tx) ListSessionsByUser(_ context.Context, _ string) ([]*store.Session, error) {
	return nil, errors.New("mysql: ListSessionsByUser not implemented")
}

func (t *tx) DeleteSession(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteSession not implemented")
}

func (t *tx) DeleteSessionsByUser(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteSessionsByUser not implemented")
}

func (t *tx) DeleteSessionsByUserExcept(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteSessionsByUserExcept not implemented")
}

func (t *tx) UpdateSessionLastActive(_ context.Context, _ string, _ time.Time) error {
	return errors.New("mysql: UpdateSessionLastActive not implemented")
}

func (t *tx) DeleteExpiredSessions(_ context.Context) (int64, error) {
	return 0, errors.New("mysql: DeleteExpiredSessions not implemented")
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

func (t *tx) CreateRole(_ context.Context, _ store.CreateRoleParams) (*store.Role, error) {
	return nil, errors.New("mysql: CreateRole not implemented")
}

func (t *tx) GetRole(_ context.Context, _ string) (*store.Role, error) {
	return nil, errors.New("mysql: GetRole not implemented")
}

func (t *tx) ListRoles(_ context.Context) ([]*store.Role, error) {
	return nil, errors.New("mysql: ListRoles not implemented")
}

func (t *tx) UpdateRole(_ context.Context, _ string, _ store.UpdateRoleParams) (*store.Role, error) {
	return nil, errors.New("mysql: UpdateRole not implemented")
}

func (t *tx) DeleteRole(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteRole not implemented")
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

func (t *tx) ListPermissions(_ context.Context) ([]*store.Permission, error) {
	return nil, errors.New("mysql: ListPermissions not implemented")
}

func (t *tx) GetUserScopes(_ context.Context, _ string) ([]string, error) {
	return nil, errors.New("mysql: GetUserScopes not implemented")
}

// ---------------------------------------------------------------------------
// User Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignRole(_ context.Context, _, _, _ string) error {
	return errors.New("mysql: AssignRole not implemented")
}

func (t *tx) RevokeRole(_ context.Context, _, _ string) error {
	return errors.New("mysql: RevokeRole not implemented")
}

func (t *tx) ListUserRoles(_ context.Context, _ string) ([]*store.UserRole, error) {
	return nil, errors.New("mysql: ListUserRoles not implemented")
}

func (t *tx) ListUsersWithRole(_ context.Context, _ string) ([]string, error) {
	return nil, errors.New("mysql: ListUsersWithRole not implemented")
}

// ---------------------------------------------------------------------------
// TOTP Backup Codes
// ---------------------------------------------------------------------------

func (t *tx) CreateTOTPBackupCodes(_ context.Context, _ string, _ []string) error {
	return errors.New("mysql: CreateTOTPBackupCodes not implemented")
}

func (t *tx) ListUnusedTOTPBackupCodes(_ context.Context, _ string) ([]*store.TOTPBackupCode, error) {
	return nil, errors.New("mysql: ListUnusedTOTPBackupCodes not implemented")
}

func (t *tx) MarkTOTPBackupCodeUsed(_ context.Context, _ string) error {
	return errors.New("mysql: MarkTOTPBackupCodeUsed not implemented")
}

func (t *tx) DeleteTOTPBackupCodes(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteTOTPBackupCodes not implemented")
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

func (t *tx) CreateTenant(_ context.Context, _ *store.Tenant) (*store.Tenant, error) {
	return nil, errors.New("mysql: CreateTenant not implemented")
}

func (t *tx) GetTenant(_ context.Context, _ string) (*store.Tenant, error) {
	return nil, errors.New("mysql: GetTenant not implemented")
}

func (t *tx) GetTenantBySlug(_ context.Context, _ string) (*store.Tenant, error) {
	return nil, errors.New("mysql: GetTenantBySlug not implemented")
}

func (t *tx) ListTenants(_ context.Context) ([]*store.Tenant, error) {
	return nil, errors.New("mysql: ListTenants not implemented")
}

func (t *tx) UpdateTenant(_ context.Context, _ string, _ store.UpdateTenantParams) (*store.Tenant, error) {
	return nil, errors.New("mysql: UpdateTenant not implemented")
}

func (t *tx) DeleteTenant(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteTenant not implemented")
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

func (t *tx) CreateMembership(_ context.Context, _ *store.Membership) (*store.Membership, error) {
	return nil, errors.New("mysql: CreateMembership not implemented")
}

func (t *tx) GetMembership(_ context.Context, _ string) (*store.Membership, error) {
	return nil, errors.New("mysql: GetMembership not implemented")
}

func (t *tx) GetMembershipByTenantUser(_ context.Context, _, _ string) (*store.Membership, error) {
	return nil, errors.New("mysql: GetMembershipByTenantUser not implemented")
}

func (t *tx) ListMembershipsByTenant(_ context.Context, _ string) ([]*store.Membership, error) {
	return nil, errors.New("mysql: ListMembershipsByTenant not implemented")
}

func (t *tx) ListMembershipsByUser(_ context.Context, _ string) ([]*store.Membership, error) {
	return nil, errors.New("mysql: ListMembershipsByUser not implemented")
}

func (t *tx) UpdateMembershipState(_ context.Context, _, _ string) (*store.Membership, error) {
	return nil, errors.New("mysql: UpdateMembershipState not implemented")
}

func (t *tx) DeleteMembership(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteMembership not implemented")
}

// ---------------------------------------------------------------------------
// Membership Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignMembershipRole(_ context.Context, _, _, _ string) error {
	return errors.New("mysql: AssignMembershipRole not implemented")
}

func (t *tx) RevokeMembershipRole(_ context.Context, _, _ string) error {
	return errors.New("mysql: RevokeMembershipRole not implemented")
}

func (t *tx) ListMembershipRoles(_ context.Context, _ string) ([]store.Role, error) {
	return nil, errors.New("mysql: ListMembershipRoles not implemented")
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboard(_ context.Context, _ *store.Dashboard) (*store.Dashboard, error) {
	return nil, errors.New("mysql: CreateDashboard not implemented")
}

func (t *tx) GetDashboard(_ context.Context, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("mysql: GetDashboard not implemented")
}

func (t *tx) ListDashboardsByTenant(_ context.Context, _ string) ([]*store.Dashboard, error) {
	return nil, errors.New("mysql: ListDashboardsByTenant not implemented")
}

func (t *tx) UpdateDashboard(_ context.Context, _, _ string, _ store.UpdateDashboardParams) (*store.Dashboard, error) {
	return nil, errors.New("mysql: UpdateDashboard not implemented")
}

func (t *tx) DeleteDashboard(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteDashboard not implemented")
}

func (t *tx) SetDefaultDashboard(_ context.Context, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("mysql: SetDefaultDashboard not implemented")
}

func (t *tx) SetDashboardHomeForUser(_ context.Context, _, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("mysql: SetDashboardHomeForUser not implemented")
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

func (t *tx) CreateWidget(_ context.Context, _ *store.Widget) (*store.Widget, error) {
	return nil, errors.New("mysql: CreateWidget not implemented")
}

func (t *tx) GetWidget(_ context.Context, _ string) (*store.Widget, error) {
	return nil, errors.New("mysql: GetWidget not implemented")
}

func (t *tx) ListWidgetsByDashboard(_ context.Context, _ string) ([]*store.Widget, error) {
	return nil, errors.New("mysql: ListWidgetsByDashboard not implemented")
}

func (t *tx) UpdateWidget(_ context.Context, _ string, _ store.UpdateWidgetParams) (*store.Widget, error) {
	return nil, errors.New("mysql: UpdateWidget not implemented")
}

func (t *tx) DeleteWidget(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteWidget not implemented")
}

func (t *tx) UpdateDashboardLayout(_ context.Context, _ string, _ map[string]string) error {
	return errors.New("mysql: UpdateDashboardLayout not implemented")
}

// ---------------------------------------------------------------------------
// Dashboard Versions
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardVersion(_ context.Context, _ *store.DashboardVersion) (*store.DashboardVersion, error) {
	return nil, errors.New("mysql: CreateDashboardVersion not implemented")
}

func (t *tx) GetDashboardVersion(_ context.Context, _ string) (*store.DashboardVersion, error) {
	return nil, errors.New("mysql: GetDashboardVersion not implemented")
}

func (t *tx) ListDashboardVersions(_ context.Context, _ string) ([]*store.DashboardVersion, error) {
	return nil, errors.New("mysql: ListDashboardVersions not implemented")
}

// ---------------------------------------------------------------------------
// Dashboard Shares
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardShare(_ context.Context, _ *store.DashboardShare) (*store.DashboardShare, error) {
	return nil, errors.New("mysql: CreateDashboardShare not implemented")
}

func (t *tx) ListDashboardShares(_ context.Context, _ string) ([]*store.DashboardShare, error) {
	return nil, errors.New("mysql: ListDashboardShares not implemented")
}

func (t *tx) DeleteDashboardShare(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteDashboardShare not implemented")
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

func (t *tx) CreateWebhookEndpoint(_ context.Context, _ *store.WebhookEndpoint) (*store.WebhookEndpoint, error) {
	return nil, errors.New("mysql: CreateWebhookEndpoint not implemented")
}

func (t *tx) GetWebhookEndpoint(_ context.Context, _, _ string) (*store.WebhookEndpoint, error) {
	return nil, errors.New("mysql: GetWebhookEndpoint not implemented")
}

func (t *tx) ListWebhookEndpointsByTenant(_ context.Context, _ string) ([]*store.WebhookEndpoint, error) {
	return nil, errors.New("mysql: ListWebhookEndpointsByTenant not implemented")
}

func (t *tx) UpdateWebhookEndpoint(_ context.Context, _, _ string, _ store.UpdateWebhookEndpointParams) (*store.WebhookEndpoint, error) {
	return nil, errors.New("mysql: UpdateWebhookEndpoint not implemented")
}

func (t *tx) DeleteWebhookEndpoint(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteWebhookEndpoint not implemented")
}

// ---------------------------------------------------------------------------
// Cluster Enrollment Tokens
// ---------------------------------------------------------------------------

func (t *tx) CreateEnrollmentToken(_ context.Context, _ *store.ClusterEnrollmentToken) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("mysql: CreateEnrollmentToken not implemented")
}

func (t *tx) GetEnrollmentTokenByHash(_ context.Context, _ string) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("mysql: GetEnrollmentTokenByHash not implemented")
}

func (t *tx) ListActiveEnrollmentTokens(_ context.Context) ([]*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("mysql: ListActiveEnrollmentTokens not implemented")
}

func (t *tx) ConsumeEnrollmentToken(_ context.Context, _, _ string) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("mysql: ConsumeEnrollmentToken not implemented")
}

func (t *tx) RevokeEnrollmentToken(_ context.Context, _ string) error {
	return errors.New("mysql: RevokeEnrollmentToken not implemented")
}

// ---------------------------------------------------------------------------
// Impersonation Sessions
// ---------------------------------------------------------------------------

func (t *tx) CreateImpersonationSession(_ context.Context, _ *store.ImpersonationSession) (*store.ImpersonationSession, error) {
	return nil, errors.New("mysql: CreateImpersonationSession not implemented")
}

func (t *tx) GetImpersonationSession(_ context.Context, _ string) (*store.ImpersonationSession, error) {
	return nil, errors.New("mysql: GetImpersonationSession not implemented")
}

func (t *tx) ListActiveImpersonationSessions(_ context.Context) ([]*store.ImpersonationSession, error) {
	return nil, errors.New("mysql: ListActiveImpersonationSessions not implemented")
}

func (t *tx) EndImpersonationSession(_ context.Context, _, _ string) (*store.ImpersonationSession, error) {
	return nil, errors.New("mysql: EndImpersonationSession not implemented")
}

func (t *tx) TouchImpersonationSession(_ context.Context, _ string) error {
	return errors.New("mysql: TouchImpersonationSession not implemented")
}

// ---------------------------------------------------------------------------
// Settings configs (singleton per tenant)
// ---------------------------------------------------------------------------

func (t *tx) GetNetworkConfig(_ context.Context, _ string) (*store.NetworkConfig, error) {
	return nil, errors.New("mysql: GetNetworkConfig not implemented")
}

func (t *tx) UpsertNetworkConfig(_ context.Context, _ *store.NetworkConfig) (*store.NetworkConfig, error) {
	return nil, errors.New("mysql: UpsertNetworkConfig not implemented")
}

func (t *tx) GetTenantAuthPolicy(_ context.Context, _ string) (*store.TenantAuthPolicy, error) {
	return nil, errors.New("mysql: GetTenantAuthPolicy not implemented")
}

func (t *tx) UpsertTenantAuthPolicy(_ context.Context, _ *store.TenantAuthPolicy) (*store.TenantAuthPolicy, error) {
	return nil, errors.New("mysql: UpsertTenantAuthPolicy not implemented")
}

func (t *tx) GetObservabilityConfig(_ context.Context, _ string) (*store.ObservabilityConfig, error) {
	return nil, errors.New("mysql: GetObservabilityConfig not implemented")
}

func (t *tx) UpsertObservabilityConfig(_ context.Context, _ *store.ObservabilityConfig) (*store.ObservabilityConfig, error) {
	return nil, errors.New("mysql: UpsertObservabilityConfig not implemented")
}

func (t *tx) GetAuditRetentionConfig(_ context.Context, _ string) (*store.AuditRetentionConfig, error) {
	return nil, errors.New("mysql: GetAuditRetentionConfig not implemented")
}

func (t *tx) UpsertAuditRetentionConfig(_ context.Context, _ *store.AuditRetentionConfig) (*store.AuditRetentionConfig, error) {
	return nil, errors.New("mysql: UpsertAuditRetentionConfig not implemented")
}

// ---------------------------------------------------------------------------
// PKI / TLS
// ---------------------------------------------------------------------------

func (t *tx) CreateCertAuthority(_ context.Context, _ *store.CertAuthority) (*store.CertAuthority, error) {
	return nil, errors.New("mysql: CreateCertAuthority not implemented")
}

func (t *tx) GetCertAuthority(_ context.Context, _, _ string) (*store.CertAuthority, error) {
	return nil, errors.New("mysql: GetCertAuthority not implemented")
}

func (t *tx) ListCertAuthoritiesByTenant(_ context.Context, _ string) ([]*store.CertAuthority, error) {
	return nil, errors.New("mysql: ListCertAuthoritiesByTenant not implemented")
}

func (t *tx) UpdateCertAuthority(_ context.Context, _, _ string, _ store.UpdateCertAuthorityParams) (*store.CertAuthority, error) {
	return nil, errors.New("mysql: UpdateCertAuthority not implemented")
}

func (t *tx) DeleteCertAuthority(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteCertAuthority not implemented")
}

func (t *tx) CreateCertEnrollment(_ context.Context, _ *store.CertEnrollment) (*store.CertEnrollment, error) {
	return nil, errors.New("mysql: CreateCertEnrollment not implemented")
}

func (t *tx) GetCertEnrollment(_ context.Context, _, _ string) (*store.CertEnrollment, error) {
	return nil, errors.New("mysql: GetCertEnrollment not implemented")
}

func (t *tx) ListCertEnrollmentsByTenant(_ context.Context, _ string) ([]*store.CertEnrollment, error) {
	return nil, errors.New("mysql: ListCertEnrollmentsByTenant not implemented")
}

func (t *tx) UpdateCertEnrollment(_ context.Context, _, _ string, _ store.UpdateCertEnrollmentParams) (*store.CertEnrollment, error) {
	return nil, errors.New("mysql: UpdateCertEnrollment not implemented")
}

func (t *tx) RevokeCertEnrollmentRow(_ context.Context, _, _, _ string) (*store.CertEnrollment, error) {
	return nil, errors.New("mysql: RevokeCertEnrollmentRow not implemented")
}

func (t *tx) CreateTLSCertificate(_ context.Context, _ *store.TLSCertificate) (*store.TLSCertificate, error) {
	return nil, errors.New("mysql: CreateTLSCertificate not implemented")
}

func (t *tx) GetTLSCertificate(_ context.Context, _, _ string) (*store.TLSCertificate, error) {
	return nil, errors.New("mysql: GetTLSCertificate not implemented")
}

func (t *tx) ListTLSCertificatesByTenant(_ context.Context, _ string) ([]*store.TLSCertificate, error) {
	return nil, errors.New("mysql: ListTLSCertificatesByTenant not implemented")
}

func (t *tx) UpdateTLSCertificate(_ context.Context, _, _ string, _ store.UpdateTLSCertificateParams) (*store.TLSCertificate, error) {
	return nil, errors.New("mysql: UpdateTLSCertificate not implemented")
}

func (t *tx) DeleteTLSCertificate(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteTLSCertificate not implemented")
}

func (t *tx) GetTLSConfig(_ context.Context, _ string) (*store.TLSConfig, error) {
	return nil, errors.New("mysql: GetTLSConfig not implemented")
}

func (t *tx) UpsertTLSConfig(_ context.Context, _ *store.TLSConfig) (*store.TLSConfig, error) {
	return nil, errors.New("mysql: UpsertTLSConfig not implemented")
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

func (t *tx) CreatePlugin(_ context.Context, _ *store.Plugin) (*store.Plugin, error) {
	return nil, errors.New("mysql: CreatePlugin not implemented")
}

func (t *tx) GetPlugin(_ context.Context, _, _ string) (*store.Plugin, error) {
	return nil, errors.New("mysql: GetPlugin not implemented")
}

func (t *tx) ListPluginsByScope(_ context.Context, _ string) ([]*store.Plugin, error) {
	return nil, errors.New("mysql: ListPluginsByScope not implemented")
}

func (t *tx) UpdatePlugin(_ context.Context, _, _ string, _ store.UpdatePluginParams) (*store.Plugin, error) {
	return nil, errors.New("mysql: UpdatePlugin not implemented")
}

func (t *tx) DeletePlugin(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeletePlugin not implemented")
}

func (t *tx) CreatePluginSigner(_ context.Context, _ *store.PluginSigner) (*store.PluginSigner, error) {
	return nil, errors.New("mysql: CreatePluginSigner not implemented")
}

func (t *tx) GetPluginSigner(_ context.Context, _, _ string) (*store.PluginSigner, error) {
	return nil, errors.New("mysql: GetPluginSigner not implemented")
}

func (t *tx) ListPluginSignersByScope(_ context.Context, _ string) ([]*store.PluginSigner, error) {
	return nil, errors.New("mysql: ListPluginSignersByScope not implemented")
}

func (t *tx) UpdatePluginSigner(_ context.Context, _, _ string, _ store.UpdatePluginSignerParams) (*store.PluginSigner, error) {
	return nil, errors.New("mysql: UpdatePluginSigner not implemented")
}

func (t *tx) DeletePluginSigner(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeletePluginSigner not implemented")
}

func (t *tx) ListPluginsBySigner(_ context.Context, _ string) ([]*store.Plugin, error) {
	return nil, errors.New("mysql: ListPluginsBySigner not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Items
// ---------------------------------------------------------------------------

func (t *tx) AppendNotificationItem(_ context.Context, _ *store.NotificationItem) (*store.NotificationItem, error) {
	return nil, errors.New("mysql: AppendNotificationItem not implemented")
}

func (t *tx) GetNotificationItem(_ context.Context, _ string) (*store.NotificationItem, error) {
	return nil, errors.New("mysql: GetNotificationItem not implemented")
}

func (t *tx) ListNotificationItemsByUser(_ context.Context, _, _ string, _ store.NotificationItemQuery) ([]*store.NotificationItem, error) {
	return nil, errors.New("mysql: ListNotificationItemsByUser not implemented")
}

func (t *tx) CountUnreadNotifications(_ context.Context, _, _ string) (int, error) {
	return 0, errors.New("mysql: CountUnreadNotifications not implemented")
}

func (t *tx) MarkNotificationRead(_ context.Context, _ string) error {
	return errors.New("mysql: MarkNotificationRead not implemented")
}

func (t *tx) MarkAllNotificationsRead(_ context.Context, _, _ string) error {
	return errors.New("mysql: MarkAllNotificationsRead not implemented")
}

func (t *tx) ArchiveNotification(_ context.Context, _ string, _ bool) error {
	return errors.New("mysql: ArchiveNotification not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Channels
// ---------------------------------------------------------------------------

func (t *tx) CreateNotificationChannel(_ context.Context, _ *store.NotificationChannel) (*store.NotificationChannel, error) {
	return nil, errors.New("mysql: CreateNotificationChannel not implemented")
}

func (t *tx) GetNotificationChannel(_ context.Context, _, _ string) (*store.NotificationChannel, error) {
	return nil, errors.New("mysql: GetNotificationChannel not implemented")
}

func (t *tx) ListNotificationChannelsByTenant(_ context.Context, _ string) ([]*store.NotificationChannel, error) {
	return nil, errors.New("mysql: ListNotificationChannelsByTenant not implemented")
}

func (t *tx) UpdateNotificationChannel(_ context.Context, _, _ string, _ store.UpdateNotificationChannelParams) (*store.NotificationChannel, error) {
	return nil, errors.New("mysql: UpdateNotificationChannel not implemented")
}

func (t *tx) DeleteNotificationChannel(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteNotificationChannel not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Routing Rules
// ---------------------------------------------------------------------------

func (t *tx) CreateRoutingRule(_ context.Context, _ *store.NotificationRoutingRule) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("mysql: CreateRoutingRule not implemented")
}

func (t *tx) GetRoutingRule(_ context.Context, _, _ string) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("mysql: GetRoutingRule not implemented")
}

func (t *tx) ListRoutingRulesByTenant(_ context.Context, _ string) ([]*store.NotificationRoutingRule, error) {
	return nil, errors.New("mysql: ListRoutingRulesByTenant not implemented")
}

func (t *tx) UpdateRoutingRule(_ context.Context, _, _ string, _ store.UpdateRoutingRuleParams) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("mysql: UpdateRoutingRule not implemented")
}

func (t *tx) DeleteRoutingRule(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteRoutingRule not implemented")
}

func (t *tx) ReorderRoutingRules(_ context.Context, _ string, _ []string) error {
	return errors.New("mysql: ReorderRoutingRules not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Delivery Log
// ---------------------------------------------------------------------------

func (t *tx) AppendDeliveryLogEntry(_ context.Context, _ *store.NotificationDeliveryLogEntry) (*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("mysql: AppendDeliveryLogEntry not implemented")
}

func (t *tx) GetDeliveryLogEntry(_ context.Context, _, _ string) (*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("mysql: GetDeliveryLogEntry not implemented")
}

func (t *tx) ListDeliveryLogByTenant(_ context.Context, _ string, _ store.DeliveryLogQuery) ([]*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("mysql: ListDeliveryLogByTenant not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Tenant Config
// ---------------------------------------------------------------------------

func (t *tx) GetTenantNotificationConfig(_ context.Context, _ string) (*store.TenantNotificationConfig, error) {
	return nil, errors.New("mysql: GetTenantNotificationConfig not implemented")
}

func (t *tx) UpsertTenantNotificationConfig(_ context.Context, _ *store.TenantNotificationConfig) (*store.TenantNotificationConfig, error) {
	return nil, errors.New("mysql: UpsertTenantNotificationConfig not implemented")
}

// ---------------------------------------------------------------------------
// AI — Providers
// ---------------------------------------------------------------------------

func (t *tx) CreateAIProvider(_ context.Context, _ *store.AIProvider) (*store.AIProvider, error) {
	return nil, errors.New("mysql: CreateAIProvider not implemented")
}

func (t *tx) GetAIProvider(_ context.Context, _, _ string) (*store.AIProvider, error) {
	return nil, errors.New("mysql: GetAIProvider not implemented")
}

func (t *tx) ListAIProvidersByTenant(_ context.Context, _ string) ([]*store.AIProvider, error) {
	return nil, errors.New("mysql: ListAIProvidersByTenant not implemented")
}

func (t *tx) UpdateAIProvider(_ context.Context, _, _ string, _ store.UpdateAIProviderParams) (*store.AIProvider, error) {
	return nil, errors.New("mysql: UpdateAIProvider not implemented")
}

func (t *tx) DeleteAIProvider(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteAIProvider not implemented")
}

// ---------------------------------------------------------------------------
// AI — Provider Models
// ---------------------------------------------------------------------------

func (t *tx) AddProviderModel(_ context.Context, _ *store.AIProviderModel) (*store.AIProviderModel, error) {
	return nil, errors.New("mysql: AddProviderModel not implemented")
}

func (t *tx) UpdateProviderModel(_ context.Context, _, _ string, _ store.UpdateAIProviderModelParams) (*store.AIProviderModel, error) {
	return nil, errors.New("mysql: UpdateProviderModel not implemented")
}

func (t *tx) RemoveProviderModel(_ context.Context, _, _ string) error {
	return errors.New("mysql: RemoveProviderModel not implemented")
}

func (t *tx) ListProviderModels(_ context.Context, _ string) ([]*store.AIProviderModel, error) {
	return nil, errors.New("mysql: ListProviderModels not implemented")
}

// ---------------------------------------------------------------------------
// AI — MCP Servers
// ---------------------------------------------------------------------------

func (t *tx) CreateMCPServer(_ context.Context, _ *store.AIMCPServer) (*store.AIMCPServer, error) {
	return nil, errors.New("mysql: CreateMCPServer not implemented")
}

func (t *tx) GetMCPServer(_ context.Context, _, _ string) (*store.AIMCPServer, error) {
	return nil, errors.New("mysql: GetMCPServer not implemented")
}

func (t *tx) ListMCPServersByTenant(_ context.Context, _ string) ([]*store.AIMCPServer, error) {
	return nil, errors.New("mysql: ListMCPServersByTenant not implemented")
}

func (t *tx) UpdateMCPServer(_ context.Context, _, _ string, _ store.UpdateAIMCPServerParams) (*store.AIMCPServer, error) {
	return nil, errors.New("mysql: UpdateMCPServer not implemented")
}

func (t *tx) DeleteMCPServer(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteMCPServer not implemented")
}

// ---------------------------------------------------------------------------
// AI — Tools
// ---------------------------------------------------------------------------

func (t *tx) CreateAITool(_ context.Context, _ *store.AITool) (*store.AITool, error) {
	return nil, errors.New("mysql: CreateAITool not implemented")
}

func (t *tx) GetAITool(_ context.Context, _, _ string) (*store.AITool, error) {
	return nil, errors.New("mysql: GetAITool not implemented")
}

func (t *tx) ListAIToolsByTenant(_ context.Context, _ string) ([]*store.AITool, error) {
	return nil, errors.New("mysql: ListAIToolsByTenant not implemented")
}

func (t *tx) UpdateAITool(_ context.Context, _, _ string, _ store.UpdateAIToolParams) (*store.AITool, error) {
	return nil, errors.New("mysql: UpdateAITool not implemented")
}

func (t *tx) DeleteAITool(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteAITool not implemented")
}

// ---------------------------------------------------------------------------
// AI — Agents
// ---------------------------------------------------------------------------

func (t *tx) CreateAIAgent(_ context.Context, _ *store.AIAgent) (*store.AIAgent, error) {
	return nil, errors.New("mysql: CreateAIAgent not implemented")
}

func (t *tx) GetAIAgent(_ context.Context, _, _ string) (*store.AIAgent, error) {
	return nil, errors.New("mysql: GetAIAgent not implemented")
}

func (t *tx) ListAIAgentsByTenant(_ context.Context, _ string) ([]*store.AIAgent, error) {
	return nil, errors.New("mysql: ListAIAgentsByTenant not implemented")
}

func (t *tx) UpdateAIAgent(_ context.Context, _, _ string, _ store.UpdateAIAgentParams) (*store.AIAgent, error) {
	return nil, errors.New("mysql: UpdateAIAgent not implemented")
}

func (t *tx) DeleteAIAgent(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteAIAgent not implemented")
}

// ---------------------------------------------------------------------------
// AI — Tool Bindings
// ---------------------------------------------------------------------------

func (t *tx) CreateAIToolBinding(_ context.Context, _ *store.AIToolBinding) (*store.AIToolBinding, error) {
	return nil, errors.New("mysql: CreateAIToolBinding not implemented")
}

func (t *tx) GetAIToolBinding(_ context.Context, _, _ string) (*store.AIToolBinding, error) {
	return nil, errors.New("mysql: GetAIToolBinding not implemented")
}

func (t *tx) ListAIToolBindingsByTenant(_ context.Context, _ string) ([]*store.AIToolBinding, error) {
	return nil, errors.New("mysql: ListAIToolBindingsByTenant not implemented")
}

func (t *tx) ListAIToolBindingsByAgent(_ context.Context, _ string) ([]*store.AIToolBinding, error) {
	return nil, errors.New("mysql: ListAIToolBindingsByAgent not implemented")
}

func (t *tx) UpdateAIToolBinding(_ context.Context, _, _ string, _ store.UpdateAIToolBindingParams) (*store.AIToolBinding, error) {
	return nil, errors.New("mysql: UpdateAIToolBinding not implemented")
}

func (t *tx) DeleteAIToolBinding(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteAIToolBinding not implemented")
}

// ---------------------------------------------------------------------------
// AI — Semantic Rate Limits
// ---------------------------------------------------------------------------

func (t *tx) CreateAIRateLimit(_ context.Context, _ *store.AISemanticRateLimit) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("mysql: CreateAIRateLimit not implemented")
}

func (t *tx) GetAIRateLimit(_ context.Context, _, _ string) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("mysql: GetAIRateLimit not implemented")
}

func (t *tx) ListAIRateLimitsByTenant(_ context.Context, _ string) ([]*store.AISemanticRateLimit, error) {
	return nil, errors.New("mysql: ListAIRateLimitsByTenant not implemented")
}

func (t *tx) UpdateAIRateLimit(_ context.Context, _, _ string, _ store.UpdateAIRateLimitParams) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("mysql: UpdateAIRateLimit not implemented")
}

func (t *tx) DeleteAIRateLimit(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteAIRateLimit not implemented")
}

// ---------------------------------------------------------------------------
// AI — Traces
// ---------------------------------------------------------------------------

func (t *tx) AppendAITrace(_ context.Context, _ *store.AITrace) (*store.AITrace, error) {
	return nil, errors.New("mysql: AppendAITrace not implemented")
}

func (t *tx) GetAITrace(_ context.Context, _, _ string) (*store.AITrace, error) {
	return nil, errors.New("mysql: GetAITrace not implemented")
}

func (t *tx) ListAITracesByTenant(_ context.Context, _ string, _ store.AITraceQuery) ([]*store.AITrace, error) {
	return nil, errors.New("mysql: ListAITracesByTenant not implemented")
}

func (t *tx) ListAITracesByAgent(_ context.Context, _ string, _ store.AITraceQuery) ([]*store.AITrace, error) {
	return nil, errors.New("mysql: ListAITracesByAgent not implemented")
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

func (t *tx) CreateSite(_ context.Context, _ *store.Site) (*store.Site, error) {
	return nil, errors.New("mysql: CreateSite not implemented")
}

func (t *tx) GetSite(_ context.Context, _, _ string) (*store.Site, error) {
	return nil, errors.New("mysql: GetSite not implemented")
}

func (t *tx) ListSitesByTenant(_ context.Context, _ string) ([]*store.Site, error) {
	return nil, errors.New("mysql: ListSitesByTenant not implemented")
}

func (t *tx) UpdateSite(_ context.Context, _, _ string, _ store.UpdateSiteParams) (*store.Site, error) {
	return nil, errors.New("mysql: UpdateSite not implemented")
}

func (t *tx) ToggleSite(_ context.Context, _, _ string, _ bool) (*store.Site, error) {
	return nil, errors.New("mysql: ToggleSite not implemented")
}

func (t *tx) DeleteSite(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteSite not implemented")
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

func (t *tx) CreateMiddleware(_ context.Context, _ *store.Middleware) (*store.Middleware, error) {
	return nil, errors.New("mysql: CreateMiddleware not implemented")
}

func (t *tx) GetMiddleware(_ context.Context, _, _ string) (*store.Middleware, error) {
	return nil, errors.New("mysql: GetMiddleware not implemented")
}

func (t *tx) ListMiddlewaresByTenant(_ context.Context, _ string) ([]*store.Middleware, error) {
	return nil, errors.New("mysql: ListMiddlewaresByTenant not implemented")
}

func (t *tx) UpdateMiddleware(_ context.Context, _, _ string, _ store.UpdateMiddlewareParams) (*store.Middleware, error) {
	return nil, errors.New("mysql: UpdateMiddleware not implemented")
}

func (t *tx) DeleteMiddleware(_ context.Context, _, _ string) error {
	return errors.New("mysql: DeleteMiddleware not implemented")
}

// ---------------------------------------------------------------------------
// RBAC Policies
// ---------------------------------------------------------------------------

func (t *tx) CreateRbacPolicy(_ context.Context, _ *store.RbacPolicy) (*store.RbacPolicy, error) {
	return nil, errors.New("mysql: CreateRbacPolicy not implemented")
}

func (t *tx) GetRbacPolicy(_ context.Context, _ string) (*store.RbacPolicy, error) {
	return nil, errors.New("mysql: GetRbacPolicy not implemented")
}

func (t *tx) ListRbacPolicies(_ context.Context) ([]*store.RbacPolicy, error) {
	return nil, errors.New("mysql: ListRbacPolicies not implemented")
}

func (t *tx) UpdateRbacPolicy(_ context.Context, _ string, _ store.UpdateRbacPolicyParams) (*store.RbacPolicy, error) {
	return nil, errors.New("mysql: UpdateRbacPolicy not implemented")
}

func (t *tx) DeleteRbacPolicy(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteRbacPolicy not implemented")
}

// ---------------------------------------------------------------------------
// Access Policies
// ---------------------------------------------------------------------------

func (t *tx) CreateAccessPolicy(_ context.Context, _ *store.AccessPolicy) (*store.AccessPolicy, error) {
	return nil, errors.New("mysql: CreateAccessPolicy not implemented")
}

func (t *tx) GetAccessPolicy(_ context.Context, _ string) (*store.AccessPolicy, error) {
	return nil, errors.New("mysql: GetAccessPolicy not implemented")
}

func (t *tx) ListAccessPolicies(_ context.Context) ([]*store.AccessPolicy, error) {
	return nil, errors.New("mysql: ListAccessPolicies not implemented")
}

func (t *tx) UpdateAccessPolicy(_ context.Context, _ string, _ store.UpdateAccessPolicyParams) (*store.AccessPolicy, error) {
	return nil, errors.New("mysql: UpdateAccessPolicy not implemented")
}

func (t *tx) DeleteAccessPolicy(_ context.Context, _ string) error {
	return errors.New("mysql: DeleteAccessPolicy not implemented")
}
