// Package sqlite implements the store.Driver interface using SQLite.
// This is the default for single-node deployments.
package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"

	_ "modernc.org/sqlite"
)

const timeFormat = "2006-01-02T15:04:05.000Z"

func init() {
	store.Register("sqlite", func() store.Driver {
		return &driver{}
	})
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

type driver struct {
	db     *sql.DB
	notify chan store.ChangeEvent
	mu     sync.RWMutex
	closed bool
}

func (d *driver) Open(_ context.Context, cfg store.DriverConfig) error {
	path := cfg.Path
	if path == "" {
		path = cfg.DSN
	}
	if path == "" {
		return fmt.Errorf("sqlite: path is required")
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("sqlite: open: %w", err)
	}

	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	} {
		if _, err := db.Exec(pragma); err != nil {
			_ = db.Close()
			return fmt.Errorf("sqlite: %s: %w", pragma, err)
		}
	}

	d.db = db
	d.notify = make(chan store.ChangeEvent, 64)
	return nil
}

func (d *driver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closed = true
	if d.notify != nil {
		close(d.notify)
	}
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

func (d *driver) Ping(ctx context.Context) error {
	return d.db.PingContext(ctx)
}

func (d *driver) Migrate(ctx context.Context, direction store.MigrateDirection) error {
	switch direction {
	case store.MigrateUp:
		return d.migrateUp(ctx)
	case store.MigrateDown:
		return d.migrateDown(ctx)
	default:
		return fmt.Errorf("sqlite: unknown migration direction %d", direction)
	}
}

func (d *driver) migrateUp(ctx context.Context) error {
	// Check if already at target version (idempotent).
	current, _ := d.CurrentVersion(ctx)

	// Migration 1: initial schema.
	if current < 1 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000001_initial.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 1: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 1: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (1, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 1: %w", err)
		}
	}

	// Migration 2: users and sessions tables.
	if current < 2 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000002_auth_users_sessions.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 2: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 2: %w", err)
		}
	}

	// Migration 3: RBAC tables (permissions, roles, role_permissions, user_roles).
	if current < 3 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000003_rbac.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 3: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 3: %w", err)
		}
	}

	// Migration 4: TOTP backup codes.
	if current < 4 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000004_totp_backup.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 4: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 4: %w", err)
		}
	}

	// Migration 5: service timeout columns.
	if current < 5 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000005_service_timeouts.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 5: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 5: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (5, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 5: %w", err)
		}
	}

	// Migration 6: add 'deleted' to user status CHECK constraint.
	if current < 6 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000006_user_deleted_status.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 6: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 6: %w", err)
		}
	}

	return nil
}

func (d *driver) migrateDown(ctx context.Context) error {
	current, _ := d.CurrentVersion(ctx)

	// Migration 6 down: revert user status CHECK constraint.
	if current >= 6 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000006_user_deleted_status.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 6: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 6: %w", err)
		}
	}

	// Migration 5 down: drop service timeout columns.
	if current >= 5 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000005_service_timeouts.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 5: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 5: %w", err)
		}
	}

	// Migration 4 down: drop TOTP backup codes.
	if current >= 4 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000004_totp_backup.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 4: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 4: %w", err)
		}
	}

	// Migration 3 down: drop RBAC tables.
	if current >= 3 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000003_rbac.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 3: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 3: %w", err)
		}
	}

	// Migration 2 down: drop users and sessions tables.
	if current >= 2 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000002_auth_users_sessions.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 2: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 2: %w", err)
		}
	}

	// Migration 1 down: drop initial schema.
	if current >= 1 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000001_initial.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 1: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 1: %w", err)
		}
	}

	return nil
}

