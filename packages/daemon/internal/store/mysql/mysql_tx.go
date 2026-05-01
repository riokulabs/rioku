package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

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

func (t *tx) CreateAPIKey(ctx context.Context, name, keyHash string, scopes []string, expiresAt *time.Time, ownerID string) (string, error) {
	id := uuid.New().String()
	now := nowUTC()

	scopesJSON, err := json.Marshal(scopes)
	if err != nil {
		return "", fmt.Errorf("mysql: marshal scopes: %w", err)
	}

	var expiresStr *string
	if expiresAt != nil {
		s := expiresAt.UTC().Format(timeFormat)
		expiresStr = &s
	}

	var ownerIDVal *string
	if ownerID != "" {
		ownerIDVal = &ownerID
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO api_keys (id, tenant_id, name, key_hash, scopes, expires_at, created_at, owner_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, name, keyHash, string(scopesJSON), expiresStr, now, ownerIDVal,
	)
	if err != nil {
		return "", fmt.Errorf("mysql: insert api_key: %w", err)
	}

	t.emit("api_keys", id, "INSERT")

	return id, nil
}

func (t *tx) GetAPIKey(ctx context.Context, id string) (*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count
		 FROM api_keys WHERE id = ? AND tenant_id = ?`, id, tenantID)
	return scanAPIKey(row)
}

// GetAPIKeyByHash is invoked by the auth middleware before any tenant
// context exists. The hash is unique system-wide; the resolved key
// carries its tenant_id so the caller can attach it to the request
// context for downstream tenant filtering.
func (t *tx) GetAPIKeyByHash(ctx context.Context, keyHash string) (*store.APIKey, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count
		 FROM api_keys WHERE key_hash = ?`, keyHash)
	return scanAPIKey(row)
}

func (t *tx) ListAPIKeys(ctx context.Context) ([]*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count
		 FROM api_keys WHERE revoked_at IS NULL AND tenant_id = ?`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list api_keys: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var keys []*store.APIKey
	for rows.Next() {
		k, err := scanAPIKeyRows(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (t *tx) ListAPIKeysByOwner(ctx context.Context, ownerID string) ([]*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count
		 FROM api_keys WHERE revoked_at IS NULL AND owner_id = ? AND tenant_id = ?`, ownerID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list api_keys by owner: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var keys []*store.APIKey
	for rows.Next() {
		k, err := scanAPIKeyRows(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (t *tx) RevokeAPIKey(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL`,
		now, id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("mysql: revoke api_key: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: api_key %q not found or already revoked", id)
	}
	t.emit("api_keys", id, "UPDATE")
	return nil
}

// UpdateAPIKey applies partial changes to a key's metadata.
func (t *tx) UpdateAPIKey(ctx context.Context, id string, params store.UpdateAPIKeyParams) (*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	// Build the SET clause from the supplied fields. Skip the UPDATE
	// entirely when nothing was supplied so we don't bump updated_at
	// for a no-op call.
	var (
		setClauses []string
		args       []any
	)
	if params.Name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *params.Name)
	}
	if params.Scopes != nil {
		raw, err := json.Marshal(*params.Scopes)
		if err != nil {
			return nil, fmt.Errorf("mysql: marshal scopes: %w", err)
		}
		setClauses = append(setClauses, "scopes = ?")
		args = append(args, string(raw))
	}
	if params.ExpiresAt != nil {
		if *params.ExpiresAt == nil {
			setClauses = append(setClauses, "expires_at = NULL")
		} else {
			setClauses = append(setClauses, "expires_at = ?")
			args = append(args, (*params.ExpiresAt).UTC().Format(timeFormat))
		}
	}
	if len(setClauses) > 0 {
		args = append(args, id, tenantID)
		query := "UPDATE api_keys SET " + strings.Join(setClauses, ", ") +
			" WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL"
		res, err := t.sqlTx.ExecContext(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("mysql: update api_key: %w", err)
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return nil, fmt.Errorf("mysql: api_key %q not found", id)
		}
		t.emit("api_keys", id, "UPDATE")
	}
	return t.GetAPIKey(ctx, id)
}

// RecordAPIKeyUse atomically bumps usage_count and overwrites
// last_used_at. No-op (no error) when the key id doesn't exist —
// the caller is the auth path and a missing row at this point is
// already an authentication failure handled upstream.
func (t *tx) RecordAPIKeyUse(ctx context.Context, id string, at time.Time) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`UPDATE api_keys SET last_used_at = ?, usage_count = usage_count + 1 WHERE id = ?`,
		at.UTC().Format(timeFormat), id,
	)
	if err != nil {
		return fmt.Errorf("mysql: record api_key use: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Config Versions
// ---------------------------------------------------------------------------

const maxConfigVersions = 100

func (t *tx) SaveConfigVersion(ctx context.Context, snapshot []byte, actor string) (int64, error) {
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO config_versions (snapshot, actor, created_at) VALUES (?, ?, ?)`,
		string(snapshot), actor, now,
	)
	if err != nil {
		return 0, fmt.Errorf("mysql: insert config_version: %w", err)
	}
	version, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("mysql: get config version: %w", err)
	}
	t.emit("config_versions", fmt.Sprintf("%d", version), "INSERT")

	// Prune old versions beyond the max retention.
	_, _ = t.sqlTx.ExecContext(ctx,
		`DELETE FROM config_versions WHERE version NOT IN (
			SELECT version FROM (SELECT version FROM config_versions ORDER BY version DESC LIMIT ?) AS t
		)`, maxConfigVersions)

	return version, nil
}

func (t *tx) GetConfigVersion(ctx context.Context, version int64) (*store.ConfigVersion, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT version, snapshot, actor, created_at FROM config_versions WHERE version = ?`, version)

	var cv store.ConfigVersion
	var createdAt string
	if err := row.Scan(&cv.Version, &cv.Snapshot, &cv.Actor, &createdAt); err != nil {
		return nil, fmt.Errorf("mysql: get config_version: %w", err)
	}
	cv.CreatedAt = parseTime(createdAt)
	return &cv, nil
}

func (t *tx) ListConfigVersions(ctx context.Context, limit int) ([]*store.ConfigVersion, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT version, snapshot, actor, created_at FROM config_versions ORDER BY version DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("mysql: list config_versions: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var versions []*store.ConfigVersion
	for rows.Next() {
		var cv store.ConfigVersion
		var createdAt string
		if err := rows.Scan(&cv.Version, &cv.Snapshot, &cv.Actor, &createdAt); err != nil {
			return nil, fmt.Errorf("mysql: scan config_version: %w", err)
		}
		cv.CreatedAt = parseTime(createdAt)
		versions = append(versions, &cv)
	}
	return versions, rows.Err()
}

func (t *tx) LatestConfigVersion(ctx context.Context) (int64, error) {
	var version int64
	err := t.sqlTx.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM config_versions`).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("mysql: latest config version: %w", err)
	}
	return version, nil
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

