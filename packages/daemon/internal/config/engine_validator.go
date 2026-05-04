package config

import (
	"fmt"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

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
