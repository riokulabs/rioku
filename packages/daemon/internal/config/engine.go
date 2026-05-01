// Package config implements the config engine that sits between the
// gRPC service layer and the store driver. It handles validation,
// versioning, audit logging, and Caddy config compilation.
package config

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/store"
)

// Engine orchestrates config validation, versioning, audit logging, and
// Caddy config compilation. It is the single entry point for all config
// mutations.
type Engine struct {
	store          store.Driver
	compiler       *caddy.Compiler
	mu             sync.RWMutex
	cachedSnapshot *riokuv1.ConfigSnapshot
}

// NewEngine creates a new config engine backed by the given store and
// Caddy compiler.
func NewEngine(s store.Driver, c *caddy.Compiler) *Engine {
	return &Engine{
		store:    s,
		compiler: c,
	}
}

// SetCompiler replaces the Caddy compiler. Used when the compiler config
// depends on runtime state (e.g., the gateway's OS-assigned port).
func (e *Engine) SetCompiler(c *caddy.Compiler) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.compiler = c
}

// CachedSnapshot returns the last successfully-read config snapshot, or nil
// if no successful read has occurred yet.
func (e *Engine) CachedSnapshot() *riokuv1.ConfigSnapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.cachedSnapshot
}

// --------------------------------------------------------------------------
// GetConfig
// --------------------------------------------------------------------------