func (t *tx) AppendAuditEntry(ctx context.Context, entry *riokuv1.AuditEntry) error {
	id := entry.GetId()
	if id == "" {
		id = uuid.New().String()
	}
	now := nowUTC()
	if entry.GetOccurredAt() != nil {
		now = entry.GetOccurredAt().AsTime().UTC().Format(timeFormat)
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO audit_log (id, tenant_id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, entry.GetActor(), entry.GetEntityType(), entry.GetEntityId(),
		entry.GetOperation(), entry.GetDiff(), entry.GetConfigVersion(), now,
	)
	if err != nil {
		return fmt.Errorf("mysql: append audit entry: %w", err)
	}
	t.emit("audit_log", id, "INSERT")
	return nil
}

func (t *tx) QueryAuditLog(ctx context.Context, query store.AuditQuery) ([]*riokuv1.AuditEntry, error) {
	tenantID := store.TenantIDFromContext(ctx)
	q := `SELECT id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at FROM audit_log WHERE tenant_id = ?`
	args := []any{tenantID}

	if query.Actor != "" {
		q += ` AND actor = ?`
		args = append(args, query.Actor)
	}
	if query.EntityType != "" {
		q += ` AND entity_type = ?`
		args = append(args, query.EntityType)
	}
	if query.EntityID != "" {
		q += ` AND entity_id = ?`
		args = append(args, query.EntityID)
	}
	if query.Since != nil {
		q += ` AND occurred_at >= ?`
		args = append(args, query.Since.UTC().Format(timeFormat))
	}
	if query.Until != nil {
		q += ` AND occurred_at <= ?`
		args = append(args, query.Until.UTC().Format(timeFormat))
	}

	q += ` ORDER BY occurred_at DESC`

	// Enforce a maximum limit to prevent OOM on unbounded queries.
	limit := query.Limit
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	q += ` LIMIT ?`
	args = append(args, limit)

	// OFFSET only makes sense with LIMIT.
	if query.Offset > 0 {
		q += ` OFFSET ?`
		args = append(args, query.Offset)
	}

	rows, err := t.sqlTx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("mysql: query audit log: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var entries []*riokuv1.AuditEntry
	for rows.Next() {
		var (
			id            string
			actor         string
			entityType    string
			entityID      string
			operation     string
			diff          string
			configVersion int64
			occurredAt    string
		)
		if err := rows.Scan(&id, &actor, &entityType, &entityID, &operation, &diff, &configVersion, &occurredAt); err != nil {
			return nil, fmt.Errorf("mysql: scan audit entry: %w", err)
		}
		entries = append(entries, &riokuv1.AuditEntry{
			Id:            id,
			Actor:         actor,
			EntityType:    entityType,
			EntityId:      entityID,
			Operation:     operation,
			Diff:          diff,
			ConfigVersion: configVersion,
			OccurredAt:    timestamppb.New(parseTime(occurredAt)),
		})
	}
	return entries, rows.Err()
}

// CountAuditLog mirrors QueryAuditLog's WHERE clause but returns
// COUNT(*) so the REST layer can expose total counts for paginated
// UIs. Limit/Offset are intentionally ignored.
func (t *tx) CountAuditLog(ctx context.Context, query store.AuditQuery) (int, error) {
	tenantID := store.TenantIDFromContext(ctx)
	q := `SELECT COUNT(*) FROM audit_log WHERE tenant_id = ?`
	args := []any{tenantID}

	if query.Actor != "" {
		q += ` AND actor = ?`
		args = append(args, query.Actor)
	}
	if query.EntityType != "" {
		q += ` AND entity_type = ?`
		args = append(args, query.EntityType)
	}
	if query.EntityID != "" {
		q += ` AND entity_id = ?`
		args = append(args, query.EntityID)
	}
	if query.Since != nil {
		q += ` AND occurred_at >= ?`
		args = append(args, query.Since.UTC().Format(timeFormat))
	}
	if query.Until != nil {
		q += ` AND occurred_at <= ?`
		args = append(args, query.Until.UTC().Format(timeFormat))
	}

	var count int
	if err := t.sqlTx.QueryRowContext(ctx, q, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("mysql: count audit log: %w", err)
	}
	return count, nil
}

// GetAuditEntry returns a single audit entry by id, scoped to the active tenant.
func (t *tx) GetAuditEntry(ctx context.Context, id string) (*riokuv1.AuditEntry, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at
		 FROM audit_log WHERE id = ? AND tenant_id = ?`, id, tenantID)
	var (
		gotID         string
		actor         string
		entityType    string
		entityID      string
		operation     string
		diff          string
		configVersion int64
		occurredAt    string
	)
	if err := row.Scan(&gotID, &actor, &entityType, &entityID, &operation, &diff, &configVersion, &occurredAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("mysql: audit entry %q not found", id)
		}
		return nil, fmt.Errorf("mysql: get audit entry: %w", err)
	}
	return &riokuv1.AuditEntry{
		Id:            gotID,
		Actor:         actor,
		EntityType:    entityType,
		EntityId:      entityID,
		Operation:     operation,
		Diff:          diff,
		ConfigVersion: configVersion,
		OccurredAt:    timestamppb.New(parseTime(occurredAt)),
	}, nil
}

// ListAuditActors returns distinct actors matching `prefix`, capped at
// `limit` (default 50, max 1000).
func (t *tx) ListAuditActors(ctx context.Context, prefix string, limit int) ([]string, error) {
	tenantID := store.TenantIDFromContext(ctx)
	if limit <= 0 || limit > 1000 {
		limit = 50
	}
	q := `SELECT DISTINCT actor FROM audit_log WHERE tenant_id = ?`
	args := []any{tenantID}
	if prefix != "" {
		q += ` AND actor LIKE ?`
		args = append(args, prefix+"%")
	}
	q += ` ORDER BY actor LIMIT ?`
	args = append(args, limit)

	rows, err := t.sqlTx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("mysql: list audit actors: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ListAuditResourceIDs returns distinct entity_ids matching the
// optional entity_type filter and `prefix`.
func (t *tx) ListAuditResourceIDs(ctx context.Context, entityType, prefix string, limit int) ([]string, error) {
	tenantID := store.TenantIDFromContext(ctx)
	if limit <= 0 || limit > 1000 {
		limit = 50
	}
	q := `SELECT DISTINCT entity_id FROM audit_log WHERE tenant_id = ?`
	args := []any{tenantID}
	if entityType != "" {
		q += ` AND entity_type = ?`
		args = append(args, entityType)
	}
	if prefix != "" {
		q += ` AND entity_id LIKE ?`
		args = append(args, prefix+"%")
	}
	q += ` ORDER BY entity_id LIMIT ?`
	args = append(args, limit)

	rows, err := t.sqlTx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("mysql: list audit resource_ids: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

func (t *tx) CreateUser(ctx context.Context, u *store.User) (*store.User, error) {
	id := uuid.New().String()
	now := nowUTC()

	username := strings.ToLower(u.Username)

	var email, displayName, totpSecret sql.NullString
	if u.Email != nil {
		email = sql.NullString{String: *u.Email, Valid: true}
	}
	if u.DisplayName != nil {
		displayName = sql.NullString{String: *u.DisplayName, Valid: true}
	}
	if u.TOTPSecret != nil {
		totpSecret = sql.NullString{String: *u.TOTPSecret, Valid: true}
	}

	totpEnabled := 0
	if u.TOTPEnabled {
		totpEnabled = 1
	}
	forcePasswordChange := 0
	if u.ForcePasswordChange {
		forcePasswordChange = 1
	}

	var lockedUntil sql.NullString
	if u.LockedUntil != nil {
		lockedUntil = sql.NullString{String: u.LockedUntil.UTC().Format(timeFormat), Valid: true}
	}
	var lastLogin sql.NullString
	if u.LastLogin != nil {
		lastLogin = sql.NullString{String: u.LastLogin.UTC().Format(timeFormat), Valid: true}
	}

	passwordChangedAt := now
	if !u.PasswordChangedAt.IsZero() {
		passwordChangedAt = u.PasswordChangedAt.UTC().Format(timeFormat)
	}

	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO users (id, username, email, display_name, password_hash, status,
		                     totp_secret, totp_enabled, force_password_change,
		                     failed_attempts, locked_until, last_login,
		                     password_changed_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, username, email, displayName, u.PasswordHash, u.Status,
		totpSecret, totpEnabled, forcePasswordChange,
		u.FailedAttempts, lockedUntil, lastLogin,
		passwordChangedAt, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert user: %w", err)
	}

	t.emit("users", id, "INSERT")

	return t.GetUser(ctx, id)
}

func (t *tx) GetUser(ctx context.Context, id string) (*store.User, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users WHERE id = ?`, id)
	return scanUser(row)
}

func (t *tx) GetUserByUsername(ctx context.Context, username string) (*store.User, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users WHERE LOWER(username) = LOWER(?)`, username)
	return scanUser(row)
}

func (t *tx) ListUsers(ctx context.Context) ([]*store.User, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users ORDER BY username`)
	if err != nil {
		return nil, fmt.Errorf("mysql: list users: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var users []*store.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (t *tx) UpdateUser(ctx context.Context, u *store.User) (*store.User, error) {
	now := nowUTC()

	var email, displayName, totpSecret sql.NullString
	if u.Email != nil {
		email = sql.NullString{String: *u.Email, Valid: true}
	}
	if u.DisplayName != nil {
		displayName = sql.NullString{String: *u.DisplayName, Valid: true}
	}
	if u.TOTPSecret != nil {
		totpSecret = sql.NullString{String: *u.TOTPSecret, Valid: true}
	}

	totpEnabled := 0
	if u.TOTPEnabled {
		totpEnabled = 1
	}
	forcePasswordChange := 0
	if u.ForcePasswordChange {
		forcePasswordChange = 1
	}

	var lockedUntil sql.NullString
	if u.LockedUntil != nil {
		lockedUntil = sql.NullString{String: u.LockedUntil.UTC().Format(timeFormat), Valid: true}
	}
	var lastLogin sql.NullString
	if u.LastLogin != nil {
		lastLogin = sql.NullString{String: u.LastLogin.UTC().Format(timeFormat), Valid: true}
	}

	passwordChangedAt := u.PasswordChangedAt.UTC().Format(timeFormat)

	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE users SET username=?, email=?, display_name=?, password_hash=?, status=?,
		                  totp_secret=?, totp_enabled=?, force_password_change=?,
		                  failed_attempts=?, locked_until=?, last_login=?,
		                  password_changed_at=?, updated_at=?
		 WHERE id=?`,
		strings.ToLower(u.Username), email, displayName, u.PasswordHash, u.Status,
		totpSecret, totpEnabled, forcePasswordChange,
		u.FailedAttempts, lockedUntil, lastLogin,
		passwordChangedAt, now, u.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: update user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("mysql: user %q not found", u.ID)
	}

	t.emit("users", u.ID, "UPDATE")

	return t.GetUser(ctx, u.ID)
}

func (t *tx) DeleteUser(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("mysql: delete user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: user %q not found", id)
	}
	t.emit("users", id, "DELETE")
	return nil
}

func (t *tx) IncrementFailedAttempts(ctx context.Context, userID string, lockUntil *time.Time) error {
	var res sql.Result
	var err error

	if lockUntil != nil {
		res, err = t.sqlTx.ExecContext(ctx,
			`UPDATE users SET failed_attempts = failed_attempts + 1,
			                  locked_until = ?, status = 'locked', updated_at = ?
			 WHERE id = ?`,
			lockUntil.UTC().Format(timeFormat), nowUTC(), userID,
		)
	} else {
		res, err = t.sqlTx.ExecContext(ctx,
			`UPDATE users SET failed_attempts = failed_attempts + 1, updated_at = ?
			 WHERE id = ?`,
			nowUTC(), userID,
		)
	}
	if err != nil {
		return fmt.Errorf("mysql: increment failed_attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: user %q not found", userID)
	}
	t.emit("users", userID, "UPDATE")
	return nil
}

func (t *tx) ResetFailedAttempts(ctx context.Context, userID string) error {
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE users SET failed_attempts = 0, locked_until = NULL, status = 'active', updated_at = ?
		 WHERE id = ?`,
		nowUTC(), userID,
	)
	if err != nil {
		return fmt.Errorf("mysql: reset failed_attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: user %q not found", userID)
	}
	t.emit("users", userID, "UPDATE")
	return nil
}

func (t *tx) UpdateLastLogin(ctx context.Context, userID string) error {
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?`,
		now, now, userID,
	)
	if err != nil {
		return fmt.Errorf("mysql: update last_login: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: user %q not found", userID)
	}
	t.emit("users", userID, "UPDATE")
	return nil
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

func (t *tx) CreateSession(ctx context.Context, s *store.Session) (*store.Session, error) {
	var ipAddress, userAgent sql.NullString
	if s.IPAddress != nil {
		ipAddress = sql.NullString{String: *s.IPAddress, Valid: true}
	}
	if s.UserAgent != nil {
		userAgent = sql.NullString{String: *s.UserAgent, Valid: true}
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO sessions (id, tenant_id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.ID, tenantID, s.UserID, s.Fingerprint,
		s.CreatedAt.UTC().Format(timeFormat),
		s.ExpiresAt.UTC().Format(timeFormat),
		s.LastActive.UTC().Format(timeFormat),
		ipAddress, userAgent,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert session: %w", err)
	}

	t.emit("sessions", s.ID, "INSERT")

	return t.GetSession(ctx, s.ID)
}

// GetSession does NOT filter by tenant. Sessions live for the user's
// active tenant only — but the auth middleware looks up the session
// before any tenant context exists.
func (t *tx) GetSession(ctx context.Context, id string) (*store.Session, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent
		 FROM sessions WHERE id = ?`, id)
	return scanSession(row)
}