func (d *driver) CurrentVersion(ctx context.Context) (int, error) {
	var version int
	err := d.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM schema_versions`).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("sqlite: current version: %w", err)
	}
	return version, nil
}

func (d *driver) Begin(ctx context.Context, opts store.TxOptions) (store.Tx, error) {
	sqlTx, err := d.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: opts.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("sqlite: begin tx: %w", err)
	}
	return &tx{sqlTx: sqlTx, notify: d.notify}, nil
}

func (d *driver) Notify() <-chan store.ChangeEvent {
	return d.notify
}

func (d *driver) Health(ctx context.Context) store.DriverHealth {
	if err := d.db.PingContext(ctx); err != nil {
		return store.DriverHealth{OK: false, Mode: store.ModeSingle, Details: map[string]string{"error": err.Error()}}
	}
	return store.DriverHealth{OK: true, Mode: store.ModeSingle}
}

// ---------------------------------------------------------------------------
// tx
// ---------------------------------------------------------------------------

type tx struct {
	sqlTx  *sql.Tx
	notify chan store.ChangeEvent
}

func (t *tx) Commit() error   { return t.sqlTx.Commit() }
func (t *tx) Rollback() error { return t.sqlTx.Rollback() }

// emit sends a non-blocking change event. Logs a warning if the channel is full.
func (t *tx) emit(table, rowID, operation string) {
	select {
	case t.notify <- store.ChangeEvent{Table: table, RowID: rowID, Operation: operation}:
	default:
		log.Printf("sqlite: change event dropped (channel full): %s/%s %s", table, rowID, operation)
	}
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

func (t *tx) CreateRoute(ctx context.Context, route *riokuv1.Route) (*riokuv1.Route, error) {
	id := uuid.New().String()
	now := nowUTC()

	matchersJSON, err := marshalMatchersJSON(route.GetMatchers())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal matchers: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(route.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
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
			return nil, fmt.Errorf("sqlite: marshal upstream: %w", err)
		}
		targetUpstreamJSON = &j
	}

	enabled := 1
	if !route.GetEnabled() {
		enabled = 0
	}

	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO routes (id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, route.GetName(), matchersJSON, targetServiceID, targetUpstreamJSON, enabled, labelsJSON, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: insert route: %w", err)
	}

	t.emit("routes", id, "INSERT")

	return t.GetRoute(ctx, id)
}

func (t *tx) GetRoute(ctx context.Context, id string) (*riokuv1.Route, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at
		 FROM routes WHERE id = ?`, id)
	return scanRoute(row)
}

