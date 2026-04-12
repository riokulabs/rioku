# Proto & Compiler Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add proxy timeout fields to the Service proto and Caddy compiler transport block, plus configurable HTTP security headers injected into compiled traffic routes.

**Architecture:** Two features that touch proto definitions, the config store, the compiler, and daemon config. Feature 1 adds three int32 timeout fields to the Service proto message, persists them through sqlite, and emits a Caddy reverse_proxy `transport` block. Feature 2 adds a SecurityHeaders config struct, a new Compiler method to build the Caddy `headers` handler, and inserts it into the traffic route handler chain at position 1 (after tracing, before vars).

**Tech Stack:** Go 1.24, protobuf (buf toolchain), SQLite, Caddy JSON API

**Working directory:** `packages/daemon`

**Spec:** `docs/superpowers/specs/2026-04-12-proto-compiler-additions.md`

**Key conventions:**
- Go standard library preferred, no external test libraries
- Table-driven tests, real databases for integration tests
- Handle every error explicitly, `-race` flag on all tests
- Conventional Commits required, no AI references in commits
- TDD: write test first, verify it fails, then implement

---

## Task 1: Add timeout fields to Service proto + regenerate

**Files:**
- Modify: `packages/proto/rioku/v1/config.proto`

- [ ] **Step 1: Add timeout fields to Service message**

In `packages/proto/rioku/v1/config.proto`, add three fields after `updated_at` (field 8):

```proto
message Service {
  string                    id          = 1;
  string                    name        = 2;
  repeated Upstream         upstreams   = 3;
  LoadBalancingPolicy       lb_policy   = 4;
  HealthCheck               health_check = 5;
  Labels                    labels      = 6;
  google.protobuf.Timestamp created_at  = 7;
  google.protobuf.Timestamp updated_at  = 8;
  int32 dial_timeout_seconds             = 9;
  int32 response_header_timeout_seconds  = 10;
  int32 idle_timeout_seconds             = 11;
}
```

- [ ] **Step 2: Regenerate Go code from proto**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && make proto
```

- [ ] **Step 3: Verify proto compiles and Go code generated**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go build ./...
```

- [ ] **Step 4: Commit**

```
feat(proto): add timeout fields to Service message
```

---

## Task 2: Add migration 000005 for timeout columns

**Files:**
- Create: `packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.up.sql`
- Create: `packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.down.sql`
- Create: `packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.up.sql`
- Create: `packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.down.sql`
- Create: `packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.up.sql`
- Create: `packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.down.sql`
- Modify: `packages/daemon/internal/store/sqlite/sqlite.go`

- [ ] **Step 1: Create sqlite up migration**

Create `packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.up.sql`:

```sql
ALTER TABLE services ADD COLUMN dial_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN response_header_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN idle_timeout_seconds INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Create sqlite down migration**

Create `packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.down.sql`:

```sql
-- SQLite does not support DROP COLUMN before 3.35.0; recreate table.
CREATE TABLE services_backup AS SELECT id, name, lb_policy, health_check, labels, created_at, updated_at FROM services;
DROP TABLE services;
ALTER TABLE services_backup RENAME TO services;
DELETE FROM schema_versions WHERE version = 5;
```

**Note:** SQLite's ALTER TABLE DROP COLUMN was added in 3.35.0 (2021-03-12). The modernc.org/sqlite driver embeds SQLite 3.46+, so DROP COLUMN is supported. However, the safer table-recreation approach is used to match the pattern set by other down migrations which target maximum compatibility. If the team prefers the simpler approach, replace with:

```sql
ALTER TABLE services DROP COLUMN dial_timeout_seconds;
ALTER TABLE services DROP COLUMN response_header_timeout_seconds;
ALTER TABLE services DROP COLUMN idle_timeout_seconds;
DELETE FROM schema_versions WHERE version = 5;
```

- [ ] **Step 3: Create postgres up migration**

Create `packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.up.sql`:

```sql
ALTER TABLE services ADD COLUMN dial_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN response_header_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN idle_timeout_seconds INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Create postgres down migration**

Create `packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.down.sql`:

```sql
ALTER TABLE services DROP COLUMN dial_timeout_seconds;
ALTER TABLE services DROP COLUMN response_header_timeout_seconds;
ALTER TABLE services DROP COLUMN idle_timeout_seconds;
DELETE FROM schema_versions WHERE version = 5;
```

- [ ] **Step 5: Create mysql up migration**

Create `packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.up.sql`:

```sql
ALTER TABLE services ADD COLUMN dial_timeout_seconds INT NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN response_header_timeout_seconds INT NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN idle_timeout_seconds INT NOT NULL DEFAULT 0;
```

- [ ] **Step 6: Create mysql down migration**

Create `packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.down.sql`:

```sql
ALTER TABLE services DROP COLUMN dial_timeout_seconds;
ALTER TABLE services DROP COLUMN response_header_timeout_seconds;
ALTER TABLE services DROP COLUMN idle_timeout_seconds;
DELETE FROM schema_versions WHERE version = 5;
```

- [ ] **Step 7: Register migration 5 in migrateUp**

In `packages/daemon/internal/store/sqlite/sqlite.go`, in the `migrateUp` method, after the migration 4 block (which ends with `}` around line 154), add:

```go
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
```

- [ ] **Step 8: Register migration 5 in migrateDown**

In `packages/daemon/internal/store/sqlite/sqlite.go`, in the `migrateDown` method, add **before** the migration 4 down block (migration down runs in reverse order, highest first):

```go
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
```

- [ ] **Step 9: Write migration test**

In `packages/daemon/internal/store/sqlite/sqlite_test.go`, add:

```go
func TestMigration_000005_UpDown(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// After openTestDB, migrations are applied up to latest.
	v, err := d.CurrentVersion(ctx)
	if err != nil {
		t.Fatalf("CurrentVersion: %v", err)
	}
	if v < 5 {
		t.Fatalf("expected version >= 5 after migration, got %d", v)
	}

	// Verify columns exist by inserting a row with timeout values.
	_, err = d.db.ExecContext(ctx,
		`INSERT INTO services (id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds)
		 VALUES ('test-svc', 'test', 0, NULL, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 5, 30, 120)`)
	if err != nil {
		t.Fatalf("insert with timeout columns: %v", err)
	}

	// Read back.
	var dial, respHeader, idle int32
	err = d.db.QueryRowContext(ctx,
		`SELECT dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds FROM services WHERE id = 'test-svc'`).
		Scan(&dial, &respHeader, &idle)
	if err != nil {
		t.Fatalf("select timeout columns: %v", err)
	}
	if dial != 5 || respHeader != 30 || idle != 120 {
		t.Fatalf("timeout values = (%d, %d, %d), want (5, 30, 120)", dial, respHeader, idle)
	}

	// Clean up test row before down migration.
	_, _ = d.db.ExecContext(ctx, `DELETE FROM services WHERE id = 'test-svc'`)
}
```

Also update the `TestOpen` version check from `v != 4` to `v != 5`:

```go
	if v != 5 {
		t.Fatalf("expected version 5, got %d", v)
	}
```

- [ ] **Step 10: Run migration test**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/store/sqlite/ -run TestMigration_000005
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/store/sqlite/ -run TestOpen
```

- [ ] **Step 11: Commit**

```
feat(store): add migration 000005 for service timeout columns
```

---

## Task 3: Wire timeout fields in sqlite store

**Files:**
- Modify: `packages/daemon/internal/store/sqlite/sqlite.go`
- Modify: `packages/daemon/internal/store/sqlite/sqlite_test.go`

- [ ] **Step 1: Write failing round-trip test**

Add to `packages/daemon/internal/store/sqlite/sqlite_test.go`:

```go
func TestServiceTimeout_RoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:     "timeout-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080", Weight: 1, Healthy: true},
		},
		DialTimeoutSeconds:            5,
		ResponseHeaderTimeoutSeconds:  30,
		IdleTimeoutSeconds:            120,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}

	if created.GetDialTimeoutSeconds() != 5 {
		t.Errorf("dial_timeout_seconds = %d, want 5", created.GetDialTimeoutSeconds())
	}
	if created.GetResponseHeaderTimeoutSeconds() != 30 {
		t.Errorf("response_header_timeout_seconds = %d, want 30", created.GetResponseHeaderTimeoutSeconds())
	}
	if created.GetIdleTimeoutSeconds() != 120 {
		t.Errorf("idle_timeout_seconds = %d, want 120", created.GetIdleTimeoutSeconds())
	}

	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Read back via GetService.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetService(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if got.GetDialTimeoutSeconds() != 5 {
		t.Errorf("GetService dial_timeout_seconds = %d, want 5", got.GetDialTimeoutSeconds())
	}
	if got.GetResponseHeaderTimeoutSeconds() != 30 {
		t.Errorf("GetService response_header_timeout_seconds = %d, want 30", got.GetResponseHeaderTimeoutSeconds())
	}
	if got.GetIdleTimeoutSeconds() != 120 {
		t.Errorf("GetService idle_timeout_seconds = %d, want 120", got.GetIdleTimeoutSeconds())
	}
	_ = tx2.Rollback()

	// Verify via ListServices.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	services, err := tx3.ListServices(ctx)
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	if services[0].GetDialTimeoutSeconds() != 5 {
		t.Errorf("ListServices dial_timeout_seconds = %d, want 5", services[0].GetDialTimeoutSeconds())
	}
	_ = tx3.Rollback()
}

func TestServiceTimeout_Update(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:     "update-timeout-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080", Weight: 1, Healthy: true},
		},
		DialTimeoutSeconds:            5,
		ResponseHeaderTimeoutSeconds:  30,
		IdleTimeoutSeconds:            120,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Update timeout values.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created.DialTimeoutSeconds = 10
	created.ResponseHeaderTimeoutSeconds = 60
	created.IdleTimeoutSeconds = 0 // reset to default
	updated, err := tx2.UpdateService(ctx, created)
	if err != nil {
		t.Fatalf("UpdateService: %v", err)
	}
	if updated.GetDialTimeoutSeconds() != 10 {
		t.Errorf("updated dial_timeout_seconds = %d, want 10", updated.GetDialTimeoutSeconds())
	}
	if updated.GetResponseHeaderTimeoutSeconds() != 60 {
		t.Errorf("updated response_header_timeout_seconds = %d, want 60", updated.GetResponseHeaderTimeoutSeconds())
	}
	if updated.GetIdleTimeoutSeconds() != 0 {
		t.Errorf("updated idle_timeout_seconds = %d, want 0", updated.GetIdleTimeoutSeconds())
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestServiceTimeout_ZeroValues(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	// Create service with no timeouts (all 0, proto3 default).
	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:     "no-timeout-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if created.GetDialTimeoutSeconds() != 0 {
		t.Errorf("dial_timeout_seconds = %d, want 0", created.GetDialTimeoutSeconds())
	}
	if created.GetResponseHeaderTimeoutSeconds() != 0 {
		t.Errorf("response_header_timeout_seconds = %d, want 0", created.GetResponseHeaderTimeoutSeconds())
	}
	if created.GetIdleTimeoutSeconds() != 0 {
		t.Errorf("idle_timeout_seconds = %d, want 0", created.GetIdleTimeoutSeconds())
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}
```

- [ ] **Step 2: Run tests (expect failure -- columns not in queries yet)**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/store/sqlite/ -run TestServiceTimeout
```

- [ ] **Step 3: Modify CreateService INSERT**

In `packages/daemon/internal/store/sqlite/sqlite.go`, in `CreateService` (around line 421), change the INSERT statement from:

```go
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO services (id, name, lb_policy, health_check, labels, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now, now,
	)
```

to:

```go
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO services (id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
	)
```

- [ ] **Step 4: Modify UpdateService UPDATE**

In `packages/daemon/internal/store/sqlite/sqlite.go`, in `UpdateService` (around line 545), change the UPDATE statement from:

```go
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE services SET name=?, lb_policy=?, health_check=?, labels=?, updated_at=?
		 WHERE id=?`,
		svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now, svc.GetId(),
	)
