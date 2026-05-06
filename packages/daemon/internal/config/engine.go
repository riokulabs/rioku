// Package config implements the config engine that sits between the
// gRPC service layer and the store driver. It handles validation,
// versioning, audit logging, and Caddy config compilation.
package config

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/store"
)

// AuditEventDispatchFn is the narrow surface the engine calls after
// committing an audit entry. The notifications package wires a closure
// that calls EventRouter.AsyncEvaluateAndDispatch with a translated
// envelope. Using a function type (rather than an interface with a
// struct param) keeps the config package free of any notifications
// dependency while side-stepping Go's nominal type-identity rules.
type AuditEventDispatchFn func(tenantID string, env AuditEventEnvelope)

// AuditEventEnvelope describes the audit row in a kind-agnostic way so
// the notifications package can match it against routing rules. Mirrors
// notifications.AuditEnvelope; the engine projects into this neutral
// shape so the config package never imports notifications.
type AuditEventEnvelope struct {
	Kind       string
	Category   string
	Subtype    string
	Severity   string
	Subject    string
	Body       string
	Actor      string
	EntityType string
	EntityID   string
	Extra      map[string]any
}

// Engine orchestrates config validation, versioning, audit logging, and
// Caddy config compilation. It is the single entry point for all config
// mutations.
type Engine struct {
	store          store.Driver
	compiler       *caddy.Compiler
	mu             sync.RWMutex
	cachedSnapshot *riokuv1.ConfigSnapshot

	// auditDispatcher (optional) receives an envelope after every
	// successful audit-entry commit. Nil = no event routing.
	auditDispatcher AuditEventDispatchFn
}

// SetAuditDispatcher installs (or clears) the post-commit audit event
// dispatcher. Nil disables event routing.
func (e *Engine) SetAuditDispatcher(fn AuditEventDispatchFn) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.auditDispatcher = fn
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

	// Fire-and-forget event routing for the just-committed audit entry.
	// We are still holding e.mu (write lock) here, so it is safe to read
	// e.auditDispatcher directly without an additional RLock — and the
	// RWMutex is NOT re-entrant, so an explicit RLock would deadlock.
	dispatcher := e.auditDispatcher
	if dispatcher != nil {
		tenantID := store.TenantIDFromContext(ctx)
		dispatcher(tenantID, AuditEventEnvelope{
			Kind:       entityType + "." + operation,
			Category:   "audit",
			Subtype:    operation,
			Severity:   "info",
			Subject:    fmt.Sprintf("%s %s", entityType, operation),
			Body:       fmt.Sprintf("%s/%s by %s (config version %d)", entityType, entityID, actor, version),
			Actor:      actor,
			EntityType: entityType,
			EntityID:   entityID,
		})
	}

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
//
// CompileCaddyConfig performs the snapshot read and per-route plugin
// (#171 OAS validator, #172 Coraza WAF) load in a single read tx so
// the compiler sees a consistent view: a route's per-route config row
// is paired with the route definition that referenced it.
func (e *Engine) CompileCaddyConfig(ctx context.Context) ([]byte, error) {
	tx, err := e.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		// Store unavailable: fall back to GetConfig's cached-snapshot
		// path, but without per-route plugins (we have no way to
		// resurrect them without the store). This matches the
		// pre-#171/#172 behaviour and keeps Caddy reload working
		// during a transient store outage.
		snap, gerr := e.GetConfig(ctx)
		if gerr != nil {
			return nil, fmt.Errorf("config: get snapshot for compile: %w", gerr)
		}
		data, cerr := e.compiler.Compile(snap)
		if cerr != nil {
			return nil, fmt.Errorf("config: compile caddy config: %w", cerr)
		}
		return data, nil
	}
	defer func() { _ = tx.Rollback() }()

	snap, err := buildSnapshot(ctx, tx)
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}

	perRoute, err := loadPerRoutePlugins(ctx, tx, snap.GetRoutes())
	if err != nil {
		return nil, fmt.Errorf("config: load per-route plugins: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("config: commit read tx: %w", err)
	}

	// Refresh the cached snapshot too — same shape as GetConfig.
	e.mu.Lock()
	e.cachedSnapshot = snap
	e.mu.Unlock()

	data, err := e.compiler.CompileWithPlugins(snap, perRoute)
	if err != nil {
		return nil, fmt.Errorf("config: compile caddy config: %w", err)
	}
	return data, nil
}