func (t *tx) ListRoutes(ctx context.Context) ([]*riokuv1.Route, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, matchers, target_service_id, target_upstream, enabled, labels, created_at, updated_at
		 FROM routes ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list routes: %w", err)
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
		return nil, fmt.Errorf("sqlite: marshal matchers: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(route.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
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
			return nil, fmt.Errorf("sqlite: marshal upstream: %w", err)
		}
		targetUpstreamJSON = &j
	}

	enabled := 1
	if !route.GetEnabled() {
		enabled = 0
	}

	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE routes SET name=?, matchers=?, target_service_id=?, target_upstream=?, enabled=?, labels=?, updated_at=?
		 WHERE id=?`,
		route.GetName(), matchersJSON, targetServiceID, targetUpstreamJSON, enabled, labelsJSON, now, route.GetId(),
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: update route: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("sqlite: route %q not found", route.GetId())
	}

	t.emit("routes", route.GetId(), "UPDATE")

	return t.GetRoute(ctx, route.GetId())
}

func (t *tx) DeleteRoute(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM routes WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete route: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: route %q not found", id)
	}
	// Clean up orphaned policy bindings for this route.
	if _, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM policy_bindings WHERE target_type = 'route' AND target_id = ?`, id,
	); err != nil {
		return fmt.Errorf("sqlite: cleanup route policy_bindings: %w", err)
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
		return nil, fmt.Errorf("sqlite: marshal health_check: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(svc.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
	}

	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO services (id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
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
		_, err = t.sqlTx.ExecContext(ctx,
			`INSERT INTO upstreams (id, service_id, address, weight, tls_mode, healthy, dial_err)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			uid, id, u.GetAddress(), u.GetWeight(), int32(u.GetTls()), healthy, u.GetDialErr(),
		)
		if err != nil {
			return nil, fmt.Errorf("sqlite: insert upstream: %w", err)
		}
	}

	t.emit("services", id, "INSERT")

	return t.GetService(ctx, id)
}

func (t *tx) GetService(ctx context.Context, id string) (*riokuv1.Service, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds
		 FROM services WHERE id = ?`, id)

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
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds FROM services ORDER BY id`)
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
	if len(services) > 0 {
		uRows, err := t.sqlTx.QueryContext(ctx,
			`SELECT id, service_id, address, weight, tls_mode, healthy, dial_err FROM upstreams ORDER BY service_id, id`)
		if err != nil {
			return nil, fmt.Errorf("sqlite: fetch all upstreams: %w", err)
		}
		defer func() { _ = uRows.Close() }()

		for uRows.Next() {
			var (
				id        string
				serviceID string
				address   string
				weight    int32
				tlsMode   int32
				healthy   int
				dialErr   string
			)
			if err := uRows.Scan(&id, &serviceID, &address, &weight, &tlsMode, &healthy, &dialErr); err != nil {
				return nil, fmt.Errorf("sqlite: scan upstream: %w", err)
			}
			if svc, ok := serviceIndex[serviceID]; ok {
				svc.Upstreams = append(svc.Upstreams, &riokuv1.Upstream{
					Id:      id,
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
		return nil, fmt.Errorf("sqlite: marshal health_check: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(svc.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
	}

	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE services SET name=?, lb_policy=?, health_check=?, labels=?, updated_at=?, dial_timeout_seconds=?, response_header_timeout_seconds=?, idle_timeout_seconds=?
		 WHERE id=?`,
		svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
		svc.GetId(),
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
		_, err = t.sqlTx.ExecContext(ctx,
			`INSERT INTO upstreams (id, service_id, address, weight, tls_mode, healthy, dial_err)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			uid, svc.GetId(), u.GetAddress(), u.GetWeight(), int32(u.GetTls()), healthy, u.GetDialErr(),
		)
		if err != nil {
			return nil, fmt.Errorf("sqlite: insert upstream: %w", err)
		}
	}

	t.emit("services", svc.GetId(), "UPDATE")

	return t.GetService(ctx, svc.GetId())
}

func (t *tx) DeleteService(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM services WHERE id = ?`, id)
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
		`SELECT id, address, weight, tls_mode, healthy, dial_err
		 FROM upstreams WHERE service_id = ?`, serviceID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: fetch upstreams: %w", err)
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
			return nil, fmt.Errorf("sqlite: scan upstream: %w", err)
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
// Policies
// ---------------------------------------------------------------------------

func (t *tx) CreatePolicy(ctx context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error) {
	id := uuid.New().String()
	now := nowUTC()

	configJSON, err := marshalStructJSON(pol.GetConfig())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal policy config: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(pol.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
	}

	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO policies (id, name, type, config, labels, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, pol.GetName(), int32(pol.GetType()), configJSON, labelsJSON, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: insert policy: %w", err)
	}

	t.emit("policies", id, "INSERT")

	return t.GetPolicy(ctx, id)
}

func (t *tx) GetPolicy(ctx context.Context, id string) (*riokuv1.Policy, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, type, config, labels, created_at, updated_at
		 FROM policies WHERE id = ?`, id)
	return scanPolicy(row)
}

func (t *tx) ListPolicies(ctx context.Context) ([]*riokuv1.Policy, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, type, config, labels, created_at, updated_at FROM policies ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list policies: %w", err)
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
		return nil, fmt.Errorf("sqlite: marshal policy config: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(pol.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
	}

	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE policies SET name=?, type=?, config=?, labels=?, updated_at=? WHERE id=?`,
		pol.GetName(), int32(pol.GetType()), configJSON, labelsJSON, now, pol.GetId(),
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: update policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("sqlite: policy %q not found", pol.GetId())
	}

	t.emit("policies", pol.GetId(), "UPDATE")

	return t.GetPolicy(ctx, pol.GetId())
}

func (t *tx) DeletePolicy(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM policies WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: policy %q not found", id)
	}
	t.emit("policies", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Policy Bindings
// ---------------------------------------------------------------------------

var validTargetTypes = map[string]bool{"route": true, "service": true}

func (t *tx) AttachPolicy(ctx context.Context, policyID, targetType, targetID string) error {
	if !validTargetTypes[targetType] {
		return fmt.Errorf("sqlite: invalid target_type %q (must be 'route' or 'service')", targetType)
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO policy_bindings (policy_id, target_type, target_id) VALUES (?, ?, ?)`,
		policyID, targetType, targetID,
	)
	if err != nil {
		return fmt.Errorf("sqlite: attach policy: %w", err)
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
		return fmt.Errorf("sqlite: detach policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: policy binding not found")
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
		return nil, fmt.Errorf("sqlite: list policies by target: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("sqlite: scan policy_id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

func (t *tx) CreateAPIKey(ctx context.Context, name, keyHash string, scopes []string, expiresAt *time.Time) (string, error) {
	id := uuid.New().String()
	now := nowUTC()

	scopesJSON, err := json.Marshal(scopes)
	if err != nil {
		return "", fmt.Errorf("sqlite: marshal scopes: %w", err)
	}

	var expiresStr *string
	if expiresAt != nil {
		s := expiresAt.UTC().Format(timeFormat)
		expiresStr = &s
	}

	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO api_keys (id, name, key_hash, scopes, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, name, keyHash, string(scopesJSON), expiresStr, now,
	)
	if err != nil {
		return "", fmt.Errorf("sqlite: insert api_key: %w", err)
	}

	t.emit("api_keys", id, "INSERT")

	return id, nil
}

func (t *tx) GetAPIKey(ctx context.Context, id string) (*store.APIKey, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, key_hash, scopes, expires_at, created_at, revoked_at
		 FROM api_keys WHERE id = ?`, id)
	return scanAPIKey(row)
}

func (t *tx) GetAPIKeyByHash(ctx context.Context, keyHash string) (*store.APIKey, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, key_hash, scopes, expires_at, created_at, revoked_at
		 FROM api_keys WHERE key_hash = ?`, keyHash)
	return scanAPIKey(row)
}

func (t *tx) ListAPIKeys(ctx context.Context) ([]*store.APIKey, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, key_hash, scopes, expires_at, created_at, revoked_at
		 FROM api_keys WHERE revoked_at IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list api_keys: %w", err)
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
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
		now, id,
	)
	if err != nil {
		return fmt.Errorf("sqlite: revoke api_key: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: api_key %q not found or already revoked", id)
	}
	t.emit("api_keys", id, "UPDATE")
	return nil
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
		return nil, fmt.Errorf("sqlite: insert user: %w", err)
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
		return nil, fmt.Errorf("sqlite: list users: %w", err)
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
		return nil, fmt.Errorf("sqlite: update user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("sqlite: user %q not found", u.ID)
	}

	t.emit("users", u.ID, "UPDATE")

	return t.GetUser(ctx, u.ID)
}

func (t *tx) DeleteUser(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: user %q not found", id)
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
		return fmt.Errorf("sqlite: increment failed_attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: user %q not found", userID)
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
		return fmt.Errorf("sqlite: reset failed_attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: user %q not found", userID)
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
		return fmt.Errorf("sqlite: update last_login: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: user %q not found", userID)
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

	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		s.ID, s.UserID, s.Fingerprint,
		s.CreatedAt.UTC().Format(timeFormat),
		s.ExpiresAt.UTC().Format(timeFormat),
		s.LastActive.UTC().Format(timeFormat),
		ipAddress, userAgent,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: insert session: %w", err)
	}

	t.emit("sessions", s.ID, "INSERT")

	return t.GetSession(ctx, s.ID)
}

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
		return nil, fmt.Errorf("sqlite: list sessions by user: %w", err)
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
		return fmt.Errorf("sqlite: delete session: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: session %q not found", id)
	}
	t.emit("sessions", id, "DELETE")
	return nil
}

func (t *tx) DeleteSessionsByUser(ctx context.Context, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("sqlite: delete sessions by user: %w", err)
	}
	t.emit("sessions", userID, "DELETE")
	return nil
}

func (t *tx) DeleteSessionsByUserExcept(ctx context.Context, userID, exceptSessionID string) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM sessions WHERE user_id = ? AND id != ?`, userID, exceptSessionID)
	if err != nil {
		return fmt.Errorf("sqlite: delete sessions by user except: %w", err)
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
		return fmt.Errorf("sqlite: update session last_active: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: session %q not found", id)
	}
	t.emit("sessions", id, "UPDATE")
	return nil
}

func (t *tx) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM sessions
		 WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		    OR last_active < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')`)
	if err != nil {
		return 0, fmt.Errorf("sqlite: delete expired sessions: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
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
		return 0, fmt.Errorf("sqlite: insert config_version: %w", err)
	}
	version, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("sqlite: last insert id: %w", err)
	}
	t.emit("config_versions", fmt.Sprintf("%d", version), "INSERT")

	// Prune old versions beyond the max retention.
	_, _ = t.sqlTx.ExecContext(ctx,
		`DELETE FROM config_versions WHERE version NOT IN (
			SELECT version FROM config_versions ORDER BY version DESC LIMIT ?
		)`, maxConfigVersions)

	return version, nil
}

