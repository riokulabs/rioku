# Config Store Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix policyIds lifecycle, labels round-trip, deletion cleanup, and ImportConfig remapping in the config engine and store drivers.

**Architecture:** Four targeted fixes in the config engine (engine.go) and two store drivers (sqlite, raft). policyIds wiring happens at the engine layer via existing AttachPolicy/DetachPolicy/ListPoliciesByTarget methods. Labels fix is a one-line change in sqlite's unmarshalLabelsJSON. Deletion cleanup adds DELETE FROM policy_bindings in both drivers. ImportConfig gets policyID remapping and reordered entity creation.

**Tech Stack:** Go 1.24, SQLite, bbolt (raft), protobuf

**Working directory:** `packages/daemon`

**Spec:** `docs/superpowers/specs/2026-04-12-config-store-fixes.md`

**Key conventions:**
- Go standard library preferred, no external test libraries
- Table-driven tests, real databases for integration tests
- Handle every error explicitly, `-race` flag on all tests
- Conventional Commits required, no AI references in commits
- TDD: write test first, verify it fails, then implement

---

## Task 1: Fix unmarshalLabelsJSON (labels round-trip bug)

**Files:**
- Modify: `packages/daemon/internal/store/sqlite/sqlite.go`
- Modify: `packages/daemon/internal/store/sqlite/sqlite_test.go`

- [ ] **Step 1: Write failing test for labels round-trip**

Add the following test to `packages/daemon/internal/store/sqlite/sqlite_test.go`:

```go
func TestLabelsRoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tests := []struct {
		name       string
		labels     *riokuv1.Labels
		wantNil    bool
		wantLabels map[string]string
	}{
		{
			name:       "non-empty labels round-trip",
			labels:     &riokuv1.Labels{Labels: map[string]string{"env": "prod", "tier": "frontend"}},
			wantLabels: map[string]string{"env": "prod", "tier": "frontend"},
		},
		{
			name:       "empty labels returns non-nil empty map",
			labels:     nil,
			wantLabels: map[string]string{},
		},
		{
			name:       "explicit empty labels returns non-nil empty map",
			labels:     &riokuv1.Labels{Labels: map[string]string{}},
			wantLabels: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a service to reference from the route.
			txS, err := d.Begin(ctx, store.TxOptions{})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			svc, err := txS.CreateService(ctx, &riokuv1.Service{
				Name:     "labels-svc-" + tt.name,
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				Upstreams: []*riokuv1.Upstream{
					{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
				},
			})
			if err != nil {
				t.Fatalf("CreateService: %v", err)
			}
			if err := txS.Commit(); err != nil {
				t.Fatalf("Commit: %v", err)
			}

			// Create route with labels.
			tx1, err := d.Begin(ctx, store.TxOptions{})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			created, err := tx1.CreateRoute(ctx, &riokuv1.Route{
				Name:   "labels-route-" + tt.name,
				Labels: tt.labels,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"example.com"}},
				},
				Target:  &riokuv1.Route_ServiceId{ServiceId: svc.GetId()},
				Enabled: true,
			})
			if err != nil {
				t.Fatalf("CreateRoute: %v", err)
			}
			if err := tx1.Commit(); err != nil {
				t.Fatalf("Commit: %v", err)
			}

			// Read back.
			tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			got, err := tx2.GetRoute(ctx, created.GetId())
			if err != nil {
				t.Fatalf("GetRoute: %v", err)
			}
			_ = tx2.Rollback()

			// Verify labels.
			if got.GetLabels() == nil {
				t.Fatal("expected non-nil Labels, got nil")
			}
			gotMap := got.GetLabels().GetLabels()
			if gotMap == nil {
				t.Fatal("expected non-nil Labels.Labels map, got nil")
			}
			if len(gotMap) != len(tt.wantLabels) {
				t.Fatalf("expected %d label entries, got %d", len(tt.wantLabels), len(gotMap))
			}
			for k, wantV := range tt.wantLabels {
				if gotV, ok := gotMap[k]; !ok || gotV != wantV {
					t.Fatalf("expected label %q=%q, got %q", k, wantV, gotV)
				}
			}
		})
	}
}

func TestLabelsRoundTripService(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tests := []struct {
		name       string
		labels     *riokuv1.Labels
		wantLabels map[string]string
	}{
		{
			name:       "service non-empty labels",
			labels:     &riokuv1.Labels{Labels: map[string]string{"region": "us-east"}},
			wantLabels: map[string]string{"region": "us-east"},
		},
		{
			name:       "service nil labels returns non-nil empty map",
			labels:     nil,
			wantLabels: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx1, err := d.Begin(ctx, store.TxOptions{})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			created, err := tx1.CreateService(ctx, &riokuv1.Service{
				Name:     "labels-svc-" + tt.name,
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				Labels:   tt.labels,
				Upstreams: []*riokuv1.Upstream{
					{Address: "127.0.0.1:9090", Weight: 1, Healthy: true},
				},
			})
			if err != nil {
				t.Fatalf("CreateService: %v", err)
			}
			if err := tx1.Commit(); err != nil {
				t.Fatalf("Commit: %v", err)
			}

			tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			got, err := tx2.GetService(ctx, created.GetId())
			if err != nil {
				t.Fatalf("GetService: %v", err)
			}
			_ = tx2.Rollback()

			if got.GetLabels() == nil {
				t.Fatal("expected non-nil Labels, got nil")
			}
			gotMap := got.GetLabels().GetLabels()
			if gotMap == nil {
				t.Fatal("expected non-nil Labels.Labels map, got nil")
			}
			if len(gotMap) != len(tt.wantLabels) {
				t.Fatalf("expected %d label entries, got %d", len(tt.wantLabels), len(gotMap))
			}
			for k, wantV := range tt.wantLabels {
				if gotV, ok := gotMap[k]; !ok || gotV != wantV {
					t.Fatalf("expected label %q=%q, got %q", k, wantV, gotV)
				}
			}
		})
	}
}
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
cd packages/daemon && go test -race -v ./internal/store/sqlite/ -run TestLabelsRoundTrip
```

