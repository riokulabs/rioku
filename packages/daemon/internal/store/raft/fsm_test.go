package raft

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	hraft "github.com/hashicorp/raft"
	bolt "go.etcd.io/bbolt"
)

// openTestFSM creates a temporary bbolt-backed FSM for unit tests.
func openTestFSM(t *testing.T) (*fsm, func()) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test-fsm.db")
	db, err := bolt.Open(dbPath, 0600, &bolt.Options{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("open bolt db: %v", err)
	}

	notify := make(chan fsmEvent, 256)
	f := &fsm{db: db, notify: notify}
	if err := f.initBuckets(); err != nil {
		_ = db.Close()
		t.Fatalf("init buckets: %v", err)
	}
	return f, func() { _ = db.Close() }
}

// applyJSON is a test helper that builds a raft.Log from op+data and applies it.
func applyJSON(t *testing.T, f *fsm, op CommandOp, data interface{}) *CommandResult {
	t.Helper()
	encoded, err := encodeCommand(op, data)
	if err != nil {
		t.Fatalf("encode command: %v", err)
	}
	resp := f.Apply(&hraft.Log{Data: encoded})
	result, ok := resp.(*CommandResult)
	if !ok {
		t.Fatalf("unexpected Apply response type: %T", resp)
	}
	return result
}

// ---------------------------------------------------------------------------
// bindingKey
// ---------------------------------------------------------------------------

func TestBindingKey(t *testing.T) {
	got := bindingKey("pol1", "route", "r1")
	want := "pol1|route|r1"
	if got != want {
		t.Errorf("bindingKey = %q, want %q", got, want)
	}
}

// ---------------------------------------------------------------------------
// opToString
// ---------------------------------------------------------------------------

func TestOpToString(t *testing.T) {
	tests := []struct {
		op   CommandOp
		want string
	}{
		{OpCreateRoute, "INSERT"},
		{OpCreateService, "INSERT"},
		{OpCreatePolicy, "INSERT"},
		{OpUpdateRoute, "UPDATE"},
		{OpUpdateService, "UPDATE"},
		{OpUpdatePolicy, "UPDATE"},
		{OpDeleteRoute, "DELETE"},
		{OpDeleteService, "DELETE"},
		{OpDeletePolicy, "DELETE"},
		// Anything that doesn't match create/update falls through to DELETE.
		{OpAttachPolicy, "DELETE"},
	}
	for _, tt := range tests {
		t.Run(string(tt.op), func(t *testing.T) {
			got := opToString(tt.op)
			if got != tt.want {
				t.Errorf("opToString(%q) = %q, want %q", tt.op, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// writeFile
// ---------------------------------------------------------------------------

func TestWriteFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.bin")
	data := []byte("hello raft")
	if err := writeFile(path, data); err != nil {
		t.Fatalf("writeFile: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != string(data) {
		t.Errorf("read back %q, want %q", got, data)
	}
}

// ---------------------------------------------------------------------------
// encodeCommand
// ---------------------------------------------------------------------------

func TestEncodeCommand(t *testing.T) {
	b, err := encodeCommand(OpCreateRoute, putData{ID: "r1", Data: json.RawMessage(`{"name":"x"}`)})
	if err != nil {
		t.Fatalf("encodeCommand: %v", err)
	}
	var cmd Command
	if err := json.Unmarshal(b, &cmd); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if cmd.Op != OpCreateRoute {
		t.Errorf("op = %q, want %q", cmd.Op, OpCreateRoute)
	}
}

func TestEncodeCommandBadData(t *testing.T) {
	// Channels cannot be marshalled to JSON.
	_, err := encodeCommand(OpCreateRoute, make(chan int))
	if err == nil {
		t.Error("expected marshal error for un-marshalable data")
	}
}

// ---------------------------------------------------------------------------
// FSM Apply: routes
// ---------------------------------------------------------------------------

func TestFSMApplyCreateAndGetRoute(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	result := applyJSON(t, f, OpCreateRoute, putData{
		ID:   "route-1",
		Data: json.RawMessage(`{"name":"test-route"}`),
	})
	if result.Error != "" {
		t.Fatalf("create route error: %s", result.Error)
	}

	// Verify stored.
	var found bool
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketRoutes))
		if v := b.Get([]byte("route-1")); v != nil {
			found = true
		}
		return nil
	})
	if !found {
		t.Error("route not found after create")
	}
}

func TestFSMApplyUpdateRoute(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create.
	applyJSON(t, f, OpCreateRoute, putData{
		ID:   "route-1",
		Data: json.RawMessage(`{"name":"original"}`),
	})

	// Update.
	result := applyJSON(t, f, OpUpdateRoute, putData{
		ID:   "route-1",
		Data: json.RawMessage(`{"name":"updated"}`),
	})
	if result.Error != "" {
		t.Fatalf("update route error: %s", result.Error)
	}

	// Verify updated value.
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketRoutes))
		raw := b.Get([]byte("route-1"))
		var m map[string]interface{}
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if m["name"] != "updated" {
			t.Errorf("name = %q, want %q", m["name"], "updated")
		}
		return nil
	})
}