func (t *tx) GetConfigVersion(ctx context.Context, version int64) (*store.ConfigVersion, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT version, snapshot, actor, created_at FROM config_versions WHERE version = ?`, version)

	var cv store.ConfigVersion
	var createdAt string
	if err := row.Scan(&cv.Version, &cv.Snapshot, &cv.Actor, &createdAt); err != nil {
		return nil, fmt.Errorf("sqlite: get config_version: %w", err)
	}
	cv.CreatedAt = parseTime(createdAt)
	return &cv, nil
}

func (t *tx) ListConfigVersions(ctx context.Context, limit int) ([]*store.ConfigVersion, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT version, snapshot, actor, created_at FROM config_versions ORDER BY version DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list config_versions: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var versions []*store.ConfigVersion
	for rows.Next() {
		var cv store.ConfigVersion
		var createdAt string
		if err := rows.Scan(&cv.Version, &cv.Snapshot, &cv.Actor, &createdAt); err != nil {
			return nil, fmt.Errorf("sqlite: scan config_version: %w", err)
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
		return 0, fmt.Errorf("sqlite: latest config version: %w", err)
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

	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO audit_log (id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, entry.GetActor(), entry.GetEntityType(), entry.GetEntityId(),
		entry.GetOperation(), entry.GetDiff(), entry.GetConfigVersion(), now,
	)
	if err != nil {
		return fmt.Errorf("sqlite: append audit entry: %w", err)
	}
	t.emit("audit_log", id, "INSERT")
	return nil
}

func (t *tx) QueryAuditLog(ctx context.Context, query store.AuditQuery) ([]*riokuv1.AuditEntry, error) {
	q := `SELECT id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at FROM audit_log WHERE 1=1`
	var args []any

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
		return nil, fmt.Errorf("sqlite: query audit log: %w", err)
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
			return nil, fmt.Errorf("sqlite: scan audit entry: %w", err)
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

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

func (t *tx) CreateRole(ctx context.Context, params store.CreateRoleParams) (*store.Role, error) {
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO roles (id, name, description, is_builtin, created_at, updated_at)
		 VALUES (?, ?, ?, 0, ?, ?)`,
		params.ID, params.Name, params.Description, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: create role: %w", err)
	}
	for _, permID := range params.Permissions {
		if _, err := t.sqlTx.ExecContext(ctx,
			`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
			params.ID, permID,
		); err != nil {
			return nil, fmt.Errorf("sqlite: assign permission %s to role: %w", permID, err)
		}
	}
	t.emit("roles", params.ID, "INSERT")
	return t.GetRole(ctx, params.ID)
}

func (t *tx) GetRole(ctx context.Context, id string) (*store.Role, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, description, is_builtin, created_at, updated_at FROM roles WHERE id = ?`, id)
	r := &store.Role{}
	var isBuiltinInt int
	var createdStr, updatedStr string
	if err := row.Scan(&r.ID, &r.Name, &r.Description, &isBuiltinInt, &createdStr, &updatedStr); err != nil {
		if err == sql.ErrNoRows {
			return nil, store.ErrRoleNotFound
		}
		return nil, fmt.Errorf("sqlite: get role: %w", err)
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
		return nil, fmt.Errorf("sqlite: get role permissions: %w", err)
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
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, description, is_builtin, created_at, updated_at FROM roles ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list roles: %w", err)
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
	if params.Name != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE roles SET name = ?, updated_at = ? WHERE id = ?`,
			*params.Name, now, id,
		); err != nil {
			return nil, fmt.Errorf("sqlite: update role name: %w", err)
		}
	}
	if params.Description != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE roles SET description = ?, updated_at = ? WHERE id = ?`,
			*params.Description, now, id,
		); err != nil {
			return nil, fmt.Errorf("sqlite: update role description: %w", err)
		}
	}
	for _, permID := range params.AddPerms {
		if _, err := t.sqlTx.ExecContext(ctx,
			`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
			id, permID,
		); err != nil {
			return nil, fmt.Errorf("sqlite: add permission %s: %w", permID, err)
		}
	}
	for _, permID := range params.RemovePerms {
		if _, err := t.sqlTx.ExecContext(ctx,
			`DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`,
			id, permID,
		); err != nil {
			return nil, fmt.Errorf("sqlite: remove permission %s: %w", permID, err)
		}
	}
	t.emit("roles", id, "UPDATE")
	return t.GetRole(ctx, id)
}

func (t *tx) DeleteRole(ctx context.Context, id string) error {
	if id == "role_superadmin" {
		return store.ErrRoleImmutable
	}
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM roles WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("sqlite: delete role: %w", err)
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
		return nil, fmt.Errorf("sqlite: list permissions: %w", err)
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
		return nil, fmt.Errorf("sqlite: get user scopes: %w", err)
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
		`INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by)
		 VALUES (?, ?, ?)`,
		userID, roleID, grantedByVal,
	)
	if err != nil {
		return fmt.Errorf("sqlite: assign role: %w", err)
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
		return fmt.Errorf("sqlite: revoke role: %w", err)
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
		return nil, fmt.Errorf("sqlite: list user roles: %w", err)
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
		return nil, fmt.Errorf("sqlite: list users with role: %w", err)
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
		return fmt.Errorf("sqlite: clear backup codes: %w", err)
	}
	for _, h := range codeHashes {
		id := uuid.New().String()
		if _, err := t.sqlTx.ExecContext(ctx,
			`INSERT INTO totp_backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)`,
			id, userID, h,
		); err != nil {
			return fmt.Errorf("sqlite: insert backup code: %w", err)
		}
	}
	return nil
}

func (t *tx) ListUnusedTOTPBackupCodes(ctx context.Context, userID string) ([]*store.TOTPBackupCode, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, user_id, code_hash FROM totp_backup_codes
		 WHERE user_id = ? AND used_at IS NULL`, userID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list backup codes: %w", err)
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
		return fmt.Errorf("sqlite: mark backup code used: %w", err)
	}
	return nil
}