```

to:

```go
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE services SET name=?, lb_policy=?, health_check=?, labels=?, updated_at=?, dial_timeout_seconds=?, response_header_timeout_seconds=?, idle_timeout_seconds=?
		 WHERE id=?`,
		svc.GetName(), int32(svc.GetLbPolicy()), hcJSON, labelsJSON, now,
		svc.GetDialTimeoutSeconds(), svc.GetResponseHeaderTimeoutSeconds(), svc.GetIdleTimeoutSeconds(),
		svc.GetId(),
	)
```

- [ ] **Step 5: Modify GetService SELECT**

In `packages/daemon/internal/store/sqlite/sqlite.go`, in `GetService` (around line 453), change:

```go
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at
		 FROM services WHERE id = ?`, id)
```

to:

```go
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds
		 FROM services WHERE id = ?`, id)
```

- [ ] **Step 6: Modify ListServices SELECT**

In `packages/daemon/internal/store/sqlite/sqlite.go`, in `ListServices` (around line 471), change:

```go
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at FROM services ORDER BY id`)
```

to:

```go
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds FROM services ORDER BY id`)
```

- [ ] **Step 7: Modify scanService to scan 3 additional columns**

In `packages/daemon/internal/store/sqlite/sqlite.go`, in `scanService` (around line 1809), change from:

```go
func scanService(s scanner) (*riokuv1.Service, error) {
	var (
		id         string
		name       string
		lbPolicy   int32
		hcJSON     *string
		labelsJSON string
		createdAt  string
		updatedAt  string
	)
	if err := s.Scan(&id, &name, &lbPolicy, &hcJSON, &labelsJSON, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("sqlite: scan service: %w", err)
	}

	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal labels: %w", err)
	}

	svc := &riokuv1.Service{
		Id:        id,
		Name:      name,
		LbPolicy:  riokuv1.LoadBalancingPolicy(lbPolicy),
		Labels:    labels,
		CreatedAt: timestamppb.New(parseTime(createdAt)),
		UpdatedAt: timestamppb.New(parseTime(updatedAt)),
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
```

to:

```go
func scanService(s scanner) (*riokuv1.Service, error) {
	var (
		id                          string
		name                        string
		lbPolicy                    int32
		hcJSON                      *string
		labelsJSON                  string
		createdAt                   string
		updatedAt                   string
		dialTimeoutSeconds          int32
		responseHeaderTimeoutSeconds int32
		idleTimeoutSeconds          int32
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
		Id:                          id,
		Name:                        name,
		LbPolicy:                    riokuv1.LoadBalancingPolicy(lbPolicy),
		Labels:                      labels,
		CreatedAt:                   timestamppb.New(parseTime(createdAt)),
		UpdatedAt:                   timestamppb.New(parseTime(updatedAt)),
		DialTimeoutSeconds:          dialTimeoutSeconds,
		ResponseHeaderTimeoutSeconds: responseHeaderTimeoutSeconds,
		IdleTimeoutSeconds:          idleTimeoutSeconds,
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
```

- [ ] **Step 8: Run tests (all should pass now)**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/store/sqlite/ -run TestServiceTimeout
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/store/sqlite/ -run TestServiceCRUD
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/store/sqlite/
```

- [ ] **Step 9: Commit**

```
feat(store): wire service timeout fields in sqlite driver
```

---

## Task 4: Add timeout transport block to compiler

**Files:**
- Modify: `packages/daemon/internal/caddy/compiler.go`
- Modify: `packages/daemon/internal/caddy/compiler_test.go`

- [ ] **Step 1: Write failing compiler timeout tests**

Add to `packages/daemon/internal/caddy/compiler_test.go`:

```go
func TestCompiler_ServiceWithAllTimeouts(t *testing.T) {
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:       "svc1",
				Name:     "backend",
				Upstreams: []*riokuv1.Upstream{
					{Id: "u1", Address: "10.0.0.1:8080"},
				},
				DialTimeoutSeconds:            5,
				ResponseHeaderTimeoutSeconds:  30,
				IdleTimeoutSeconds:            120,
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	route := routes[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any) // [0]=tracing, [1]=vars, [2]=reverse_proxy

	transport, ok := handler["transport"].(map[string]any)
	if !ok {
		t.Fatal("expected transport block in reverse_proxy handler")
	}
	if transport["protocol"].(string) != "http" {
		t.Errorf("transport.protocol = %v, want http", transport["protocol"])
	}
	if transport["dial_timeout"].(string) != "5s" {
		t.Errorf("transport.dial_timeout = %v, want 5s", transport["dial_timeout"])
	}
	if transport["response_header_timeout"].(string) != "30s" {
		t.Errorf("transport.response_header_timeout = %v, want 30s", transport["response_header_timeout"])
	}

	keepAlive, ok := transport["keep_alive"].(map[string]any)
	if !ok {
		t.Fatal("expected keep_alive sub-object in transport")
	}
	if keepAlive["idle_conn_timeout"].(string) != "120s" {
		t.Errorf("transport.keep_alive.idle_conn_timeout = %v, want 120s", keepAlive["idle_conn_timeout"])
	}
}

func TestCompiler_ServiceWithPartialTimeouts(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target:  &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:                 "svc1",
				Upstreams:          []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
				DialTimeoutSeconds: 5,
				// ResponseHeaderTimeoutSeconds and IdleTimeoutSeconds are 0 (default).
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any)

	transport, ok := handler["transport"].(map[string]any)
	if !ok {
		t.Fatal("expected transport block when dial_timeout_seconds > 0")
	}
	if transport["dial_timeout"].(string) != "5s" {
		t.Errorf("transport.dial_timeout = %v, want 5s", transport["dial_timeout"])
	}
	// response_header_timeout should be absent (0 = omit).
	if _, ok := transport["response_header_timeout"]; ok {
		t.Error("response_header_timeout should not be present when 0")
	}
	// keep_alive should be absent (idle_timeout_seconds = 0).
	if _, ok := transport["keep_alive"]; ok {
		t.Error("keep_alive should not be present when idle_timeout_seconds is 0")
	}
}

