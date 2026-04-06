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
	store    store.Driver
	compiler *caddy.Compiler
	mu       sync.RWMutex
}

// NewEngine creates a new config engine backed by the given store and
// Caddy compiler.
func NewEngine(s store.Driver, c *caddy.Compiler) *Engine {
	return &Engine{
		store:    s,
		compiler: c,
	}
}

// --------------------------------------------------------------------------
// GetConfig
// --------------------------------------------------------------------------

// GetConfig returns the current config snapshot (all routes, services, and
// policies) along with the latest config version.
func (e *Engine) GetConfig(ctx context.Context) (*riokuv1.ConfigSnapshot, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	tx, err := e.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("config: begin read tx: %w", err)
	}
	defer tx.Rollback()

	snap, err := buildSnapshot(ctx, tx)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("config: commit read tx: %w", err)
	}
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
	defer tx.Rollback()

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
	go func() {
		defer close(out)
		if notify == nil {
			// Backend does not support notifications; block until
			// context cancellation.
			<-ctx.Done()
			return
		}
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

// translateChangeEvent converts a store.ChangeEvent into a ConfigEvent.
func translateChangeEvent(ce store.ChangeEvent) *riokuv1.ConfigEvent {
	evt := &riokuv1.ConfigEvent{
		OccurredAt: timestamppb.Now(),
	}
	switch ce.Table {
	case "routes":
		if ce.Operation == "DELETE" {
			evt.Type = riokuv1.ConfigEvent_TYPE_ROUTE_DELETED
		} else {
			evt.Type = riokuv1.ConfigEvent_TYPE_ROUTE_UPSERTED
		}
	case "services":
		if ce.Operation == "DELETE" {
			evt.Type = riokuv1.ConfigEvent_TYPE_SERVICE_DELETED
		} else {
			evt.Type = riokuv1.ConfigEvent_TYPE_SERVICE_UPSERTED
		}
	case "policies":
		if ce.Operation == "DELETE" {
			evt.Type = riokuv1.ConfigEvent_TYPE_POLICY_DELETED
		} else {
			evt.Type = riokuv1.ConfigEvent_TYPE_POLICY_UPSERTED
		}
	}
	return evt
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
	defer tx.Rollback()

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
// ImportConfig
// --------------------------------------------------------------------------

// ImportConfig replaces the entire config with the contents of the given
// snapshot. All existing routes, services, and policies are deleted and
// replaced with those from the snapshot. A new config version and audit
// entry are recorded.
func (e *Engine) ImportConfig(ctx context.Context, snapshot *riokuv1.ConfigSnapshot, actor string) (*riokuv1.ImportResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	tx, err := e.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("config: begin tx: %w", err)
	}
	defer tx.Rollback()

	// Delete all existing entities.
	if err := deleteAll(ctx, tx); err != nil {
		return nil, err
	}

	// Create all entities from snapshot. Services must be created first
	// because routes may reference them via service_id. We track the
	// old-to-new ID mapping so we can fix up route targets.
	var routeCount, serviceCount, policyCount int32
	svcIDMap := make(map[string]string) // old ID -> new ID

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

	for _, route := range snapshot.GetRoutes() {
		// Remap service_id if the route targets a service.
		if oldSvcID := route.GetServiceId(); oldSvcID != "" {
			if newSvcID, ok := svcIDMap[oldSvcID]; ok {
				route.Target = &riokuv1.Route_ServiceId{ServiceId: newSvcID}
			}
		}
		if _, err := tx.CreateRoute(ctx, route); err != nil {
			return nil, fmt.Errorf("config: import route %q: %w", route.GetName(), err)
		}
		routeCount++
	}

	for _, pol := range snapshot.GetPolicies() {
		if _, err := tx.CreatePolicy(ctx, pol); err != nil {
			return nil, fmt.Errorf("config: import policy %q: %w", pol.GetName(), err)
		}
		policyCount++
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

// --------------------------------------------------------------------------
// Helpers: snapshot builder
// --------------------------------------------------------------------------

// buildSnapshot assembles a ConfigSnapshot from the data in the given
// transaction.
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

	return &riokuv1.ConfigSnapshot{
		Version:    version,
		Routes:     routes,
		Services:   services,
		Policies:   policies,
		SnapshotAt: timestamppb.Now(),
	}, nil
}

// --------------------------------------------------------------------------
// Helpers: operation dispatch
// --------------------------------------------------------------------------

// applyRouteOp executes a route create, update, or delete inside the given
// transaction. It returns the entity ID, the operation string for audit
// logging, and any error.
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
				return updated.GetId(), "UPDATE", nil
			}
		}
		// Create new.
		created, err := tx.CreateRoute(ctx, route)
		if err != nil {
			return "", "", fmt.Errorf("config: create route: %w", err)
		}
		return created.GetId(), "CREATE", nil

	case riokuv1.RouteOp_DELETE:
		id := op.GetId()
		if id == "" {
			id = op.GetRoute().GetId()
		}
		if err := tx.DeleteRoute(ctx, id); err != nil {
			return "", "", fmt.Errorf("config: delete route: %w", err)
		}
		return id, "DELETE", nil

	default:
		return "", "", fmt.Errorf("config: unknown route action %v", op.GetAction())
	}
}

