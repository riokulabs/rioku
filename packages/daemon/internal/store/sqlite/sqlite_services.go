package sqlite

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

func (t *tx) CreateService(ctx context.Context, svc *riokuv1.Service) (*riokuv1.Service, error) {
	id := uuid.New().String()
	now := nowUTC()

	hcJSON, err := marshalHealthCheckJSON(svc.GetHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal health_check: %w", err)
	}
	phcJSON, err := marshalPassiveHealthCheckJSON(svc.GetPassiveHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal passive_health_check: %w", err)
	}
	rpJSON, err := marshalRetryPolicyJSON(svc.GetRetryPolicy())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal retry_policy: %w", err)
	}
	utJSON, err := marshalUpstreamTLSJSON(svc.GetUpstreamTls())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal upstream_tls: %w", err)
	}
	cpJSON, err := marshalConnectionPoolJSON(svc.GetConnectionPool())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal connection_pool: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(svc.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
	}
	reqHJSON, err := marshalRequestHeadersJSON(svc.GetRequestHeaders())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal request_headers: %w", err)
	}
	respHJSON, err := marshalResponseHeadersJSON(svc.GetResponseHeaders())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal response_headers: %w", err)
	}
	respRulesJSON, err := marshalResponseRulesJSON(svc.GetResponseRules())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal response_rules: %w", err)
	}
	compJSON, err := marshalCompressionJSON(svc.GetCompression())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal compression: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO services (id, tenant_id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name, request_headers, response_headers, response_rules, compression)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
		phcJSON, rpJSON, utJSON, cpJSON,
		svc.GetLbCookieName(), svc.GetLbHeaderName(),
		reqHJSON, respHJSON, respRulesJSON, compJSON,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: insert service: %w", err)
	}

	// Insert upstreams.
	for _, u := range svc.GetUpstreams() {
		uid := uuid.New().String()
		healthy := 1
		if !u.GetHealthy() {
			healthy = 0
		}
		srcType, srcJSON, err := marshalUpstreamSourceJSON(u)
		if err != nil {
			return nil, fmt.Errorf("sqlite: marshal upstream source: %w", err)
		}
		_, err = t.sqlTx.ExecContext(ctx,
			`INSERT INTO upstreams (id, service_id, address, weight, tls_mode, healthy, dial_err, source_type, source_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			uid, id, u.GetAddress(), u.GetWeight(), int32(u.GetTls()), healthy, u.GetDialErr(), srcType, srcJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("sqlite: insert upstream: %w", err)
		}
	}

	t.emit("services", id, "INSERT")

	return t.GetService(ctx, id)
}

func (t *tx) GetService(ctx context.Context, id string) (*riokuv1.Service, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name, request_headers, response_headers, response_rules, compression
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
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy, upstream_tls, connection_pool, lb_cookie_name, lb_header_name, request_headers, response_headers, response_rules, compression FROM services WHERE tenant_id = ? ORDER BY id`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list services: %w", err)
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
			`SELECT u.id, u.service_id, u.address, u.weight, u.tls_mode, u.healthy, u.dial_err, u.source_type, u.source_json
			 FROM upstreams u JOIN services s ON s.id = u.service_id
			 WHERE s.tenant_id = ? ORDER BY u.service_id, u.id`, tenantID)
		if err != nil {
			return nil, fmt.Errorf("sqlite: fetch all upstreams: %w", err)
		}
		defer func() { _ = uRows.Close() }()

		for uRows.Next() {
			var (
				id         string
				serviceID  string
				address    string
				weight     int32
				tlsMode    int32
				healthy    int
				dialErr    string
				sourceType string
				sourceJSON string
			)
			if err := uRows.Scan(&id, &serviceID, &address, &weight, &tlsMode, &healthy, &dialErr, &sourceType, &sourceJSON); err != nil {
				return nil, fmt.Errorf("sqlite: scan upstream: %w", err)
			}
			if svc, ok := serviceIndex[serviceID]; ok {
				u := &riokuv1.Upstream{
					Id:      id,
					Address: address,
					Weight:  weight,
					Tls:     riokuv1.TLSMode(tlsMode),
					Healthy: healthy != 0,
					DialErr: dialErr,
				}
				if err := unmarshalUpstreamSource(u, sourceType, sourceJSON); err != nil {
					return nil, fmt.Errorf("sqlite: unmarshal upstream source: %w", err)
				}
				svc.Upstreams = append(svc.Upstreams, u)
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
		return nil, fmt.Errorf("sqlite: marshal health_check: %w", err)
	}
	phcJSON, err := marshalPassiveHealthCheckJSON(svc.GetPassiveHealthCheck())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal passive_health_check: %w", err)
	}
	rpJSON, err := marshalRetryPolicyJSON(svc.GetRetryPolicy())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal retry_policy: %w", err)
	}
	utJSON, err := marshalUpstreamTLSJSON(svc.GetUpstreamTls())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal upstream_tls: %w", err)
	}
	cpJSON, err := marshalConnectionPoolJSON(svc.GetConnectionPool())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal connection_pool: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(svc.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
	}
	reqHJSON, err := marshalRequestHeadersJSON(svc.GetRequestHeaders())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal request_headers: %w", err)
	}
	respHJSON, err := marshalResponseHeadersJSON(svc.GetResponseHeaders())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal response_headers: %w", err)
	}
	respRulesJSON, err := marshalResponseRulesJSON(svc.GetResponseRules())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal response_rules: %w", err)
	}
	compJSON, err := marshalCompressionJSON(svc.GetCompression())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal compression: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE services SET name=?, lb_policy=?, health_check=?, labels=?, updated_at=?, dial_timeout_seconds=?, response_header_timeout_seconds=?, idle_timeout_seconds=?, passive_health_check=?, retry_policy=?, upstream_tls=?, connection_pool=?, lb_cookie_name=?, lb_header_name=?, request_headers=?, response_headers=?, response_rules=?, compression=?
		 WHERE id=? AND tenant_id=?`,
		svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
		phcJSON, rpJSON, utJSON, cpJSON,
		svc.GetLbCookieName(), svc.GetLbHeaderName(),
		reqHJSON, respHJSON, respRulesJSON, compJSON,
		svc.GetId(), tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: update service: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("sqlite: service %q not found", svc.GetId())
	}

	// Replace upstreams: delete existing, insert new.
	if _, err := t.sqlTx.ExecContext(ctx, `DELETE FROM upstreams WHERE service_id = ?`, svc.GetId()); err != nil {
		return nil, fmt.Errorf("sqlite: delete old upstreams: %w", err)
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
		srcType, srcJSON, err := marshalUpstreamSourceJSON(u)
		if err != nil {
			return nil, fmt.Errorf("sqlite: marshal upstream source: %w", err)
		}
		_, err = t.sqlTx.ExecContext(ctx,
			`INSERT INTO upstreams (id, service_id, address, weight, tls_mode, healthy, dial_err, source_type, source_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			uid, svc.GetId(), u.GetAddress(), u.GetWeight(), int32(u.GetTls()), healthy, u.GetDialErr(), srcType, srcJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("sqlite: insert upstream: %w", err)
		}
	}

	t.emit("services", svc.GetId(), "UPDATE")

	return t.GetService(ctx, svc.GetId())
}