func TestCompiler_ServiceWithNoTimeouts(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target:  &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
				// All timeouts are 0 (proto3 default).
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any)

	if _, ok := handler["transport"]; ok {
		t.Error("transport block should not be present when all timeouts are 0")
	}
}

func TestCompiler_TimeoutFormatting(t *testing.T) {
	tests := []struct {
		name     string
		seconds  int32
		wantDial string
	}{
		{"1 second", 1, "1s"},
		{"30 seconds", 30, "30s"},
		{"120 seconds", 120, "120s"},
		{"3600 seconds", 3600, "3600s"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

			snapshot := &riokuv1.ConfigSnapshot{
				Routes: []*riokuv1.Route{
					{
						Id:      "r1",
						Enabled: true,
						Target:  &riokuv1.Route_ServiceId{ServiceId: "svc1"},
					},
				},
				Services: []*riokuv1.Service{
					{
						Id:                 "svc1",
						Upstreams:          []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
						DialTimeoutSeconds: tt.seconds,
					},
				},
			}

			data, err := c.Compile(snapshot)
			if err != nil {
				t.Fatalf("Compile: %v", err)
			}

			var cfg map[string]any
			if err := json.Unmarshal(data, &cfg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}

			server := dig(t, cfg, "apps", "http", "servers", "traffic")
			route := server["routes"].([]any)[0].(map[string]any)
			handler := route["handle"].([]any)[2].(map[string]any)
			transport := handler["transport"].(map[string]any)

			if transport["dial_timeout"].(string) != tt.wantDial {
				t.Errorf("dial_timeout = %v, want %v", transport["dial_timeout"], tt.wantDial)
			}
		})
	}
}
```

- [ ] **Step 2: Run tests (expect failure -- transport block not emitted yet)**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/caddy/ -run "TestCompiler_ServiceWith(All|Partial|No)Timeouts|TestCompiler_TimeoutFormatting"
```

- [ ] **Step 3: Implement transport block in applyService**

In `packages/daemon/internal/caddy/compiler.go`, in the `applyService` function, after the health checks block (after line 379 `}`), add:

```go
	// Transport timeouts
	dialTimeout := svc.GetDialTimeoutSeconds()
	respHeaderTimeout := svc.GetResponseHeaderTimeoutSeconds()
	idleTimeout := svc.GetIdleTimeoutSeconds()

	if dialTimeout > 0 || respHeaderTimeout > 0 || idleTimeout > 0 {
		transport := map[string]any{
			"protocol": "http",
		}
		if dialTimeout > 0 {
			transport["dial_timeout"] = fmt.Sprintf("%ds", dialTimeout)
		}
		if respHeaderTimeout > 0 {
			transport["response_header_timeout"] = fmt.Sprintf("%ds", respHeaderTimeout)
		}
		if idleTimeout > 0 {
			transport["keep_alive"] = map[string]any{
				"idle_conn_timeout": fmt.Sprintf("%ds", idleTimeout),
			}
		}
		handler["transport"] = transport
	}
```

- [ ] **Step 4: Run tests (all should pass)**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/caddy/ -run "TestCompiler_ServiceWith(All|Partial|No)Timeouts|TestCompiler_TimeoutFormatting"
```

- [ ] **Step 5: Run full compiler test suite to confirm no regressions**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/caddy/
```

- [ ] **Step 6: Commit**

```
feat(compiler): emit transport timeout block for services
```

---

## Task 5: Add SecurityHeaders config struct

**Files:**
- Modify: `packages/daemon/internal/config/file.go`

- [ ] **Step 1: Add SecurityHeaders and HSTSConfig structs**

In `packages/daemon/internal/config/file.go`, add the following structs after the `CORSConfig` struct (around line 262, before the `Default()` function):

```go
// --------------------------------------------------------------------------
// Security Headers
// --------------------------------------------------------------------------

// SecurityHeaders controls HTTP security headers injected by the Caddy
// compiler into all traffic (non-admin) routes.
type SecurityHeaders struct {
	Enabled             bool       `yaml:"enabled"`
	XContentTypeOptions string     `yaml:"x_content_type_options"`
	XFrameOptions       string     `yaml:"x_frame_options"`
	ReferrerPolicy      string     `yaml:"referrer_policy"`
	PermissionsPolicy   string     `yaml:"permissions_policy"`
	CSP                 string     `yaml:"csp"`
	CSPReportOnly       bool       `yaml:"csp_report_only"`
	HSTS                HSTSConfig `yaml:"hsts"`
}

// HSTSConfig controls HTTP Strict Transport Security header generation.
type HSTSConfig struct {
	Enabled           bool `yaml:"enabled"`
	MaxAge            int  `yaml:"max_age"`
	IncludeSubdomains bool `yaml:"include_subdomains"`
}
```

- [ ] **Step 2: Add SecurityHeaders field to Config struct**

In `packages/daemon/internal/config/file.go`, add to the `Config` struct:

```go
type Config struct {
	Store           StoreConfig     `yaml:"store"`
	Listen          ListenConfig    `yaml:"listen"`
	Caddy           CaddyConfig     `yaml:"caddy"`
	PKI             PKIConfig       `yaml:"pki"`
	Traces          TracesConfig    `yaml:"traces"`
	AI              AIConfig        `yaml:"ai"`
	Auth            AuthConfig      `yaml:"auth"`
	SecurityHeaders SecurityHeaders `yaml:"security_headers"`
	DataDir         string          `yaml:"data_dir"`
	LogLevel        string          `yaml:"log_level"`
}
```

- [ ] **Step 3: Set defaults in Default()**

In `packages/daemon/internal/config/file.go`, in the `Default()` function, add to the returned `&Config{...}` literal, before the `DataDir` field (around line 396):