func TestFSMApplyDeleteRoute(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create first.
	applyJSON(t, f, OpCreateRoute, putData{
		ID:   "route-del",
		Data: json.RawMessage(`{"name":"to-delete"}`),
	})

	// Delete.
	result := applyJSON(t, f, OpDeleteRoute, deleteData{ID: "route-del"})
	if result.Error != "" {
		t.Fatalf("delete route error: %s", result.Error)
	}

	// Verify gone.
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketRoutes))
		if v := b.Get([]byte("route-del")); v != nil {
			t.Error("route should be deleted")
		}
		return nil
	})
}

func TestFSMApplyDeleteRouteNotFound(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	result := applyJSON(t, f, OpDeleteRoute, deleteData{ID: "nonexistent"})
	if result.Error == "" {
		t.Error("expected not-found error for deleting nonexistent route")
	}
}

// ---------------------------------------------------------------------------
// FSM Apply: services
// ---------------------------------------------------------------------------

func TestFSMApplyCreateService(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	result := applyJSON(t, f, OpCreateService, serviceData{
		ID:   "svc-1",
		Data: json.RawMessage(`{"name":"test-svc"}`),
		Upstreams: []upstreamEntry{
			{ID: "up-1", Data: json.RawMessage(`{"service_id":"svc-1","address":"127.0.0.1:8080"}`)},
		},
	})
	if result.Error != "" {
		t.Fatalf("create service error: %s", result.Error)
	}

	// Verify service stored.
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketServices))
		if v := b.Get([]byte("svc-1")); v == nil {
			t.Error("service not stored")
		}
		ub := tx.Bucket([]byte(bucketUpstreams))
		if v := ub.Get([]byte("up-1")); v == nil {
			t.Error("upstream not stored")
		}
		return nil
	})
}

func TestFSMApplyUpdateService(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create first.
	applyJSON(t, f, OpCreateService, serviceData{
		ID:   "svc-upd",
		Data: json.RawMessage(`{"name":"original"}`),
		Upstreams: []upstreamEntry{
			{ID: "up-old", Data: json.RawMessage(`{"service_id":"svc-upd","address":"1.1.1.1:80"}`)},
		},
	})

	// Update with new upstreams.
	result := applyJSON(t, f, OpUpdateService, serviceData{
		ID:   "svc-upd",
		Data: json.RawMessage(`{"name":"updated"}`),
		Upstreams: []upstreamEntry{
			{ID: "up-new", Data: json.RawMessage(`{"service_id":"svc-upd","address":"2.2.2.2:80"}`)},
		},
	})
	if result.Error != "" {
		t.Fatalf("update service error: %s", result.Error)
	}

	// Old upstream should be gone, new one should exist.
	_ = f.view(func(tx *bolt.Tx) error {
		ub := tx.Bucket([]byte(bucketUpstreams))
		if v := ub.Get([]byte("up-old")); v != nil {
			t.Error("old upstream should be deleted after update")
		}
		if v := ub.Get([]byte("up-new")); v == nil {
			t.Error("new upstream not stored after update")
		}
		return nil
	})
}

func TestFSMApplyUpdateServiceNotFound(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	result := applyJSON(t, f, OpUpdateService, serviceData{
		ID:   "nonexistent",
		Data: json.RawMessage(`{"name":"x"}`),
	})
	if result.Error == "" {
		t.Error("expected not-found error")
	}
}