func (t *tx) ListSessionsByUser(ctx context.Context, userID string) ([]*store.Session, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent
		 FROM sessions WHERE user_id = ? ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list sessions by user: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var sessions []*store.Session
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

func (t *tx) DeleteSession(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("mysql: delete session: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: session %q not found", id)
	}
	t.emit("sessions", id, "DELETE")
	return nil
}

func (t *tx) DeleteSessionsByUser(ctx context.Context, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("mysql: delete sessions by user: %w", err)
	}
	t.emit("sessions", userID, "DELETE")
	return nil
}

func (t *tx) DeleteSessionsByUserExcept(ctx context.Context, userID, exceptSessionID string) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM sessions WHERE user_id = ? AND id != ?`, userID, exceptSessionID)
	if err != nil {
		return fmt.Errorf("mysql: delete sessions by user except: %w", err)
	}
	t.emit("sessions", userID, "DELETE")
	return nil
}

func (t *tx) UpdateSessionLastActive(ctx context.Context, id string, at time.Time) error {
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE sessions SET last_active = ? WHERE id = ?`,
		at.UTC().Format(timeFormat), id,
	)
	if err != nil {
		return fmt.Errorf("mysql: update session last_active: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: session %q not found", id)
	}
	t.emit("sessions", id, "UPDATE")
	return nil
}