func (t *tx) DeleteTOTPBackupCodes(ctx context.Context, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM totp_backup_codes WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("sqlite: delete backup codes: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

type scanner interface {
	Scan(dest ...any) error
}

func scanRoute(s scanner) (*riokuv1.Route, error) {
	var (
		id              string
		name            string
		matchersJSON    string
		targetServiceID *string
		targetUpstream  *string
		enabled         int
		labelsJSON      string
		createdAt       string
		updatedAt       string
	)

	if err := s.Scan(&id, &name, &matchersJSON, &targetServiceID, &targetUpstream, &enabled, &labelsJSON, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("sqlite: scan route: %w", err)
	}

	matchers, err := unmarshalMatchersJSON(matchersJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal matchers: %w", err)
	}
	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal labels: %w", err)
	}

	route := &riokuv1.Route{
		Id:        id,
		Name:      name,
		Matchers:  matchers,
		Enabled:   enabled != 0,
		Labels:    labels,
		CreatedAt: timestamppb.New(parseTime(createdAt)),
		UpdatedAt: timestamppb.New(parseTime(updatedAt)),
	}

	if targetServiceID != nil {
		route.Target = &riokuv1.Route_ServiceId{ServiceId: *targetServiceID}
	} else if targetUpstream != nil {
		du, err := unmarshalDirectUpstreamJSON(*targetUpstream)
		if err != nil {
			return nil, fmt.Errorf("sqlite: unmarshal upstream: %w", err)
		}
		route.Target = &riokuv1.Route_Upstream{Upstream: du}
	}

	return route, nil
}

func scanRouteRows(rows *sql.Rows) (*riokuv1.Route, error) {
	return scanRoute(rows)
}

func scanService(s scanner) (*riokuv1.Service, error) {
	var (
		id                           string
		name                         string
		lbPolicy                     int32
		hcJSON                       *string
		labelsJSON                   string
		createdAt                    string
		updatedAt                    string
		dialTimeoutSeconds           int32
		responseHeaderTimeoutSeconds int32
		idleTimeoutSeconds           int32
	)
	if err := s.Scan(&id, &name, &lbPolicy, &hcJSON, &labelsJSON, &createdAt, &updatedAt,
		&dialTimeoutSeconds, &responseHeaderTimeoutSeconds, &idleTimeoutSeconds); err != nil {
		return nil, fmt.Errorf("sqlite: scan service: %w", err)
	}

	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal labels: %w", err)
	}

	svc := &riokuv1.Service{
		Id:                           id,
		Name:                         name,
		LbPolicy:                     riokuv1.LoadBalancingPolicy(lbPolicy),
		Labels:                       labels,
		CreatedAt:                    timestamppb.New(parseTime(createdAt)),
		UpdatedAt:                    timestamppb.New(parseTime(updatedAt)),
		DialTimeoutSeconds:           dialTimeoutSeconds,
		ResponseHeaderTimeoutSeconds: responseHeaderTimeoutSeconds,
		IdleTimeoutSeconds:           idleTimeoutSeconds,
	}

	if hcJSON != nil && *hcJSON != "" {
		hc, err := unmarshalHealthCheckJSON(*hcJSON)
		if err != nil {
			return nil, fmt.Errorf("sqlite: unmarshal health_check: %w", err)
		}
		svc.HealthCheck = hc
	}

	return svc, nil
}