func TestFSMApplyDeleteService(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create.
	applyJSON(t, f, OpCreateService, serviceData{
		ID:   "svc-del",
		Data: json.RawMessage(`{"name":"del-me"}`),
		Upstreams: []upstreamEntry{
			{ID: "up-del", Data: json.RawMessage(`{"service_id":"svc-del","address":"3.3.3.3:80"}`)},
		},
	})

	// Delete.
	result := applyJSON(t, f, OpDeleteService, deleteData{ID: "svc-del"})
	if result.Error != "" {
		t.Fatalf("delete service error: %s", result.Error)
	}

	// Verify service and upstream gone.
	_ = f.view(func(tx *bolt.Tx) error {
		if v := tx.Bucket([]byte(bucketServices)).Get([]byte("svc-del")); v != nil {
			t.Error("service should be deleted")
		}
		if v := tx.Bucket([]byte(bucketUpstreams)).Get([]byte("up-del")); v != nil {
			t.Error("upstream should be deleted with service")
		}
		return nil
	})
}

func TestFSMApplyDeleteServiceNotFound(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	result := applyJSON(t, f, OpDeleteService, deleteData{ID: "nonexistent"})
	if result.Error == "" {
		t.Error("expected not-found error for nonexistent service")
	}
}

// ---------------------------------------------------------------------------
// FSM Apply: policies
// ---------------------------------------------------------------------------

func TestFSMApplyPolicyCreateAndDelete(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create.
	result := applyJSON(t, f, OpCreatePolicy, putData{
		ID:   "pol-1",
		Data: json.RawMessage(`{"name":"rate-limit"}`),
	})
	if result.Error != "" {
		t.Fatalf("create policy error: %s", result.Error)
	}

	// Verify.
	_ = f.view(func(tx *bolt.Tx) error {
		if v := tx.Bucket([]byte(bucketPolicies)).Get([]byte("pol-1")); v == nil {
			t.Error("policy not stored")
		}
		return nil
	})

	// Update.
	result = applyJSON(t, f, OpUpdatePolicy, putData{
		ID:   "pol-1",
		Data: json.RawMessage(`{"name":"rate-limit-v2"}`),
	})
	if result.Error != "" {
		t.Fatalf("update policy error: %s", result.Error)
	}

	// Delete.
	result = applyJSON(t, f, OpDeletePolicy, deleteData{ID: "pol-1"})
	if result.Error != "" {
		t.Fatalf("delete policy error: %s", result.Error)
	}
}

// ---------------------------------------------------------------------------
// FSM Apply: policy bindings
// ---------------------------------------------------------------------------

func TestFSMApplyAttachDetachPolicy(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Attach.
	result := applyJSON(t, f, OpAttachPolicy, policyBindingData{
		PolicyID:   "pol-1",
		TargetType: "route",
		TargetID:   "route-1",
	})
	if result.Error != "" {
		t.Fatalf("attach policy error: %s", result.Error)
	}

	// Verify stored.
	key := bindingKey("pol-1", "route", "route-1")
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicyBindings))
		if v := b.Get([]byte(key)); v == nil {
			t.Error("binding not stored")
		}
		return nil
	})

	// Detach.
	result = applyJSON(t, f, OpDetachPolicy, policyBindingData{
		PolicyID:   "pol-1",
		TargetType: "route",
		TargetID:   "route-1",
	})
	if result.Error != "" {
		t.Fatalf("detach policy error: %s", result.Error)
	}

	// Verify gone.
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicyBindings))
		if v := b.Get([]byte(key)); v != nil {
			t.Error("binding should be deleted")
		}
		return nil
	})
}

func TestFSMApplyDetachPolicyNotFound(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	result := applyJSON(t, f, OpDetachPolicy, policyBindingData{
		PolicyID:   "nope",
		TargetType: "route",
		TargetID:   "nope",
	})
	if result.Error == "" {
		t.Error("expected not-found error from detach on nonexistent binding")
	}
}

// ---------------------------------------------------------------------------
// FSM Apply: API keys
// ---------------------------------------------------------------------------

