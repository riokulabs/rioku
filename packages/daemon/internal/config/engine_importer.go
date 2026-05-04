package config

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
)

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
	policyIDMap := make(map[string]string) // old ID -> new ID

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

	// Update cached snapshot so subsequent reads reflect this import
	// even if the store becomes unavailable.
	e.cachedSnapshot = newSnap

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
// Helpers: bulk delete for import
// --------------------------------------------------------------------------

// deleteAll removes all routes, services, and policies from the store.
// Uses individual deletes via the Tx interface. A future optimization would
// add a BulkDelete method to Tx and use DELETE FROM <table> directly.
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
