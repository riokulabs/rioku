package store

import (
	"fmt"
	"time"
)

// API-management entities (#164, Sprint 4 Phase 1a).
//
// Plans, Applications, and Subscriptions form the consumer-facing
// shape that an API gateway needs to be an API-management product:
//
//   API     — abstract; modeled in v1 as a string id stored on Plans
//             (the APIs catalog table lands as its own follow-up).
//   Plan    — security_type + rate-limit + quota policy attached
//             to an API. Plans have a publish/deprecate/archive
//             lifecycle (PlanStatus).
//   Application — consumer-facing identity. Owns Subscriptions.
//   Subscription — (Application, Plan, API) tuple that authorises
//                  the application to consume the API under the
//                  plan's terms. ApprovalStatus state machine.
//
// API-keys link to Subscription + Application via FK. The
// rioku_apikey Caddy module's resolution chain (Sprint 3, #179)
// resolves Key → Subscription → Plan → security_type chain once
// those FKs are populated; pre-Sprint-4 standalone keys keep
// working with NULL FKs.

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

// PlanSecurityType is the access-control mechanism a Plan
// declares. Each subscriber's API key resolves to the plan and
// gets evaluated under this scheme.
type PlanSecurityType string

const (
	PlanSecurityAPIKey PlanSecurityType = "api_key"
	PlanSecurityJWT    PlanSecurityType = "jwt"
	PlanSecurityOIDC   PlanSecurityType = "oidc"
	PlanSecurityOAuth2 PlanSecurityType = "oauth2"
	PlanSecurityMTLS   PlanSecurityType = "mtls"
	PlanSecurityNone   PlanSecurityType = "none"
)

// PlanValidation is "auto" (subscriptions auto-accept on request)
// or "manual" (subscriptions enter "pending" and require an
// approver to accept or reject).
type PlanValidation string

const (
	PlanValidationAuto   PlanValidation = "auto"
	PlanValidationManual PlanValidation = "manual"
)

// PlanStatus is the plan-lifecycle state machine.
//
//	staging → published → deprecated → archived
//
// staging is editable + invisible to consumers.
// published is visible + open to new subscriptions.
// deprecated is visible to existing subscribers + closed to new subs.
// archived is terminal — subscriptions are closed, the plan still
// shows up in admin views for audit.
type PlanStatus string

const (
	PlanStatusStaging    PlanStatus = "staging"
	PlanStatusPublished  PlanStatus = "published"
	PlanStatusDeprecated PlanStatus = "deprecated"
	PlanStatusArchived   PlanStatus = "archived"
)