Expected: Tests fail with `expected non-nil Labels, got nil` for the empty-labels test cases.

- [ ] **Step 3: Fix `unmarshalLabelsJSON` in `sqlite.go`**

Replace the `unmarshalLabelsJSON` function at line 2070 of `packages/daemon/internal/store/sqlite/sqlite.go` with:

```go
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
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd packages/daemon && go test -race -v ./internal/store/sqlite/ -run TestLabelsRoundTrip
```

Expected: All label round-trip tests pass.

- [ ] **Step 5: Run full sqlite test suite to verify no regressions**

```bash
cd packages/daemon && go test -race -v ./internal/store/sqlite/...
```

Expected: All existing tests pass (TestRouteCRUD, TestServiceCRUD, TestPolicyCRUD, etc.).

- [ ] **Step 6: Commit**

```
fix: return non-nil empty Labels from unmarshalLabelsJSON in sqlite driver
```

---

## Task 2: Fix DeleteRoute/DeleteService cleanup (sqlite)

**Files:**
- Modify: `packages/daemon/internal/store/sqlite/sqlite.go`
- Modify: `packages/daemon/internal/store/sqlite/sqlite_test.go`

- [ ] **Step 1: Write failing tests for deletion cleanup**

Add the following tests to `packages/daemon/internal/store/sqlite/sqlite_test.go`:

```go
func TestDeleteRouteCleanupBindings(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a service for the route target.
	txS, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc, err := txS.CreateService(ctx, &riokuv1.Service{
		Name:     "cleanup-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := txS.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Create a policy.
	txP, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	pol, err := txP.CreatePolicy(ctx, &riokuv1.Policy{
		Name: "cleanup-policy",
		Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
	})
	if err != nil {
		t.Fatalf("CreatePolicy: %v", err)
	}
	if err := txP.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Create a route.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	route, err := tx1.CreateRoute(ctx, &riokuv1.Route{
		Name:    "cleanup-route",
		Enabled: true,
		Matchers: []*riokuv1.Matcher{
			{Hosts: []string{"example.com"}},
		},
		Target: &riokuv1.Route_ServiceId{ServiceId: svc.GetId()},
	})
	if err != nil {
		t.Fatalf("CreateRoute: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Attach policy to route.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx2.AttachPolicy(ctx, pol.GetId(), "route", route.GetId()); err != nil {
		t.Fatalf("AttachPolicy: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify binding exists.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ids, err := tx3.ListPoliciesByTarget(ctx, "route", route.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(ids) != 1 {
		t.Fatalf("expected 1 binding before delete, got %d", len(ids))
	}
	_ = tx3.Rollback()

	// Delete the route.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.DeleteRoute(ctx, route.GetId()); err != nil {
		t.Fatalf("DeleteRoute: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify binding is cleaned up.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ids, err = tx5.ListPoliciesByTarget(ctx, "route", route.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("expected 0 bindings after route delete, got %d", len(ids))
	}
	_ = tx5.Rollback()
}

func TestDeleteServiceCleanupBindings(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a policy.
	txP, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	pol, err := txP.CreatePolicy(ctx, &riokuv1.Policy{
		Name: "svc-cleanup-policy",
		Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
	})
	if err != nil {
		t.Fatalf("CreatePolicy: %v", err)
	}
	if err := txP.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Create a service.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:     "svc-cleanup-target",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:9090", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Attach policy to service.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx2.AttachPolicy(ctx, pol.GetId(), "service", svc.GetId()); err != nil {
		t.Fatalf("AttachPolicy: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify binding exists.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ids, err := tx3.ListPoliciesByTarget(ctx, "service", svc.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(ids) != 1 {
		t.Fatalf("expected 1 binding before delete, got %d", len(ids))
	}
	_ = tx3.Rollback()

	// Delete the service.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.DeleteService(ctx, svc.GetId()); err != nil {
		t.Fatalf("DeleteService: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify binding is cleaned up.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ids, err = tx5.ListPoliciesByTarget(ctx, "service", svc.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("expected 0 bindings after service delete, got %d", len(ids))
	}
	_ = tx5.Rollback()
}
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
cd packages/daemon && go test -race -v ./internal/store/sqlite/ -run "TestDelete.*CleanupBindings"
```

Expected: Tests fail with `expected 0 bindings after route delete, got 1` and `expected 0 bindings after service delete, got 1`.

- [ ] **Step 3: Fix `DeleteRoute` in `sqlite.go`**

Replace the `DeleteRoute` function at line 385 of `packages/daemon/internal/store/sqlite/sqlite.go` with:

```go
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
```

- [ ] **Step 4: Fix `DeleteService` in `sqlite.go`**

Replace the `DeleteService` function at line 580 of `packages/daemon/internal/store/sqlite/sqlite.go` with:

```go
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
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
cd packages/daemon && go test -race -v ./internal/store/sqlite/ -run "TestDelete.*CleanupBindings"
```

Expected: Both cleanup tests pass.

- [ ] **Step 6: Run full sqlite test suite to verify no regressions**

```bash
cd packages/daemon && go test -race -v ./internal/store/sqlite/...
```

Expected: All tests pass including the existing TestRouteCRUD, TestServiceCRUD, TestPolicyCRUD.

- [ ] **Step 7: Commit**

```
fix: clean up policy_bindings on route and service deletion in sqlite driver
```

---

## Task 3: Fix raft applyDelete/applyDeleteService cleanup

**Files:**
- Modify: `packages/daemon/internal/store/raft/fsm.go`
- Modify: `packages/daemon/internal/store/raft/fsm_test.go`

- [ ] **Step 1: Write failing tests for raft deletion cleanup**

Add the following tests to `packages/daemon/internal/store/raft/fsm_test.go`:

```go
func TestFSMApplyDeleteRouteCleanupBindings(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create a route.
	applyJSON(t, f, OpCreateRoute, putData{
		ID:   "route-cleanup",
		Data: json.RawMessage(`{"name":"cleanup-route"}`),
	})

	// Attach a policy binding to the route.
	result := applyJSON(t, f, OpAttachPolicy, policyBindingData{
		PolicyID:   "pol-1",
		TargetType: "route",
		TargetID:   "route-cleanup",
	})
	if result.Error != "" {
		t.Fatalf("attach policy error: %s", result.Error)
	}

	// Verify binding exists.
	key := bindingKey("pol-1", "route", "route-cleanup")
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicyBindings))
		if v := b.Get([]byte(key)); v == nil {
			t.Error("binding should exist before delete")
		}
		return nil
	})

	// Delete the route.
	result = applyJSON(t, f, OpDeleteRoute, deleteData{ID: "route-cleanup"})
	if result.Error != "" {
		t.Fatalf("delete route error: %s", result.Error)
	}

	// Verify binding is cleaned up.
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicyBindings))
		if v := b.Get([]byte(key)); v != nil {
			t.Error("binding should be cleaned up after route delete")
		}
		return nil
	})
}

func TestFSMApplyDeleteServiceCleanupBindings(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create a service.
	applyJSON(t, f, OpCreateService, serviceData{
		ID:   "svc-cleanup",
		Data: json.RawMessage(`{"name":"cleanup-svc"}`),
		Upstreams: []upstreamEntry{
			{ID: "up-cleanup", Data: json.RawMessage(`{"service_id":"svc-cleanup","address":"1.1.1.1:80"}`)},
		},
	})

	// Attach a policy binding to the service.
	result := applyJSON(t, f, OpAttachPolicy, policyBindingData{
		PolicyID:   "pol-2",
		TargetType: "service",
		TargetID:   "svc-cleanup",
	})
	if result.Error != "" {
		t.Fatalf("attach policy error: %s", result.Error)
	}

	// Verify binding exists.
	key := bindingKey("pol-2", "service", "svc-cleanup")
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicyBindings))
		if v := b.Get([]byte(key)); v == nil {
			t.Error("binding should exist before delete")
		}
		return nil
	})

	// Delete the service.
	result = applyJSON(t, f, OpDeleteService, deleteData{ID: "svc-cleanup"})
	if result.Error != "" {
		t.Fatalf("delete service error: %s", result.Error)
	}

	// Verify binding is cleaned up.
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicyBindings))
		if v := b.Get([]byte(key)); v != nil {
			t.Error("binding should be cleaned up after service delete")
		}
		return nil
	})

	// Verify upstream is also cleaned up (existing behavior).
	_ = f.view(func(tx *bolt.Tx) error {
		ub := tx.Bucket([]byte(bucketUpstreams))
		if v := ub.Get([]byte("up-cleanup")); v != nil {
			t.Error("upstream should be deleted with service")
		}
		return nil
	})
}
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
cd packages/daemon && go test -race -v ./internal/store/raft/ -run "TestFSMApplyDelete.*CleanupBindings"
```

Expected: Tests fail with `binding should be cleaned up after route delete` and `binding should be cleaned up after service delete`.

- [ ] **Step 3: Add `deleteBindingsForTarget` helper to `fsm.go`**

Add the following helper function to `packages/daemon/internal/store/raft/fsm.go`, near the existing `deleteUpstreamsForService` function (after line 344):

```go
func (f *fsm) deleteBindingsForTarget(pb *bolt.Bucket, targetType, targetID string) {
	c := pb.Cursor()
	var toDelete [][]byte
	for k, v := c.First(); k != nil; k, v = c.Next() {
		var entry policyBindingData
		if json.Unmarshal(v, &entry) == nil && entry.TargetType == targetType && entry.TargetID == targetID {
			toDelete = append(toDelete, append([]byte{}, k...))
		}
	}
	for _, k := range toDelete {
		_ = pb.Delete(k)
	}
}
```

- [ ] **Step 4: Modify `applyDelete` for routes in `fsm.go`**

