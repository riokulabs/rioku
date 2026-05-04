package config

import (
	"context"
	"fmt"
	"strings"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/store"
)

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
			// Name conflict — find existing by name and update instead.
			if strings.Contains(err.Error(), "UNIQUE constraint") || strings.Contains(err.Error(), "duplicate key") {
				if existing := findRouteByName(ctx, tx, route.GetName()); existing != nil {
					route.Id = existing.GetId()
					updated, updateErr := tx.UpdateRoute(ctx, route)
					if updateErr != nil {
						return "", "", fmt.Errorf("config: update route: %w", updateErr)
					}
					if err := syncRoutePolicyIds(ctx, tx, updated.GetId(), route.GetPolicyIds()); err != nil {
						return "", "", err
					}
					return updated.GetId(), "UPDATE", nil
				}
			}
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
			// Name conflict — find existing by name and update instead.
			if strings.Contains(err.Error(), "UNIQUE constraint") || strings.Contains(err.Error(), "duplicate key") {
				if existing := findServiceByName(ctx, tx, svc.GetName()); existing != nil {
					svc.Id = existing.GetId()
					updated, updateErr := tx.UpdateService(ctx, svc)
					if updateErr != nil {
						return "", "", fmt.Errorf("config: update service: %w", updateErr)
					}
					return updated.GetId(), "UPDATE", nil
				}
			}
			return "", "", fmt.Errorf("config: create service: %w", err)
		}
		return created.GetId(), "CREATE", nil

	case riokuv1.ServiceOp_DELETE:
		id := op.GetId()
		if id == "" && op.GetService() != nil {
			id = op.GetService().GetId()
		}
		if id == "" {
			return "", "", fmt.Errorf("config: delete service: id is required")
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
			if strings.Contains(err.Error(), "UNIQUE constraint") || strings.Contains(err.Error(), "duplicate key") {
				if existing := findPolicyByName(ctx, tx, pol.GetName()); existing != nil {
					pol.Id = existing.GetId()
					updated, updateErr := tx.UpdatePolicy(ctx, pol)
					if updateErr != nil {
						return "", "", fmt.Errorf("config: update policy: %w", updateErr)
					}
					return updated.GetId(), "UPDATE", nil
				}
			}
			return "", "", fmt.Errorf("config: create policy: %w", err)
		}
		return created.GetId(), "CREATE", nil

	case riokuv1.PolicyOp_DELETE:
		id := op.GetId()
		if id == "" && op.GetPolicy() != nil {
			id = op.GetPolicy().GetId()
		}
		if id == "" {
			return "", "", fmt.Errorf("config: delete policy: id is required")
		}
		if err := tx.DeletePolicy(ctx, id); err != nil {
			return "", "", fmt.Errorf("config: delete policy: %w", err)
		}
		return id, "DELETE", nil

	default:
		return "", "", fmt.Errorf("config: unknown policy action %v", op.GetAction())
	}
}

// findServiceByName returns an existing service by name, or nil.
func findServiceByName(ctx context.Context, tx store.Tx, name string) *riokuv1.Service {
	svcs, err := tx.ListServices(ctx)
	if err != nil {
		return nil
	}
	for _, s := range svcs {
		if s.GetName() == name {
			return s
		}
	}
	return nil
}

// findRouteByName returns an existing route by name, or nil.
func findRouteByName(ctx context.Context, tx store.Tx, name string) *riokuv1.Route {
	routes, err := tx.ListRoutes(ctx)
	if err != nil {
		return nil
	}
	for _, r := range routes {
		if r.GetName() == name {
			return r
		}
	}
	return nil
}

// findPolicyByName returns an existing policy by name, or nil.
func findPolicyByName(ctx context.Context, tx store.Tx, name string) *riokuv1.Policy {
	policies, err := tx.ListPolicies(ctx)
	if err != nil {
		return nil
	}
	for _, p := range policies {
		if p.GetName() == name {
			return p
		}
	}
	return nil
}
