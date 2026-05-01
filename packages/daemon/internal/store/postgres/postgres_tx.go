package postgres

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
// returning "not implemented" errors until filled in by subsequent phases.
//
// SQL REWRITING — REQUIRED FOR EVERY METHOD IMPLEMENTATION
// When implementing a method stub below, always pass your SQL through
// rewritePlaceholders before executing it:
//
//	query := rewritePlaceholders("SELECT ... WHERE id = ?")
//	row := t.sqlTx.QueryRowContext(ctx, query, id)
//
// PostgreSQL uses $1, $2, ... syntax while SQLite uses `?`. The helper in
// placeholder.go converts `?` to $N at runtime. Skipping this call causes
// a silent runtime failure — PostgreSQL rejects `?` at the wire level and
// returns an error that is easy to miss during integration testing.
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

	matchersJSON, err := marshalMatchersJSON(route.GetMatchers())
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

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

func (t *tx) CreateService(ctx context.Context, svc *riokuv1.Service) (*riokuv1.Service, error) {
	id := uuid.New().String()
	now := nowUTC()

	hcJSON, err := marshalHealthCheckJSON(svc.GetHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal health_check: %w", err)
	}
	phcJSON, err := marshalPassiveHealthCheckJSON(svc.GetPassiveHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal passive_health_check: %w", err)
	}
	rpJSON, err := marshalRetryPolicyJSON(svc.GetRetryPolicy())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal retry_policy: %w", err)
	}
	utJSON, err := marshalUpstreamTLSJSON(svc.GetUpstreamTls())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal upstream_tls: %w", err)
	}
	cpJSON, err := marshalConnectionPoolJSON(svc.GetConnectionPool())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal connection_pool: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(svc.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO services (id, tenant_id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, tenantID, svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
		phcJSON, rpJSON, utJSON, cpJSON,
		svc.GetLbCookieName(), svc.GetLbHeaderName(),
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert service: %w", err)
	}

	// Insert upstreams.
	for _, u := range svc.GetUpstreams() {
		uid := uuid.New().String()
		_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`INSERT INTO upstreams (id, service_id, address, weight, tls_mode, healthy, dial_err)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`),
			uid, id, u.GetAddress(), u.GetWeight(), int32(u.GetTls()), u.GetHealthy(), u.GetDialErr(),
		)
		if err != nil {
			return nil, fmt.Errorf("postgres: insert upstream: %w", err)
		}
	}

	t.emit("services", id, "INSERT")

	return t.GetService(ctx, id)
}

func (t *tx) GetService(ctx context.Context, id string) (*riokuv1.Service, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name
		 FROM services WHERE id = ? AND tenant_id = ?`), id, tenantID)

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
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name FROM services WHERE tenant_id = ? ORDER BY id`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list services: %w", err)
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
		uRows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
			`SELECT u.id, u.service_id, u.address, u.weight, u.tls_mode, u.healthy, u.dial_err
			 FROM upstreams u JOIN services s ON s.id = u.service_id
			 WHERE s.tenant_id = ? ORDER BY u.service_id, u.id`), tenantID)
		if err != nil {
			return nil, fmt.Errorf("postgres: fetch all upstreams: %w", err)
		}
		defer func() { _ = uRows.Close() }()

		for uRows.Next() {
			var (
				uid       string
				serviceID string
				address   string
				weight    int32
				tlsMode   int32
				healthy   bool
				dialErr   string
			)
			if err := uRows.Scan(&uid, &serviceID, &address, &weight, &tlsMode, &healthy, &dialErr); err != nil {
				return nil, fmt.Errorf("postgres: scan upstream: %w", err)
			}
			if svc, ok := serviceIndex[serviceID]; ok {
				svc.Upstreams = append(svc.Upstreams, &riokuv1.Upstream{
					Id:      uid,
					Address: address,
					Weight:  weight,
					Tls:     riokuv1.TLSMode(tlsMode),
					Healthy: healthy,
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
		return nil, fmt.Errorf("postgres: marshal health_check: %w", err)
	}
	phcJSON, err := marshalPassiveHealthCheckJSON(svc.GetPassiveHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal passive_health_check: %w", err)
	}
	rpJSON, err := marshalRetryPolicyJSON(svc.GetRetryPolicy())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal retry_policy: %w", err)
	}
	utJSON, err := marshalUpstreamTLSJSON(svc.GetUpstreamTls())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal upstream_tls: %w", err)
	}
	cpJSON, err := marshalConnectionPoolJSON(svc.GetConnectionPool())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal connection_pool: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(svc.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE services SET name=?, lb_policy=?, health_check=?, labels=?, updated_at=?, dial_timeout_seconds=?, response_header_timeout_seconds=?, idle_timeout_seconds=?, passive_health_check=?, retry_policy=?, upstream_tls=?, connection_pool=?, lb_cookie_name=?, lb_header_name=?
		 WHERE id=? AND tenant_id=?`),
		svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
		phcJSON, rpJSON, utJSON, cpJSON,
		svc.GetLbCookieName(), svc.GetLbHeaderName(),
		svc.GetId(), tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: update service: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("postgres: service %q not found", svc.GetId())
	}

	// Replace upstreams: delete existing, insert new.
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM upstreams WHERE service_id = ?`), svc.GetId()); err != nil {
		return nil, fmt.Errorf("postgres: delete old upstreams: %w", err)
	}
	for _, u := range svc.GetUpstreams() {
		uid := u.GetId()
		if uid == "" {
			uid = uuid.New().String()
		}
		_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`INSERT INTO upstreams (id, service_id, address, weight, tls_mode, healthy, dial_err)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`),
			uid, svc.GetId(), u.GetAddress(), u.GetWeight(), int32(u.GetTls()), u.GetHealthy(), u.GetDialErr(),
		)
		if err != nil {
			return nil, fmt.Errorf("postgres: insert upstream: %w", err)
		}
	}

	t.emit("services", svc.GetId(), "UPDATE")

	return t.GetService(ctx, svc.GetId())
}