func TestFSMApplyCreateAndRevokeAPIKey(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create.
	result := applyJSON(t, f, OpCreateAPIKey, apiKeyData{
		ID:      "key-1",
		KeyHash: "sha256:abc123",
		Data:    json.RawMessage(`{"id":"key-1","name":"test-key","key_hash":"sha256:abc123","scopes":["read"]}`),
	})
	if result.Error != "" {
		t.Fatalf("create api key error: %s", result.Error)
	}

	// Verify stored + hash index.
	_ = f.view(func(tx *bolt.Tx) error {
		if v := tx.Bucket([]byte(bucketAPIKeys)).Get([]byte("key-1")); v == nil {
			t.Error("api key not stored")
		}
		idx := tx.Bucket([]byte(bucketAPIKeysByHash))
		if v := idx.Get([]byte("sha256:abc123")); v == nil {
			t.Error("hash index not stored")
		} else if string(v) != "key-1" {
			t.Errorf("hash index = %q, want %q", v, "key-1")
		}
		return nil
	})

	// Revoke.
	result = applyJSON(t, f, OpRevokeAPIKey, revokeKeyData{
		ID:        "key-1",
		RevokedAt: "2026-01-01T00:00:00.000Z",
	})
	if result.Error != "" {
		t.Fatalf("revoke api key error: %s", result.Error)
	}

	// Verify revoked_at is set.
	_ = f.view(func(tx *bolt.Tx) error {
		raw := tx.Bucket([]byte(bucketAPIKeys)).Get([]byte("key-1"))
		var m map[string]interface{}
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if m["revoked_at"] == nil {
			t.Error("revoked_at should be set after revoke")
		}
		return nil
	})
}

func TestFSMApplyRevokeAPIKeyNotFound(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	result := applyJSON(t, f, OpRevokeAPIKey, revokeKeyData{
		ID:        "nonexistent",
		RevokedAt: "2026-01-01T00:00:00.000Z",
	})
	if result.Error == "" {
		t.Error("expected not-found error")
	}
}

func TestFSMApplyRevokeAPIKeyAlreadyRevoked(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Create.
	applyJSON(t, f, OpCreateAPIKey, apiKeyData{
		ID:      "key-2",
		KeyHash: "sha256:def456",
		Data:    json.RawMessage(`{"id":"key-2","name":"k2","key_hash":"sha256:def456"}`),
	})

	// Revoke once.
	applyJSON(t, f, OpRevokeAPIKey, revokeKeyData{
		ID:        "key-2",
		RevokedAt: "2026-01-01T00:00:00.000Z",
	})

	// Revoke again — should error.
	result := applyJSON(t, f, OpRevokeAPIKey, revokeKeyData{
		ID:        "key-2",
		RevokedAt: "2026-01-02T00:00:00.000Z",
	})
	if result.Error == "" {
		t.Error("expected already-revoked error")
	}
}

// ---------------------------------------------------------------------------
// FSM Apply: config versions
// ---------------------------------------------------------------------------

func TestFSMApplySaveConfigVersion(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Save first version.
	r1 := applyJSON(t, f, OpSaveConfigVersion, configVersionData{
		Snapshot: `{"routes":[]}`,
		Actor:    "admin",
		Time:     "2026-01-01T00:00:00.000Z",
	})
	if r1.Error != "" {
		t.Fatalf("save config version: %s", r1.Error)
	}

	var v1 int64
	if err := json.Unmarshal(r1.Data, &v1); err != nil {
		t.Fatalf("unmarshal version: %v", err)
	}
	if v1 != 1 {
		t.Errorf("first version = %d, want 1", v1)
	}

	// Save second version.
	r2 := applyJSON(t, f, OpSaveConfigVersion, configVersionData{
		Snapshot: `{"routes":[{"id":"r1"}]}`,
		Actor:    "admin",
		Time:     "2026-01-01T01:00:00.000Z",
	})
	if r2.Error != "" {
		t.Fatalf("save config version 2: %s", r2.Error)
	}

	var v2 int64
	if err := json.Unmarshal(r2.Data, &v2); err != nil {
		t.Fatalf("unmarshal version 2: %v", err)
	}
	if v2 != 2 {
		t.Errorf("second version = %d, want 2", v2)
	}
}

// ---------------------------------------------------------------------------
// FSM Apply: audit log
// ---------------------------------------------------------------------------

func TestFSMApplyAppendAuditEntry(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	result := applyJSON(t, f, OpAppendAuditEntry, auditEntryData{
		ID:   "audit-1",
		Data: json.RawMessage(`{"actor":"admin","action":"create_route","entity_type":"route","entity_id":"r1"}`),
	})
	if result.Error != "" {
		t.Fatalf("append audit entry error: %s", result.Error)
	}

	// Verify stored.
	_ = f.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketAuditLog))
		if v := b.Get([]byte("audit-1")); v == nil {
			t.Error("audit entry not stored")
		}
		return nil
	})
}

// ---------------------------------------------------------------------------
// FSM Apply: unknown op
// ---------------------------------------------------------------------------