Replace the `applyDelete` function at line 226 of `packages/daemon/internal/store/raft/fsm.go` with:

```go
func (f *fsm) applyDelete(tx *bolt.Tx, bucket string, cmd Command) (*CommandResult, error) {
	var dd deleteData
	if err := json.Unmarshal(cmd.Data, &dd); err != nil {
		return nil, fmt.Errorf("unmarshal delete data: %w", err)
	}
	b := tx.Bucket([]byte(bucket))

	// Check existence.
	if v := b.Get([]byte(dd.ID)); v == nil {
		return &CommandResult{Error: fmt.Sprintf("%s %q not found", bucket, dd.ID)}, nil
	}

	if err := b.Delete([]byte(dd.ID)); err != nil {
		return nil, fmt.Errorf("delete %s/%s: %w", bucket, dd.ID, err)
	}

	// Clean up policy bindings for deleted entity.
	// Determine target type from bucket name.
	if bucket == bucketRoutes {
		pb := tx.Bucket([]byte(bucketPolicyBindings))
		f.deleteBindingsForTarget(pb, "route", dd.ID)
	}

	f.emitEvent(bucket, dd.ID, "DELETE")
	return &CommandResult{}, nil
}
```

- [ ] **Step 5: Modify `applyDeleteService` in `fsm.go`**

Replace the `applyDeleteService` function at line 308 of `packages/daemon/internal/store/raft/fsm.go` with:

```go
func (f *fsm) applyDeleteService(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var dd deleteData
	if err := json.Unmarshal(cmd.Data, &dd); err != nil {
		return nil, fmt.Errorf("unmarshal delete data: %w", err)
	}
	b := tx.Bucket([]byte(bucketServices))
	if v := b.Get([]byte(dd.ID)); v == nil {
		return &CommandResult{Error: fmt.Sprintf("service %q not found", dd.ID)}, nil
	}
	if err := b.Delete([]byte(dd.ID)); err != nil {
		return nil, fmt.Errorf("delete service: %w", err)
	}

	// Delete associated upstreams.
	ub := tx.Bucket([]byte(bucketUpstreams))
	f.deleteUpstreamsForService(ub, dd.ID)

	// Clean up policy bindings for deleted service.
	pb := tx.Bucket([]byte(bucketPolicyBindings))
	f.deleteBindingsForTarget(pb, "service", dd.ID)

	f.emitEvent(bucketServices, dd.ID, "DELETE")
	return &CommandResult{}, nil
}
```

- [ ] **Step 6: Run tests and verify they pass**

```bash
cd packages/daemon && go test -race -v ./internal/store/raft/ -run "TestFSMApplyDelete.*CleanupBindings"
```

Expected: Both cleanup tests pass.

- [ ] **Step 7: Run full raft test suite to verify no regressions**

```bash
cd packages/daemon && go test -race -v ./internal/store/raft/...
```

Expected: All existing tests pass (TestFSMApplyDeleteRoute, TestFSMApplyDeleteService, TestFSMApplyAttachDetachPolicy, etc.).

- [ ] **Step 8: Commit**

```
fix: clean up policy_bindings on route and service deletion in raft FSM
```

---

## Task 4: Wire policyIds in applyRouteOp (engine write path)

**Files:**
- Modify: `packages/daemon/internal/config/engine.go`
- Modify: `packages/daemon/internal/config/engine_test.go`

- [ ] **Step 1: Write failing tests for policyIds lifecycle**

Add the following tests to `packages/daemon/internal/config/engine_test.go`:

```go
func TestPolicyIdsCreateRoute(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service for the route target.
	applyService(t, eng, "policy-ids-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create two policies.
	cfg1, _ := structpb.NewStruct(map[string]any{"rps": 100})
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name:   "pol-a",
					Type:   riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
					Config: cfg1,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-a: %v", err)
	}

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "pol-b",
					Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-b: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Policies) != 2 {
		t.Fatalf("expected 2 policies, got %d", len(snap.Policies))
	}
	polAID := snap.Policies[0].Id
	polBID := snap.Policies[1].Id

	// Create a route with policyIds.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "policy-ids-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polAID, polBID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route: %v", err)
	}

	// Read back and verify policyIds.
	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(snap.Routes))
	}
	route := snap.Routes[0]
	if len(route.PolicyIds) != 2 {
		t.Fatalf("expected 2 policyIds on route, got %d: %v", len(route.PolicyIds), route.PolicyIds)
	}

	// Verify both policy IDs are present (order may vary).
	policySet := make(map[string]bool)
	for _, id := range route.PolicyIds {
		policySet[id] = true
	}
	if !policySet[polAID] {
		t.Fatalf("expected polAID %q in policyIds", polAID)
	}
	if !policySet[polBID] {
		t.Fatalf("expected polBID %q in policyIds", polBID)
	}
}

func TestPolicyIdsUpdateRoute(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service.
	applyService(t, eng, "upd-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create two policies.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "upd-pol-a",
					Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-a: %v", err)
	}
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "upd-pol-b",
					Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-b: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	polAID := snap.Policies[0].Id
	polBID := snap.Policies[1].Id

	// Create route with polA only.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "upd-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polAID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange create route: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	routeID := snap.Routes[0].Id
	if len(snap.Routes[0].PolicyIds) != 1 {
		t.Fatalf("expected 1 policyId after create, got %d", len(snap.Routes[0].PolicyIds))
	}

	// Update: replace polA with polB.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Id:      routeID,
					Name:    "upd-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polBID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange update route: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Routes[0].PolicyIds) != 1 {
		t.Fatalf("expected 1 policyId after update, got %d", len(snap.Routes[0].PolicyIds))
	}
	if snap.Routes[0].PolicyIds[0] != polBID {
		t.Fatalf("expected policyId %q, got %q", polBID, snap.Routes[0].PolicyIds[0])
	}
}

func TestPolicyIdsRemoveAll(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service.
	applyService(t, eng, "rm-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create a policy.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "rm-pol",
					Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	polID := snap.Policies[0].Id

	// Create route with policy.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "rm-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange create route: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	routeID := snap.Routes[0].Id
	if len(snap.Routes[0].PolicyIds) != 1 {
		t.Fatalf("expected 1 policyId, got %d", len(snap.Routes[0].PolicyIds))
	}

	// Update route with empty policyIds.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Id:      routeID,
					Name:    "rm-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: nil,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange update route empty policies: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Routes[0].PolicyIds) != 0 {
		t.Fatalf("expected 0 policyIds after removal, got %d: %v", len(snap.Routes[0].PolicyIds), snap.Routes[0].PolicyIds)
	}
}
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
cd packages/daemon && go test -race -v ./internal/config/ -run "TestPolicyIds"
```