func (t *tx) DeleteService(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM services WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete service: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: service %q not found", id)
	}
	// Clean up orphaned policy bindings for this service.
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM policy_bindings WHERE target_type = 'service' AND target_id = ?`), id,
	); err != nil {
		return fmt.Errorf("postgres: cleanup service policy_bindings: %w", err)
	}
	t.emit("services", id, "DELETE")
	return nil
}

func (t *tx) fetchUpstreams(ctx context.Context, serviceID string) ([]*riokuv1.Upstream, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, address, weight, tls_mode, healthy, dial_err
		 FROM upstreams WHERE service_id = ?`), serviceID)
	if err != nil {
		return nil, fmt.Errorf("postgres: fetch upstreams: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var upstreams []*riokuv1.Upstream
	for rows.Next() {
		var (
			id      string
			address string
			weight  int32
			tlsMode int32
			healthy bool
			dialErr string
		)
		if err := rows.Scan(&id, &address, &weight, &tlsMode, &healthy, &dialErr); err != nil {
			return nil, fmt.Errorf("postgres: scan upstream: %w", err)
		}
		upstreams = append(upstreams, &riokuv1.Upstream{
			Id:      id,
			Address: address,
			Weight:  weight,
			Tls:     riokuv1.TLSMode(tlsMode),
			Healthy: healthy,
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
		return nil, fmt.Errorf("postgres: marshal policy config: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(pol.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO policies (id, tenant_id, name, type, config, labels, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		id, tenantID, pol.GetName(), int32(pol.GetType()), configJSON, labelsJSON, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert policy: %w", err)
	}

	t.emit("policies", id, "INSERT")

	return t.GetPolicy(ctx, id)
}

func (t *tx) GetPolicy(ctx context.Context, id string) (*riokuv1.Policy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, name, type, config, labels, created_at, updated_at
		 FROM policies WHERE id = ? AND tenant_id = ?`), id, tenantID)
	return scanPolicy(row)
}

func (t *tx) ListPolicies(ctx context.Context) ([]*riokuv1.Policy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, name, type, config, labels, created_at, updated_at FROM policies WHERE tenant_id = ? ORDER BY id`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list policies: %w", err)
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
		return nil, fmt.Errorf("postgres: marshal policy config: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(pol.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("postgres: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE policies SET name=?, type=?, config=?, labels=?, updated_at=? WHERE id=? AND tenant_id=?`),
		pol.GetName(), int32(pol.GetType()), configJSON, labelsJSON, now, pol.GetId(), tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: update policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("postgres: policy %q not found", pol.GetId())
	}

	t.emit("policies", pol.GetId(), "UPDATE")

	return t.GetPolicy(ctx, pol.GetId())
}

func (t *tx) DeletePolicy(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM policies WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: policy %q not found", id)
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
		return fmt.Errorf("postgres: invalid target_type %q (must be 'route' or 'service')", targetType)
	}
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO policy_bindings (policy_id, target_type, target_id) VALUES (?, ?, ?)`),
		policyID, targetType, targetID,
	)
	if err != nil {
		return fmt.Errorf("postgres: attach policy: %w", err)
	}
	t.emit("policy_bindings", policyID, "INSERT")
	return nil
}

func (t *tx) DetachPolicy(ctx context.Context, policyID, targetType, targetID string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM policy_bindings WHERE policy_id=? AND target_type=? AND target_id=?`),
		policyID, targetType, targetID,
	)
	if err != nil {
		return fmt.Errorf("postgres: detach policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: policy binding not found")
	}
	t.emit("policy_bindings", policyID, "DELETE")
	return nil
}

func (t *tx) ListPoliciesByTarget(ctx context.Context, targetType, targetID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT policy_id FROM policy_bindings WHERE target_type=? AND target_id=?`),
		targetType, targetID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list policies by target: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("postgres: scan policy_id: %w", err)
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
		return "", fmt.Errorf("postgres: marshal scopes: %w", err)
	}

	var ownerIDVal *string
	if ownerID != "" {
		ownerIDVal = &ownerID
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO api_keys (id, tenant_id, name, key_hash, scopes, expires_at, created_at, owner_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		id, tenantID, name, keyHash, string(scopesJSON), expiresAt, now, ownerIDVal,
	)
	if err != nil {
		return "", fmt.Errorf("postgres: insert api_key: %w", err)
	}

	t.emit("api_keys", id, "INSERT")

	return id, nil
}

func (t *tx) GetAPIKey(ctx context.Context, id string) (*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count
		 FROM api_keys WHERE id = ? AND tenant_id = ?`), id, tenantID)
	return scanAPIKey(row)
}

// GetAPIKeyByHash is invoked by the auth middleware before any tenant
// context exists. The hash is unique system-wide; the resolved key
// carries its tenant_id so the caller can attach it to the request
// context for downstream tenant filtering.
func (t *tx) GetAPIKeyByHash(ctx context.Context, keyHash string) (*store.APIKey, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count
		 FROM api_keys WHERE key_hash = ?`), keyHash)
	return scanAPIKey(row)
}

func (t *tx) ListAPIKeys(ctx context.Context) ([]*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count
		 FROM api_keys WHERE revoked_at IS NULL AND tenant_id = ?`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list api_keys: %w", err)
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
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count
		 FROM api_keys WHERE revoked_at IS NULL AND owner_id = ? AND tenant_id = ?`), ownerID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list api_keys by owner: %w", err)
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
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL`),
		now, id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("postgres: revoke api_key: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: api_key %q not found or already revoked", id)
	}
	t.emit("api_keys", id, "UPDATE")
	return nil
}

// UpdateAPIKey applies partial changes to a key's metadata.
func (t *tx) UpdateAPIKey(ctx context.Context, id string, params store.UpdateAPIKeyParams) (*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	// Build the SET clause from the supplied fields. Skip the UPDATE
	// entirely when nothing was supplied so we don't bump anything for
	// a no-op call.
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
			return nil, fmt.Errorf("postgres: marshal scopes: %w", err)
		}
		setClauses = append(setClauses, "scopes = ?")
		args = append(args, string(raw))
	}
	if params.ExpiresAt != nil {
		if *params.ExpiresAt == nil {
			setClauses = append(setClauses, "expires_at = NULL")
		} else {
			setClauses = append(setClauses, "expires_at = ?")
			args = append(args, (*params.ExpiresAt).UTC())
		}
	}
	if len(setClauses) > 0 {
		args = append(args, id, tenantID)
		query := rewritePlaceholders("UPDATE api_keys SET " + strings.Join(setClauses, ", ") +
			" WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL")
		res, err := t.sqlTx.ExecContext(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("postgres: update api_key: %w", err)
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return nil, fmt.Errorf("postgres: api_key %q not found", id)
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
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE api_keys SET last_used_at = ?, usage_count = usage_count + 1 WHERE id = ?`),
		at.UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("postgres: record api_key use: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Config Versions
// ---------------------------------------------------------------------------

const maxConfigVersions = 100

func (t *tx) SaveConfigVersion(ctx context.Context, snapshot []byte, actor string) (int64, error) {
	now := nowUTC()
	const q = `INSERT INTO config_versions (snapshot, actor, created_at) VALUES (?, ?, ?) RETURNING version`
	var version int64
	if err := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(q), string(snapshot), actor, now).Scan(&version); err != nil {
		return 0, fmt.Errorf("postgres: insert config_version: %w", err)
	}
	t.emit("config_versions", fmt.Sprintf("%d", version), "INSERT")

	// Prune old versions beyond the max retention.
	_, _ = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM config_versions WHERE version NOT IN (
			SELECT version FROM config_versions ORDER BY version DESC LIMIT ?
		)`), maxConfigVersions)

	return version, nil
}

func (t *tx) GetConfigVersion(ctx context.Context, version int64) (*store.ConfigVersion, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT version, snapshot, actor, created_at FROM config_versions WHERE version = ?`), version)

	var cv store.ConfigVersion
	var createdAt time.Time
	if err := row.Scan(&cv.Version, &cv.Snapshot, &cv.Actor, &createdAt); err != nil {
		return nil, fmt.Errorf("postgres: get config_version: %w", err)
	}
	cv.CreatedAt = createdAt.UTC()
	return &cv, nil
}