func (t *tx) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	now := nowUTC()
	yesterday := time.Now().UTC().Add(-24 * time.Hour).Format(timeFormat)
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM sessions WHERE expires_at < ? OR last_active < ?`,
		now, yesterday,
	)
	if err != nil {
		return 0, fmt.Errorf("mysql: delete expired sessions: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

func (t *tx) CreateRole(ctx context.Context, params store.CreateRoleParams) (*store.Role, error) {
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO roles (id, tenant_id, name, description, is_builtin, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 0, ?, ?)`,
		params.ID, tenantID, params.Name, params.Description, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: create role: %w", err)
	}
	for _, permID := range params.Permissions {
		if _, err := t.sqlTx.ExecContext(ctx,
			`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
			params.ID, permID,
		); err != nil {
			return nil, fmt.Errorf("mysql: assign permission %s to role: %w", permID, err)
		}
	}
	t.emit("roles", params.ID, "INSERT")
	return t.GetRole(ctx, params.ID)
}

func (t *tx) GetRole(ctx context.Context, id string) (*store.Role, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, description, is_builtin, created_at, updated_at FROM roles WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?)`, id, tenantID)
	r := &store.Role{}
	var isBuiltinInt int
	var createdStr, updatedStr string
	if err := row.Scan(&r.ID, &r.Name, &r.Description, &isBuiltinInt, &createdStr, &updatedStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrRoleNotFound
		}
		return nil, fmt.Errorf("mysql: get role: %w", err)
	}
	r.IsBuiltin = isBuiltinInt == 1
	r.CreatedAt = parseTime(createdStr)
	r.UpdatedAt = parseTime(updatedStr)
	perms, err := t.getRolePermissions(ctx, id)
	if err != nil {
		return nil, err
	}
	r.Permissions = perms
	return r, nil
}

func (t *tx) getRolePermissions(ctx context.Context, roleID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT permission_id FROM role_permissions WHERE role_id = ?`, roleID)
	if err != nil {
		return nil, fmt.Errorf("mysql: get role permissions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var perms []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}

func (t *tx) ListRoles(ctx context.Context) ([]*store.Role, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, description, is_builtin, created_at, updated_at FROM roles WHERE tenant_id IS NULL OR tenant_id = ? ORDER BY name`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list roles: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var roles []*store.Role
	for rows.Next() {
		r := &store.Role{}
		var isBuiltinInt int
		var createdStr, updatedStr string
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &isBuiltinInt, &createdStr, &updatedStr); err != nil {
			return nil, err
		}
		r.IsBuiltin = isBuiltinInt == 1
		r.CreatedAt = parseTime(createdStr)
		r.UpdatedAt = parseTime(updatedStr)
		perms, err := t.getRolePermissions(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		r.Permissions = perms
		roles = append(roles, r)
	}
	return roles, rows.Err()
}