Expected: Tests fail with `expected 2 policyIds on route, got 0` (the create test) because `applyRouteOp` does not call `AttachPolicy`, and `buildSnapshot` does not enrich `PolicyIds`.

- [ ] **Step 3: Add `syncRoutePolicyIds` helper to `engine.go`**

Add the following helper function to `packages/daemon/internal/config/engine.go`, after the `applyRouteOp` function (after line 499):

```go
// syncRoutePolicyIds synchronizes the policy_bindings junction table for a
// route. It computes the diff between the desired policy IDs (from the incoming
// route proto) and the current bindings, then calls AttachPolicy for additions
// and DetachPolicy for removals.
func syncRoutePolicyIds(ctx context.Context, tx store.Tx, routeID string, desired []string) error {
	current, err := tx.ListPoliciesByTarget(ctx, "route", routeID)
	if err != nil {
		return fmt.Errorf("config: list current policyIds: %w", err)
	}

	currentSet := make(map[string]bool, len(current))
	for _, id := range current {
		currentSet[id] = true
	}
	desiredSet := make(map[string]bool, len(desired))
	for _, id := range desired {
		desiredSet[id] = true
	}

	// Attach new bindings.
	for _, id := range desired {
		if !currentSet[id] {
			if err := tx.AttachPolicy(ctx, id, "route", routeID); err != nil {
				return fmt.Errorf("config: attach policy %q to route %q: %w", id, routeID, err)
			}
		}
	}

	// Detach removed bindings.
	for _, id := range current {
		if !desiredSet[id] {
			if err := tx.DetachPolicy(ctx, id, "route", routeID); err != nil {
				return fmt.Errorf("config: detach policy %q from route %q: %w", id, routeID, err)
			}
		}
	}

	return nil
}
```

- [ ] **Step 4: Modify `applyRouteOp` to call `syncRoutePolicyIds`**

Replace the `applyRouteOp` function at line 458 of `packages/daemon/internal/config/engine.go` with:

```go
func applyRouteOp(ctx context.Context, tx store.Tx, op *riokuv1.RouteOp) (string, string, error) {
	switch op.GetAction() {
	case riokuv1.RouteOp_UPSERT:
		route := op.GetRoute()
		if route == nil {
			return "", "", fmt.Errorf("config: route upsert: route is nil")
		}
		if id := route.GetId(); id != "" {
			// Try to update existing.
			existing, _ := tx.GetRoute(ctx, id)
			if existing != nil {
				updated, err := tx.UpdateRoute(ctx, route)
				if err != nil {
					return "", "", fmt.Errorf("config: update route: %w", err)
				}
				// Sync policy bindings.
				if err := syncRoutePolicyIds(ctx, tx, updated.GetId(), route.GetPolicyIds()); err != nil {
					return "", "", err
				}
				return updated.GetId(), "UPDATE", nil
			}
		}
		// Create new.
		created, err := tx.CreateRoute(ctx, route)
		if err != nil {
			return "", "", fmt.Errorf("config: create route: %w", err)
		}
		// Sync policy bindings.
		if err := syncRoutePolicyIds(ctx, tx, created.GetId(), route.GetPolicyIds()); err != nil {
			return "", "", err
		}
		return created.GetId(), "CREATE", nil

	case riokuv1.RouteOp_DELETE:
		id := op.GetId()
		if id == "" && op.GetRoute() != nil {
			id = op.GetRoute().GetId()
		}
		if id == "" {
			return "", "", fmt.Errorf("config: delete route: id is required")
		}
		if err := tx.DeleteRoute(ctx, id); err != nil {
			return "", "", fmt.Errorf("config: delete route: %w", err)
		}
		return id, "DELETE", nil

	default:
		return "", "", fmt.Errorf("config: unknown route action %v", op.GetAction())
	}
}
```