// applyServiceOp executes a service create, update, or delete.
func applyServiceOp(ctx context.Context, tx store.Tx, op *riokuv1.ServiceOp) (string, string, error) {
	switch op.GetAction() {
	case riokuv1.ServiceOp_UPSERT:
		svc := op.GetService()
		if svc == nil {
			return "", "", fmt.Errorf("config: service upsert: service is nil")
		}
		if id := svc.GetId(); id != "" {
			existing, _ := tx.GetService(ctx, id)
			if existing != nil {
				updated, err := tx.UpdateService(ctx, svc)
				if err != nil {
					return "", "", fmt.Errorf("config: update service: %w", err)
				}
				return updated.GetId(), "UPDATE", nil
			}
		}
		created, err := tx.CreateService(ctx, svc)
		if err != nil {
			return "", "", fmt.Errorf("config: create service: %w", err)
		}
		return created.GetId(), "CREATE", nil

	case riokuv1.ServiceOp_DELETE:
		id := op.GetId()
		if id == "" {
			id = op.GetService().GetId()
		}
		if err := tx.DeleteService(ctx, id); err != nil {
			return "", "", fmt.Errorf("config: delete service: %w", err)
		}
		return id, "DELETE", nil

	default:
		return "", "", fmt.Errorf("config: unknown service action %v", op.GetAction())
	}
}

// applyPolicyOp executes a policy create, update, or delete.
func applyPolicyOp(ctx context.Context, tx store.Tx, op *riokuv1.PolicyOp) (string, string, error) {
	switch op.GetAction() {
	case riokuv1.PolicyOp_UPSERT:
		pol := op.GetPolicy()
		if pol == nil {
			return "", "", fmt.Errorf("config: policy upsert: policy is nil")
		}
		if id := pol.GetId(); id != "" {
			existing, _ := tx.GetPolicy(ctx, id)
			if existing != nil {
				updated, err := tx.UpdatePolicy(ctx, pol)
				if err != nil {
					return "", "", fmt.Errorf("config: update policy: %w", err)
				}
				return updated.GetId(), "UPDATE", nil
			}
		}
		created, err := tx.CreatePolicy(ctx, pol)
		if err != nil {
			return "", "", fmt.Errorf("config: create policy: %w", err)
		}
		return created.GetId(), "CREATE", nil

	case riokuv1.PolicyOp_DELETE:
		id := op.GetId()
		if id == "" {
			id = op.GetPolicy().GetId()
		}
		if err := tx.DeletePolicy(ctx, id); err != nil {
			return "", "", fmt.Errorf("config: delete policy: %w", err)
		}
		return id, "DELETE", nil

	default:
		return "", "", fmt.Errorf("config: unknown policy action %v", op.GetAction())
	}
}

// --------------------------------------------------------------------------
// Helpers: validation
// --------------------------------------------------------------------------

// validateChange checks that a ConfigChange is well-formed before applying
// it to the store. Returns a descriptive error on failure.
func validateChange(change *riokuv1.ConfigChange) error {
	if change == nil {
		return fmt.Errorf("change is nil")
	}

	switch op := change.GetOperation().(type) {
	case *riokuv1.ConfigChange_Route:
		return validateRouteOp(op.Route)
	case *riokuv1.ConfigChange_Service:
		return validateServiceOp(op.Service)
	case *riokuv1.ConfigChange_Policy:
		return validatePolicyOp(op.Policy)
	default:
		return fmt.Errorf("operation is required")
	}
}