func scanServiceRows(rows *sql.Rows) (*riokuv1.Service, error) {
	return scanService(rows)
}

func scanPolicy(s scanner) (*riokuv1.Policy, error) {
	var (
		id         string
		name       string
		pType      int32
		configJSON string
		labelsJSON string
		createdAt  string
		updatedAt  string
	)
	if err := s.Scan(&id, &name, &pType, &configJSON, &labelsJSON, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("sqlite: scan policy: %w", err)
	}

	config, err := unmarshalStructJSON(configJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal policy config: %w", err)
	}
	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal labels: %w", err)
	}

	return &riokuv1.Policy{
		Id:        id,
		Name:      name,
		Type:      riokuv1.PolicyType(pType),
		Config:    config,
		Labels:    labels,
		CreatedAt: timestamppb.New(parseTime(createdAt)),
		UpdatedAt: timestamppb.New(parseTime(updatedAt)),
	}, nil
}

func scanPolicyRows(rows *sql.Rows) (*riokuv1.Policy, error) {
	return scanPolicy(rows)
}

func scanUser(s scanner) (*store.User, error) {
	var (
		id                  string
		username            string
		email               sql.NullString
		displayName         sql.NullString
		passwordHash        string
		status              string
		totpSecret          sql.NullString
		totpEnabled         int
		forcePasswordChange int
		failedAttempts      int
		lockedUntil         sql.NullString
		lastLogin           sql.NullString
		passwordChangedAt   string
		createdAt           string
		updatedAt           string
	)

	if err := s.Scan(&id, &username, &email, &displayName, &passwordHash, &status,
		&totpSecret, &totpEnabled, &forcePasswordChange,
		&failedAttempts, &lockedUntil, &lastLogin,
		&passwordChangedAt, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("sqlite: scan user: %w", err)
	}

	u := &store.User{
		ID:                  id,
		Username:            username,
		PasswordHash:        passwordHash,
		Status:              status,
		TOTPEnabled:         totpEnabled != 0,
		ForcePasswordChange: forcePasswordChange != 0,
		FailedAttempts:      failedAttempts,
		PasswordChangedAt:   parseTime(passwordChangedAt),
		CreatedAt:           parseTime(createdAt),
		UpdatedAt:           parseTime(updatedAt),
	}
	if email.Valid {
		u.Email = &email.String
	}
	if displayName.Valid {
		u.DisplayName = &displayName.String
	}
	if totpSecret.Valid {
		u.TOTPSecret = &totpSecret.String
	}
	if lockedUntil.Valid {
		t := parseTime(lockedUntil.String)
		u.LockedUntil = &t
	}
	if lastLogin.Valid {
		t := parseTime(lastLogin.String)
		u.LastLogin = &t
	}
	return u, nil
}