func (t *tx) DeleteService(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM services WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: delete service: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: service %q not found", id)
	}
	// Clean up orphaned policy bindings for this service.
	if _, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM policy_bindings WHERE target_type = 'service' AND target_id = ?`, id,
	); err != nil {
		return fmt.Errorf("sqlite: cleanup service policy_bindings: %w", err)
	}
	t.emit("services", id, "DELETE")
	return nil
}

func (t *tx) fetchUpstreams(ctx context.Context, serviceID string) ([]*riokuv1.Upstream, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, address, weight, tls_mode, healthy, dial_err, source_type, source_json
		 FROM upstreams WHERE service_id = ?`, serviceID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: fetch upstreams: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var upstreams []*riokuv1.Upstream
	for rows.Next() {
		var (
			id         string
			address    string
			weight     int32
			tlsMode    int32
			healthy    int
			dialErr    string
			sourceType string
			sourceJSON string
		)
		if err := rows.Scan(&id, &address, &weight, &tlsMode, &healthy, &dialErr, &sourceType, &sourceJSON); err != nil {
			return nil, fmt.Errorf("sqlite: scan upstream: %w", err)
		}
		u := &riokuv1.Upstream{
			Id:      id,
			Address: address,
			Weight:  weight,
			Tls:     riokuv1.TLSMode(tlsMode),
			Healthy: healthy != 0,
			DialErr: dialErr,
		}
		if err := unmarshalUpstreamSource(u, sourceType, sourceJSON); err != nil {
			return nil, fmt.Errorf("sqlite: unmarshal upstream source: %w", err)
		}
		upstreams = append(upstreams, u)
	}
	return upstreams, rows.Err()
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------