```go
		SecurityHeaders: SecurityHeaders{
			Enabled:             true,
			XContentTypeOptions: "nosniff",
			XFrameOptions:       "DENY",
			ReferrerPolicy:      "strict-origin-when-cross-origin",
			PermissionsPolicy:   "camera=(), microphone=(), geolocation=()",
			CSP:                 "",
			HSTS: HSTSConfig{
				Enabled:           true,
				MaxAge:            63072000, // 2 years
				IncludeSubdomains: true,
			},
		},
```

- [ ] **Step 4: Verify build**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go build ./...
```

- [ ] **Step 5: Commit**

```
feat(config): add SecurityHeaders config struct with defaults
```

---

## Task 6: Modify NewCompiler to accept SecurityHeaders

**Files:**
- Modify: `packages/daemon/internal/caddy/compiler.go`
- Modify: `packages/daemon/internal/daemon/daemon.go`
- Modify: any other files that call `NewCompiler` (test files)

- [ ] **Step 1: Add import and field to Compiler struct**

In `packages/daemon/internal/caddy/compiler.go`, add the import:

```go
import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/riokulabs/rioku/internal/config"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)
```

Add the field to the `Compiler` struct:

```go
type Compiler struct {
	trafficAddrs    []string
	admin           AdminConfig
	traceSocketPath string
	trustedProxies  *TrustedProxiesConfig
	securityHeaders config.SecurityHeaders
}
```

- [ ] **Step 2: Update NewCompiler signature**

Change `NewCompiler` from:

```go
func NewCompiler(trafficAddrs []string, admin AdminConfig, traceSocketPath string, trustedProxies *TrustedProxiesConfig) *Compiler {
	addrs := make([]string, len(trafficAddrs))
	copy(addrs, trafficAddrs)
	return &Compiler{trafficAddrs: addrs, admin: admin, traceSocketPath: traceSocketPath, trustedProxies: trustedProxies}
}
```

to:

```go
func NewCompiler(trafficAddrs []string, admin AdminConfig, traceSocketPath string, trustedProxies *TrustedProxiesConfig, secHeaders config.SecurityHeaders) *Compiler {
	addrs := make([]string, len(trafficAddrs))
	copy(addrs, trafficAddrs)
	return &Compiler{trafficAddrs: addrs, admin: admin, traceSocketPath: traceSocketPath, trustedProxies: trustedProxies, securityHeaders: secHeaders}
}
```

- [ ] **Step 3: Update daemon.go call sites**

In `packages/daemon/internal/daemon/daemon.go`, update both `NewCompiler` calls.

The placeholder compiler (around line 131):

```go
	placeholderCompiler := caddy.NewCompiler([]string{":443"}, caddy.AdminConfig{}, "", nil, config.SecurityHeaders{})
```

The real compiler (around line 227):

```go
	compiler := caddy.NewCompiler(trafficAddrs, caddy.AdminConfig{
		InternalAddr: internalAddr,
		ListenAddr:   adminListenAddr,
		Domain:       d.cfg.Listen.AdminDomain,
		DevMode:      d.cfg.Auth.DevMode,
	}, socketPath, nil, d.cfg.SecurityHeaders)
```

- [ ] **Step 4: Update all other NewCompiler call sites**

Every other call to `NewCompiler` throughout the codebase needs the new `secHeaders` parameter added. These are all in test files and should pass `config.SecurityHeaders{}` (zero value = disabled) to preserve existing behavior:

- `packages/daemon/internal/config/engine_test.go` (line 46)
- `packages/daemon/internal/config/engine_bench_test.go` (line 35)
- `packages/daemon/internal/config/engine_coverage_test.go` (line 26)
- `packages/daemon/internal/grpc/server_test.go` (line 61)
- `packages/daemon/internal/gateway/contract_test.go` (line 128)
- `packages/daemon/internal/grpc/config_service_test.go` (line 48)
- `packages/daemon/internal/gateway/gateway_lifecycle_test.go` (lines 47, 104)
- `packages/daemon/internal/sync/agent_test.go` (line 49)

For each, add `config.SecurityHeaders{}` as the final argument and ensure the `config` package is imported:

```go
import "github.com/riokulabs/rioku/internal/config"
```

All `compiler_test.go` calls also need updating -- every `NewCompiler(...)` in that file should get `, config.SecurityHeaders{}` appended. There are many instances, so use find-and-replace:

Find: `NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil)`
Replace: `NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, config.SecurityHeaders{})`

And similarly for all other variations in the file.

- [ ] **Step 5: Verify everything builds and existing tests pass**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go build ./...
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/caddy/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/config/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/grpc/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/gateway/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/sync/
```

- [ ] **Step 6: Commit**

```
refactor(compiler): accept SecurityHeaders in NewCompiler
```

---

## Task 7: Implement buildSecurityHeadersHandler

**Files:**
- Modify: `packages/daemon/internal/caddy/compiler.go`
- Modify: `packages/daemon/internal/caddy/compiler_test.go`

- [ ] **Step 1: Write failing security headers tests**

Add to `packages/daemon/internal/caddy/compiler_test.go`:

```go
func TestCompiler_SecurityHeadersAllDefaults(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		XFrameOptions:       "DENY",
		ReferrerPolicy:      "strict-origin-when-cross-origin",
		PermissionsPolicy:   "camera=(), microphone=(), geolocation=()",
		HSTS: config.HSTSConfig{
			Enabled:           true,
			MaxAge:            63072000,
			IncludeSubdomains: true,
		},
	}
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_Upstream{
					Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"},
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)

	// Handler chain: tracing, headers, vars, reverse_proxy
	if len(handlers) != 4 {
		t.Fatalf("expected 4 handlers, got %d", len(handlers))
	}

	wantOrder := []string{"tracing", "headers", "vars", "reverse_proxy"}
	for i, want := range wantOrder {
		got := handlers[i].(map[string]any)["handler"].(string)
		if got != want {
			t.Errorf("handlers[%d].handler = %v, want %v", i, got, want)
		}
	}

	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	checks := map[string]string{
		"X-Content-Type-Options":    "nosniff",
		"X-Frame-Options":          "DENY",
		"Referrer-Policy":          "strict-origin-when-cross-origin",
		"Permissions-Policy":       "camera=(), microphone=(), geolocation=()",
		"Strict-Transport-Security": "max-age=63072000; includeSubDomains",
	}
	for header, wantVal := range checks {
		vals, ok := set[header].([]any)
		if !ok {
			t.Errorf("header %q not found in set", header)
			continue
		}
		if len(vals) != 1 || vals[0].(string) != wantVal {
			t.Errorf("header %q = %v, want [%q]", header, vals, wantVal)
		}
	}

	// CSP should not be present (empty by default).
	if _, ok := set["Content-Security-Policy"]; ok {
		t.Error("Content-Security-Policy should not be present when CSP is empty")
	}
	if _, ok := set["Content-Security-Policy-Report-Only"]; ok {
		t.Error("Content-Security-Policy-Report-Only should not be present when CSP is empty")
	}
}

func TestCompiler_SecurityHeadersDisabled(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled: false,
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target: &riokuv1.Route_Upstream{
					Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"},
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)

	// Without security headers: tracing, vars, reverse_proxy (3 handlers).
	if len(handlers) != 3 {
		t.Fatalf("expected 3 handlers (no security headers), got %d", len(handlers))
	}
	wantOrder := []string{"tracing", "vars", "reverse_proxy"}
	for i, want := range wantOrder {
		got := handlers[i].(map[string]any)["handler"].(string)
		if got != want {
			t.Errorf("handlers[%d].handler = %v, want %v", i, got, want)
		}
	}
}

func TestCompiler_SecurityHeadersPartialEmpty(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		XFrameOptions:       "",          // empty = omit
		ReferrerPolicy:      "",          // empty = omit
		PermissionsPolicy:   "camera=()", // non-empty = include
		HSTS: config.HSTSConfig{
			Enabled: false,
		},
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target: &riokuv1.Route_Upstream{
					Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"},
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	if len(handlers) != 4 {
		t.Fatalf("expected 4 handlers, got %d", len(handlers))
	}

	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	// Only non-empty headers should be present.
	if _, ok := set["X-Content-Type-Options"]; !ok {
		t.Error("X-Content-Type-Options should be present")
	}
	if _, ok := set["Permissions-Policy"]; !ok {
		t.Error("Permissions-Policy should be present")
	}
	if _, ok := set["X-Frame-Options"]; ok {
		t.Error("X-Frame-Options should not be present (empty)")
	}
	if _, ok := set["Referrer-Policy"]; ok {
		t.Error("Referrer-Policy should not be present (empty)")
	}
	if _, ok := set["Strict-Transport-Security"]; ok {
		t.Error("HSTS should not be present (disabled)")
	}
}

func TestCompiler_SecurityHeadersNoCSP(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		CSP:                 "", // empty = no CSP header
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	if _, ok := set["Content-Security-Policy"]; ok {
		t.Error("Content-Security-Policy should not be present when CSP is empty")
	}
	if _, ok := set["Content-Security-Policy-Report-Only"]; ok {
		t.Error("Content-Security-Policy-Report-Only should not be present when CSP is empty")
	}
}

func TestCompiler_SecurityHeadersWithCSP(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled:       true,
		CSP:           "default-src 'self'",
		CSPReportOnly: false,
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	vals, ok := set["Content-Security-Policy"].([]any)
	if !ok {
		t.Fatal("Content-Security-Policy not found")
	}
	if vals[0].(string) != "default-src 'self'" {
		t.Errorf("CSP = %v, want default-src 'self'", vals[0])
	}
	if _, ok := set["Content-Security-Policy-Report-Only"]; ok {
		t.Error("CSP-Report-Only should not be present when CSPReportOnly is false")
	}
}

func TestCompiler_SecurityHeadersWithCSPReportOnly(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled:       true,
		CSP:           "default-src 'self'",
		CSPReportOnly: true,
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	vals, ok := set["Content-Security-Policy-Report-Only"].([]any)
	if !ok {
		t.Fatal("Content-Security-Policy-Report-Only not found")
	}
	if vals[0].(string) != "default-src 'self'" {
		t.Errorf("CSP-Report-Only = %v, want default-src 'self'", vals[0])
	}
	if _, ok := set["Content-Security-Policy"]; ok {
		t.Error("Content-Security-Policy should not be present when CSPReportOnly is true")
	}
}

func TestCompiler_HSTSWithStandardPorts(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled: true,
		HSTS: config.HSTSConfig{
			Enabled:           true,
			MaxAge:            63072000,
			IncludeSubdomains: true,
		},
	}
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	vals, ok := set["Strict-Transport-Security"].([]any)
	if !ok {
		t.Fatal("Strict-Transport-Security not found")
	}
	if vals[0].(string) != "max-age=63072000; includeSubDomains" {
		t.Errorf("HSTS = %v, want max-age=63072000; includeSubDomains", vals[0])
	}
}

func TestCompiler_HSTSWithNonStandardPorts(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled: true,
		HSTS: config.HSTSConfig{
			Enabled:           true,
			MaxAge:            63072000,
			IncludeSubdomains: true,
		},
	}
	// Non-standard port -- HSTS should be suppressed.
	c := NewCompiler([]string{":8443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)

	// With only HSTS configured and non-standard ports, the headers handler
	// may still appear if other headers are set, or may be absent entirely.
	// Check that HSTS is not in the output.
	for _, h := range handlers {
		hm := h.(map[string]any)
		if hm["handler"].(string) == "headers" {
			response := hm["response"].(map[string]any)
			set := response["set"].(map[string]any)
			if _, ok := set["Strict-Transport-Security"]; ok {
				t.Error("HSTS should not be present on non-standard ports")
			}
		}
	}
}

func TestCompiler_HSTSDisabled(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		HSTS: config.HSTSConfig{
			Enabled: false,
		},
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	if _, ok := set["Strict-Transport-Security"]; ok {
		t.Error("HSTS should not be present when disabled")
	}
}

func TestCompiler_HSTSNoSubdomains(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled: true,
		HSTS: config.HSTSConfig{
			Enabled:           true,
			MaxAge:            31536000,
			IncludeSubdomains: false,
		},
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	vals := set["Strict-Transport-Security"].([]any)
	if vals[0].(string) != "max-age=31536000" {
		t.Errorf("HSTS = %v, want max-age=31536000 (no includeSubDomains)", vals[0])
	}
}

func TestCompiler_AllHeadersEmpty(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled:             true,
		XContentTypeOptions: "",
		XFrameOptions:       "",
		ReferrerPolicy:      "",
		PermissionsPolicy:   "",
		CSP:                 "",
		HSTS: config.HSTSConfig{
			Enabled: false,
		},
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)

	// When all headers are empty/disabled, no headers handler should be inserted.
	if len(handlers) != 3 {
		t.Fatalf("expected 3 handlers (no headers handler when all empty), got %d", len(handlers))
	}
	wantOrder := []string{"tracing", "vars", "reverse_proxy"}
	for i, want := range wantOrder {
		got := handlers[i].(map[string]any)["handler"].(string)
		if got != want {
			t.Errorf("handlers[%d].handler = %v, want %v", i, got, want)
		}
	}
}
```