// Plan is the API-management product attachment.
type Plan struct {
	ID                 string
	TenantID           string
	APIID              string // free-form pointer in v1; APIs catalog is a follow-up
	Name               string
	Description        string
	SecurityType       PlanSecurityType
	Validation         PlanValidation
	Status             PlanStatus
	RateLimitPerMinute int32
	QuotaPerDay        int32
	SelectionRule      string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// CreatePlanParams is the input shape for CreatePlan. ID is the
// caller-provided UUID; the daemon generates it client-side and
// passes it down so the audit log + REST response can carry it
// without an extra round-trip.
type CreatePlanParams struct {
	ID                 string
	TenantID           string
	APIID              string
	Name               string
	Description        string
	SecurityType       PlanSecurityType
	Validation         PlanValidation
	RateLimitPerMinute int32
	QuotaPerDay        int32
	SelectionRule      string
}

// UpdatePlanParams holds a partial-update shape; nil pointer
// fields mean "no change".
type UpdatePlanParams struct {
	Name               *string
	Description        *string
	SecurityType       *PlanSecurityType
	Validation         *PlanValidation
	RateLimitPerMinute *int32
	QuotaPerDay        *int32
	SelectionRule      *string
}

// ValidPlanTransition reports whether the lifecycle move from→to
// is allowed. Used by both the storage layer and the REST handler
// to short-circuit illegal transitions before they hit the DB.
func ValidPlanTransition(from, to PlanStatus) bool {
	switch from {
	case PlanStatusStaging:
		return to == PlanStatusPublished || to == PlanStatusArchived
	case PlanStatusPublished:
		return to == PlanStatusDeprecated || to == PlanStatusArchived
	case PlanStatusDeprecated:
		return to == PlanStatusArchived
	}
	// archived is terminal.
	return false
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

// ApplicationStatus is active | paused | closed. closed is
// terminal — child subscriptions cascade to closed when their
// parent application closes.
type ApplicationStatus string

const (
	ApplicationStatusActive ApplicationStatus = "active"
	ApplicationStatusPaused ApplicationStatus = "paused"
	ApplicationStatusClosed ApplicationStatus = "closed"
)

// Application is a consumer-facing identity that owns
// Subscriptions and (transitively, via Subscription) API keys.
type Application struct {
	ID          string
	TenantID    string
	Name        string
	Description string
	OwnerUserID *string // nullable; SET NULL on user delete
	Status      ApplicationStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type CreateApplicationParams struct {
	ID          string
	TenantID    string
	Name        string
	Description string
	OwnerUserID *string
}

type UpdateApplicationParams struct {
	Name        *string
	Description *string
	OwnerUserID *string
	// SetOwnerNil distinguishes "leave owner alone" (false +
	// OwnerUserID nil) from "explicitly clear owner" (true).
	SetOwnerNil bool
}

// ValidApplicationTransition reports whether the move is allowed.
// active ↔ paused both ways; either → closed is allowed; closed
// is terminal.
func ValidApplicationTransition(from, to ApplicationStatus) bool {
	if from == ApplicationStatusClosed {
		return false
	}
	if to == ApplicationStatusClosed {
		return true
	}
	if from == ApplicationStatusActive && to == ApplicationStatusPaused {
		return true
	}
	if from == ApplicationStatusPaused && to == ApplicationStatusActive {
		return true
	}
	return false
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

// SubscriptionStatus models the approval-workflow state machine:
//
//	pending → accepted → paused ↔ accepted → closed
//	pending → rejected
//
// pending: requested; awaiting approval. Auto-validation flips
// straight to accepted; manual validation waits for the API
// owner.
// accepted: live; api_keys with this subscription_id resolve.
// rejected: terminal; was never live.
// paused: temporary suspension; resolution returns 403.
// closed: terminal; was once live, no longer.
type SubscriptionStatus string

const (
	SubscriptionStatusPending  SubscriptionStatus = "pending"
	SubscriptionStatusAccepted SubscriptionStatus = "accepted"
	SubscriptionStatusRejected SubscriptionStatus = "rejected"
	SubscriptionStatusPaused   SubscriptionStatus = "paused"
	SubscriptionStatusClosed   SubscriptionStatus = "closed"
)

// Subscription is the (Application, Plan, API) tuple authorising
// consumption.
type Subscription struct {
	ID             string
	TenantID       string
	PlanID         string
	ApplicationID  string
	APIID          string
	Status         SubscriptionStatus
	RequestMessage string
	ReasonMessage  string
	StartingAt     *time.Time
	EndingAt       *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type CreateSubscriptionParams struct {
	ID             string
	TenantID       string
	PlanID         string
	ApplicationID  string
	APIID          string
	RequestMessage string
}

// UpdateSubscriptionParams covers the fields the consumer or
// approver can adjust. Status changes go through dedicated
// transition methods, not this struct.
type UpdateSubscriptionParams struct {
	RequestMessage *string
	ReasonMessage  *string
	StartingAt     *time.Time
	EndingAt       *time.Time
	// ClearStartingAt / ClearEndingAt distinguish "leave alone"
	// from "explicitly clear" the same way ParentRoleID +
	// ClearParent do on UpdateRoleParams (#117).
	ClearStartingAt bool
	ClearEndingAt   bool
}

// ValidSubscriptionTransition reports whether the move is
// allowed. The state machine:
//
//	pending → accepted (approver accepts, or auto-validate)
//	pending → rejected (approver rejects; terminal)
//	accepted → paused
//	paused → accepted
//	accepted | paused → closed (terminal)
//
// rejected and closed are both terminal.
func ValidSubscriptionTransition(from, to SubscriptionStatus) bool {
	switch from {
	case SubscriptionStatusPending:
		return to == SubscriptionStatusAccepted || to == SubscriptionStatusRejected
	case SubscriptionStatusAccepted:
		return to == SubscriptionStatusPaused || to == SubscriptionStatusClosed
	case SubscriptionStatusPaused:
		return to == SubscriptionStatusAccepted || to == SubscriptionStatusClosed
	}
	// rejected and closed are terminal.
	return false
}

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

var (
	ErrPlanNotFound          = fmt.Errorf("store: plan not found")
	ErrPlanNameTaken         = fmt.Errorf("store: plan name already exists in tenant")
	ErrPlanInvalidTransition = fmt.Errorf("store: plan state transition not allowed")

	ErrApplicationNotFound          = fmt.Errorf("store: application not found")
	ErrApplicationNameTaken         = fmt.Errorf("store: application name already exists in tenant")
	ErrApplicationInvalidTransition = fmt.Errorf("store: application state transition not allowed")

	ErrSubscriptionNotFound          = fmt.Errorf("store: subscription not found")
	ErrSubscriptionDuplicate         = fmt.Errorf("store: live subscription already exists for application+plan")
	ErrSubscriptionInvalidTransition = fmt.Errorf("store: subscription state transition not allowed")
)