- [ ] **Step 5: Run the policyIds tests (they will still fail because buildSnapshot doesn't enrich)**

```bash
cd packages/daemon && go test -race -v ./internal/config/ -run "TestPolicyIdsCreateRoute"
```

Expected: Still fails because `buildSnapshot` does not populate `PolicyIds` on routes. The write path now works but the read path does not. This is expected -- Task 5 will fix the read path.

- [ ] **Step 6: Commit (partial -- write path only)**

Do not commit yet. Task 5 will complete the feature and we commit both tasks together.

---

## Task 5: Enrich policyIds in buildSnapshot (engine read path)

**Files:**
- Modify: `packages/daemon/internal/config/engine.go`

- [ ] **Step 1: Modify `buildSnapshot` to enrich policyIds**

Replace the `buildSnapshot` function at line 424 of `packages/daemon/internal/config/engine.go` with:

```go
func buildSnapshot(ctx context.Context, tx store.Tx) (*riokuv1.ConfigSnapshot, error) {
	routes, err := tx.ListRoutes(ctx)
	if err != nil {
		return nil, fmt.Errorf("config: list routes: %w", err)
	}
	services, err := tx.ListServices(ctx)
	if err != nil {
		return nil, fmt.Errorf("config: list services: %w", err)
	}
	policies, err := tx.ListPolicies(ctx)
	if err != nil {
		return nil, fmt.Errorf("config: list policies: %w", err)
	}
	version, err := tx.LatestConfigVersion(ctx)
	if err != nil {
		return nil, fmt.Errorf("config: latest version: %w", err)
	}

	// Enrich routes with their attached policy IDs.
	for _, route := range routes {
		policyIDs, err := tx.ListPoliciesByTarget(ctx, "route", route.GetId())
		if err != nil {
			return nil, fmt.Errorf("config: list policyIds for route %q: %w", route.GetId(), err)
		}
		route.PolicyIds = policyIDs
	}

	return &riokuv1.ConfigSnapshot{
		Version:    version,
		Routes:     routes,
		Services:   services,
		Policies:   policies,
		SnapshotAt: timestamppb.Now(),
	}, nil
}
```

- [ ] **Step 2: Run all policyIds tests and verify they pass**

```bash
cd packages/daemon && go test -race -v ./internal/config/ -run "TestPolicyIds"
```

Expected: All three tests pass -- `TestPolicyIdsCreateRoute`, `TestPolicyIdsUpdateRoute`, `TestPolicyIdsRemoveAll`.

- [ ] **Step 3: Run full config engine test suite to verify no regressions**

```bash
cd packages/daemon && go test -race -v ./internal/config/...
```

Expected: All existing tests pass (TestApplyServiceChange, TestApplyRouteChange, TestApplyPolicyChange, TestApplyDeleteChange, TestOptimisticLocking, TestValidation, TestAuditLog, TestImportExport, TestCompileCaddyConfig).

- [ ] **Step 4: Commit Tasks 4 and 5 together**

```
feat: wire policyIds lifecycle in config engine (write + read paths)
```

---

## Task 6: Fix ImportConfig policyId remapping

**Files:**
- Modify: `packages/daemon/internal/config/engine.go`
- Modify: `packages/daemon/internal/config/engine_test.go`

- [ ] **Step 1: Write failing test for ImportConfig with policyIds**

Add the following test to `packages/daemon/internal/config/engine_test.go`:

```go
func TestImportConfigPolicyIdRemapping(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create entities in the source engine.
	applyService(t, eng, "import-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create two policies.
	cfg1, _ := structpb.NewStruct(map[string]any{"rps": 50})
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name:   "import-pol-a",
					Type:   riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
					Config: cfg1,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-a: %v", err)
	}

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "import-pol-b",
					Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-b: %v", err)
	}

	// Create a route with both policyIds.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "import-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"import.example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route: %v", err)
	}

	// Manually get the policy IDs and attach them to the route.
	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	polAID := ""
	polBID := ""
	for _, p := range snap.Policies {
		if p.Name == "import-pol-a" {
			polAID = p.Id
		}
		if p.Name == "import-pol-b" {
			polBID = p.Id
		}
	}

	routeID := snap.Routes[0].Id
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Id:      routeID,
					Name:    "import-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"import.example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polAID, polBID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange update route with policies: %v", err)
	}

	// Export the snapshot.
	exported, err := eng.ExportConfig(ctx)
	if err != nil {
		t.Fatalf("ExportConfig: %v", err)
	}

	// Verify the exported snapshot has policyIds.
	if len(exported.Routes) != 1 {
		t.Fatalf("expected 1 route in export, got %d", len(exported.Routes))
	}
	if len(exported.Routes[0].PolicyIds) != 2 {
		t.Fatalf("expected 2 policyIds in exported route, got %d", len(exported.Routes[0].PolicyIds))
	}

	// Import into a fresh engine.
	eng2 := newTestEngine(t)

	result, err := eng2.ImportConfig(ctx, exported, "import-actor")
	if err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	if result.RoutesImported != 1 {
		t.Fatalf("expected 1 route imported, got %d", result.RoutesImported)
	}
	if result.ServicesImported != 1 {
		t.Fatalf("expected 1 service imported, got %d", result.ServicesImported)
	}
	if result.PoliciesImported != 2 {
		t.Fatalf("expected 2 policies imported, got %d", result.PoliciesImported)
	}

	// Verify imported config has policyIds on the route.
	imported, err := eng2.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after import: %v", err)
	}
	if len(imported.Routes) != 1 {
		t.Fatalf("expected 1 route after import, got %d", len(imported.Routes))
	}
	if len(imported.Routes[0].PolicyIds) != 2 {
		t.Fatalf("expected 2 policyIds after import, got %d: %v", len(imported.Routes[0].PolicyIds), imported.Routes[0].PolicyIds)
	}

	// Verify the imported policyIds reference the NEW policy IDs (not old ones).
	importedPolIDs := make(map[string]bool)
	for _, p := range imported.Policies {
		importedPolIDs[p.Id] = true
	}
	for _, pid := range imported.Routes[0].PolicyIds {
		if !importedPolIDs[pid] {
			t.Fatalf("imported route policyId %q does not reference an imported policy", pid)
		}
	}

	// Verify names survived.
	polNames := make(map[string]bool)
	for _, p := range imported.Policies {
		polNames[p.Name] = true
	}
	if !polNames["import-pol-a"] {
		t.Fatal("expected import-pol-a in imported policies")
	}
	if !polNames["import-pol-b"] {
		t.Fatal("expected import-pol-b in imported policies")
	}
}
```

- [ ] **Step 2: Run test and verify it fails**

```bash
cd packages/daemon && go test -race -v ./internal/config/ -run TestImportConfigPolicyIdRemapping
```

Expected: Fails with `expected 2 policyIds after import, got 0` because ImportConfig does not remap or recreate policy bindings.

- [ ] **Step 3: Modify `ImportConfig` in `engine.go`**

Replace the `ImportConfig` function at line 303 of `packages/daemon/internal/config/engine.go` with:

```go
func (e *Engine) ImportConfig(ctx context.Context, snapshot *riokuv1.ConfigSnapshot, actor string) (*riokuv1.ImportResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	tx, err := e.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("config: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Delete all existing entities.
	if err := deleteAll(ctx, tx); err != nil {
		return nil, err
	}

	// Create all entities from snapshot. Order matters:
	// 1. Services first (routes reference them via service_id)
	// 2. Policies second (routes reference them via policy_ids)
	// 3. Routes last (with remapped service_id and policy_ids)
	var routeCount, serviceCount, policyCount int32
	svcIDMap := make(map[string]string)    // old ID -> new ID
	policyIDMap := make(map[string]string)  // old ID -> new ID

	for _, svc := range snapshot.GetServices() {
		oldID := svc.GetId()
		created, err := tx.CreateService(ctx, svc)
		if err != nil {
			return nil, fmt.Errorf("config: import service %q: %w", svc.GetName(), err)
		}
		if oldID != "" {
			svcIDMap[oldID] = created.GetId()
		}
		serviceCount++
	}

	for _, pol := range snapshot.GetPolicies() {
		oldID := pol.GetId()
		created, err := tx.CreatePolicy(ctx, pol)
		if err != nil {
			return nil, fmt.Errorf("config: import policy %q: %w", pol.GetName(), err)
		}
		if oldID != "" {
			policyIDMap[oldID] = created.GetId()
		}
		policyCount++
	}

	for _, route := range snapshot.GetRoutes() {
		// Remap service_id if the route targets a service.
		if oldSvcID := route.GetServiceId(); oldSvcID != "" {
			if newSvcID, ok := svcIDMap[oldSvcID]; ok {
				route.Target = &riokuv1.Route_ServiceId{ServiceId: newSvcID}
			}
		}

		// Capture the original policy IDs before creating the route.
		oldPolicyIDs := route.GetPolicyIds()

		created, err := tx.CreateRoute(ctx, route)
		if err != nil {
			return nil, fmt.Errorf("config: import route %q: %w", route.GetName(), err)
		}

		// Remap and attach policy bindings.
		for _, oldPolID := range oldPolicyIDs {
			newPolID := oldPolID
			if mapped, ok := policyIDMap[oldPolID]; ok {
				newPolID = mapped
			}
			if err := tx.AttachPolicy(ctx, newPolID, "route", created.GetId()); err != nil {
				return nil, fmt.Errorf("config: import attach policy %q to route %q: %w", newPolID, created.GetName(), err)
			}
		}

		routeCount++
	}

	// Build new snapshot and save version.
	newSnap, err := buildSnapshot(ctx, tx)
	if err != nil {
		return nil, err
	}
	snapJSON, err := protojson.Marshal(newSnap)
	if err != nil {
		return nil, fmt.Errorf("config: marshal snapshot: %w", err)
	}
	version, err := tx.SaveConfigVersion(ctx, snapJSON, actor)
	if err != nil {
		return nil, fmt.Errorf("config: save version: %w", err)
	}

	now := timestamppb.Now()
	auditEntry := &riokuv1.AuditEntry{
		Id:            uuid.New().String(),
		Actor:         actor,
		EntityType:    "config",
		EntityId:      "import",
		Operation:     "IMPORT",
		ConfigVersion: version,
		OccurredAt:    now,
	}
	if err := tx.AppendAuditEntry(ctx, auditEntry); err != nil {
		return nil, fmt.Errorf("config: audit entry: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("config: commit tx: %w", err)
	}

	return &riokuv1.ImportResult{
		Meta: &riokuv1.MutationMeta{
			ConfigVersion: version,
			Actor:         actor,
			MutatedAt:     now,
		},
		RoutesImported:   routeCount,
		ServicesImported: serviceCount,
		PoliciesImported: policyCount,
	}, nil
}
```

- [ ] **Step 4: Run the import test and verify it passes**

```bash
cd packages/daemon && go test -race -v ./internal/config/ -run TestImportConfigPolicyIdRemapping
```

Expected: Test passes.

- [ ] **Step 5: Run full config engine test suite to verify no regressions**

```bash
cd packages/daemon && go test -race -v ./internal/config/...
```

Expected: All tests pass, including the existing `TestImportExport` and all new policyIds tests.

- [ ] **Step 6: Commit**

```
fix: remap policyIds and reorder entity creation in ImportConfig
```

---

## Task 7: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all config engine tests**

```bash
cd packages/daemon && go test -race -v ./internal/config/...
```

Expected output includes PASS for all of:
- `TestApplyServiceChange`
- `TestApplyRouteChange`
- `TestApplyPolicyChange`
- `TestApplyDeleteChange`
- `TestOptimisticLocking`
- `TestValidation`
- `TestAuditLog`
- `TestImportExport`
- `TestCompileCaddyConfig`
- `TestPolicyIdsCreateRoute`
- `TestPolicyIdsUpdateRoute`
- `TestPolicyIdsRemoveAll`
- `TestImportConfigPolicyIdRemapping`

- [ ] **Step 2: Run all sqlite store tests**

```bash
cd packages/daemon && go test -race -v ./internal/store/sqlite/...
```

Expected output includes PASS for all of:
- `TestOpen`
- `TestRouteCRUD`
- `TestServiceCRUD`
- `TestPolicyCRUD`
- `TestAPIKeyCRUD`
- `TestLabelsRoundTrip`
- `TestLabelsRoundTripService`
- `TestDeleteRouteCleanupBindings`
- `TestDeleteServiceCleanupBindings`
- (plus all other existing tests)

- [ ] **Step 3: Run all raft store tests**

```bash
cd packages/daemon && go test -race -v ./internal/store/raft/...
```

Expected output includes PASS for all of:
- `TestBindingKey`
- `TestOpToString`
- `TestWriteFile`
- `TestEncodeCommand`
- `TestFSMApplyCreateAndGetRoute`
- `TestFSMApplyUpdateRoute`
- `TestFSMApplyDeleteRoute`
- `TestFSMApplyDeleteRouteNotFound`
- `TestFSMApplyCreateService`
- `TestFSMApplyUpdateService`
- `TestFSMApplyDeleteService`
- `TestFSMApplyDeleteServiceNotFound`
- `TestFSMApplyPolicyCreateAndDelete`
- `TestFSMApplyAttachDetachPolicy`
- `TestFSMApplyDetachPolicyNotFound`
- `TestFSMApplyDeleteRouteCleanupBindings`
- `TestFSMApplyDeleteServiceCleanupBindings`
- (plus all other existing tests)

- [ ] **Step 4: Run all three packages together**

```bash
cd packages/daemon && go test -race ./internal/config/... ./internal/store/sqlite/... ./internal/store/raft/...
```

Expected: `ok` for all three packages with zero failures.

---

## Summary of Changes

| File | Change | Bug Fixed |
|------|--------|-----------|
| `internal/store/sqlite/sqlite.go` | `unmarshalLabelsJSON`: return non-nil empty `Labels` | Labels nil on read |
| `internal/store/sqlite/sqlite.go` | `DeleteRoute`: add `DELETE FROM policy_bindings` | Deletion orphans (sqlite) |
| `internal/store/sqlite/sqlite.go` | `DeleteService`: add `DELETE FROM policy_bindings` | Deletion orphans (sqlite) |
| `internal/store/raft/fsm.go` | `applyDelete`: add `deleteBindingsForTarget` for routes | Deletion orphans (raft) |
| `internal/store/raft/fsm.go` | `applyDeleteService`: add `deleteBindingsForTarget` | Deletion orphans (raft) |
| `internal/store/raft/fsm.go` | New `deleteBindingsForTarget` helper | Deletion orphans (raft) |
| `internal/config/engine.go` | `applyRouteOp`: call `syncRoutePolicyIds` after create/update | policyIds dropped on write |
| `internal/config/engine.go` | New `syncRoutePolicyIds` helper | policyIds dropped on write |
| `internal/config/engine.go` | `buildSnapshot`: enrich routes with `ListPoliciesByTarget` | policyIds dropped on read |
| `internal/config/engine.go` | `ImportConfig`: add `policyIDMap`, reorder to svc->pol->route, call `AttachPolicy` | Import policyIds lost |
| `internal/store/sqlite/sqlite_test.go` | 4 new tests | Test coverage |
| `internal/config/engine_test.go` | 4 new tests | Test coverage |
| `internal/store/raft/fsm_test.go` | 2 new tests | Test coverage |

## Commit History (expected)

1. `fix: return non-nil empty Labels from unmarshalLabelsJSON in sqlite driver`
2. `fix: clean up policy_bindings on route and service deletion in sqlite driver`
3. `fix: clean up policy_bindings on route and service deletion in raft FSM`
4. `feat: wire policyIds lifecycle in config engine (write + read paths)`
5. `fix: remap policyIds and reorder entity creation in ImportConfig`
