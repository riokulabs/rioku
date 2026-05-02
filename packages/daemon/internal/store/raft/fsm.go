package raft

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"

	hraft "github.com/hashicorp/raft"
	bolt "go.etcd.io/bbolt"
)

// fsm implements hashicorp/raft.FSM backed by a bbolt database.
// All mutations to the config store flow through Apply.
//
// Thread safety:
// - Apply() is called sequentially by raft's internal goroutine (never concurrent).
// - Snapshot() and Restore() are also called by raft, never concurrent with Apply().
// - However, external reads via readFSM() happen on user goroutines concurrently.
// - The dbMu protects the db pointer during Restore() (which swaps the db).
type fsm struct {
	dbMu   sync.RWMutex
	db     *bolt.DB
	notify chan<- fsmEvent
}

// fsmEvent is emitted after Apply so the driver can relay change events.
type fsmEvent struct {
	Table     string
	RowID     string
	Operation string
}

// allBuckets lists every bucket the FSM uses.
var allBuckets = []string{
	bucketRoutes,
	bucketServices,
	bucketUpstreams,
	bucketUpstreamsByService,
	bucketPolicies,
	bucketPolicyBindings,
	bucketAPIKeys,
	bucketAPIKeysByHash,
	bucketConfigVersions,
	bucketAuditLog,
	bucketMeta,
}

// initBuckets creates all required buckets in bbolt.
// Called during Open() before any concurrent access, but uses the lock for safety.
func (f *fsm) initBuckets() error {
	f.dbMu.RLock()
	db := f.db
	f.dbMu.RUnlock()
	return db.Update(func(tx *bolt.Tx) error {
		for _, name := range allBuckets {
			if _, err := tx.CreateBucketIfNotExists([]byte(name)); err != nil {
				return fmt.Errorf("create bucket %q: %w", name, err)
			}
		}
		return nil
	})
}

// ---------------------------------------------------------------------------
// raft.FSM interface
// ---------------------------------------------------------------------------

// Apply is called by raft when a log entry is committed. It deserializes the
// command and applies it to the bbolt database. The returned interface{} is
// a *CommandResult.
func (f *fsm) Apply(log *hraft.Log) interface{} {
	var cmd Command
	if err := json.Unmarshal(log.Data, &cmd); err != nil {
		return &CommandResult{Error: fmt.Sprintf("unmarshal command: %v", err)}
	}

	// Apply holds a read lock on dbMu — raft guarantees Apply is never
	// concurrent with Restore, but external reads also hold this lock.
	f.dbMu.RLock()
	db := f.db
	f.dbMu.RUnlock()

	var result *CommandResult
	err := db.Update(func(tx *bolt.Tx) error {
		var applyErr error
		result, applyErr = f.applyCommand(tx, cmd)
		return applyErr
	})
	if err != nil {
		return &CommandResult{Error: fmt.Sprintf("bbolt update: %v", err)}
	}
	return result
}

// Snapshot returns a snapshot of the full bbolt state for log compaction.
func (f *fsm) Snapshot() (hraft.FSMSnapshot, error) {
	f.dbMu.RLock()
	db := f.db
	f.dbMu.RUnlock()

	// bbolt supports consistent read-only snapshots via Tx.WriteTo.
	tx, err := db.Begin(false)
	if err != nil {
		return nil, fmt.Errorf("begin snapshot tx: %w", err)
	}
	return &fsmSnapshot{tx: tx}, nil
}