// loadPerRoutePlugins fetches per-route OAS / WAF config rows for
// every route in the snapshot. Missing rows (the common case for
// routes that don't enable either plugin) are silently skipped.
func loadPerRoutePlugins(ctx context.Context, tx store.Tx, routes []*riokuv1.Route) (caddy.PerRoutePlugins, error) {
	out := caddy.PerRoutePlugins{
		OASByRoute: make(map[string]*caddy.RouteOASConfig),
		WAFByRoute: make(map[string]*caddy.RouteWAFConfig),
	}
	for _, route := range routes {
		if !route.GetEnabled() {
			continue
		}
		id := route.GetId()

		oasCfg, err := tx.GetRouteOASConfig(ctx, id)
		switch {
		case err == nil:
			out.OASByRoute[id] = &caddy.RouteOASConfig{
				OASURL:                 oasCfg.OASURL,
				OASInline:              oasCfg.OASInline,
				RefreshIntervalSeconds: oasCfg.RefreshIntervalSeconds,
				ValidateRequestBody:    oasCfg.ValidateRequestBody,
				ValidateRequestParams:  oasCfg.ValidateRequestParams,
				RejectUnknown:          oasCfg.RejectUnknown,
			}
		case errors.Is(err, store.ErrRouteOASConfigNotFound):
			// Common case — route has no OAS config row.
		default:
			return caddy.PerRoutePlugins{}, fmt.Errorf("get oas config for route %q: %w", id, err)
		}

		wafCfg, err := tx.GetRouteWAFConfig(ctx, id)
		switch {
		case err == nil:
			out.WAFByRoute[id] = &caddy.RouteWAFConfig{
				Enabled:          wafCfg.Enabled,
				Mode:             caddy.WAFMode(string(wafCfg.Mode)),
				RuleSet:          wafCfg.RuleSet,
				ParanoiaLevel:    wafCfg.ParanoiaLevel,
				ExcludedRuleIDs:  wafCfg.ExcludedRuleIDs,
				RequestBodyLimit: wafCfg.RequestBodyLimit,
			}
		case errors.Is(err, store.ErrRouteWAFConfigNotFound):
			// Common case — route has no WAF config row.
		default:
			return caddy.PerRoutePlugins{}, fmt.Errorf("get waf config for route %q: %w", id, err)
		}
	}

	// Load MCP gateway routes (#201). The MCP path doesn't depend
	// on the snapshot's per-route map — every mcp_route row across
	// all tenants emerges as its own Caddy route in the shared
	// traffic server. The auth-passthrough credential resolution
	// happens here (vault refs are translated to plaintext via the
	// engine's resolver).
	mcpRoutes, err := tx.ListAllMCPRoutes(ctx)
	if err != nil {
		// Best-effort — a stub-only driver (raft) returns "not
		// implemented"; fall through with an empty list rather
		// than failing the compile entirely.
		mcpRoutes = nil
	}
	if len(mcpRoutes) > 0 {
		out.MCPRoutes = make([]caddy.MCPRouteCompileConfig, 0, len(mcpRoutes))
		for _, mr := range mcpRoutes {
			if !mr.Enabled {
				continue
			}
			tenantCtx := store.WithTenantID(ctx, mr.TenantID)
			srv, gerr := tx.GetMCPServer(tenantCtx, mr.TenantID, mr.MCPServerID)
			if gerr != nil || srv == nil {
				continue
			}
			compileCfg := caddy.MCPRouteCompileConfig{
				ID:              mr.ID,
				TenantID:        mr.TenantID,
				Hostname:        mr.Hostname,
				PathPrefix:      mr.PathPrefix,
				UpstreamURL:     srv.URL,
				AuthPassthrough: caddy.MCPRouteAuthMode(string(mr.AuthPassthrough)),
			}
			if srv.AuthCredential != nil {
				compileCfg.UpstreamCredential = *srv.AuthCredential
			}
			out.MCPRoutes = append(out.MCPRoutes, compileCfg)
		}
	}
	return out, nil
}