- [ ] **Step 2: Run tests (expect failure -- method not implemented yet)**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/caddy/ -run "TestCompiler_SecurityHeaders|TestCompiler_HSTS|TestCompiler_AllHeaders"
```

- [ ] **Step 3: Implement buildSecurityHeadersHandler**

In `packages/daemon/internal/caddy/compiler.go`, add the following method:

```go
// buildSecurityHeadersHandler constructs a Caddy headers handler with the
// configured security response headers. Returns nil if security headers are
// disabled or all header values are empty (caller should skip insertion).
func (c *Compiler) buildSecurityHeadersHandler() map[string]any {
	cfg := c.securityHeaders
	if !cfg.Enabled {
		return nil
	}

	set := make(map[string][]string)

	if cfg.XContentTypeOptions != "" {
		set["X-Content-Type-Options"] = []string{cfg.XContentTypeOptions}
	}
	if cfg.XFrameOptions != "" {
		set["X-Frame-Options"] = []string{cfg.XFrameOptions}
	}
	if cfg.ReferrerPolicy != "" {
		set["Referrer-Policy"] = []string{cfg.ReferrerPolicy}
	}
	if cfg.PermissionsPolicy != "" {
		set["Permissions-Policy"] = []string{cfg.PermissionsPolicy}
	}

	// CSP: emit either enforcing or report-only header, not both.
	if cfg.CSP != "" {
		if cfg.CSPReportOnly {
			set["Content-Security-Policy-Report-Only"] = []string{cfg.CSP}
		} else {
			set["Content-Security-Policy"] = []string{cfg.CSP}
		}
	}

	// HSTS: only when enabled AND running on standard ports (or admin domain set).
	if cfg.HSTS.Enabled && c.hasStandardPorts() {
		hstsVal := fmt.Sprintf("max-age=%d", cfg.HSTS.MaxAge)
		if cfg.HSTS.IncludeSubdomains {
			hstsVal += "; includeSubDomains"
		}
		set["Strict-Transport-Security"] = []string{hstsVal}
	}

	// If no headers ended up in the set, return nil (skip insertion).
	if len(set) == 0 {
		return nil
	}

	return map[string]any{
		"handler": "headers",
		"response": map[string]any{
			"set": set,
		},
	}
}
```

- [ ] **Step 4: Run tests (still failing -- handler not yet inserted in CompileRoute)**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/caddy/ -run "TestCompiler_SecurityHeadersAllDefaults"
```

This should still fail because `CompileRoute` does not yet call `buildSecurityHeadersHandler` and insert it.

- [ ] **Step 5: Commit**

```
feat(compiler): implement buildSecurityHeadersHandler method
```

---

## Task 8: Insert security headers into CompileRoute

**Files:**
- Modify: `packages/daemon/internal/caddy/compiler.go`
- Modify: `packages/daemon/internal/caddy/compiler_test.go`

- [ ] **Step 1: Write admin exclusion test**

Add to `packages/daemon/internal/caddy/compiler_test.go`:

```go
func TestCompiler_SecurityHeadersNotOnAdmin(t *testing.T) {
	secHeaders := config.SecurityHeaders{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		XFrameOptions:       "DENY",
	}
	c := NewCompiler([]string{":443"}, AdminConfig{
		InternalAddr: "127.0.0.1:54321",
		ListenAddr:   ":7778",
	}, "", nil, secHeaders)

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	servers := dig(t, cfg, "apps", "http", "servers")
	admin := servers["admin"].(map[string]any)
	adminRoutes := admin["routes"].([]any)
	adminRoute := adminRoutes[0].(map[string]any)
	adminHandlers := adminRoute["handle"].([]any)

	// Admin block should only have reverse_proxy, no headers handler.
	for _, h := range adminHandlers {
		hm := h.(map[string]any)
		if hm["handler"].(string) == "headers" {
			t.Error("admin server block should NOT have a headers handler")
		}
	}
}
```

- [ ] **Step 2: Modify CompileRoute to insert security headers**

In `packages/daemon/internal/caddy/compiler.go`, in `CompileRoute`, change the handler chain construction from:

```go
	caddyRoute["handle"] = []map[string]any{tracingHandler, varsHandler, handler}
```

to:

```go
	// Build handler chain: tracing -> [security headers] -> vars -> reverse_proxy.
	// Security headers are only added to traffic routes (CompileRoute), not admin.
	handleChain := []map[string]any{tracingHandler}
	if secHandler := c.buildSecurityHeadersHandler(); secHandler != nil {
		handleChain = append(handleChain, secHandler)
	}
	handleChain = append(handleChain, varsHandler, handler)
	caddyRoute["handle"] = handleChain
```

- [ ] **Step 3: Run all security headers tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/caddy/ -run "TestCompiler_SecurityHeaders|TestCompiler_HSTS|TestCompiler_AllHeaders"
```

- [ ] **Step 4: Update existing tests that assert handler count**

With security headers having a zero-value `config.SecurityHeaders{}` (where `Enabled` is `false`), all existing tests pass `config.SecurityHeaders{}` which means `Enabled: false`, so `buildSecurityHeadersHandler` returns nil. The handler chain remains 3 elements. **No existing tests should need changes** if Task 6 correctly updated all call sites with `config.SecurityHeaders{}`.

Verify:

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/caddy/
```

