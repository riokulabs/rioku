package raft

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	bolt "go.etcd.io/bbolt"

	"github.com/riokulabs/rioku/internal/store"
)

// TestUpstreamIndexListServices creates 100 services × 3 upstreams,
// runs ListServices, asserts each service has its upstreams attached,
// then deletes one upstream (via UpdateService with one fewer upstream)
// and re-runs ListServices to verify the index updates.
func TestUpstreamIndexListServices(t *testing.T) {
	node, cleanup := singleNode(t)
	defer cleanup()

	ctx := context.Background()

	type seeded struct {
		id        string
		upstreams []string // upstream IDs
	}
	want := make([]seeded, 0, 100)

	// Seed 100 services × 3 upstreams.
	for i := 0; i < 100; i++ {
		tx, err := node.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("begin tx %d: %v", i, err)
		}
		svc, err := tx.CreateService(ctx, &riokuv1.Service{
			Name: fmt.Sprintf("svc-%d", i),
			Upstreams: []*riokuv1.Upstream{
				{Address: fmt.Sprintf("10.0.%d.1:80", i), Weight: 10},
				{Address: fmt.Sprintf("10.0.%d.2:80", i), Weight: 20},
				{Address: fmt.Sprintf("10.0.%d.3:80", i), Weight: 30},
			},
		})
		if err != nil {
			t.Fatalf("create service %d: %v", i, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit %d: %v", i, err)
		}
		ups := make([]string, 0, len(svc.GetUpstreams()))
		for _, u := range svc.GetUpstreams() {
			ups = append(ups, u.GetId())
		}
		want = append(want, seeded{id: svc.GetId(), upstreams: ups})
	}

	// ListServices and verify each service has 3 upstreams.
	rtx, err := node.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin read tx: %v", err)
	}
	services, err := rtx.ListServices(ctx)
	if err != nil {
		t.Fatalf("list services: %v", err)
	}
	_ = rtx.Rollback()

	if len(services) != 100 {
		t.Fatalf("ListServices returned %d, want 100", len(services))
	}
	for _, s := range services {
		if got := len(s.GetUpstreams()); got != 3 {
			t.Errorf("service %q: %d upstreams, want 3", s.GetName(), got)
		}
	}

	// Verify the index bucket has exactly 300 entries (100 services × 3).
	if err := node.fsm.view(func(tx *bolt.Tx) error {
		idx := tx.Bucket([]byte(bucketUpstreamsByService))
		stats := idx.Stats()
		if stats.KeyN != 300 {
			t.Errorf("index bucket KeyN = %d, want 300", stats.KeyN)
		}
		return nil
	}); err != nil {
		t.Fatalf("view index: %v", err)
	}

	// Pick the first service, drop one of its upstreams via UpdateService,
	// and verify ListServices reflects the new count.
	target := want[0]
	gtx, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
	svc, err := gtx.GetService(ctx, target.id)
	if err != nil {
		t.Fatalf("get service: %v", err)
	}
	_ = gtx.Rollback()

	// Reduce to 2 upstreams, preserving IDs so the remaining ones aren't
	// re-issued. UpdateService deletes the old set + index entries and
	// inserts the new set, so the dropped upstream's index entry must be
	// gone after commit.
	if len(svc.GetUpstreams()) < 3 {
		t.Fatalf("service has %d upstreams; expected at least 3", len(svc.GetUpstreams()))
	}
	svc.Upstreams = svc.Upstreams[:2]

	utx, _ := node.Begin(ctx, store.TxOptions{})
	if _, err := utx.UpdateService(ctx, svc); err != nil {
		t.Fatalf("update service: %v", err)
	}
	if err := utx.Commit(); err != nil {
		t.Fatalf("commit update: %v", err)
	}

	// Re-list and confirm only 2 upstreams come back for the target service.
	rtx2, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
	services2, err := rtx2.ListServices(ctx)
	if err != nil {
		t.Fatalf("list services: %v", err)
	}
	_ = rtx2.Rollback()

	var found *riokuv1.Service
	for _, s := range services2 {
		if s.GetId() == target.id {
			found = s
			break
		}
	}
	if found == nil {
		t.Fatalf("target service %q missing from ListServices", target.id)
	}
	if got := len(found.GetUpstreams()); got != 2 {
		t.Errorf("after delete: target service has %d upstreams, want 2", got)
	}

	// Index bucket should now have 299 entries (300 - 1).
	if err := node.fsm.view(func(tx *bolt.Tx) error {
		idx := tx.Bucket([]byte(bucketUpstreamsByService))
		stats := idx.Stats()
		if stats.KeyN != 299 {
			t.Errorf("index bucket KeyN after update = %d, want 299", stats.KeyN)
		}
		return nil
	}); err != nil {
		t.Fatalf("view index: %v", err)
	}
}