func TestFSMApplyUnknownOp(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Manually create a log with an unknown op.
	cmd := Command{
		Op:   "totally_unknown",
		Data: json.RawMessage(`{}`),
	}
	data, err := json.Marshal(cmd)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	resp := f.Apply(&hraft.Log{Data: data})
	result, ok := resp.(*CommandResult)
	if !ok {
		t.Fatalf("unexpected type: %T", resp)
	}
	if result.Error == "" {
		t.Error("expected error for unknown op")
	}
}

func TestFSMApplyBadJSON(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	resp := f.Apply(&hraft.Log{Data: []byte("not json")})
	result, ok := resp.(*CommandResult)
	if !ok {
		t.Fatalf("unexpected type: %T", resp)
	}
	if result.Error == "" {
		t.Error("expected unmarshal error")
	}
}

// ---------------------------------------------------------------------------
// FSM Snapshot and Restore
// ---------------------------------------------------------------------------

func TestFSMSnapshotAndRestore(t *testing.T) {
	f, cleanup := openTestFSM(t)
	defer cleanup()

	// Add some data.
	applyJSON(t, f, OpCreateRoute, putData{
		ID:   "snap-route-1",
		Data: json.RawMessage(`{"name":"snapshot-test"}`),
	})
	applyJSON(t, f, OpCreatePolicy, putData{
		ID:   "snap-pol-1",
		Data: json.RawMessage(`{"name":"snapshot-policy"}`),
	})

	// Take a snapshot.
	snap, err := f.Snapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	// Write snapshot to a temp file (simulating SnapshotSink).
	dir := t.TempDir()
	snapPath := filepath.Join(dir, "snapshot.db")
	sink := &fileSink{path: snapPath}
	if err := snap.Persist(sink); err != nil {
		t.Fatalf("persist: %v", err)
	}

	// Open a new FSM and restore into it.
	restorePath := filepath.Join(dir, "restored.db")
	restoreDB, err := bolt.Open(restorePath, 0600, &bolt.Options{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("open restore db: %v", err)
	}

	f2 := &fsm{db: restoreDB, notify: make(chan fsmEvent, 256)}
	if err := f2.initBuckets(); err != nil {
		_ = restoreDB.Close()
		t.Fatalf("init buckets: %v", err)
	}

	// Read the snapshot file and restore.
	snapData, err := os.ReadFile(snapPath)
	if err != nil {
		t.Fatalf("read snapshot file: %v", err)
	}

	rc := &readCloser{data: snapData}
	if err := f2.Restore(rc); err != nil {
		t.Fatalf("restore: %v", err)
	}
	defer func() { _ = f2.db.Close() }()

	// Verify data in restored FSM.
	_ = f2.view(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketRoutes))
		if b == nil {
			t.Fatal("routes bucket missing after restore")
		}
		if v := b.Get([]byte("snap-route-1")); v == nil {
			t.Error("route not found after restore")
		}
		pb := tx.Bucket([]byte(bucketPolicies))
		if pb == nil {
			t.Fatal("policies bucket missing after restore")
		}
		if v := pb.Get([]byte("snap-pol-1")); v == nil {
			t.Error("policy not found after restore")
		}
		return nil
	})
}

// fileSink implements hraft.SnapshotSink for testing.
type fileSink struct {
	path string
	f    *os.File
}

func (s *fileSink) Write(p []byte) (int, error) {
	if s.f == nil {
		var err error
		s.f, err = os.Create(s.path)
		if err != nil {
			return 0, err
		}
	}
	return s.f.Write(p)
}

func (s *fileSink) Close() error {
	if s.f != nil {
		return s.f.Close()
	}
	return nil
}

func (s *fileSink) ID() string { return "test-snapshot" }

func (s *fileSink) Cancel() error {
	if s.f != nil {
		_ = s.f.Close()
		_ = os.Remove(s.path)
	}
	return nil
}

// readCloser wraps bytes to implement io.ReadCloser.
type readCloser struct {
	data []byte
	pos  int
}

func (rc *readCloser) Read(p []byte) (int, error) {
	if rc.pos >= len(rc.data) {
		return 0, io.EOF
	}
	n := copy(p, rc.data[rc.pos:])
	rc.pos += n
	if rc.pos >= len(rc.data) {
		return n, nil
	}
	return n, nil
}

func (rc *readCloser) Close() error { return nil }

// ---------------------------------------------------------------------------
// emitEvent with nil notify
// ---------------------------------------------------------------------------

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

func TestEmitEventNilNotify(t *testing.T) {
	f := &fsm{notify: nil}
	// Should not panic.
	f.emitEvent("routes", "r1", "INSERT")
}