func (t *tx) ListConfigVersions(ctx context.Context, limit int) ([]*store.ConfigVersion, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT version, snapshot, actor, created_at FROM config_versions ORDER BY version DESC LIMIT ?`), limit)
	if err != nil {
		return nil, fmt.Errorf("postgres: list config_versions: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var versions []*store.ConfigVersion
	for rows.Next() {
		var cv store.ConfigVersion
		var createdAt time.Time
		if err := rows.Scan(&cv.Version, &cv.Snapshot, &cv.Actor, &createdAt); err != nil {
			return nil, fmt.Errorf("postgres: scan config_version: %w", err)
		}
		cv.CreatedAt = createdAt.UTC()
		versions = append(versions, &cv)
	}
	return versions, rows.Err()
}

func (t *tx) LatestConfigVersion(ctx context.Context) (int64, error) {
	var version int64
	err := t.sqlTx.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM config_versions`).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("postgres: latest config version: %w", err)
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
		now = entry.GetOccurredAt().AsTime().UTC()
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO audit_log (id, tenant_id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, tenantID, entry.GetActor(), entry.GetEntityType(), entry.GetEntityId(),
		entry.GetOperation(), entry.GetDiff(), entry.GetConfigVersion(), now,
	)
	if err != nil {
		return fmt.Errorf("postgres: append audit entry: %w", err)
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
		args = append(args, query.Since.UTC())
	}
	if query.Until != nil {
		q += ` AND occurred_at <= ?`
		args = append(args, query.Until.UTC())
	}

	q += ` ORDER BY occurred_at DESC`

	limit := query.Limit
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	q += ` LIMIT ?`
	args = append(args, limit)

	if query.Offset > 0 {
		q += ` OFFSET ?`
		args = append(args, query.Offset)
	}

	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(q), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: query audit log: %w", err)
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
			occurredAt    time.Time
		)
		if err := rows.Scan(&id, &actor, &entityType, &entityID, &operation, &diff, &configVersion, &occurredAt); err != nil {
			return nil, fmt.Errorf("postgres: scan audit entry: %w", err)
		}
		entries = append(entries, &riokuv1.AuditEntry{
			Id:            id,
			Actor:         actor,
			EntityType:    entityType,
			EntityId:      entityID,
			Operation:     operation,
			Diff:          diff,
			ConfigVersion: configVersion,
			OccurredAt:    timestamppb.New(occurredAt.UTC()),
		})
	}
	return entries, rows.Err()
}

// CountAuditLog mirrors QueryAuditLog's WHERE clause but returns
// COUNT(*) so the REST layer can expose total counts for paginated UIs.
// Limit/Offset are intentionally ignored.
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
		args = append(args, query.Since.UTC())
	}
	if query.Until != nil {
		q += ` AND occurred_at <= ?`
		args = append(args, query.Until.UTC())
	}

	var count int
	if err := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(q), args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("postgres: count audit log: %w", err)
	}
	return count, nil
}

// GetAuditEntry returns a single audit entry by id, scoped to the active tenant.
func (t *tx) GetAuditEntry(ctx context.Context, id string) (*riokuv1.AuditEntry, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at
		 FROM audit_log WHERE id = ? AND tenant_id = ?`), id, tenantID)
	var (
		gotID         string
		actor         string
		entityType    string
		entityID      string
		operation     string
		diff          string
		configVersion int64
		occurredAt    time.Time
	)
	if err := row.Scan(&gotID, &actor, &entityType, &entityID, &operation, &diff, &configVersion, &occurredAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("postgres: audit entry %q not found", id)
		}
		return nil, fmt.Errorf("postgres: get audit entry: %w", err)
	}
	return &riokuv1.AuditEntry{
		Id:            gotID,
		Actor:         actor,
		EntityType:    entityType,
		EntityId:      entityID,
		Operation:     operation,
		Diff:          diff,
		ConfigVersion: configVersion,
		OccurredAt:    timestamppb.New(occurredAt.UTC()),
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

	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(q), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: list audit actors: %w", err)
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

	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(q), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: list audit resource_ids: %w", err)
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

	passwordChangedAt := now
	if !u.PasswordChangedAt.IsZero() {
		passwordChangedAt = u.PasswordChangedAt.UTC()
	}

	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO users (id, username, email, display_name, password_hash, status,
		                     totp_secret, totp_enabled, force_password_change,
		                     failed_attempts, locked_until, last_login,
		                     password_changed_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, username, email, displayName, u.PasswordHash, u.Status,
		totpSecret, u.TOTPEnabled, u.ForcePasswordChange,
		u.FailedAttempts, u.LockedUntil, u.LastLogin,
		passwordChangedAt, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert user: %w", err)
	}

	t.emit("users", id, "INSERT")

	return t.GetUser(ctx, id)
}

func (t *tx) GetUser(ctx context.Context, id string) (*store.User, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users WHERE id = ?`), id)
	return scanUser(row)
}

func (t *tx) GetUserByUsername(ctx context.Context, username string) (*store.User, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users WHERE LOWER(username) = LOWER(?)`), username)
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
		return nil, fmt.Errorf("postgres: list users: %w", err)
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

	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE users SET username=?, email=?, display_name=?, password_hash=?, status=?,
		                  totp_secret=?, totp_enabled=?, force_password_change=?,
		                  failed_attempts=?, locked_until=?, last_login=?,
		                  password_changed_at=?, updated_at=?
		 WHERE id=?`),
		strings.ToLower(u.Username), email, displayName, u.PasswordHash, u.Status,
		totpSecret, u.TOTPEnabled, u.ForcePasswordChange,
		u.FailedAttempts, u.LockedUntil, u.LastLogin,
		u.PasswordChangedAt.UTC(), now, u.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: update user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("postgres: user %q not found", u.ID)
	}

	t.emit("users", u.ID, "UPDATE")

	return t.GetUser(ctx, u.ID)
}

func (t *tx) DeleteUser(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM users WHERE id = ?`), id)
	if err != nil {
		return fmt.Errorf("postgres: delete user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: user %q not found", id)
	}
	t.emit("users", id, "DELETE")
	return nil
}

func (t *tx) IncrementFailedAttempts(ctx context.Context, userID string, lockUntil *time.Time) error {
	var res sql.Result
	var err error

	if lockUntil != nil {
		res, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE users SET failed_attempts = failed_attempts + 1,
			                  locked_until = ?, status = 'locked', updated_at = ?
			 WHERE id = ?`),
			lockUntil.UTC(), nowUTC(), userID,
		)
	} else {
		res, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE users SET failed_attempts = failed_attempts + 1, updated_at = ?
			 WHERE id = ?`),
			nowUTC(), userID,
		)
	}
	if err != nil {
		return fmt.Errorf("postgres: increment failed_attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: user %q not found", userID)
	}
	t.emit("users", userID, "UPDATE")
	return nil
}

func (t *tx) ResetFailedAttempts(ctx context.Context, userID string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE users SET failed_attempts = 0, locked_until = NULL, status = 'active', updated_at = ?
		 WHERE id = ?`),
		nowUTC(), userID,
	)
	if err != nil {
		return fmt.Errorf("postgres: reset failed_attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: user %q not found", userID)
	}
	t.emit("users", userID, "UPDATE")
	return nil
}

func (t *tx) UpdateLastLogin(ctx context.Context, userID string) error {
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?`),
		now, now, userID,
	)
	if err != nil {
		return fmt.Errorf("postgres: update last_login: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: user %q not found", userID)
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
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO sessions (id, tenant_id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		s.ID, tenantID, s.UserID, s.Fingerprint,
		s.CreatedAt.UTC(), s.ExpiresAt.UTC(), s.LastActive.UTC(),
		ipAddress, userAgent,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert session: %w", err)
	}

	t.emit("sessions", s.ID, "INSERT")

	return t.GetSession(ctx, s.ID)
}

// GetSession does NOT filter by tenant. Sessions live for the user's
// active tenant only — but the auth middleware looks up the session
// before any tenant context exists.
func (t *tx) GetSession(ctx context.Context, id string) (*store.Session, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent
		 FROM sessions WHERE id = ?`), id)
	return scanSession(row)
}