// Restore rebuilds the bbolt database from a snapshot stream.
// It takes an exclusive write lock on dbMu to prevent concurrent reads
// during the db file swap.
func (f *fsm) Restore(rc io.ReadCloser) error {
	defer func() { _ = rc.Close() }()

	// Read the entire snapshot into memory. Config store data is small
	// (single-digit MB at most), so this is fine.
	data, err := io.ReadAll(rc)
	if err != nil {
		return fmt.Errorf("read snapshot: %w", err)
	}

	// Exclusive lock — blocks all reads and Apply during the swap.
	f.dbMu.Lock()
	defer f.dbMu.Unlock()

	path := f.db.Path()
	if err := f.db.Close(); err != nil {
		return fmt.Errorf("close db for restore: %w", err)
	}

	// Write raw bytes to the file — the snapshot is a complete bolt db.
	if err := writeFile(path, data); err != nil {
		return fmt.Errorf("write snapshot to file: %w", err)
	}

	// Reopen.
	db, err := bolt.Open(path, 0600, nil)
	if err != nil {
		return fmt.Errorf("reopen db after restore: %w", err)
	}
	f.db = db

	// Snapshots can predate the upstreams_by_service index. Ensure every
	// bucket exists and the index is populated before any reader observes
	// the new db pointer. Done with the direct db handle because we still
	// hold dbMu — must not call helpers that re-take the lock.
	if err := db.Update(func(tx *bolt.Tx) error {
		for _, name := range allBuckets {
			if _, err := tx.CreateBucketIfNotExists([]byte(name)); err != nil {
				return fmt.Errorf("ensure bucket %q: %w", name, err)
			}
		}
		return rebuildUpstreamIndexTx(tx)
	}); err != nil {
		return fmt.Errorf("ensure buckets after restore: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Command application
// ---------------------------------------------------------------------------

func (f *fsm) applyCommand(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	switch cmd.Op {

	// --- Routes ---
	case OpCreateRoute, OpUpdateRoute:
		return f.applyPut(tx, bucketRoutes, cmd)
	case OpDeleteRoute:
		return f.applyDelete(tx, bucketRoutes, cmd)

	// --- Services ---
	case OpCreateService:
		return f.applyCreateService(tx, cmd)
	case OpUpdateService:
		return f.applyUpdateService(tx, cmd)
	case OpDeleteService:
		return f.applyDeleteService(tx, cmd)

	// --- Policies ---
	case OpCreatePolicy, OpUpdatePolicy:
		return f.applyPut(tx, bucketPolicies, cmd)
	case OpDeletePolicy:
		return f.applyDelete(tx, bucketPolicies, cmd)

	// --- Policy Bindings ---
	case OpAttachPolicy:
		return f.applyAttachPolicy(tx, cmd)
	case OpDetachPolicy:
		return f.applyDetachPolicy(tx, cmd)

	// --- API Keys ---
	case OpCreateAPIKey:
		return f.applyCreateAPIKey(tx, cmd)
	case OpRevokeAPIKey:
		return f.applyRevokeAPIKey(tx, cmd)

	// --- Config Versions ---
	case OpSaveConfigVersion:
		return f.applySaveConfigVersion(tx, cmd)

	// --- Audit Log ---
	case OpAppendAuditEntry:
		return f.applyAppendAuditEntry(tx, cmd)

	// --- Batch (multi-op atomic) ---
	case OpBatch:
		return f.applyBatch(tx, cmd)

	default:
		return nil, fmt.Errorf("unknown command op: %s", cmd.Op)
	}
}

// applyBatch runs each sub-command inside the *same* bbolt transaction. If
// any sub-command returns an error, the surrounding db.Update rolls back
// the whole bbolt tx — giving raftTx true atomicity.
//
// Per-sub-command results are returned in order so callers that need a
// server-assigned value (e.g. SaveConfigVersion's auto-incremented version)
// can extract it.
//
// Nested OpBatch is rejected to keep the wire format flat.
func (f *fsm) applyBatch(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var bd batchData
	if err := json.Unmarshal(cmd.Data, &bd); err != nil {
		return nil, fmt.Errorf("unmarshal batch: %w", err)
	}
	results := make([]batchSubResult, len(bd.Commands))
	for i, sub := range bd.Commands {
		if sub.Op == OpBatch {
			return nil, fmt.Errorf("batch[%d]: nested OpBatch is not allowed", i)
		}
		r, err := f.applyCommand(tx, sub)
		if err != nil {
			// Hard error: bubble out so db.Update rolls back the whole tx.
			return nil, fmt.Errorf("batch[%d] (%s): %w", i, sub.Op, err)
		}
		if r.Error != "" {
			// Soft error reported via CommandResult.Error (e.g. "not found"
			// from applyDelete). Treat the same as a hard error inside a
			// batch — atomic-or-nothing — so the caller's expectations
			// match the standalone-Apply path's "if Error != '' then op
			// failed" contract.
			return nil, fmt.Errorf("batch[%d] (%s): %s", i, sub.Op, r.Error)
		}
		results[i] = batchSubResult{Data: r.Data}
	}
	out, err := json.Marshal(batchResult{Results: results})
	if err != nil {
		return nil, fmt.Errorf("marshal batch result: %w", err)
	}
	return &CommandResult{Data: out}, nil
}

// ---------------------------------------------------------------------------
// Generic put/delete for simple entity buckets
// ---------------------------------------------------------------------------

// putData is the generic payload for create/update operations.
type putData struct {
	ID   string          `json:"id"`
	Data json.RawMessage `json:"data"`
}

func (f *fsm) applyPut(tx *bolt.Tx, bucket string, cmd Command) (*CommandResult, error) {
	var pd putData
	if err := json.Unmarshal(cmd.Data, &pd); err != nil {
		return nil, fmt.Errorf("unmarshal put data: %w", err)
	}
	b := tx.Bucket([]byte(bucket))
	if err := b.Put([]byte(pd.ID), pd.Data); err != nil {
		return nil, fmt.Errorf("put %s/%s: %w", bucket, pd.ID, err)
	}
	f.emitEvent(bucket, pd.ID, opToString(cmd.Op))
	return &CommandResult{Data: pd.Data}, nil
}

type deleteData struct {
	ID string `json:"id"`
}

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

// ---------------------------------------------------------------------------
// Service operations (includes upstreams sub-bucket)
// ---------------------------------------------------------------------------

type serviceData struct {
	ID        string          `json:"id"`
	Data      json.RawMessage `json:"data"`
	Upstreams []upstreamEntry `json:"upstreams"`
}

type upstreamEntry struct {
	ID   string          `json:"id"`
	Data json.RawMessage `json:"data"`
}

func (f *fsm) applyCreateService(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var sd serviceData
	if err := json.Unmarshal(cmd.Data, &sd); err != nil {
		return nil, fmt.Errorf("unmarshal service data: %w", err)
	}
	b := tx.Bucket([]byte(bucketServices))
	if err := b.Put([]byte(sd.ID), sd.Data); err != nil {
		return nil, fmt.Errorf("put service: %w", err)
	}

	// Store upstreams + maintain the upstreams_by_service index. Both
	// writes happen inside the caller's bbolt write transaction so the
	// index is always ACID-consistent with the upstream payload.
	ub := tx.Bucket([]byte(bucketUpstreams))
	idx := tx.Bucket([]byte(bucketUpstreamsByService))
	for _, u := range sd.Upstreams {
		if err := ub.Put([]byte(u.ID), u.Data); err != nil {
			return nil, fmt.Errorf("put upstream: %w", err)
		}
		if err := idx.Put(upstreamIndexKey(sd.ID, u.ID), []byte(u.ID)); err != nil {
			return nil, fmt.Errorf("put upstream index: %w", err)
		}
	}

	f.emitEvent(bucketServices, sd.ID, "INSERT")
	return &CommandResult{Data: sd.Data}, nil
}

func (f *fsm) applyUpdateService(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var sd serviceData
	if err := json.Unmarshal(cmd.Data, &sd); err != nil {
		return nil, fmt.Errorf("unmarshal service data: %w", err)
	}
	b := tx.Bucket([]byte(bucketServices))
	if v := b.Get([]byte(sd.ID)); v == nil {
		return &CommandResult{Error: fmt.Sprintf("service %q not found", sd.ID)}, nil
	}
	if err := b.Put([]byte(sd.ID), sd.Data); err != nil {
		return nil, fmt.Errorf("put service: %w", err)
	}

	// Replace upstreams: delete old + their index entries, insert new + index entries.
	ub := tx.Bucket([]byte(bucketUpstreams))
	idx := tx.Bucket([]byte(bucketUpstreamsByService))
	if err := f.deleteUpstreamsForService(ub, idx, sd.ID); err != nil {
		return nil, err
	}
	for _, u := range sd.Upstreams {
		if err := ub.Put([]byte(u.ID), u.Data); err != nil {
			return nil, fmt.Errorf("put upstream: %w", err)
		}
		if err := idx.Put(upstreamIndexKey(sd.ID, u.ID), []byte(u.ID)); err != nil {
			return nil, fmt.Errorf("put upstream index: %w", err)
		}
	}

	f.emitEvent(bucketServices, sd.ID, "UPDATE")
	return &CommandResult{Data: sd.Data}, nil
}

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

	// Delete associated upstreams + index entries.
	ub := tx.Bucket([]byte(bucketUpstreams))
	idx := tx.Bucket([]byte(bucketUpstreamsByService))
	if err := f.deleteUpstreamsForService(ub, idx, dd.ID); err != nil {
		return nil, err
	}

	// Clean up policy bindings for deleted service.
	pb := tx.Bucket([]byte(bucketPolicyBindings))
	f.deleteBindingsForTarget(pb, "service", dd.ID)

	f.emitEvent(bucketServices, dd.ID, "DELETE")
	return &CommandResult{}, nil
}

// deleteUpstreamsForService removes every upstream belonging to serviceID
// from both the upstreams bucket and the upstreams_by_service index.
//
// The walk uses the index as the source of truth — falling back to a full
// scan only if the index is empty for this service. This keeps the hot
// path O(upstreams_for_service) instead of O(total_upstreams).
func (f *fsm) deleteUpstreamsForService(ub, idx *bolt.Bucket, serviceID string) error {
	prefix := upstreamIndexPrefix(serviceID)

	var indexKeys [][]byte
	var upstreamKeys [][]byte

	if idx != nil {
		c := idx.Cursor()
		for k, v := c.Seek(prefix); k != nil && hasPrefix(k, prefix); k, v = c.Next() {
			indexKeys = append(indexKeys, append([]byte{}, k...))
			upstreamKeys = append(upstreamKeys, append([]byte{}, v...))
		}
	}

	// Compatibility fallback: if the index has no entries for this
	// service (legacy data, missing migration) walk the upstreams
	// bucket. O(N) but only hit when the index is empty.
	if len(indexKeys) == 0 {
		uc := ub.Cursor()
		for k, v := uc.First(); k != nil; k, v = uc.Next() {
			var entry struct {
				ServiceID string `json:"service_id"`
			}
			if json.Unmarshal(v, &entry) == nil && entry.ServiceID == serviceID {
				upstreamKeys = append(upstreamKeys, append([]byte{}, k...))
			}
		}
	}

	for _, k := range upstreamKeys {
		if err := ub.Delete(k); err != nil {
			return fmt.Errorf("delete upstream: %w", err)
		}
	}
	for _, k := range indexKeys {
		if err := idx.Delete(k); err != nil {
			return fmt.Errorf("delete upstream index: %w", err)
		}
	}
	return nil
}

// hasPrefix reports whether b starts with prefix.
//
// Reimplemented locally to avoid pulling in the bytes package just for a
// hot-path check.
func hasPrefix(b, prefix []byte) bool {
	if len(b) < len(prefix) {
		return false
	}
	for i := range prefix {
		if b[i] != prefix[i] {
			return false
		}
	}
	return true
}

// rebuildUpstreamIndex repopulates bucketUpstreamsByService from the
// existing upstreams bucket. Idempotent: re-running adds entries that
// were missing and leaves correct ones alone. Called once per process
// startup as a migration shim so installs that pre-date the index
// transparently gain the read-acceleration on first boot.
//
// Runs inside its own write transaction; safe to call concurrently with
// readers (bbolt MVCC keeps existing read txs unaffected).
func (f *fsm) rebuildUpstreamIndex() error {
	f.dbMu.RLock()
	db := f.db
	f.dbMu.RUnlock()
	return db.Update(rebuildUpstreamIndexTx)
}

// rebuildUpstreamIndexTx is the bbolt-Update closure that backfills the
// upstreams_by_service index. Extracted so callers that already hold a
// write transaction (notably Restore, which holds dbMu exclusively and
// must not re-enter the public helper) can run the same logic in-line.
func rebuildUpstreamIndexTx(tx *bolt.Tx) error {
	idx, err := tx.CreateBucketIfNotExists([]byte(bucketUpstreamsByService))
	if err != nil {
		return fmt.Errorf("ensure upstream index bucket: %w", err)
	}
	ub := tx.Bucket([]byte(bucketUpstreams))
	if ub == nil {
		return nil
	}
	return ub.ForEach(func(k, v []byte) error {
		var entry struct {
			ServiceID string `json:"service_id"`
			ID        string `json:"id"`
		}
		if err := json.Unmarshal(v, &entry); err != nil {
			// Skip malformed entries — match the existing behaviour
			// of GetService/ListServices which also tolerates them.
			return nil
		}
		if entry.ServiceID == "" {
			return nil
		}
		id := entry.ID
		if id == "" {
			id = string(k)
		}
		key := upstreamIndexKey(entry.ServiceID, id)
		if existing := idx.Get(key); existing != nil {
			return nil
		}
		return idx.Put(key, []byte(id))
	})
}

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

// ---------------------------------------------------------------------------
// Policy binding operations
// ---------------------------------------------------------------------------

type policyBindingData struct {
	PolicyID   string `json:"policy_id"`
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id"`
}

func bindingKey(policyID, targetType, targetID string) string {
	return policyID + "|" + targetType + "|" + targetID
}

func (f *fsm) applyAttachPolicy(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var pb policyBindingData
	if err := json.Unmarshal(cmd.Data, &pb); err != nil {
		return nil, fmt.Errorf("unmarshal binding data: %w", err)
	}
	b := tx.Bucket([]byte(bucketPolicyBindings))
	key := bindingKey(pb.PolicyID, pb.TargetType, pb.TargetID)
	data, _ := json.Marshal(pb)
	if err := b.Put([]byte(key), data); err != nil {
		return nil, fmt.Errorf("put policy binding: %w", err)
	}
	f.emitEvent(bucketPolicyBindings, pb.PolicyID, "INSERT")
	return &CommandResult{}, nil
}

func (f *fsm) applyDetachPolicy(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var pb policyBindingData
	if err := json.Unmarshal(cmd.Data, &pb); err != nil {
		return nil, fmt.Errorf("unmarshal binding data: %w", err)
	}
	b := tx.Bucket([]byte(bucketPolicyBindings))
	key := bindingKey(pb.PolicyID, pb.TargetType, pb.TargetID)
	if v := b.Get([]byte(key)); v == nil {
		return &CommandResult{Error: "policy binding not found"}, nil
	}
	if err := b.Delete([]byte(key)); err != nil {
		return nil, fmt.Errorf("delete policy binding: %w", err)
	}
	f.emitEvent(bucketPolicyBindings, pb.PolicyID, "DELETE")
	return &CommandResult{}, nil
}

// ---------------------------------------------------------------------------
// API Key operations
// ---------------------------------------------------------------------------

type apiKeyData struct {
	ID      string          `json:"id"`
	KeyHash string          `json:"key_hash"`
	Data    json.RawMessage `json:"data"`
}

func (f *fsm) applyCreateAPIKey(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var ak apiKeyData
	if err := json.Unmarshal(cmd.Data, &ak); err != nil {
		return nil, fmt.Errorf("unmarshal api_key data: %w", err)
	}
	b := tx.Bucket([]byte(bucketAPIKeys))
	if err := b.Put([]byte(ak.ID), ak.Data); err != nil {
		return nil, fmt.Errorf("put api_key: %w", err)
	}

	// Secondary index by hash.
	idx := tx.Bucket([]byte(bucketAPIKeysByHash))
	if err := idx.Put([]byte(ak.KeyHash), []byte(ak.ID)); err != nil {
		return nil, fmt.Errorf("put api_key hash index: %w", err)
	}

	f.emitEvent(bucketAPIKeys, ak.ID, "INSERT")
	return &CommandResult{Data: []byte(ak.ID)}, nil
}

type revokeKeyData struct {
	ID        string `json:"id"`
	RevokedAt string `json:"revoked_at"`
}

func (f *fsm) applyRevokeAPIKey(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var rk revokeKeyData
	if err := json.Unmarshal(cmd.Data, &rk); err != nil {
		return nil, fmt.Errorf("unmarshal revoke data: %w", err)
	}
	b := tx.Bucket([]byte(bucketAPIKeys))
	raw := b.Get([]byte(rk.ID))
	if raw == nil {
		return &CommandResult{Error: fmt.Sprintf("api_key %q not found", rk.ID)}, nil
	}

	// Update the revoked_at field.
	var entry map[string]interface{}
	if err := json.Unmarshal(raw, &entry); err != nil {
		return nil, fmt.Errorf("unmarshal api_key: %w", err)
	}
	if entry["revoked_at"] != nil {
		return &CommandResult{Error: fmt.Sprintf("api_key %q already revoked", rk.ID)}, nil
	}
	entry["revoked_at"] = rk.RevokedAt
	updated, err := json.Marshal(entry)
	if err != nil {
		return nil, fmt.Errorf("marshal updated api_key: %w", err)
	}
	if err := b.Put([]byte(rk.ID), updated); err != nil {
		return nil, fmt.Errorf("put revoked api_key: %w", err)
	}

	f.emitEvent(bucketAPIKeys, rk.ID, "UPDATE")
	return &CommandResult{}, nil
}

// ---------------------------------------------------------------------------
// Config version operations
// ---------------------------------------------------------------------------

type configVersionData struct {
	Snapshot string `json:"snapshot"`
	Actor    string `json:"actor"`
	Time     string `json:"time"`
}

func (f *fsm) applySaveConfigVersion(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var cv configVersionData
	if err := json.Unmarshal(cmd.Data, &cv); err != nil {
		return nil, fmt.Errorf("unmarshal config_version data: %w", err)
	}

	// Increment version counter.
	meta := tx.Bucket([]byte(bucketMeta))
	var version int64 = 1
	if raw := meta.Get([]byte(metaVersionCounter)); raw != nil {
		version = int64(binary.BigEndian.Uint64(raw)) + 1
	}
	vBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(vBytes, uint64(version))
	if err := meta.Put([]byte(metaVersionCounter), vBytes); err != nil {
		return nil, fmt.Errorf("put version counter: %w", err)
	}

	// Store the version.
	entry := map[string]interface{}{
		"version":    version,
		"snapshot":   cv.Snapshot,
		"actor":      cv.Actor,
		"created_at": cv.Time,
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return nil, fmt.Errorf("marshal config_version: %w", err)
	}
	b := tx.Bucket([]byte(bucketConfigVersions))
	if err := b.Put(vBytes, data); err != nil {
		return nil, fmt.Errorf("put config_version: %w", err)
	}

	f.emitEvent(bucketConfigVersions, fmt.Sprintf("%d", version), "INSERT")

	// Return the version number.
	result, _ := json.Marshal(version)
	return &CommandResult{Data: result}, nil
}

// ---------------------------------------------------------------------------
// Audit log operations
// ---------------------------------------------------------------------------

type auditEntryData struct {
	ID   string          `json:"id"`
	Data json.RawMessage `json:"data"`
}

func (f *fsm) applyAppendAuditEntry(tx *bolt.Tx, cmd Command) (*CommandResult, error) {
	var ae auditEntryData
	if err := json.Unmarshal(cmd.Data, &ae); err != nil {
		return nil, fmt.Errorf("unmarshal audit_entry data: %w", err)
	}
	b := tx.Bucket([]byte(bucketAuditLog))
	if err := b.Put([]byte(ae.ID), ae.Data); err != nil {
		return nil, fmt.Errorf("put audit_entry: %w", err)
	}
	f.emitEvent(bucketAuditLog, ae.ID, "INSERT")
	return &CommandResult{}, nil
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

type fsmSnapshot struct {
	tx *bolt.Tx
}

func (s *fsmSnapshot) Persist(sink hraft.SnapshotSink) error {
	defer func() { _ = s.tx.Rollback() }()
	_, err := s.tx.WriteTo(sink)
	if err != nil {
		_ = sink.Cancel()
		return fmt.Errorf("write snapshot: %w", err)
	}
	return sink.Close()
}

func (s *fsmSnapshot) Release() {
	_ = s.tx.Rollback()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// view runs a read-only transaction on the FSM's bbolt database.
// Safe to call concurrently — holds dbMu.RLock to prevent racing
// with Restore() which swaps the db pointer.
func (f *fsm) view(fn func(tx *bolt.Tx) error) error {
	f.dbMu.RLock()
	db := f.db
	f.dbMu.RUnlock()
	return db.View(fn)
}

func (f *fsm) emitEvent(table, rowID, operation string) {
	if f.notify == nil {
		return
	}
	select {
	case f.notify <- fsmEvent{Table: table, RowID: rowID, Operation: operation}:
	default:
	}
}

func opToString(op CommandOp) string {
	switch { //nolint:staticcheck // switch on string op is clearer than tagged switch here
	case op == OpCreateRoute || op == OpCreateService || op == OpCreatePolicy:
		return "INSERT"
	case op == OpUpdateRoute || op == OpUpdateService || op == OpUpdatePolicy:
		return "UPDATE"
	default:
		return "DELETE"
	}
}

func writeFile(path string, data []byte) error {
	return os.WriteFile(path, data, 0600)
}
