package raft

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	hraft "github.com/hashicorp/raft"
	raftboltdb "github.com/hashicorp/raft-boltdb/v2"
	bolt "go.etcd.io/bbolt"

	"github.com/riokulabs/rioku/internal/store"
)

func init() {
	store.Register("raft", func() store.Driver {
		return &Driver{}
	})
}

// RaftConfig holds raft-specific configuration.
type RaftConfig struct {
	// NodeID uniquely identifies this node in the cluster.
	NodeID string
	// DataDir is where raft logs, snapshots, and the FSM bbolt db are stored.
	DataDir string
	// BindAddr is the address this node listens on for raft traffic (e.g. "0.0.0.0:7779").
	BindAddr string
	// AdvertiseAddr is the address other nodes use to reach this node.
	AdvertiseAddr string
	// Bootstrap indicates this is the first node forming a new cluster.
	Bootstrap bool
	// JoinAddrs are addresses of existing cluster members to join.
	JoinAddrs []string
}

// Driver implements store.Driver using hashicorp/raft with bbolt FSM.
type Driver struct {
	mu     sync.RWMutex
	raft   *hraft.Raft
	fsm    *fsm
	config RaftConfig

	logStore    hraft.LogStore
	stableStore hraft.StableStore
	snapStore   hraft.SnapshotStore
	transport   *hraft.NetworkTransport

	notify   chan store.ChangeEvent
	fsmChan  chan fsmEvent
	closed   bool
	stopOnce sync.Once
	stopCh   chan struct{}
}

func (d *Driver) Open(ctx context.Context, cfg store.DriverConfig) error {
	// Parse raft-specific config from DriverConfig. For the spike, we
	// embed RaftConfig in the DSN as JSON or use SetRaftConfig.
	if d.config.DataDir == "" {
		return fmt.Errorf("raft: DataDir is required (call SetRaftConfig before Open)")
	}

	if err := os.MkdirAll(d.config.DataDir, 0750); err != nil {
		return fmt.Errorf("raft: create data dir: %w", err)
	}

	d.notify = make(chan store.ChangeEvent, 64)
	d.fsmChan = make(chan fsmEvent, 256)
	d.stopCh = make(chan struct{})

	// Open FSM bbolt database.
	fsmDBPath := filepath.Join(d.config.DataDir, "fsm.db")
	fsmDB, err := bolt.Open(fsmDBPath, 0600, &bolt.Options{Timeout: 5 * time.Second})
	if err != nil {
		return fmt.Errorf("raft: open fsm db: %w", err)
	}

	d.fsm = &fsm{db: fsmDB, notify: d.fsmChan}
	if err := d.fsm.initBuckets(); err != nil {
		_ = fsmDB.Close()
		return fmt.Errorf("raft: init buckets: %w", err)
	}

	// One-shot migration: ensure the upstreams_by_service index is fully
	// populated from the upstreams bucket. New installs are no-ops; legacy
	// dbs that pre-date the index get backfilled exactly once. Idempotent.
	if err := d.fsm.rebuildUpstreamIndex(); err != nil {
		_ = fsmDB.Close()
		return fmt.Errorf("raft: rebuild upstream index: %w", err)
	}

	// Set up raft log store and stable store (separate bbolt db).
	raftDBPath := filepath.Join(d.config.DataDir, "raft.db")
	boltStore, err := raftboltdb.NewBoltStore(raftDBPath)
	if err != nil {
		_ = fsmDB.Close()
		return fmt.Errorf("raft: open bolt store: %w", err)
	}
	d.logStore = boltStore
	d.stableStore = boltStore

	// Snapshot store.
	d.snapStore, err = hraft.NewFileSnapshotStore(d.config.DataDir, 2, os.Stderr)
	if err != nil {
		_ = boltStore.Close()
		_ = fsmDB.Close()
		return fmt.Errorf("raft: snapshot store: %w", err)
	}

	// Transport.
	addr, err := net.ResolveTCPAddr("tcp", d.config.BindAddr)
	if err != nil {
		_ = boltStore.Close()
		_ = fsmDB.Close()
		return fmt.Errorf("raft: resolve bind addr: %w", err)
	}

	advertise, err := net.ResolveTCPAddr("tcp", d.config.AdvertiseAddr)
	if err != nil {
		advertise = addr
	}

	transport, err := hraft.NewTCPTransport(
		d.config.BindAddr,
		advertise,
		3,              // maxPool
		10*time.Second, // timeout
		os.Stderr,
	)
	if err != nil {
		_ = boltStore.Close()
		_ = fsmDB.Close()
		return fmt.Errorf("raft: transport: %w", err)
	}
	d.transport = transport

	// Raft configuration.
	raftCfg := hraft.DefaultConfig()
	raftCfg.LocalID = hraft.ServerID(d.config.NodeID)

	// Create raft instance.
	d.raft, err = hraft.NewRaft(raftCfg, d.fsm, d.logStore, d.stableStore, d.snapStore, d.transport)
	if err != nil {
		_ = d.transport.Close()
		_ = boltStore.Close()
		_ = fsmDB.Close()
		return fmt.Errorf("raft: create raft: %w", err)
	}

	// Bootstrap if this is the first node.
	if d.config.Bootstrap {
		cfg := hraft.Configuration{
			Servers: []hraft.Server{
				{
					ID:      hraft.ServerID(d.config.NodeID),
					Address: hraft.ServerAddress(d.config.AdvertiseAddr),
				},
			},
		}
		f := d.raft.BootstrapCluster(cfg)
		if err := f.Error(); err != nil && err != hraft.ErrCantBootstrap {
			// ErrCantBootstrap means already bootstrapped, which is fine.
			return fmt.Errorf("raft: bootstrap: %w", err)
		}
	}

	// Start the event relay goroutine.
	go d.relayEvents()

	return nil
}