// GetConfig returns the current config snapshot (all routes, services, and
// policies) along with the latest config version. If the store is
// unavailable and a previously cached snapshot exists, the cached
// snapshot is returned instead of an error (graceful degradation).
func (e *Engine) GetConfig(ctx context.Context) (*riokuv1.ConfigSnapshot, error) {
	// No Go-level lock for reads — the store driver handles concurrency
	// (SQLite WAL, raft FSM view, Postgres MVCC all support concurrent readers).
	tx, err := e.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		e.mu.RLock()
		cached := e.cachedSnapshot
		e.mu.RUnlock()
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("config: store unavailable and no cached snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	snap, err := buildSnapshot(ctx, tx)
	if err != nil {
		e.mu.RLock()
		cached := e.cachedSnapshot
		e.mu.RUnlock()
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("config: %w", err)
	}

	if err := tx.Commit(); err != nil {
		e.mu.RLock()
		cached := e.cachedSnapshot
		e.mu.RUnlock()
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("config: commit read tx: %w", err)
	}

	e.mu.Lock()
	e.cachedSnapshot = snap
	e.mu.Unlock()

	return snap, nil
}

// --------------------------------------------------------------------------
// ApplyChange
// --------------------------------------------------------------------------

// ApplyChange validates and applies a single config mutation inside an
// atomic transaction. It records a config version and audit entry, then
// returns the result with mutation metadata.
func (e *Engine) ApplyChange(ctx context.Context, change *riokuv1.ConfigChange, actor string) (*riokuv1.ApplyResult, error) {
	if err := validateChange(change); err != nil {
		return nil, fmt.Errorf("config: validation: %w", err)
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	tx, err := e.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("config: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Optimistic locking: if the caller provided an expected version,
	// verify it matches the current latest before proceeding.
	if ev := change.GetExpectedVersion(); ev > 0 {
		current, err := tx.LatestConfigVersion(ctx)
		if err != nil {
			return nil, fmt.Errorf("config: latest version: %w", err)
		}
		if current != ev {
			return nil, fmt.Errorf("config: version conflict: expected %d but current is %d", ev, current)
		}
	}

	// Execute the operation.
	var entityType, entityID, operation string
	switch op := change.GetOperation().(type) {
	case *riokuv1.ConfigChange_Route:
		entityType = "route"
		entityID, operation, err = applyRouteOp(ctx, tx, op.Route)
	case *riokuv1.ConfigChange_Service:
		entityType = "service"
		entityID, operation, err = applyServiceOp(ctx, tx, op.Service)
	case *riokuv1.ConfigChange_Policy:
		entityType = "policy"
		entityID, operation, err = applyPolicyOp(ctx, tx, op.Policy)
	default:
		return nil, fmt.Errorf("config: unknown operation type")
	}
	if err != nil {
		return nil, err
	}

	// Build snapshot after mutation.
	snap, err := buildSnapshot(ctx, tx)
	if err != nil {
		return nil, err
	}

	// Serialize and save config version.
	snapJSON, err := protojson.Marshal(snap)
	if err != nil {
		return nil, fmt.Errorf("config: marshal snapshot: %w", err)
	}
	version, err := tx.SaveConfigVersion(ctx, snapJSON, actor)
	if err != nil {
		return nil, fmt.Errorf("config: save version: %w", err)
	}

	// Audit entry.
	now := timestamppb.Now()
	auditEntry := &riokuv1.AuditEntry{
		Id:            uuid.New().String(),
		Actor:         actor,
		EntityType:    entityType,
		EntityId:      entityID,
		Operation:     operation,
		ConfigVersion: version,
		OccurredAt:    now,
	}
	if err := tx.AppendAuditEntry(ctx, auditEntry); err != nil {
		return nil, fmt.Errorf("config: audit entry: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("config: commit tx: %w", err)
	}

	// Update cached snapshot so subsequent reads reflect this mutation
	// even if the store becomes unavailable.
	e.cachedSnapshot = snap

	return &riokuv1.ApplyResult{
		Meta: &riokuv1.MutationMeta{
			ConfigVersion: version,
			Actor:         actor,
			MutatedAt:     now,
		},
	}, nil
}

// --------------------------------------------------------------------------
// WatchChanges
// --------------------------------------------------------------------------

// WatchChanges returns a channel that emits ConfigEvents. If sinceVersion
// is greater than zero, a SNAPSHOT event with the current config is sent
// first. Subsequent events are derived from store change notifications.
// The caller should read from the returned channel until it is closed or
// the context is cancelled.
func (e *Engine) WatchChanges(ctx context.Context, sinceVersion int64) (<-chan *riokuv1.ConfigEvent, error) {
	out := make(chan *riokuv1.ConfigEvent, 16)

	// If the caller wants to catch up, send a snapshot first.
	if sinceVersion > 0 {
		snap, err := e.GetConfig(ctx)
		if err != nil {
			close(out)
			return nil, fmt.Errorf("config: get snapshot for watch: %w", err)
		}
		evt := &riokuv1.ConfigEvent{
			Type:       riokuv1.ConfigEvent_TYPE_SNAPSHOT,
			Version:    snap.GetVersion(),
			OccurredAt: timestamppb.Now(),
			Snapshot:   snap,
		}
		select {
		case out <- evt:
		case <-ctx.Done():
			close(out)
			return nil, ctx.Err()
		}
	}

	notify := e.store.Notify()
	if notify == nil {
		// Backend does not support change notifications — return a closed
		// channel immediately so callers don't leak a goroutine waiting.
		close(out)
		return out, nil
	}

	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				return
			case ce, ok := <-notify:
				if !ok {
					return
				}
				evt := translateChangeEvent(ce)
				select {
				case out <- evt:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return out, nil
}

// --------------------------------------------------------------------------
// GetAuditLog
// --------------------------------------------------------------------------

// GetAuditLog queries the audit log with the given filters and returns
// matching entries.
func (e *Engine) GetAuditLog(ctx context.Context, query store.AuditQuery) ([]*riokuv1.AuditEntry, error) {
	tx, err := e.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("config: begin read tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	entries, err := tx.QueryAuditLog(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("config: query audit log: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("config: commit read tx: %w", err)
	}
	return entries, nil
}

// --------------------------------------------------------------------------
// ExportConfig
// --------------------------------------------------------------------------

// ExportConfig returns the current config snapshot. It is functionally
// identical to GetConfig today but exists as a separate method to allow
// future additions (e.g. including audit history in exports).
func (e *Engine) ExportConfig(ctx context.Context) (*riokuv1.ConfigSnapshot, error) {
	return e.GetConfig(ctx)
}

// --------------------------------------------------------------------------
// CompileCaddyConfig
// --------------------------------------------------------------------------

// CompileCaddyConfig builds a Caddy JSON configuration from the current
// config snapshot and returns the raw JSON bytes.
func (e *Engine) CompileCaddyConfig(ctx context.Context) ([]byte, error) {
	snap, err := e.GetConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("config: get snapshot for compile: %w", err)
	}
	data, err := e.compiler.Compile(snap)
	if err != nil {
		return nil, fmt.Errorf("config: compile caddy config: %w", err)
	}
	return data, nil
}