func (t *tx) UpdateRole(ctx context.Context, id string, params store.UpdateRoleParams) (*store.Role, error) {
	if id == "role_superadmin" {
		return nil, store.ErrRoleImmutable
	}
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	if params.Name != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE roles SET name = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
			*params.Name, now, id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("mysql: update role name: %w", err)
		}
	}
	if params.Description != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE roles SET description = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
			*params.Description, now, id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("mysql: update role description: %w", err)
		}
	}
	for _, permID := range params.AddPerms {
		if _, err := t.sqlTx.ExecContext(ctx,
			`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
			id, permID,
		); err != nil {
			return nil, fmt.Errorf("mysql: add permission %s: %w", permID, err)
		}
	}
	for _, permID := range params.RemovePerms {
		if _, err := t.sqlTx.ExecContext(ctx,
			`DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`,
			id, permID,
		); err != nil {
			return nil, fmt.Errorf("mysql: remove permission %s: %w", permID, err)
		}
	}
	t.emit("roles", id, "UPDATE")
	return t.GetRole(ctx, id)
}

func (t *tx) DeleteRole(ctx context.Context, id string) error {
	if id == "role_superadmin" {
		return store.ErrRoleImmutable
	}
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM roles WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete role: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrRoleNotFound
	}
	t.emit("roles", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

func (t *tx) ListPermissions(ctx context.Context) ([]*store.Permission, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, resource, action, description FROM permissions
		 WHERE id NOT LIKE '%:*' AND id != '*'
		 ORDER BY resource, action`)
	if err != nil {
		return nil, fmt.Errorf("mysql: list permissions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var perms []*store.Permission
	for rows.Next() {
		p := &store.Permission{}
		if err := rows.Scan(&p.ID, &p.Resource, &p.Action, &p.Description); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}

func (t *tx) GetUserScopes(ctx context.Context, userID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT DISTINCT rp.permission_id
		 FROM user_roles ur
		 JOIN role_permissions rp ON ur.role_id = rp.role_id
		 WHERE ur.user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("mysql: get user scopes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var scopes []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		scopes = append(scopes, s)
	}
	return scopes, rows.Err()
}

// ---------------------------------------------------------------------------
// User Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignRole(ctx context.Context, userID, roleID, grantedBy string) error {
	var grantedByVal interface{}
	if grantedBy != "" {
		grantedByVal = grantedBy
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT IGNORE INTO user_roles (user_id, role_id, granted_by)
		 VALUES (?, ?, ?)`,
		userID, roleID, grantedByVal,
	)
	if err != nil {
		return fmt.Errorf("mysql: assign role: %w", err)
	}
	t.emit("user_roles", userID, "INSERT")
	return nil
}

func (t *tx) RevokeRole(ctx context.Context, userID, roleID string) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`,
		userID, roleID,
	)
	if err != nil {
		return fmt.Errorf("mysql: revoke role: %w", err)
	}
	t.emit("user_roles", userID, "DELETE")
	return nil
}

func (t *tx) ListUserRoles(ctx context.Context, userID string) ([]*store.UserRole, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT ur.user_id, ur.role_id, r.name, COALESCE(ur.granted_by,''), ur.granted_at
		 FROM user_roles ur
		 JOIN roles r ON ur.role_id = r.id
		 WHERE ur.user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list user roles: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var result []*store.UserRole
	for rows.Next() {
		ur := &store.UserRole{}
		var grantedAtStr string
		if err := rows.Scan(&ur.UserID, &ur.RoleID, &ur.RoleName, &ur.GrantedBy, &grantedAtStr); err != nil {
			return nil, err
		}
		ur.GrantedAt = parseTime(grantedAtStr)
		result = append(result, ur)
	}
	return result, rows.Err()
}

func (t *tx) ListUsersWithRole(ctx context.Context, roleID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT user_id FROM user_roles WHERE role_id = ?`, roleID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list users with role: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---------------------------------------------------------------------------
// TOTP Backup Codes
// ---------------------------------------------------------------------------

func (t *tx) CreateTOTPBackupCodes(ctx context.Context, userID string, codeHashes []string) error {
	// Delete any existing codes first.
	if _, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM totp_backup_codes WHERE user_id = ?`, userID,
	); err != nil {
		return fmt.Errorf("mysql: clear backup codes: %w", err)
	}
	for _, h := range codeHashes {
		id := uuid.New().String()
		if _, err := t.sqlTx.ExecContext(ctx,
			`INSERT INTO totp_backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)`,
			id, userID, h,
		); err != nil {
			return fmt.Errorf("mysql: insert backup code: %w", err)
		}
	}
	return nil
}

func (t *tx) ListUnusedTOTPBackupCodes(ctx context.Context, userID string) ([]*store.TOTPBackupCode, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, user_id, code_hash FROM totp_backup_codes
		 WHERE user_id = ? AND used_at IS NULL`, userID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list backup codes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var codes []*store.TOTPBackupCode
	for rows.Next() {
		c := &store.TOTPBackupCode{}
		if err := rows.Scan(&c.ID, &c.UserID, &c.CodeHash); err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, rows.Err()
}

func (t *tx) MarkTOTPBackupCodeUsed(ctx context.Context, codeID string) error {
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`UPDATE totp_backup_codes SET used_at = ? WHERE id = ?`, now, codeID)
	if err != nil {
		return fmt.Errorf("mysql: mark backup code used: %w", err)
	}
	return nil
}

func (t *tx) DeleteTOTPBackupCodes(ctx context.Context, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM totp_backup_codes WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("mysql: delete backup codes: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

func (t *tx) CreateTenant(ctx context.Context, in *store.Tenant) (*store.Tenant, error) {
	if in == nil {
		return nil, fmt.Errorf("mysql: nil tenant")
	}
	if in.Slug == "" || in.Name == "" {
		return nil, fmt.Errorf("mysql: tenant requires slug and name")
	}
	id := in.ID
	if id == "" {
		id = "tenant_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	plan := in.Plan
	if plan == "" {
		plan = "community"
	}
	urlMode := in.URLMode
	if urlMode == "" {
		urlMode = "path"
	}
	now := nowUTC()

	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO tenants (id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.Slug, in.Name, plan, urlMode, in.Accent, in.LogoURL, in.DefaultDashboardID, now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrTenantSlugTaken
		}
		return nil, fmt.Errorf("mysql: insert tenant: %w", err)
	}

	t.emit("tenants", id, "INSERT")
	return t.GetTenant(ctx, id)
}

func (t *tx) GetTenant(ctx context.Context, id string) (*store.Tenant, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants WHERE id = ?`, id)
	tenant, err := scanTenant(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrTenantNotFound
	}
	return tenant, err
}

func (t *tx) GetTenantBySlug(ctx context.Context, slug string) (*store.Tenant, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants WHERE slug = ?`, slug)
	tenant, err := scanTenant(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrTenantNotFound
	}
	return tenant, err
}

func (t *tx) ListTenants(ctx context.Context) ([]*store.Tenant, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at
		 FROM tenants ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("mysql: list tenants: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var tenants []*store.Tenant
	for rows.Next() {
		tn, err := scanTenant(rows)
		if err != nil {
			return nil, err
		}
		tenants = append(tenants, tn)
	}
	return tenants, rows.Err()
}

func (t *tx) UpdateTenant(ctx context.Context, id string, params store.UpdateTenantParams) (*store.Tenant, error) {
	current, err := t.GetTenant(ctx, id)
	if err != nil {
		return nil, err
	}
	if params.Name != nil {
		current.Name = *params.Name
	}
	if params.Plan != nil {
		current.Plan = *params.Plan
	}
	if params.URLMode != nil {
		current.URLMode = *params.URLMode
	}
	if params.Accent != nil {
		current.Accent = params.Accent
	}
	if params.LogoURL != nil {
		current.LogoURL = params.LogoURL
	}
	if params.DefaultDashboardID != nil {
		current.DefaultDashboardID = params.DefaultDashboardID
	}

	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx,
		`UPDATE tenants SET name=?, plan=?, url_mode=?, accent=?, logo_url=?, default_dashboard_id=?, updated_at=?
		 WHERE id=?`,
		current.Name, current.Plan, current.URLMode, current.Accent, current.LogoURL, current.DefaultDashboardID, now, id,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: update tenant: %w", err)
	}
	t.emit("tenants", id, "UPDATE")
	return t.GetTenant(ctx, id)
}

func (t *tx) DeleteTenant(ctx context.Context, id string) error {
	if id == defaultTenantID {
		return store.ErrTenantImmutable
	}
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM tenants WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("mysql: delete tenant: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrTenantNotFound
	}
	t.emit("tenants", id, "DELETE")
	return nil
}

func scanTenant(s scanner) (*store.Tenant, error) {
	var (
		id, slug, name, plan, urlMode string
		accent, logoURL, defDashID    *string
		createdAt, updatedAt          string
	)
	if err := s.Scan(&id, &slug, &name, &plan, &urlMode, &accent, &logoURL, &defDashID, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.Tenant{
		ID:                 id,
		Slug:               slug,
		Name:               name,
		Plan:               plan,
		URLMode:            urlMode,
		Accent:             accent,
		LogoURL:            logoURL,
		DefaultDashboardID: defDashID,
		CreatedAt:          parseTime(createdAt),
		UpdatedAt:          parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

func (t *tx) CreateMembership(ctx context.Context, in *store.Membership) (*store.Membership, error) {
	if in == nil {
		return nil, fmt.Errorf("mysql: nil membership")
	}
	if in.TenantID == "" || in.UserID == "" {
		return nil, fmt.Errorf("mysql: membership requires tenant_id and user_id")
	}
	id := in.ID
	if id == "" {
		id = "m_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	state := in.State
	if state == "" {
		state = "active"
	}
	now := nowUTC()
	joinedAt := in.JoinedAt
	if joinedAt == nil && state == "active" {
		nowT := time.Now().UTC()
		joinedAt = &nowT
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO memberships (id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.UserID, state,
		in.InvitedBy, formatNullableTime(in.InvitedAt), formatNullableTime(joinedAt),
		in.InviteTokenHash, now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrMembershipExists
		}
		return nil, fmt.Errorf("mysql: insert membership: %w", err)
	}
	t.emit("memberships", id, "INSERT")
	return t.GetMembership(ctx, id)
}

func (t *tx) GetMembership(ctx context.Context, id string) (*store.Membership, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE id = ?`, id)
	m, err := scanMembership(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrMembershipNotFound
	}
	return m, err
}