// TestUpstreamIndexMigrationShim exercises rebuildUpstreamIndex on a db
// that has upstream payloads but no (or stale) index entries — the case
// when an existing install boots after the index was added.
func TestUpstreamIndexMigrationShim(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Seed two services + 5 upstreams via the FSM apply path so the index
	// is populated normally.
	svcA := "svc-A"
	svcB := "svc-B"
	upA := []upstreamEntry{
		{ID: "u-a1", Data: mustMarshalUpstream(t, svcA, "u-a1", "10.0.0.1:80")},
		{ID: "u-a2", Data: mustMarshalUpstream(t, svcA, "u-a2", "10.0.0.2:80")},
		{ID: "u-a3", Data: mustMarshalUpstream(t, svcA, "u-a3", "10.0.0.3:80")},
	}
	upB := []upstreamEntry{
		{ID: "u-b1", Data: mustMarshalUpstream(t, svcB, "u-b1", "10.0.1.1:80")},
		{ID: "u-b2", Data: mustMarshalUpstream(t, svcB, "u-b2", "10.0.1.2:80")},
	}
	applyJSON(t, f, OpCreateService, serviceData{ID: svcA, Data: json.RawMessage(`{"id":"svc-A","name":"A"}`), Upstreams: upA})
	applyJSON(t, f, OpCreateService, serviceData{ID: svcB, Data: json.RawMessage(`{"id":"svc-B","name":"B"}`), Upstreams: upB})

	// Sanity-check: index has 5 entries.
	if err := f.view(func(tx *bolt.Tx) error {
		idx := tx.Bucket([]byte(bucketUpstreamsByService))
		if got := idx.Stats().KeyN; got != 5 {
			t.Errorf("pre-drop index KeyN = %d, want 5", got)
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}

	// Simulate a legacy db: drop the index bucket entirely.
	if err := f.db.Update(func(tx *bolt.Tx) error {
		return tx.DeleteBucket([]byte(bucketUpstreamsByService))
	}); err != nil {
		t.Fatalf("drop index bucket: %v", err)
	}

	// Run the migration shim. Should rebuild the index with all 5 entries.
	if err := f.rebuildUpstreamIndex(); err != nil {
		t.Fatalf("rebuild index: %v", err)
	}

	if err := f.view(func(tx *bolt.Tx) error {
		idx := tx.Bucket([]byte(bucketUpstreamsByService))
		if idx == nil {
			t.Fatal("index bucket missing after rebuild")
		}
		if got := idx.Stats().KeyN; got != 5 {
			t.Errorf("post-rebuild index KeyN = %d, want 5", got)
		}
		// Spot-check svc-A keys.
		c := idx.Cursor()
		prefix := upstreamIndexPrefix(svcA)
		count := 0
		for k, _ := c.Seek(prefix); k != nil && hasPrefix(k, prefix); k, _ = c.Next() {
			count++
		}
		if count != 3 {
			t.Errorf("svc-A index entries = %d, want 3", count)
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}

	// Idempotency: rebuilding again must not duplicate or drop entries.
	if err := f.rebuildUpstreamIndex(); err != nil {
		t.Fatalf("rebuild index (second pass): %v", err)
	}
	if err := f.view(func(tx *bolt.Tx) error {
		idx := tx.Bucket([]byte(bucketUpstreamsByService))
		if got := idx.Stats().KeyN; got != 5 {
			t.Errorf("post-second-rebuild index KeyN = %d, want 5", got)
		}
		return nil
	}); err != nil {
		t.Fatalf("view: %v", err)
	}
}

// TestUpstreamIndexHelpers covers the byte-level helpers that don't need
// a live FSM.
func TestUpstreamIndexHelpers(t *testing.T) {
	t.Run("key+prefix", func(t *testing.T) {
		got := upstreamIndexKey("svc-1", "up-1")
		want := []byte("svc-1/up-1")
		if string(got) != string(want) {
			t.Errorf("upstreamIndexKey = %q, want %q", got, want)
		}
		gotP := upstreamIndexPrefix("svc-1")
		wantP := []byte("svc-1/")
		if string(gotP) != string(wantP) {
			t.Errorf("upstreamIndexPrefix = %q, want %q", gotP, wantP)
		}
	})
	t.Run("hasPrefix", func(t *testing.T) {
		cases := []struct {
			b, p []byte
			want bool
		}{
			{[]byte("svc-1/up-1"), []byte("svc-1/"), true},
			{[]byte("svc-1/"), []byte("svc-1/"), true},
			{[]byte("svc-2/up-1"), []byte("svc-1/"), false},
			{[]byte("svc"), []byte("svc-1/"), false},
		}
		for _, tc := range cases {
			if got := hasPrefix(tc.b, tc.p); got != tc.want {
				t.Errorf("hasPrefix(%q, %q) = %v, want %v", tc.b, tc.p, got, tc.want)
			}
		}
	})
}

// mustMarshalUpstream builds an upstream JSON payload matching the
// shape produced by marshalUpstreamWithServiceID. Used by the migration
// test to seed legacy-style data.
func mustMarshalUpstream(t *testing.T, serviceID, upstreamID, address string) json.RawMessage {
	t.Helper()
	entry := map[string]interface{}{
		"service_id": serviceID,
		"id":         upstreamID,
		"address":    address,
		"weight":     int32(10),
		"tls":        int32(0),
		"healthy":    true,
		"dial_err":   "",
	}
	data, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal upstream: %v", err)
	}
	return data
}