func scanSession(s scanner) (*store.Session, error) {
	var (
		id          string
		userID      string
		fingerprint string
		createdAt   string
		expiresAt   string
		lastActive  string
		ipAddress   sql.NullString
		userAgent   sql.NullString
	)

	if err := s.Scan(&id, &userID, &fingerprint, &createdAt, &expiresAt, &lastActive, &ipAddress, &userAgent); err != nil {
		return nil, fmt.Errorf("sqlite: scan session: %w", err)
	}

	sess := &store.Session{
		ID:          id,
		UserID:      userID,
		Fingerprint: fingerprint,
		CreatedAt:   parseTime(createdAt),
		ExpiresAt:   parseTime(expiresAt),
		LastActive:  parseTime(lastActive),
	}
	if ipAddress.Valid {
		sess.IPAddress = &ipAddress.String
	}
	if userAgent.Valid {
		sess.UserAgent = &userAgent.String
	}
	return sess, nil
}

func scanAPIKey(s scanner) (*store.APIKey, error) {
	var (
		id         string
		name       string
		keyHash    string
		scopesJSON string
		expiresAt  *string
		createdAt  string
		revokedAt  *string
	)
	if err := s.Scan(&id, &name, &keyHash, &scopesJSON, &expiresAt, &createdAt, &revokedAt); err != nil {
		return nil, fmt.Errorf("sqlite: scan api_key: %w", err)
	}

	var scopes []string
	if err := json.Unmarshal([]byte(scopesJSON), &scopes); err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal scopes: %w", err)
	}

	key := &store.APIKey{
		ID:        id,
		Name:      name,
		KeyHash:   keyHash,
		Scopes:    scopes,
		CreatedAt: parseTime(createdAt),
	}
	if expiresAt != nil {
		t := parseTime(*expiresAt)
		key.ExpiresAt = &t
	}
	if revokedAt != nil {
		t := parseTime(*revokedAt)
		key.RevokedAt = &t
	}
	return key, nil
}