func (t *tx) GetMembershipByTenantUser(ctx context.Context, tenantID, userID string) (*store.Membership, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE tenant_id = ? AND user_id = ?`, tenantID, userID)
	m, err := scanMembership(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrMembershipNotFound
	}
	return m, err
}

func (t *tx) ListMembershipsByTenant(ctx context.Context, tenantID string) ([]*store.Membership, error) {
	return t.queryMemberships(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE tenant_id = ? ORDER BY created_at ASC`,
		tenantID)
}

func (t *tx) ListMembershipsByUser(ctx context.Context, userID string) ([]*store.Membership, error) {
	return t.queryMemberships(ctx,
		`SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
		 FROM memberships WHERE user_id = ? ORDER BY created_at ASC`,
		userID)
}

func (t *tx) queryMemberships(ctx context.Context, q string, args ...any) ([]*store.Membership, error) {
	rows, err := t.sqlTx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("mysql: list memberships: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Membership
	for rows.Next() {
		m, err := scanMembership(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (t *tx) UpdateMembershipState(ctx context.Context, id, state string) (*store.Membership, error) {
	current, err := t.GetMembership(ctx, id)
	if err != nil {
		return nil, err
	}
	if !validMembershipTransition(current.State, state) {
		return nil, store.ErrMembershipInvalidState
	}

	now := nowUTC()
	args := []any{state, now}
	q := `UPDATE memberships SET state=?, updated_at=?`
	if state == "active" && current.JoinedAt == nil {
		q += `, joined_at=?`
		args = append(args, now)
	}
	q += ` WHERE id=?`
	args = append(args, id)

	if _, err := t.sqlTx.ExecContext(ctx, q, args...); err != nil {
		return nil, fmt.Errorf("mysql: update membership state: %w", err)
	}
	t.emit("memberships", id, "UPDATE")
	return t.GetMembership(ctx, id)
}

func (t *tx) DeleteMembership(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM memberships WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("mysql: delete membership: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrMembershipNotFound
	}
	t.emit("memberships", id, "DELETE")
	return nil
}

// validMembershipTransition allows: pending->active, pending->removed,
// active->deactivated, active->removed, deactivated->active,
// deactivated->removed. Removed is terminal. Same-state is a no-op
// allowed so callers can be idempotent.
func validMembershipTransition(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case "pending":
		return to == "active" || to == "removed"
	case "active":
		return to == "deactivated" || to == "removed"
	case "deactivated":
		return to == "active" || to == "removed"
	case "removed":
		return false
	}
	return false
}

func scanMembership(s scanner) (*store.Membership, error) {
	var (
		id, tenantID, userID, state string
		invitedBy, inviteTokenHash  *string
		invitedAt, joinedAt         *string
		createdAt, updatedAt        string
	)
	if err := s.Scan(&id, &tenantID, &userID, &state, &invitedBy, &invitedAt, &joinedAt, &inviteTokenHash, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	m := &store.Membership{
		ID:              id,
		TenantID:        tenantID,
		UserID:          userID,
		State:           state,
		InvitedBy:       invitedBy,
		InviteTokenHash: inviteTokenHash,
		CreatedAt:       parseTime(createdAt),
		UpdatedAt:       parseTime(updatedAt),
	}
	if invitedAt != nil {
		ts := parseTime(*invitedAt)
		m.InvitedAt = &ts
	}
	if joinedAt != nil {
		ts := parseTime(*joinedAt)
		m.JoinedAt = &ts
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// Membership Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignMembershipRole(ctx context.Context, membershipID, roleID, grantedBy string) error {
	now := nowUTC()
	var grantedByVal *string
	if grantedBy != "" {
		grantedByVal = &grantedBy
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT IGNORE INTO membership_roles (membership_id, role_id, granted_at, granted_by)
		 VALUES (?, ?, ?, ?)`,
		membershipID, roleID, now, grantedByVal,
	)
	if err != nil {
		return fmt.Errorf("mysql: assign membership role: %w", err)
	}
	return nil
}

func (t *tx) RevokeMembershipRole(ctx context.Context, membershipID, roleID string) error {
	if _, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM membership_roles WHERE membership_id = ? AND role_id = ?`,
		membershipID, roleID); err != nil {
		return fmt.Errorf("mysql: revoke membership role: %w", err)
	}
	return nil
}

func (t *tx) ListMembershipRoles(ctx context.Context, membershipID string) ([]store.Role, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT r.id, r.name, r.description, r.is_builtin, r.created_at, r.updated_at
		 FROM roles r
		 JOIN membership_roles mr ON mr.role_id = r.id
		 WHERE mr.membership_id = ?
		 ORDER BY r.name ASC`, membershipID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list membership roles: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var roles []store.Role
	for rows.Next() {
		var r store.Role
		var desc sql.NullString
		var createdAt, updatedAt string
		var isBuiltin int
		if err := rows.Scan(&r.ID, &r.Name, &desc, &isBuiltin, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if desc.Valid {
			r.Description = desc.String
		}
		r.IsBuiltin = isBuiltin == 1
		r.CreatedAt = parseTime(createdAt)
		r.UpdatedAt = parseTime(updatedAt)
		roles = append(roles, r)
	}
	return roles, rows.Err()
}

// ---------------------------------------------------------------------------
// Dashboard Shares
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardShare(ctx context.Context, s *store.DashboardShare) (*store.DashboardShare, error) {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	tenantID := store.TenantIDFromContext(ctx)
	now := nowUTC()
	var expires *string
	if s.ExpiresAt != nil {
		v := s.ExpiresAt.UTC().Format(timeFormat)
		expires = &v
	}
	var createdBy *string
	if s.CreatedBy != nil && *s.CreatedBy != "" {
		v := *s.CreatedBy
		createdBy = &v
	}
	_, err := t.sqlTx.ExecContext(ctx, `
		INSERT INTO dashboard_shares (id, tenant_id, dashboard_id, role_id, created_by, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, s.ID, tenantID, s.DashboardID, s.RoleID, createdBy, expires, now)
	if err != nil {
		return nil, fmt.Errorf("mysql: create dashboard_share: %w", err)
	}
	t.emit("dashboard_shares", s.ID, "INSERT")
	return t.getDashboardShareByID(ctx, s.ID, tenantID)
}

func (t *tx) ListDashboardShares(ctx context.Context, dashboardID string) ([]*store.DashboardShare, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, `
		SELECT id, tenant_id, dashboard_id, role_id, created_by, expires_at, created_at
		FROM dashboard_shares
		WHERE tenant_id = ? AND dashboard_id = ?
		ORDER BY created_at, id
	`, tenantID, dashboardID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list dashboard_shares: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.DashboardShare
	for rows.Next() {
		sh, err := scanDashboardShare(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (t *tx) DeleteDashboardShare(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM dashboard_shares WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete dashboard_share: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: dashboard_share %q not found", id)
	}
	t.emit("dashboard_shares", id, "DELETE")
	return nil
}

func (t *tx) getDashboardShareByID(ctx context.Context, id, tenantID string) (*store.DashboardShare, error) {
	row := t.sqlTx.QueryRowContext(ctx, `
		SELECT id, tenant_id, dashboard_id, role_id, created_by, expires_at, created_at
		FROM dashboard_shares WHERE id = ? AND tenant_id = ?
	`, id, tenantID)
	return scanDashboardShare(row)
}

func scanDashboardShare(s scanner) (*store.DashboardShare, error) {
	var (
		ds         store.DashboardShare
		createdBy  *string
		expiresAt  *string
		createdStr string
	)
	if err := s.Scan(&ds.ID, &ds.TenantID, &ds.DashboardID, &ds.RoleID, &createdBy, &expiresAt, &createdStr); err != nil {
		return nil, err
	}
	ds.CreatedAt = parseTime(createdStr)
	if createdBy != nil {
		v := *createdBy
		ds.CreatedBy = &v
	}
	if expiresAt != nil {
		t := parseTime(*expiresAt)
		ds.ExpiresAt = &t
	}
	return &ds, nil
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

// AI subsystem methods are implemented in mysql_ai.go.

// Sites and Middlewares are implemented in mysql_sites.go.

// ---------------------------------------------------------------------------
// RBAC Policies
// ---------------------------------------------------------------------------

func (t *tx) CreateRbacPolicy(ctx context.Context, p *store.RbacPolicy) (*store.RbacPolicy, error) {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	enabled := 1
	if !p.Enabled {
		enabled = 0
	}
	_, err := t.sqlTx.ExecContext(ctx, `
		INSERT INTO rbac_policies (id, tenant_id, name, description, subject_type, subject_id, role_id, enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, p.ID, tenantID, p.Name, p.Description, p.SubjectType, p.SubjectID, p.RoleID, enabled, now, now)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrRbacPolicyDuplicate
		}
		return nil, fmt.Errorf("mysql: create rbac_policy: %w", err)
	}
	t.emit("rbac_policies", p.ID, "INSERT")
	return t.GetRbacPolicy(ctx, p.ID)
}

func (t *tx) GetRbacPolicy(ctx context.Context, id string) (*store.RbacPolicy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, `
		SELECT id, tenant_id, name, description, subject_type, subject_id, role_id, enabled, created_at, updated_at
		FROM rbac_policies WHERE id = ? AND tenant_id = ?
	`, id, tenantID)
	p, err := scanRbacPolicy(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrRbacPolicyNotFound
	}
	return p, err
}

func (t *tx) ListRbacPolicies(ctx context.Context) ([]*store.RbacPolicy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, `
		SELECT id, tenant_id, name, description, subject_type, subject_id, role_id, enabled, created_at, updated_at
		FROM rbac_policies WHERE tenant_id = ? ORDER BY created_at, id
	`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list rbac_policies: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.RbacPolicy
	for rows.Next() {
		p, err := scanRbacPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) UpdateRbacPolicy(ctx context.Context, id string, params store.UpdateRbacPolicyParams) (*store.RbacPolicy, error) {
	if _, err := t.GetRbacPolicy(ctx, id); err != nil {
		return nil, err
	}
	tenantID := store.TenantIDFromContext(ctx)
	now := nowUTC()
	var setClauses []string
	var args []any
	if params.Name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *params.Name)
	}
	if params.Description != nil {
		setClauses = append(setClauses, "description = ?")
		args = append(args, *params.Description)
	}
	if params.SubjectType != nil {
		setClauses = append(setClauses, "subject_type = ?")
		args = append(args, *params.SubjectType)
	}
	if params.SubjectID != nil {
		setClauses = append(setClauses, "subject_id = ?")
		args = append(args, *params.SubjectID)
	}
	if params.RoleID != nil {
		setClauses = append(setClauses, "role_id = ?")
		args = append(args, *params.RoleID)
	}
	if params.Enabled != nil {
		v := 0
		if *params.Enabled {
			v = 1
		}
		setClauses = append(setClauses, "enabled = ?")
		args = append(args, v)
	}
	if len(setClauses) > 0 {
		setClauses = append(setClauses, "updated_at = ?")
		args = append(args, now, id, tenantID)
		query := "UPDATE rbac_policies SET " + strings.Join(setClauses, ", ") +
			" WHERE id = ? AND tenant_id = ?"
		if _, err := t.sqlTx.ExecContext(ctx, query, args...); err != nil {
			if isUniqueViolation(err) {
				return nil, store.ErrRbacPolicyDuplicate
			}
			return nil, fmt.Errorf("mysql: update rbac_policy: %w", err)
		}
		t.emit("rbac_policies", id, "UPDATE")
	}
	return t.GetRbacPolicy(ctx, id)
}

func (t *tx) DeleteRbacPolicy(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM rbac_policies WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete rbac_policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrRbacPolicyNotFound
	}
	t.emit("rbac_policies", id, "DELETE")
	return nil
}

func scanRbacPolicy(s scanner) (*store.RbacPolicy, error) {
	var (
		p          store.RbacPolicy
		enabledInt int
		createdStr string
		updatedStr string
	)
	if err := s.Scan(&p.ID, &p.TenantID, &p.Name, &p.Description, &p.SubjectType, &p.SubjectID, &p.RoleID, &enabledInt, &createdStr, &updatedStr); err != nil {
		return nil, err
	}
	p.Enabled = enabledInt == 1
	p.CreatedAt = parseTime(createdStr)
	p.UpdatedAt = parseTime(updatedStr)
	return &p, nil
}

// ---------------------------------------------------------------------------
// Access Policies
// ---------------------------------------------------------------------------

func (t *tx) CreateAccessPolicy(ctx context.Context, p *store.AccessPolicy) (*store.AccessPolicy, error) {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	now := nowUTC()
	targetIDs, err := json.Marshal(orEmpty(p.TargetIDs))
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal target_ids: %w", err)
	}
	conditions, err := json.Marshal(orEmptyConditions(p.Conditions))
	if err != nil {
		return nil, fmt.Errorf("mysql: marshal conditions: %w", err)
	}
	enabled := 0
	if p.Enabled {
		enabled = 1
	}
	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx, `
		INSERT INTO access_policies
			(id, tenant_id, name, description, effect, target_type, target_ids_json, conditions_json, priority, enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, p.ID, tenantID, p.Name, p.Description, string(p.Effect), string(p.TargetType),
		string(targetIDs), string(conditions), p.Priority, enabled, now, now)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAccessPolicyDuplicate
		}
		return nil, fmt.Errorf("mysql: create access_policy: %w", err)
	}
	t.emit("access_policies", p.ID, "INSERT")
	return t.GetAccessPolicy(ctx, p.ID)
}

func (t *tx) GetAccessPolicy(ctx context.Context, id string) (*store.AccessPolicy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, `
		SELECT id, name, description, effect, target_type, target_ids_json,
		       conditions_json, priority, enabled, created_at, updated_at
		  FROM access_policies WHERE id = ? AND tenant_id = ?
	`, id, tenantID)
	p, err := scanAccessPolicy(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAccessPolicyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("mysql: get access_policy: %w", err)
	}
	return p, nil
}

func (t *tx) ListAccessPolicies(ctx context.Context) ([]*store.AccessPolicy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, `
		SELECT id, name, description, effect, target_type, target_ids_json,
		       conditions_json, priority, enabled, created_at, updated_at
		  FROM access_policies
		 WHERE tenant_id = ?
		 ORDER BY priority ASC, created_at ASC
	`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list access_policies: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AccessPolicy
	for rows.Next() {
		p, err := scanAccessPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) UpdateAccessPolicy(ctx context.Context, id string, params store.UpdateAccessPolicyParams) (*store.AccessPolicy, error) {
	if _, err := t.GetAccessPolicy(ctx, id); err != nil {
		return nil, err
	}
	now := nowUTC()
	if params.Name != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET name = ?, updated_at = ? WHERE id = ?`,
			*params.Name, now, id); err != nil {
			if isUniqueViolation(err) {
				return nil, store.ErrAccessPolicyDuplicate
			}
			return nil, fmt.Errorf("mysql: update access_policy name: %w", err)
		}
	}
	if params.Description != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET description = ?, updated_at = ? WHERE id = ?`,
			*params.Description, now, id); err != nil {
			return nil, fmt.Errorf("mysql: update access_policy description: %w", err)
		}
	}
	if params.Effect != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET effect = ?, updated_at = ? WHERE id = ?`,
			string(*params.Effect), now, id); err != nil {
			return nil, fmt.Errorf("mysql: update access_policy effect: %w", err)
		}
	}
	if params.TargetType != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET target_type = ?, updated_at = ? WHERE id = ?`,
			string(*params.TargetType), now, id); err != nil {
			return nil, fmt.Errorf("mysql: update access_policy target_type: %w", err)
		}
	}
	if params.TargetIDs != nil {
		raw, err := json.Marshal(orEmpty(*params.TargetIDs))
		if err != nil {
			return nil, fmt.Errorf("mysql: marshal target_ids: %w", err)
		}
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET target_ids_json = ?, updated_at = ? WHERE id = ?`,
			string(raw), now, id); err != nil {
			return nil, fmt.Errorf("mysql: update access_policy target_ids: %w", err)
		}
	}
	if params.Conditions != nil {
		raw, err := json.Marshal(orEmptyConditions(*params.Conditions))
		if err != nil {
			return nil, fmt.Errorf("mysql: marshal conditions: %w", err)
		}
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET conditions_json = ?, updated_at = ? WHERE id = ?`,
			string(raw), now, id); err != nil {
			return nil, fmt.Errorf("mysql: update access_policy conditions: %w", err)
		}
	}
	if params.Priority != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET priority = ?, updated_at = ? WHERE id = ?`,
			*params.Priority, now, id); err != nil {
			return nil, fmt.Errorf("mysql: update access_policy priority: %w", err)
		}
	}
	if params.Enabled != nil {
		v := 0
		if *params.Enabled {
			v = 1
		}
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET enabled = ?, updated_at = ? WHERE id = ?`,
			v, now, id); err != nil {
			return nil, fmt.Errorf("mysql: update access_policy enabled: %w", err)
		}
	}
	t.emit("access_policies", id, "UPDATE")
	return t.GetAccessPolicy(ctx, id)
}