// SetRaftConfig sets the raft-specific configuration before Open is called.
func (d *Driver) SetRaftConfig(cfg RaftConfig) {
	d.config = cfg
}

func (d *Driver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return nil
	}
	d.closed = true

	d.stopOnce.Do(func() { close(d.stopCh) })

	// Attempt leadership transfer for graceful handoff.
	if d.raft.State() == hraft.Leader {
		d.raft.LeadershipTransfer()
	}

	var errs []error
	if f := d.raft.Shutdown(); f.Error() != nil {
		errs = append(errs, f.Error())
	}
	if d.transport != nil {
		if err := d.transport.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if ls, ok := d.logStore.(interface{ Close() error }); ok {
		if err := ls.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if d.fsm != nil && d.fsm.db != nil {
		if err := d.fsm.db.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	// d.notify is closed by the relayEvents goroutine when it sees stopCh.

	if len(errs) > 0 {
		return fmt.Errorf("raft: close errors: %v", errs)
	}
	return nil
}

func (d *Driver) Ping(_ context.Context) error {
	if d.raft == nil {
		return fmt.Errorf("raft: not initialized")
	}
	return nil
}

func (d *Driver) Migrate(_ context.Context, _ store.MigrateDirection) error {
	// Raft store uses buckets, not SQL migrations. Buckets are created in initBuckets.
	return nil
}

func (d *Driver) CurrentVersion(_ context.Context) (int, error) {
	// No schema versions for the KV store.
	return 1, nil
}

func (d *Driver) Begin(ctx context.Context, opts store.TxOptions) (store.Tx, error) {
	return &raftTx{
		driver:   d,
		readOnly: opts.ReadOnly,
		ctx:      ctx,
	}, nil
}

func (d *Driver) Notify() <-chan store.ChangeEvent {
	return d.notify
}

func (d *Driver) Health(_ context.Context) store.DriverHealth {
	if d.raft == nil {
		return store.DriverHealth{OK: false, Mode: store.ModeDegraded}
	}

	state := d.raft.State()
	leader, _ := d.raft.LeaderWithID()
	stats := d.raft.Stats()

	details := map[string]string{
		"state":        state.String(),
		"leader":       string(leader),
		"term":         stats["term"],
		"commit_index": stats["commit_index"],
		"num_peers":    stats["num_peers"],
	}

	mode := store.ModeSingle
	switch state {
	case hraft.Leader:
		mode = store.ModePrimary
	case hraft.Follower:
		mode = store.ModeReplica
	case hraft.Candidate:
		mode = store.ModeDegraded
	}

	return store.DriverHealth{
		OK:      state == hraft.Leader || state == hraft.Follower,
		Mode:    mode,
		Details: details,
	}
}

// AddVoter adds a new voter to the raft cluster. Only callable on the leader.
func (d *Driver) AddVoter(id, addr string) error {
	f := d.raft.AddVoter(hraft.ServerID(id), hraft.ServerAddress(addr), 0, 10*time.Second)
	return f.Error()
}

// RemoveServer removes a server from the raft cluster.
func (d *Driver) RemoveServer(id string) error {
	f := d.raft.RemoveServer(hraft.ServerID(id), 0, 10*time.Second)
	return f.Error()
}

// IsLeader returns true if this node is the current raft leader.
func (d *Driver) IsLeader() bool {
	return d.raft.State() == hraft.Leader
}

// LeaderAddr returns the address of the current leader.
func (d *Driver) LeaderAddr() string {
	addr, _ := d.raft.LeaderWithID()
	return string(addr)
}

// apply submits a command to the raft leader and waits for it to be committed.
// Note: We don't pre-check IsLeader() because it's a TOCTOU race — leadership
// can change between the check and Apply(). Instead we let raft.Apply() return
// ErrNotLeader, which is authoritative.
func (d *Driver) apply(op CommandOp, data any) (*CommandResult, error) {
	cmdBytes, err := encodeCommand(op, data)
	if err != nil {
		return nil, err
	}

	f := d.raft.Apply(cmdBytes, 10*time.Second)
	if err := f.Error(); err != nil {
		return nil, fmt.Errorf("raft: apply: %w", err)
	}

	result, ok := f.Response().(*CommandResult)
	if !ok {
		return nil, fmt.Errorf("raft: unexpected response type %T", f.Response())
	}
	if result.Error != "" {
		return nil, fmt.Errorf("raft: %s", result.Error)
	}
	return result, nil
}

// readFSM performs a read-only operation on the local bbolt FSM.
// Thread-safe — uses fsm.view() which guards against Restore() swapping the db.
func (d *Driver) readFSM(fn func(tx *bolt.Tx) error) error {
	return d.fsm.view(fn)
}

// relayEvents forwards FSM events to the store.ChangeEvent channel.
// It closes d.notify when it exits, so Close() must NOT close d.notify.
func (d *Driver) relayEvents() {
	defer func() {
		d.mu.Lock()
		if d.notify != nil {
			close(d.notify)
			d.notify = nil
		}
		d.mu.Unlock()
	}()
	for {
		select {
		case <-d.stopCh:
			return
		case evt, ok := <-d.fsmChan:
			if !ok {
				return
			}
			d.mu.RLock()
			ch := d.notify
			d.mu.RUnlock()
			if ch == nil {
				return
			}
			select {
			case ch <- store.ChangeEvent{
				Table:     evt.Table,
				RowID:     evt.RowID,
				Operation: evt.Operation,
			}:
			default:
			}
		}
	}
}

// readEntity reads a single entity from a bucket by ID and unmarshals it.

// listEntities lists all entities from a bucket.
