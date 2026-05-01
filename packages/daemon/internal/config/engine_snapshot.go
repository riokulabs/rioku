package config

import (
	"context"
	"fmt"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
)

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