func (t *tx) DeleteAccessPolicy(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM access_policies WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete access_policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrAccessPolicyNotFound
	}
	t.emit("access_policies", id, "DELETE")
	return nil
}

func scanAccessPolicy(s scanner) (*store.AccessPolicy, error) {
	var (
		p             store.AccessPolicy
		effect        string
		targetType    string
		targetIDsRaw  string
		conditionsRaw string
		enabledInt    int
		createdStr    string
		updatedStr    string
	)
	if err := s.Scan(&p.ID, &p.Name, &p.Description, &effect, &targetType,
		&targetIDsRaw, &conditionsRaw, &p.Priority, &enabledInt, &createdStr, &updatedStr); err != nil {
		return nil, err
	}
	p.Effect = store.AccessPolicyEffect(effect)
	p.TargetType = store.AccessPolicyTargetType(targetType)
	p.Enabled = enabledInt == 1
	p.CreatedAt = parseTime(createdStr)
	p.UpdatedAt = parseTime(updatedStr)
	if err := json.Unmarshal([]byte(targetIDsRaw), &p.TargetIDs); err != nil {
		return nil, fmt.Errorf("mysql: parse target_ids JSON: %w", err)
	}
	if p.TargetIDs == nil {
		p.TargetIDs = []string{}
	}
	if err := json.Unmarshal([]byte(conditionsRaw), &p.Conditions); err != nil {
		return nil, fmt.Errorf("mysql: parse conditions JSON: %w", err)
	}
	if p.Conditions == nil {
		p.Conditions = []store.AccessPolicyCondition{}
	}
	return &p, nil
}