func validateRouteOp(op *riokuv1.RouteOp) error {
	if op == nil {
		return fmt.Errorf("route operation is nil")
	}
	switch op.GetAction() {
	case riokuv1.RouteOp_UPSERT:
		route := op.GetRoute()
		if route == nil {
			return fmt.Errorf("route is required for upsert")
		}
		if route.GetName() == "" {
			return fmt.Errorf("route name is required")
		}
		if len(route.GetMatchers()) == 0 {
			return fmt.Errorf("route must have at least one matcher")
		}
		// Exactly one of service_id or upstream target must be set.
		hasServiceID := route.GetServiceId() != ""
		hasUpstream := route.GetUpstream() != nil
		if !hasServiceID && !hasUpstream {
			return fmt.Errorf("route must have either a service_id or an upstream target")
		}
		if hasServiceID && hasUpstream {
			return fmt.Errorf("route must have exactly one of service_id or upstream target, not both")
		}
		return nil

	case riokuv1.RouteOp_DELETE:
		id := op.GetId()
		if id == "" {
			id = op.GetRoute().GetId()
		}
		if id == "" {
			return fmt.Errorf("id is required for route delete")
		}
		return nil

	default:
		return fmt.Errorf("route action is required")
	}
}

func validateServiceOp(op *riokuv1.ServiceOp) error {
	if op == nil {
		return fmt.Errorf("service operation is nil")
	}
	switch op.GetAction() {
	case riokuv1.ServiceOp_UPSERT:
		svc := op.GetService()
		if svc == nil {
			return fmt.Errorf("service is required for upsert")
		}
		if svc.GetName() == "" {
			return fmt.Errorf("service name is required")
		}
		return nil

	case riokuv1.ServiceOp_DELETE:
		id := op.GetId()
		if id == "" {
			id = op.GetService().GetId()
		}
		if id == "" {
			return fmt.Errorf("id is required for service delete")
		}
		return nil

	default:
		return fmt.Errorf("service action is required")
	}
}

func validatePolicyOp(op *riokuv1.PolicyOp) error {
	if op == nil {
		return fmt.Errorf("policy operation is nil")
	}
	switch op.GetAction() {
	case riokuv1.PolicyOp_UPSERT:
		pol := op.GetPolicy()
		if pol == nil {
			return fmt.Errorf("policy is required for upsert")
		}
		if pol.GetName() == "" {
			return fmt.Errorf("policy name is required")
		}
		if pol.GetType() == riokuv1.PolicyType_POLICY_TYPE_UNSPECIFIED {
			return fmt.Errorf("policy type must be specified")
		}
		return nil

	case riokuv1.PolicyOp_DELETE:
		id := op.GetId()
		if id == "" {
			id = op.GetPolicy().GetId()
		}
		if id == "" {
			return fmt.Errorf("id is required for policy delete")
		}
		return nil

	default:
		return fmt.Errorf("policy action is required")
	}
}

// --------------------------------------------------------------------------
// Helpers: bulk delete for import
// --------------------------------------------------------------------------

// deleteAll removes all routes, services, and policies from the store.
func deleteAll(ctx context.Context, tx store.Tx) error {
	routes, err := tx.ListRoutes(ctx)
	if err != nil {
		return fmt.Errorf("config: list routes for delete: %w", err)
	}
	for _, r := range routes {
		if err := tx.DeleteRoute(ctx, r.GetId()); err != nil {
			return fmt.Errorf("config: delete route %q: %w", r.GetId(), err)
		}
	}

	services, err := tx.ListServices(ctx)
	if err != nil {
		return fmt.Errorf("config: list services for delete: %w", err)
	}
	for _, s := range services {
		if err := tx.DeleteService(ctx, s.GetId()); err != nil {
			return fmt.Errorf("config: delete service %q: %w", s.GetId(), err)
		}
	}

	policies, err := tx.ListPolicies(ctx)
	if err != nil {
		return fmt.Errorf("config: list policies for delete: %w", err)
	}
	for _, p := range policies {
		if err := tx.DeletePolicy(ctx, p.GetId()); err != nil {
			return fmt.Errorf("config: delete policy %q: %w", p.GetId(), err)
		}
	}
	return nil
}
