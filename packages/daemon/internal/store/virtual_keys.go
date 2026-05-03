package store

import (
	"errors"
	"time"
)

// Virtual keys (Sprint 5 Phase 2, #167).
//
// A virtual key wraps an upstream AI provider credential with
// per-key policy: which models the consumer is allowed to call,
// rate-limit + budget caps, and optional rotation. The AI gateway
// (D7) resolves the inbound API key → virtual key → upstream
// credential; the upstream credential is a vault reference (D12)
// so plaintext never lands at rest.

// BudgetWindow names the time bucket budget_usd is enforced over.
type BudgetWindow string

const (
	BudgetWindowMinute BudgetWindow = "minute"
	BudgetWindowHour   BudgetWindow = "hour"
	BudgetWindowDay    BudgetWindow = "day"
	BudgetWindowMonth  BudgetWindow = "month"
)

// VirtualKey is the Rioku-side wrapper around an upstream
// provider credential.
type VirtualKey struct {
	ID             string
	TenantID       string
	Name           string
	ProviderID     string
	CredentialRef  string  // vault://... reference; resolved by daemon at request time
	AllowedModels  []string // empty = all models (use with care)
	RPMLimit       int32   // 0 = unlimited
	TPMLimit       int32   // 0 = unlimited
	BudgetUSD      float64 // 0 = unlimited
	BudgetWindow   BudgetWindow
	RevokedAt      *time.Time
	CreatedBy      *string // user id; SET NULL on user delete
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// CreateVirtualKeyParams covers the input fields admin REST
// produces from a create request.
type CreateVirtualKeyParams struct {
	ID             string
	TenantID       string
	Name           string
	ProviderID     string
	CredentialRef  string
	AllowedModels  []string
	RPMLimit       int32
	TPMLimit       int32
	BudgetUSD      float64
	BudgetWindow   BudgetWindow
	CreatedBy      string
}

// UpdateVirtualKeyParams is the partial-update payload.
type UpdateVirtualKeyParams struct {
	Name          *string
	ProviderID    *string
	CredentialRef *string
	AllowedModels *[]string
	RPMLimit      *int32
	TPMLimit      *int32
	BudgetUSD     *float64
	BudgetWindow  *BudgetWindow
}

// AllowsModel reports whether the virtual key is authorized to
// call the given model. An empty AllowedModels list allows every
// model (operator opt-in for "no allow-list" semantics).
func (k *VirtualKey) AllowsModel(modelID string) bool {
	if len(k.AllowedModels) == 0 {
		return true
	}
	for _, m := range k.AllowedModels {
		if m == modelID {
			return true
		}
	}
	return false
}

// IsActive reports whether the virtual key is usable right now —
// not revoked. Future expansion: consider time-bounded
// activation windows.
func (k *VirtualKey) IsActive() bool {
	return k.RevokedAt == nil
}

// Sentinel errors.
var (
	ErrVirtualKeyNotFound  = errors.New("store: virtual_key not found")
	ErrVirtualKeyNameTaken = errors.New("store: virtual_key name already exists in tenant")
)