If any existing tests fail due to handler chain length changes, it means their `NewCompiler` call uses a non-zero `SecurityHeaders`. Double-check all test call sites pass `config.SecurityHeaders{}` (which has `Enabled: false` by default).

- [ ] **Step 5: Commit**

```
feat(compiler): inject security headers into traffic routes
```

---

## Task 9: Combined test + full verification

**Files:**
- Modify: `packages/daemon/internal/caddy/compiler_test.go`

- [ ] **Step 1: Write combined feature test**

Add to `packages/daemon/internal/caddy/compiler_test.go`:

```go
func TestCompiler_ServiceWithHealthCheckAndTimeouts(t *testing.T) {
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, config.SecurityHeaders{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:   "svc1",
				Name: "backend",
				Upstreams: []*riokuv1.Upstream{
					{Id: "u1", Address: "10.0.0.1:8080"},
					{Id: "u2", Address: "10.0.0.2:8080"},
				},
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				HealthCheck: &riokuv1.HealthCheck{
					Enabled:         true,
					Path:            "/health",
					IntervalSeconds: 10,
					TimeoutSeconds:  5,
				},
				DialTimeoutSeconds:            5,
				ResponseHeaderTimeoutSeconds:  30,
				IdleTimeoutSeconds:            120,
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	route := routes[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any) // [0]=tracing, [1]=vars, [2]=reverse_proxy

	// Verify health checks are present.
	hcs, ok := handler["health_checks"].(map[string]any)
	if !ok {
		t.Fatal("expected health_checks block")
	}
	active := hcs["active"].(map[string]any)
	if active["path"].(string) != "/health" {
		t.Errorf("health_check path = %v, want /health", active["path"])
	}
	if active["interval"].(string) != "10s" {
		t.Errorf("health_check interval = %v, want 10s", active["interval"])
	}
	if active["timeout"].(string) != "5s" {
		t.Errorf("health_check timeout = %v, want 5s", active["timeout"])
	}

	// Verify transport block is present alongside health checks.
	transport, ok := handler["transport"].(map[string]any)
	if !ok {
		t.Fatal("expected transport block")
	}
	if transport["protocol"].(string) != "http" {
		t.Errorf("transport.protocol = %v, want http", transport["protocol"])
	}
	if transport["dial_timeout"].(string) != "5s" {
		t.Errorf("transport.dial_timeout = %v, want 5s", transport["dial_timeout"])
	}
	if transport["response_header_timeout"].(string) != "30s" {
		t.Errorf("transport.response_header_timeout = %v, want 30s", transport["response_header_timeout"])
	}

	keepAlive := transport["keep_alive"].(map[string]any)
	if keepAlive["idle_conn_timeout"].(string) != "120s" {
		t.Errorf("keep_alive.idle_conn_timeout = %v, want 120s", keepAlive["idle_conn_timeout"])
	}

	// Verify load balancing is also present (all three blocks coexist).
	lb, ok := handler["load_balancing"].(map[string]any)
	if !ok {
		t.Fatal("expected load_balancing block")
	}
	sp := lb["selection_policy"].(map[string]any)
	if sp["policy"].(string) != "round_robin" {
		t.Errorf("lb policy = %v, want round_robin", sp["policy"])
	}
}
```

- [ ] **Step 2: Run full test suites**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/caddy/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/store/sqlite/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/config/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/grpc/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/sync/
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./...
```

- [ ] **Step 3: Commit**

```
test(compiler): add combined health check + timeout verification test
```

---

## Summary of all files modified/created

### Created (6 migration files):
- `packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.up.sql`
- `packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.down.sql`
- `packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.up.sql`
- `packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.down.sql`
- `packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.up.sql`
- `packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.down.sql`

### Modified:
- `packages/proto/rioku/v1/config.proto` -- 3 new fields on Service
- `packages/daemon/internal/caddy/compiler.go` -- transport block, SecurityHeaders field, buildSecurityHeadersHandler, CompileRoute chain
- `packages/daemon/internal/caddy/compiler_test.go` -- 16 new test functions
- `packages/daemon/internal/config/file.go` -- SecurityHeaders/HSTSConfig structs, Config field, defaults
- `packages/daemon/internal/store/sqlite/sqlite.go` -- migration 5 registration, CreateService, UpdateService, scanService, GetService/ListServices queries
- `packages/daemon/internal/store/sqlite/sqlite_test.go` -- 4 new test functions, version check update
- `packages/daemon/internal/daemon/daemon.go` -- NewCompiler call sites updated
- `packages/daemon/internal/config/engine_test.go` -- NewCompiler call updated
- `packages/daemon/internal/config/engine_bench_test.go` -- NewCompiler call updated
- `packages/daemon/internal/config/engine_coverage_test.go` -- NewCompiler call updated
- `packages/daemon/internal/grpc/server_test.go` -- NewCompiler call updated
- `packages/daemon/internal/grpc/config_service_test.go` -- NewCompiler call updated
- `packages/daemon/internal/gateway/contract_test.go` -- NewCompiler call updated
- `packages/daemon/internal/gateway/gateway_lifecycle_test.go` -- NewCompiler calls updated
- `packages/daemon/internal/sync/agent_test.go` -- NewCompiler call updated

### Commits (9 total):
1. `feat(proto): add timeout fields to Service message`
2. `feat(store): add migration 000005 for service timeout columns`
3. `feat(store): wire service timeout fields in sqlite driver`
4. `feat(compiler): emit transport timeout block for services`
5. `feat(config): add SecurityHeaders config struct with defaults`
6. `refactor(compiler): accept SecurityHeaders in NewCompiler`
7. `feat(compiler): implement buildSecurityHeadersHandler method`
8. `feat(compiler): inject security headers into traffic routes`
9. `test(compiler): add combined health check + timeout verification test`