func (t *tx) ListSessionsByUser(ctx context.Context, userID string) ([]*store.Session, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent
		 FROM sessions WHERE user_id = ? ORDER BY created_at`), userID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list sessions by user: %w", err)
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
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM sessions WHERE id = ?`), id)
	if err != nil {
		return fmt.Errorf("postgres: delete session: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: session %q not found", id)
	}
	t.emit("sessions", id, "DELETE")
	return nil
}

func (t *tx) DeleteSessionsByUser(ctx context.Context, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM sessions WHERE user_id = ?`), userID)
	if err != nil {
		return fmt.Errorf("postgres: delete sessions by user: %w", err)
	}
	t.emit("sessions", userID, "DELETE")
	return nil
}

func (t *tx) DeleteSessionsByUserExcept(ctx context.Context, userID, exceptSessionID string) error {
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM sessions WHERE user_id = ? AND id != ?`), userID, exceptSessionID)
	if err != nil {
		return fmt.Errorf("postgres: delete sessions by user except: %w", err)
	}
	t.emit("sessions", userID, "DELETE")
	return nil
}

func (t *tx) UpdateSessionLastActive(ctx context.Context, id string, at time.Time) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE sessions SET last_active = ? WHERE id = ?`),
		at.UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("postgres: update session last_active: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: session %q not found", id)
	}
	t.emit("sessions", id, "UPDATE")
	return nil
}

func (t *tx) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	now := nowUTC()
	yesterday := now.Add(-24 * time.Hour)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM sessions WHERE expires_at < ? OR last_active < ?`),
		now, yesterday,
	)
	if err != nil {
		return 0, fmt.Errorf("postgres: delete expired sessions: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

func (t *tx) CreateRole(_ context.Context, _ store.CreateRoleParams) (*store.Role, error) {
	return nil, errors.New("postgres: CreateRole not implemented")
}

func (t *tx) GetRole(_ context.Context, _ string) (*store.Role, error) {
	return nil, errors.New("postgres: GetRole not implemented")
}

func (t *tx) ListRoles(_ context.Context) ([]*store.Role, error) {
	return nil, errors.New("postgres: ListRoles not implemented")
}

func (t *tx) UpdateRole(_ context.Context, _ string, _ store.UpdateRoleParams) (*store.Role, error) {
	return nil, errors.New("postgres: UpdateRole not implemented")
}

func (t *tx) DeleteRole(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteRole not implemented")
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

func (t *tx) ListPermissions(_ context.Context) ([]*store.Permission, error) {
	return nil, errors.New("postgres: ListPermissions not implemented")
}

func (t *tx) GetUserScopes(_ context.Context, _ string) ([]string, error) {
	return nil, errors.New("postgres: GetUserScopes not implemented")
}

// ---------------------------------------------------------------------------
// User Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignRole(_ context.Context, _, _, _ string) error {
	return errors.New("postgres: AssignRole not implemented")
}

func (t *tx) RevokeRole(_ context.Context, _, _ string) error {
	return errors.New("postgres: RevokeRole not implemented")
}

func (t *tx) ListUserRoles(_ context.Context, _ string) ([]*store.UserRole, error) {
	return nil, errors.New("postgres: ListUserRoles not implemented")
}

func (t *tx) ListUsersWithRole(_ context.Context, _ string) ([]string, error) {
	return nil, errors.New("postgres: ListUsersWithRole not implemented")
}

// ---------------------------------------------------------------------------
// TOTP Backup Codes
// ---------------------------------------------------------------------------

func (t *tx) CreateTOTPBackupCodes(_ context.Context, _ string, _ []string) error {
	return errors.New("postgres: CreateTOTPBackupCodes not implemented")
}

func (t *tx) ListUnusedTOTPBackupCodes(_ context.Context, _ string) ([]*store.TOTPBackupCode, error) {
	return nil, errors.New("postgres: ListUnusedTOTPBackupCodes not implemented")
}

func (t *tx) MarkTOTPBackupCodeUsed(_ context.Context, _ string) error {
	return errors.New("postgres: MarkTOTPBackupCodeUsed not implemented")
}

func (t *tx) DeleteTOTPBackupCodes(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteTOTPBackupCodes not implemented")
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

func (t *tx) CreateTenant(_ context.Context, _ *store.Tenant) (*store.Tenant, error) {
	return nil, errors.New("postgres: CreateTenant not implemented")
}

func (t *tx) GetTenant(_ context.Context, _ string) (*store.Tenant, error) {
	return nil, errors.New("postgres: GetTenant not implemented")
}

func (t *tx) GetTenantBySlug(_ context.Context, _ string) (*store.Tenant, error) {
	return nil, errors.New("postgres: GetTenantBySlug not implemented")
}

func (t *tx) ListTenants(_ context.Context) ([]*store.Tenant, error) {
	return nil, errors.New("postgres: ListTenants not implemented")
}

func (t *tx) UpdateTenant(_ context.Context, _ string, _ store.UpdateTenantParams) (*store.Tenant, error) {
	return nil, errors.New("postgres: UpdateTenant not implemented")
}

func (t *tx) DeleteTenant(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteTenant not implemented")
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

func (t *tx) CreateMembership(_ context.Context, _ *store.Membership) (*store.Membership, error) {
	return nil, errors.New("postgres: CreateMembership not implemented")
}

func (t *tx) GetMembership(_ context.Context, _ string) (*store.Membership, error) {
	return nil, errors.New("postgres: GetMembership not implemented")
}

func (t *tx) GetMembershipByTenantUser(_ context.Context, _, _ string) (*store.Membership, error) {
	return nil, errors.New("postgres: GetMembershipByTenantUser not implemented")
}

func (t *tx) ListMembershipsByTenant(_ context.Context, _ string) ([]*store.Membership, error) {
	return nil, errors.New("postgres: ListMembershipsByTenant not implemented")
}

func (t *tx) ListMembershipsByUser(_ context.Context, _ string) ([]*store.Membership, error) {
	return nil, errors.New("postgres: ListMembershipsByUser not implemented")
}

func (t *tx) UpdateMembershipState(_ context.Context, _, _ string) (*store.Membership, error) {
	return nil, errors.New("postgres: UpdateMembershipState not implemented")
}

func (t *tx) DeleteMembership(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteMembership not implemented")
}

// ---------------------------------------------------------------------------
// Membership Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignMembershipRole(_ context.Context, _, _, _ string) error {
	return errors.New("postgres: AssignMembershipRole not implemented")
}

func (t *tx) RevokeMembershipRole(_ context.Context, _, _ string) error {
	return errors.New("postgres: RevokeMembershipRole not implemented")
}

func (t *tx) ListMembershipRoles(_ context.Context, _ string) ([]store.Role, error) {
	return nil, errors.New("postgres: ListMembershipRoles not implemented")
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboard(_ context.Context, _ *store.Dashboard) (*store.Dashboard, error) {
	return nil, errors.New("postgres: CreateDashboard not implemented")
}

func (t *tx) GetDashboard(_ context.Context, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("postgres: GetDashboard not implemented")
}

func (t *tx) ListDashboardsByTenant(_ context.Context, _ string) ([]*store.Dashboard, error) {
	return nil, errors.New("postgres: ListDashboardsByTenant not implemented")
}

func (t *tx) UpdateDashboard(_ context.Context, _, _ string, _ store.UpdateDashboardParams) (*store.Dashboard, error) {
	return nil, errors.New("postgres: UpdateDashboard not implemented")
}

func (t *tx) DeleteDashboard(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteDashboard not implemented")
}

func (t *tx) SetDefaultDashboard(_ context.Context, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("postgres: SetDefaultDashboard not implemented")
}

func (t *tx) SetDashboardHomeForUser(_ context.Context, _, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("postgres: SetDashboardHomeForUser not implemented")
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

func (t *tx) CreateWidget(_ context.Context, _ *store.Widget) (*store.Widget, error) {
	return nil, errors.New("postgres: CreateWidget not implemented")
}

func (t *tx) GetWidget(_ context.Context, _ string) (*store.Widget, error) {
	return nil, errors.New("postgres: GetWidget not implemented")
}

func (t *tx) ListWidgetsByDashboard(_ context.Context, _ string) ([]*store.Widget, error) {
	return nil, errors.New("postgres: ListWidgetsByDashboard not implemented")
}

func (t *tx) UpdateWidget(_ context.Context, _ string, _ store.UpdateWidgetParams) (*store.Widget, error) {
	return nil, errors.New("postgres: UpdateWidget not implemented")
}

func (t *tx) DeleteWidget(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteWidget not implemented")
}

func (t *tx) UpdateDashboardLayout(_ context.Context, _ string, _ map[string]string) error {
	return errors.New("postgres: UpdateDashboardLayout not implemented")
}

// ---------------------------------------------------------------------------
// Dashboard Versions
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardVersion(_ context.Context, _ *store.DashboardVersion) (*store.DashboardVersion, error) {
	return nil, errors.New("postgres: CreateDashboardVersion not implemented")
}

func (t *tx) GetDashboardVersion(_ context.Context, _ string) (*store.DashboardVersion, error) {
	return nil, errors.New("postgres: GetDashboardVersion not implemented")
}

func (t *tx) ListDashboardVersions(_ context.Context, _ string) ([]*store.DashboardVersion, error) {
	return nil, errors.New("postgres: ListDashboardVersions not implemented")
}

// ---------------------------------------------------------------------------
// Dashboard Shares
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardShare(_ context.Context, _ *store.DashboardShare) (*store.DashboardShare, error) {
	return nil, errors.New("postgres: CreateDashboardShare not implemented")
}

func (t *tx) ListDashboardShares(_ context.Context, _ string) ([]*store.DashboardShare, error) {
	return nil, errors.New("postgres: ListDashboardShares not implemented")
}

func (t *tx) DeleteDashboardShare(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteDashboardShare not implemented")
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

func (t *tx) CreateWebhookEndpoint(_ context.Context, _ *store.WebhookEndpoint) (*store.WebhookEndpoint, error) {
	return nil, errors.New("postgres: CreateWebhookEndpoint not implemented")
}

func (t *tx) GetWebhookEndpoint(_ context.Context, _, _ string) (*store.WebhookEndpoint, error) {
	return nil, errors.New("postgres: GetWebhookEndpoint not implemented")
}

func (t *tx) ListWebhookEndpointsByTenant(_ context.Context, _ string) ([]*store.WebhookEndpoint, error) {
	return nil, errors.New("postgres: ListWebhookEndpointsByTenant not implemented")
}

func (t *tx) UpdateWebhookEndpoint(_ context.Context, _, _ string, _ store.UpdateWebhookEndpointParams) (*store.WebhookEndpoint, error) {
	return nil, errors.New("postgres: UpdateWebhookEndpoint not implemented")
}

func (t *tx) DeleteWebhookEndpoint(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteWebhookEndpoint not implemented")
}

// ---------------------------------------------------------------------------
// Cluster Enrollment Tokens
// ---------------------------------------------------------------------------

func (t *tx) CreateEnrollmentToken(_ context.Context, _ *store.ClusterEnrollmentToken) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("postgres: CreateEnrollmentToken not implemented")
}

func (t *tx) GetEnrollmentTokenByHash(_ context.Context, _ string) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("postgres: GetEnrollmentTokenByHash not implemented")
}

func (t *tx) ListActiveEnrollmentTokens(_ context.Context) ([]*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("postgres: ListActiveEnrollmentTokens not implemented")
}

func (t *tx) ConsumeEnrollmentToken(_ context.Context, _, _ string) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("postgres: ConsumeEnrollmentToken not implemented")
}

func (t *tx) RevokeEnrollmentToken(_ context.Context, _ string) error {
	return errors.New("postgres: RevokeEnrollmentToken not implemented")
}

// ---------------------------------------------------------------------------
// Impersonation Sessions
// ---------------------------------------------------------------------------

func (t *tx) CreateImpersonationSession(_ context.Context, _ *store.ImpersonationSession) (*store.ImpersonationSession, error) {
	return nil, errors.New("postgres: CreateImpersonationSession not implemented")
}

func (t *tx) GetImpersonationSession(_ context.Context, _ string) (*store.ImpersonationSession, error) {
	return nil, errors.New("postgres: GetImpersonationSession not implemented")
}

func (t *tx) ListActiveImpersonationSessions(_ context.Context) ([]*store.ImpersonationSession, error) {
	return nil, errors.New("postgres: ListActiveImpersonationSessions not implemented")
}

func (t *tx) EndImpersonationSession(_ context.Context, _, _ string) (*store.ImpersonationSession, error) {
	return nil, errors.New("postgres: EndImpersonationSession not implemented")
}

func (t *tx) TouchImpersonationSession(_ context.Context, _ string) error {
	return errors.New("postgres: TouchImpersonationSession not implemented")
}

// ---------------------------------------------------------------------------
// Settings configs (singleton per tenant)
// ---------------------------------------------------------------------------

func (t *tx) GetNetworkConfig(_ context.Context, _ string) (*store.NetworkConfig, error) {
	return nil, errors.New("postgres: GetNetworkConfig not implemented")
}

func (t *tx) UpsertNetworkConfig(_ context.Context, _ *store.NetworkConfig) (*store.NetworkConfig, error) {
	return nil, errors.New("postgres: UpsertNetworkConfig not implemented")
}

func (t *tx) GetTenantAuthPolicy(_ context.Context, _ string) (*store.TenantAuthPolicy, error) {
	return nil, errors.New("postgres: GetTenantAuthPolicy not implemented")
}

func (t *tx) UpsertTenantAuthPolicy(_ context.Context, _ *store.TenantAuthPolicy) (*store.TenantAuthPolicy, error) {
	return nil, errors.New("postgres: UpsertTenantAuthPolicy not implemented")
}

func (t *tx) GetObservabilityConfig(_ context.Context, _ string) (*store.ObservabilityConfig, error) {
	return nil, errors.New("postgres: GetObservabilityConfig not implemented")
}

func (t *tx) UpsertObservabilityConfig(_ context.Context, _ *store.ObservabilityConfig) (*store.ObservabilityConfig, error) {
	return nil, errors.New("postgres: UpsertObservabilityConfig not implemented")
}

func (t *tx) GetAuditRetentionConfig(_ context.Context, _ string) (*store.AuditRetentionConfig, error) {
	return nil, errors.New("postgres: GetAuditRetentionConfig not implemented")
}

func (t *tx) UpsertAuditRetentionConfig(_ context.Context, _ *store.AuditRetentionConfig) (*store.AuditRetentionConfig, error) {
	return nil, errors.New("postgres: UpsertAuditRetentionConfig not implemented")
}

// ---------------------------------------------------------------------------
// PKI / TLS
// ---------------------------------------------------------------------------

func (t *tx) CreateCertAuthority(_ context.Context, _ *store.CertAuthority) (*store.CertAuthority, error) {
	return nil, errors.New("postgres: CreateCertAuthority not implemented")
}

func (t *tx) GetCertAuthority(_ context.Context, _, _ string) (*store.CertAuthority, error) {
	return nil, errors.New("postgres: GetCertAuthority not implemented")
}

func (t *tx) ListCertAuthoritiesByTenant(_ context.Context, _ string) ([]*store.CertAuthority, error) {
	return nil, errors.New("postgres: ListCertAuthoritiesByTenant not implemented")
}

func (t *tx) UpdateCertAuthority(_ context.Context, _, _ string, _ store.UpdateCertAuthorityParams) (*store.CertAuthority, error) {
	return nil, errors.New("postgres: UpdateCertAuthority not implemented")
}

func (t *tx) DeleteCertAuthority(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteCertAuthority not implemented")
}

func (t *tx) CreateCertEnrollment(_ context.Context, _ *store.CertEnrollment) (*store.CertEnrollment, error) {
	return nil, errors.New("postgres: CreateCertEnrollment not implemented")
}

func (t *tx) GetCertEnrollment(_ context.Context, _, _ string) (*store.CertEnrollment, error) {
	return nil, errors.New("postgres: GetCertEnrollment not implemented")
}

func (t *tx) ListCertEnrollmentsByTenant(_ context.Context, _ string) ([]*store.CertEnrollment, error) {
	return nil, errors.New("postgres: ListCertEnrollmentsByTenant not implemented")
}

func (t *tx) UpdateCertEnrollment(_ context.Context, _, _ string, _ store.UpdateCertEnrollmentParams) (*store.CertEnrollment, error) {
	return nil, errors.New("postgres: UpdateCertEnrollment not implemented")
}

func (t *tx) RevokeCertEnrollmentRow(_ context.Context, _, _, _ string) (*store.CertEnrollment, error) {
	return nil, errors.New("postgres: RevokeCertEnrollmentRow not implemented")
}

func (t *tx) CreateTLSCertificate(_ context.Context, _ *store.TLSCertificate) (*store.TLSCertificate, error) {
	return nil, errors.New("postgres: CreateTLSCertificate not implemented")
}

func (t *tx) GetTLSCertificate(_ context.Context, _, _ string) (*store.TLSCertificate, error) {
	return nil, errors.New("postgres: GetTLSCertificate not implemented")
}

func (t *tx) ListTLSCertificatesByTenant(_ context.Context, _ string) ([]*store.TLSCertificate, error) {
	return nil, errors.New("postgres: ListTLSCertificatesByTenant not implemented")
}

func (t *tx) UpdateTLSCertificate(_ context.Context, _, _ string, _ store.UpdateTLSCertificateParams) (*store.TLSCertificate, error) {
	return nil, errors.New("postgres: UpdateTLSCertificate not implemented")
}

func (t *tx) DeleteTLSCertificate(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteTLSCertificate not implemented")
}

func (t *tx) GetTLSConfig(_ context.Context, _ string) (*store.TLSConfig, error) {
	return nil, errors.New("postgres: GetTLSConfig not implemented")
}

func (t *tx) UpsertTLSConfig(_ context.Context, _ *store.TLSConfig) (*store.TLSConfig, error) {
	return nil, errors.New("postgres: UpsertTLSConfig not implemented")
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

func (t *tx) CreatePlugin(_ context.Context, _ *store.Plugin) (*store.Plugin, error) {
	return nil, errors.New("postgres: CreatePlugin not implemented")
}

func (t *tx) GetPlugin(_ context.Context, _, _ string) (*store.Plugin, error) {
	return nil, errors.New("postgres: GetPlugin not implemented")
}

func (t *tx) ListPluginsByScope(_ context.Context, _ string) ([]*store.Plugin, error) {
	return nil, errors.New("postgres: ListPluginsByScope not implemented")
}

func (t *tx) UpdatePlugin(_ context.Context, _, _ string, _ store.UpdatePluginParams) (*store.Plugin, error) {
	return nil, errors.New("postgres: UpdatePlugin not implemented")
}

func (t *tx) DeletePlugin(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeletePlugin not implemented")
}

func (t *tx) CreatePluginSigner(_ context.Context, _ *store.PluginSigner) (*store.PluginSigner, error) {
	return nil, errors.New("postgres: CreatePluginSigner not implemented")
}

func (t *tx) GetPluginSigner(_ context.Context, _, _ string) (*store.PluginSigner, error) {
	return nil, errors.New("postgres: GetPluginSigner not implemented")
}

func (t *tx) ListPluginSignersByScope(_ context.Context, _ string) ([]*store.PluginSigner, error) {
	return nil, errors.New("postgres: ListPluginSignersByScope not implemented")
}

func (t *tx) UpdatePluginSigner(_ context.Context, _, _ string, _ store.UpdatePluginSignerParams) (*store.PluginSigner, error) {
	return nil, errors.New("postgres: UpdatePluginSigner not implemented")
}

func (t *tx) DeletePluginSigner(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeletePluginSigner not implemented")
}

func (t *tx) ListPluginsBySigner(_ context.Context, _ string) ([]*store.Plugin, error) {
	return nil, errors.New("postgres: ListPluginsBySigner not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Items
// ---------------------------------------------------------------------------

func (t *tx) AppendNotificationItem(_ context.Context, _ *store.NotificationItem) (*store.NotificationItem, error) {
	return nil, errors.New("postgres: AppendNotificationItem not implemented")
}

func (t *tx) GetNotificationItem(_ context.Context, _ string) (*store.NotificationItem, error) {
	return nil, errors.New("postgres: GetNotificationItem not implemented")
}

func (t *tx) ListNotificationItemsByUser(_ context.Context, _, _ string, _ store.NotificationItemQuery) ([]*store.NotificationItem, error) {
	return nil, errors.New("postgres: ListNotificationItemsByUser not implemented")
}

func (t *tx) CountUnreadNotifications(_ context.Context, _, _ string) (int, error) {
	return 0, errors.New("postgres: CountUnreadNotifications not implemented")
}

func (t *tx) MarkNotificationRead(_ context.Context, _ string) error {
	return errors.New("postgres: MarkNotificationRead not implemented")
}

func (t *tx) MarkAllNotificationsRead(_ context.Context, _, _ string) error {
	return errors.New("postgres: MarkAllNotificationsRead not implemented")
}

func (t *tx) ArchiveNotification(_ context.Context, _ string, _ bool) error {
	return errors.New("postgres: ArchiveNotification not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Channels
// ---------------------------------------------------------------------------

func (t *tx) CreateNotificationChannel(_ context.Context, _ *store.NotificationChannel) (*store.NotificationChannel, error) {
	return nil, errors.New("postgres: CreateNotificationChannel not implemented")
}

func (t *tx) GetNotificationChannel(_ context.Context, _, _ string) (*store.NotificationChannel, error) {
	return nil, errors.New("postgres: GetNotificationChannel not implemented")
}

func (t *tx) ListNotificationChannelsByTenant(_ context.Context, _ string) ([]*store.NotificationChannel, error) {
	return nil, errors.New("postgres: ListNotificationChannelsByTenant not implemented")
}

func (t *tx) UpdateNotificationChannel(_ context.Context, _, _ string, _ store.UpdateNotificationChannelParams) (*store.NotificationChannel, error) {
	return nil, errors.New("postgres: UpdateNotificationChannel not implemented")
}

func (t *tx) DeleteNotificationChannel(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteNotificationChannel not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Routing Rules
// ---------------------------------------------------------------------------

func (t *tx) CreateRoutingRule(_ context.Context, _ *store.NotificationRoutingRule) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("postgres: CreateRoutingRule not implemented")
}

func (t *tx) GetRoutingRule(_ context.Context, _, _ string) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("postgres: GetRoutingRule not implemented")
}

func (t *tx) ListRoutingRulesByTenant(_ context.Context, _ string) ([]*store.NotificationRoutingRule, error) {
	return nil, errors.New("postgres: ListRoutingRulesByTenant not implemented")
}

func (t *tx) UpdateRoutingRule(_ context.Context, _, _ string, _ store.UpdateRoutingRuleParams) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("postgres: UpdateRoutingRule not implemented")
}

func (t *tx) DeleteRoutingRule(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteRoutingRule not implemented")
}

func (t *tx) ReorderRoutingRules(_ context.Context, _ string, _ []string) error {
	return errors.New("postgres: ReorderRoutingRules not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Delivery Log
// ---------------------------------------------------------------------------

func (t *tx) AppendDeliveryLogEntry(_ context.Context, _ *store.NotificationDeliveryLogEntry) (*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("postgres: AppendDeliveryLogEntry not implemented")
}

func (t *tx) GetDeliveryLogEntry(_ context.Context, _, _ string) (*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("postgres: GetDeliveryLogEntry not implemented")
}

func (t *tx) ListDeliveryLogByTenant(_ context.Context, _ string, _ store.DeliveryLogQuery) ([]*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("postgres: ListDeliveryLogByTenant not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Tenant Config
// ---------------------------------------------------------------------------

func (t *tx) GetTenantNotificationConfig(_ context.Context, _ string) (*store.TenantNotificationConfig, error) {
	return nil, errors.New("postgres: GetTenantNotificationConfig not implemented")
}

func (t *tx) UpsertTenantNotificationConfig(_ context.Context, _ *store.TenantNotificationConfig) (*store.TenantNotificationConfig, error) {
	return nil, errors.New("postgres: UpsertTenantNotificationConfig not implemented")
}

// ---------------------------------------------------------------------------
// AI — Providers
// ---------------------------------------------------------------------------

func (t *tx) CreateAIProvider(_ context.Context, _ *store.AIProvider) (*store.AIProvider, error) {
	return nil, errors.New("postgres: CreateAIProvider not implemented")
}

func (t *tx) GetAIProvider(_ context.Context, _, _ string) (*store.AIProvider, error) {
	return nil, errors.New("postgres: GetAIProvider not implemented")
}

func (t *tx) ListAIProvidersByTenant(_ context.Context, _ string) ([]*store.AIProvider, error) {
	return nil, errors.New("postgres: ListAIProvidersByTenant not implemented")
}

func (t *tx) UpdateAIProvider(_ context.Context, _, _ string, _ store.UpdateAIProviderParams) (*store.AIProvider, error) {
	return nil, errors.New("postgres: UpdateAIProvider not implemented")
}

func (t *tx) DeleteAIProvider(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAIProvider not implemented")
}

// ---------------------------------------------------------------------------
// AI — Provider Models
// ---------------------------------------------------------------------------

func (t *tx) AddProviderModel(_ context.Context, _ *store.AIProviderModel) (*store.AIProviderModel, error) {
	return nil, errors.New("postgres: AddProviderModel not implemented")
}

func (t *tx) UpdateProviderModel(_ context.Context, _, _ string, _ store.UpdateAIProviderModelParams) (*store.AIProviderModel, error) {
	return nil, errors.New("postgres: UpdateProviderModel not implemented")
}

func (t *tx) RemoveProviderModel(_ context.Context, _, _ string) error {
	return errors.New("postgres: RemoveProviderModel not implemented")
}

func (t *tx) ListProviderModels(_ context.Context, _ string) ([]*store.AIProviderModel, error) {
	return nil, errors.New("postgres: ListProviderModels not implemented")
}

// ---------------------------------------------------------------------------
// AI — MCP Servers
// ---------------------------------------------------------------------------

func (t *tx) CreateMCPServer(_ context.Context, _ *store.AIMCPServer) (*store.AIMCPServer, error) {
	return nil, errors.New("postgres: CreateMCPServer not implemented")
}

func (t *tx) GetMCPServer(_ context.Context, _, _ string) (*store.AIMCPServer, error) {
	return nil, errors.New("postgres: GetMCPServer not implemented")
}

func (t *tx) ListMCPServersByTenant(_ context.Context, _ string) ([]*store.AIMCPServer, error) {
	return nil, errors.New("postgres: ListMCPServersByTenant not implemented")
}

func (t *tx) UpdateMCPServer(_ context.Context, _, _ string, _ store.UpdateAIMCPServerParams) (*store.AIMCPServer, error) {
	return nil, errors.New("postgres: UpdateMCPServer not implemented")
}

func (t *tx) DeleteMCPServer(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteMCPServer not implemented")
}

// ---------------------------------------------------------------------------
// AI — Tools
// ---------------------------------------------------------------------------

func (t *tx) CreateAITool(_ context.Context, _ *store.AITool) (*store.AITool, error) {
	return nil, errors.New("postgres: CreateAITool not implemented")
}

func (t *tx) GetAITool(_ context.Context, _, _ string) (*store.AITool, error) {
	return nil, errors.New("postgres: GetAITool not implemented")
}

func (t *tx) ListAIToolsByTenant(_ context.Context, _ string) ([]*store.AITool, error) {
	return nil, errors.New("postgres: ListAIToolsByTenant not implemented")
}

func (t *tx) UpdateAITool(_ context.Context, _, _ string, _ store.UpdateAIToolParams) (*store.AITool, error) {
	return nil, errors.New("postgres: UpdateAITool not implemented")
}

func (t *tx) DeleteAITool(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAITool not implemented")
}

// ---------------------------------------------------------------------------
// AI — Agents
// ---------------------------------------------------------------------------

func (t *tx) CreateAIAgent(_ context.Context, _ *store.AIAgent) (*store.AIAgent, error) {
	return nil, errors.New("postgres: CreateAIAgent not implemented")
}

func (t *tx) GetAIAgent(_ context.Context, _, _ string) (*store.AIAgent, error) {
	return nil, errors.New("postgres: GetAIAgent not implemented")
}

func (t *tx) ListAIAgentsByTenant(_ context.Context, _ string) ([]*store.AIAgent, error) {
	return nil, errors.New("postgres: ListAIAgentsByTenant not implemented")
}

func (t *tx) UpdateAIAgent(_ context.Context, _, _ string, _ store.UpdateAIAgentParams) (*store.AIAgent, error) {
	return nil, errors.New("postgres: UpdateAIAgent not implemented")
}

func (t *tx) DeleteAIAgent(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAIAgent not implemented")
}

// ---------------------------------------------------------------------------
// AI — Tool Bindings
// ---------------------------------------------------------------------------

func (t *tx) CreateAIToolBinding(_ context.Context, _ *store.AIToolBinding) (*store.AIToolBinding, error) {
	return nil, errors.New("postgres: CreateAIToolBinding not implemented")
}

func (t *tx) GetAIToolBinding(_ context.Context, _, _ string) (*store.AIToolBinding, error) {
	return nil, errors.New("postgres: GetAIToolBinding not implemented")
}

func (t *tx) ListAIToolBindingsByTenant(_ context.Context, _ string) ([]*store.AIToolBinding, error) {
	return nil, errors.New("postgres: ListAIToolBindingsByTenant not implemented")
}

func (t *tx) ListAIToolBindingsByAgent(_ context.Context, _ string) ([]*store.AIToolBinding, error) {
	return nil, errors.New("postgres: ListAIToolBindingsByAgent not implemented")
}

func (t *tx) UpdateAIToolBinding(_ context.Context, _, _ string, _ store.UpdateAIToolBindingParams) (*store.AIToolBinding, error) {
	return nil, errors.New("postgres: UpdateAIToolBinding not implemented")
}

func (t *tx) DeleteAIToolBinding(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAIToolBinding not implemented")
}

// ---------------------------------------------------------------------------
// AI — Semantic Rate Limits
// ---------------------------------------------------------------------------

func (t *tx) CreateAIRateLimit(_ context.Context, _ *store.AISemanticRateLimit) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("postgres: CreateAIRateLimit not implemented")
}

func (t *tx) GetAIRateLimit(_ context.Context, _, _ string) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("postgres: GetAIRateLimit not implemented")
}

func (t *tx) ListAIRateLimitsByTenant(_ context.Context, _ string) ([]*store.AISemanticRateLimit, error) {
	return nil, errors.New("postgres: ListAIRateLimitsByTenant not implemented")
}

func (t *tx) UpdateAIRateLimit(_ context.Context, _, _ string, _ store.UpdateAIRateLimitParams) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("postgres: UpdateAIRateLimit not implemented")
}

func (t *tx) DeleteAIRateLimit(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAIRateLimit not implemented")
}

// ---------------------------------------------------------------------------
// AI — Traces
// ---------------------------------------------------------------------------

func (t *tx) AppendAITrace(_ context.Context, _ *store.AITrace) (*store.AITrace, error) {
	return nil, errors.New("postgres: AppendAITrace not implemented")
}

func (t *tx) GetAITrace(_ context.Context, _, _ string) (*store.AITrace, error) {
	return nil, errors.New("postgres: GetAITrace not implemented")
}

func (t *tx) ListAITracesByTenant(_ context.Context, _ string, _ store.AITraceQuery) ([]*store.AITrace, error) {
	return nil, errors.New("postgres: ListAITracesByTenant not implemented")
}

func (t *tx) ListAITracesByAgent(_ context.Context, _ string, _ store.AITraceQuery) ([]*store.AITrace, error) {
	return nil, errors.New("postgres: ListAITracesByAgent not implemented")
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

func (t *tx) CreateSite(_ context.Context, _ *store.Site) (*store.Site, error) {
	return nil, errors.New("postgres: CreateSite not implemented")
}

func (t *tx) GetSite(_ context.Context, _, _ string) (*store.Site, error) {
	return nil, errors.New("postgres: GetSite not implemented")
}

func (t *tx) ListSitesByTenant(_ context.Context, _ string) ([]*store.Site, error) {
	return nil, errors.New("postgres: ListSitesByTenant not implemented")
}

func (t *tx) UpdateSite(_ context.Context, _, _ string, _ store.UpdateSiteParams) (*store.Site, error) {
	return nil, errors.New("postgres: UpdateSite not implemented")
}

func (t *tx) ToggleSite(_ context.Context, _, _ string, _ bool) (*store.Site, error) {
	return nil, errors.New("postgres: ToggleSite not implemented")
}

func (t *tx) DeleteSite(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteSite not implemented")
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

func (t *tx) CreateMiddleware(_ context.Context, _ *store.Middleware) (*store.Middleware, error) {
	return nil, errors.New("postgres: CreateMiddleware not implemented")
}

func (t *tx) GetMiddleware(_ context.Context, _, _ string) (*store.Middleware, error) {
	return nil, errors.New("postgres: GetMiddleware not implemented")
}

func (t *tx) ListMiddlewaresByTenant(_ context.Context, _ string) ([]*store.Middleware, error) {
	return nil, errors.New("postgres: ListMiddlewaresByTenant not implemented")
}

func (t *tx) UpdateMiddleware(_ context.Context, _, _ string, _ store.UpdateMiddlewareParams) (*store.Middleware, error) {
	return nil, errors.New("postgres: UpdateMiddleware not implemented")
}

func (t *tx) DeleteMiddleware(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteMiddleware not implemented")
}

// ---------------------------------------------------------------------------
// RBAC Policies
// ---------------------------------------------------------------------------

func (t *tx) CreateRbacPolicy(_ context.Context, _ *store.RbacPolicy) (*store.RbacPolicy, error) {
	return nil, errors.New("postgres: CreateRbacPolicy not implemented")
}

func (t *tx) GetRbacPolicy(_ context.Context, _ string) (*store.RbacPolicy, error) {
	return nil, errors.New("postgres: GetRbacPolicy not implemented")
}

func (t *tx) ListRbacPolicies(_ context.Context) ([]*store.RbacPolicy, error) {
	return nil, errors.New("postgres: ListRbacPolicies not implemented")
}

func (t *tx) UpdateRbacPolicy(_ context.Context, _ string, _ store.UpdateRbacPolicyParams) (*store.RbacPolicy, error) {
	return nil, errors.New("postgres: UpdateRbacPolicy not implemented")
}

func (t *tx) DeleteRbacPolicy(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteRbacPolicy not implemented")
}

// ---------------------------------------------------------------------------
// Access Policies
// ---------------------------------------------------------------------------

func (t *tx) CreateAccessPolicy(_ context.Context, _ *store.AccessPolicy) (*store.AccessPolicy, error) {
	return nil, errors.New("postgres: CreateAccessPolicy not implemented")
}

func (t *tx) GetAccessPolicy(_ context.Context, _ string) (*store.AccessPolicy, error) {
	return nil, errors.New("postgres: GetAccessPolicy not implemented")
}

func (t *tx) ListAccessPolicies(_ context.Context) ([]*store.AccessPolicy, error) {
	return nil, errors.New("postgres: ListAccessPolicies not implemented")
}

func (t *tx) UpdateAccessPolicy(_ context.Context, _ string, _ store.UpdateAccessPolicyParams) (*store.AccessPolicy, error) {
	return nil, errors.New("postgres: UpdateAccessPolicy not implemented")
}

func (t *tx) DeleteAccessPolicy(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteAccessPolicy not implemented")
}