func scanAPIKeyRows(rows *sql.Rows) (*store.APIKey, error) {
	return scanAPIKey(rows)
}

// ---------------------------------------------------------------------------
// JSON marshaling helpers
// ---------------------------------------------------------------------------

func marshalMatchersJSON(matchers []*riokuv1.Matcher) (string, error) {
	if matchers == nil {
		return "[]", nil
	}
	var arr []json.RawMessage
	for _, m := range matchers {
		b, err := protojson.Marshal(m)
		if err != nil {
			return "", err
		}
		arr = append(arr, b)
	}
	out, err := json.Marshal(arr)
	return string(out), err
}

func unmarshalMatchersJSON(s string) ([]*riokuv1.Matcher, error) {
	var arr []json.RawMessage
	if err := json.Unmarshal([]byte(s), &arr); err != nil {
		return nil, err
	}
	matchers := make([]*riokuv1.Matcher, 0, len(arr))
	for _, raw := range arr {
		m := &riokuv1.Matcher{}
		if err := protojson.Unmarshal(raw, m); err != nil {
			return nil, err
		}
		matchers = append(matchers, m)
	}
	return matchers, nil
}

func marshalDirectUpstreamJSON(u *riokuv1.DirectUpstream) (string, error) {
	if u == nil {
		return "", nil
	}
	b, err := protojson.Marshal(u)
	return string(b), err
}

func unmarshalDirectUpstreamJSON(s string) (*riokuv1.DirectUpstream, error) {
	du := &riokuv1.DirectUpstream{}
	if err := protojson.Unmarshal([]byte(s), du); err != nil {
		return nil, err
	}
	return du, nil
}

func marshalLabelsJSON(labels *riokuv1.Labels) (string, error) {
	if labels == nil || labels.GetLabels() == nil {
		return "{}", nil
	}
	b, err := json.Marshal(labels.GetLabels())
	return string(b), err
}

func unmarshalLabelsJSON(s string) (*riokuv1.Labels, error) {
	if s == "" || s == "{}" {
		return &riokuv1.Labels{Labels: map[string]string{}}, nil
	}
	m := make(map[string]string)
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return &riokuv1.Labels{Labels: map[string]string{}}, nil
	}
	return &riokuv1.Labels{Labels: m}, nil
}

func marshalHealthCheckJSON(hc *riokuv1.HealthCheck) (*string, error) {
	if hc == nil {
		return nil, nil
	}
	b, err := protojson.Marshal(hc)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}

func unmarshalHealthCheckJSON(s string) (*riokuv1.HealthCheck, error) {
	hc := &riokuv1.HealthCheck{}
	if err := protojson.Unmarshal([]byte(s), hc); err != nil {
		return nil, err
	}
	return hc, nil
}

func marshalStructJSON(st *structpb.Struct) (string, error) {
	if st == nil {
		return "{}", nil
	}
	b, err := protojson.Marshal(st)
	return string(b), err
}

func unmarshalStructJSON(s string) (*structpb.Struct, error) {
	if s == "" || s == "{}" {
		return nil, nil
	}
	st := &structpb.Struct{}
	if err := protojson.Unmarshal([]byte(s), st); err != nil {
		return nil, err
	}
	return st, nil
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

func nowUTC() string {
	return time.Now().UTC().Format(timeFormat)
}

func parseTime(s string) time.Time {
	t, err := time.Parse(timeFormat, s)
	if err != nil && s != "" {
		log.Printf("sqlite: warning: failed to parse time %q: %v", s, err)
	}
	return t
}
