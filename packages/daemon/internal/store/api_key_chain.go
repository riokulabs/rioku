package store

import (
	"context"
	"errors"
	"time"
)

// APIKeyChain is the result of resolving an API key through the
// Sprint 4 Phase 1 (#164) chain:
//
//	Key → Subscription → Plan → security_type + rate_limit + quota
//
// Pre-Sprint-4 standalone scoped keys (no subscription_id) resolve
// to a Reason="" + Valid=true result with Plan=nil; the caller
// authorizes via the legacy Scopes list. Subscription-bound keys
// pull policy from the parent Plan.
//
// Reason values (when Valid=false) match the rioku_apikey plugin's
// status-code mapping (Sprint 3 #179):
//
//	"missing"  → 401  key not found
//	"revoked"  → 403  key was once valid, deliberately removed
//	"expired"  → 401  key past its expires_at
//	"invalid"  → 401  subscription rejected/closed/paused etc.
//
// PrincipalID is the user identity the data plane stamps on
// X-Rioku-Principal. For subscription-bound keys it's the
// owning Application's ID; for standalone keys it falls back
// to the key's OwnerID (creator).
type APIKeyChain struct {
	Valid       bool
	Reason      string
	PrincipalID string
	TenantID    string
	Scopes      []string
	// Subscription + Plan are populated for chain-resolved keys.
	// Both nil for standalone scoped keys.
	Subscription *Subscription
	Plan         *Plan
	// Application owner; populated when SubscriptionID is set.
	Application *Application
}

// ResolveAPIKeyChain runs the full Key → Subscription → Plan
// chain against the supplied Tx. Used by the daemon-side
// validation endpoint that the rioku_apikey Caddy module POSTs
// to (#179, #189).
//
// The function is read-only. Callers wanting to bump usage_count
// should call tx.RecordAPIKeyUse separately on success.
func ResolveAPIKeyChain(ctx context.Context, tx Tx, keyHash string, now time.Time) (*APIKeyChain, error) {
	key, err := tx.GetAPIKeyByHash(ctx, keyHash)
	if err != nil {
		// Distinguish not-found from real driver errors so the
		// caller can map to 401 vs 500.
		if errors.Is(err, ErrAPIKeyNotFound) {
			return &APIKeyChain{Valid: false, Reason: "missing"}, nil
		}
		return nil, err
	}

	// Revocation wins over every other check — a revoked key is
	// permanently rejected regardless of expires_at or
	// subscription state.
	if key.RevokedAt != nil {
		return &APIKeyChain{Valid: false, Reason: "revoked", TenantID: key.TenantID}, nil
	}
	if key.ExpiresAt != nil && now.After(*key.ExpiresAt) {
		return &APIKeyChain{Valid: false, Reason: "expired", TenantID: key.TenantID}, nil
	}

	chain := &APIKeyChain{
		Valid:       true,
		PrincipalID: key.OwnerID,
		TenantID:    key.TenantID,
		Scopes:      key.Scopes,
	}

	// Standalone scoped key — no subscription chain to walk.
	// The caller authorizes against Scopes directly.
	if key.SubscriptionID == nil {
		return chain, nil
	}

	sub, err := tx.GetSubscription(ctx, *key.SubscriptionID)
	if err != nil {
		// Subscription was deleted but the FK had ON DELETE SET
		// NULL so the key's subscription_id was nulled — the row
		// we just read is the post-null state. If we got here it
		// means the subscription_id is set but the subscription
		// is missing, which is a lookup error.
		return nil, err
	}

	switch sub.Status {
	case SubscriptionStatusAccepted:
		// fall through
	case SubscriptionStatusPaused:
		return &APIKeyChain{Valid: false, Reason: "invalid", TenantID: key.TenantID}, nil
	case SubscriptionStatusPending, SubscriptionStatusRejected, SubscriptionStatusClosed:
		return &APIKeyChain{Valid: false, Reason: "invalid", TenantID: key.TenantID}, nil
	}

	// Within the active window? StartingAt nil = no lower bound;
	// EndingAt nil = no upper bound.
	if sub.StartingAt != nil && now.Before(*sub.StartingAt) {
		return &APIKeyChain{Valid: false, Reason: "invalid", TenantID: key.TenantID}, nil
	}
	if sub.EndingAt != nil && now.After(*sub.EndingAt) {
		return &APIKeyChain{Valid: false, Reason: "expired", TenantID: key.TenantID}, nil
	}

	plan, err := tx.GetPlan(ctx, sub.PlanID)
	if err != nil {
		return nil, err
	}

	// A plan that's archived rejects new requests even if the
	// subscription is still in accepted state. Operators
	// archiving a plan should also close subscriptions, but the
	// resolution path defends against the lag.
	if plan.Status == PlanStatusArchived {
		return &APIKeyChain{Valid: false, Reason: "invalid", TenantID: key.TenantID}, nil
	}

	chain.Subscription = sub
	chain.Plan = plan

	if key.ApplicationID != nil {
		app, err := tx.GetApplication(ctx, *key.ApplicationID)
		if err != nil {
			return nil, err
		}
		chain.Application = app
		// Use the application id as the principal — that's the
		// consumer-visible identity the data plane should stamp
		// for billing / rate-limit / audit attribution.
		chain.PrincipalID = app.ID
	}

	return chain, nil
}

// ErrAPIKeyNotFound is the sentinel returned by GetAPIKeyByHash
// when the hash isn't in the table. Distinguished from a generic
// store error so ResolveAPIKeyChain can produce a Reason="missing"
// result instead of an Internal error to the caller.
var ErrAPIKeyNotFound = errors.New("store: api_key not found")
