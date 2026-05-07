package audit

import "time"

// This file collects the canonical first-party audit payload types.
// Each implements Payload (returns its own AuditSchema) and gets
// registered via DefaultRegistry on package init. Adding a new
// payload is a two-step change:
//
//  1. Define the struct + AuditSchema() in this file (or a sibling
//     namespace-specific file like cert.go / raft.go as the surface
//     grows).
//  2. Append a Schema entry to the init() list below.

// CertLifecycleEvent describes a certificate lifecycle transition
// — issuance, renewal, revocation, ACME failure. Captures the
// parts of the event a human reviewer wants to see at a glance
// without exposing the full cert chain.
//
// Schema: cert.lifecycle_event.v1
type CertLifecycleEvent struct {
	// Action is one of: issued | renewed | revoked | failed.
	Action string `json:"action"`

	// Issuer is the CA that performed the action — e.g.
	// "letsencrypt", "internal", or the CA id from the config
	// store.
	Issuer string `json:"issuer"`

	// SubjectCN is the certificate's CommonName or first SAN
	// entry. Used by the admin renderer to identify the cert
	// at a glance.
	SubjectCN string `json:"subject_cn"`

	// FingerprintSHA256 is a hex-encoded SHA-256 of the cert's
	// DER bytes. Stable identity for the cert across renewals.
	// Empty on failed issuance.
	FingerprintSHA256 string `json:"fingerprint_sha256,omitempty"`

	// NotBefore + NotAfter bound the cert validity. Empty on
	// failure.
	NotBefore time.Time `json:"not_before,omitempty"`
	NotAfter  time.Time `json:"not_after,omitempty"`

	// Reason carries a human-readable explanation. Required for
	// "failed" actions; optional otherwise.
	Reason string `json:"reason,omitempty"`
}

// AuditSchema returns the registered discriminator.
func (CertLifecycleEvent) AuditSchema() string { return "cert.lifecycle_event.v1" }

// RaftLeaderChange records a Raft leader transition. Useful for
// debugging cluster instability and for the "cluster events"
// admin tab.
//
// Schema: raft.leader_change.v1
type RaftLeaderChange struct {
	// FromNodeID is the previous leader. Empty on first
	// election after cluster bootstrap.
	FromNodeID string `json:"from_node_id,omitempty"`

	// ToNodeID is the new leader.
	ToNodeID string `json:"to_node_id"`

	// Term is the Raft term that elected the new leader.
	Term uint64 `json:"term"`

	// Reason categorises the trigger: "heartbeat_timeout",
	// "leadership_transfer", "manual_promote", etc.
	Reason string `json:"reason"`
}

func (RaftLeaderChange) AuditSchema() string { return "raft.leader_change.v1" }

// RoleEscalationRejected records a 403 returned from the role
// create / update REST handlers when the actor attempted to grant
// a permission they don't themselves hold (#117). Captures enough
// for a security reviewer to triage without leaking the full
// permission set.
//
// Schema: auth.role_escalation_rejected.v1
type RoleEscalationRejected struct {
	// ActorUserID is the user whose request was rejected.
	ActorUserID string `json:"actor_user_id"`

	// TargetRoleID is the role being created or updated. Empty
	// on create when the new id wasn't yet allocated.
	TargetRoleID string `json:"target_role_id,omitempty"`

	// TargetRoleName is the proposed role name. Useful when
	// TargetRoleID is empty.
	TargetRoleName string `json:"target_role_name,omitempty"`

	// OffendingPermission is the first permission the actor
	// lacked. Single value (not a list) so we don't leak the
	// actor's full uncovered permission set in the audit row.
	OffendingPermission string `json:"offending_permission"`

	// Operation is "create" or "update".
	Operation string `json:"operation"`
}

func (RoleEscalationRejected) AuditSchema() string {
	return "auth.role_escalation_rejected.v1"
}

// PasswordResetByAdmin records the AdminResetPassword bypass per
// #115. Pairs with the password-history reuse policy: regular
// users hit ErrPasswordReuse, admins bypass — but the audit must
// name the admin actor so the bypass is reviewable.
//
// Schema: auth.password_reset_by_admin.v1
type PasswordResetByAdmin struct {
	// AdminUserID performed the reset.
	AdminUserID string `json:"admin_user_id"`

	// TargetUserID had its password changed.
	TargetUserID string `json:"target_user_id"`

	// Reason captures why the bypass was needed (e.g.
	// "user_locked_out", "lost_credentials"). Free-form;
	// surfaced verbatim by the admin renderer.
	Reason string `json:"reason,omitempty"`
}

func (PasswordResetByAdmin) AuditSchema() string {
	return "auth.password_reset_by_admin.v1"
}

// AuditSensitiveRevealed records a privileged operator unmasking the
// sensitive fields (ip / user_agent / payload) of a prior audit row
// via POST /api/v1/t/{tenant}/audit/{id}/reveal. Capturing the
// reason is the compliance contract for the bypass: every reveal
// produces a new auditable row referencing the original.
//
// Schema: audit.sensitive_revealed.v1
type AuditSensitiveRevealed struct {
	// RevealedEntryID is the id of the audit entry whose sensitive
	// fields were exposed.
	RevealedEntryID string `json:"revealed_entry_id"`

	// Reason is the compliance justification provided by the
	// operator at reveal time. Surfaced verbatim to subsequent
	// reviewers.
	Reason string `json:"reason"`
}

func (AuditSensitiveRevealed) AuditSchema() string {
	return "audit.sensitive_revealed.v1"
}

// DefaultRegistry is the package-level registry pre-populated with
// the canonical first-party schemas. Sub-systems that don't need
// custom schemas can use this directly; tests + plugins can build
// their own via NewRegistry.
var DefaultRegistry = NewRegistry()

func init() {
	mustRegister(DefaultRegistry, Schema{
		Discriminator: "cert.lifecycle_event.v1",
		New:           func() Payload { return &CertLifecycleEvent{} },
	})
	mustRegister(DefaultRegistry, Schema{
		Discriminator: "raft.leader_change.v1",
		New:           func() Payload { return &RaftLeaderChange{} },
	})
	mustRegister(DefaultRegistry, Schema{
		Discriminator: "auth.role_escalation_rejected.v1",
		New:           func() Payload { return &RoleEscalationRejected{} },
	})
	mustRegister(DefaultRegistry, Schema{
		Discriminator: "auth.password_reset_by_admin.v1",
		New:           func() Payload { return &PasswordResetByAdmin{} },
	})
	mustRegister(DefaultRegistry, Schema{
		Discriminator: "audit.sensitive_revealed.v1",
		New:           func() Payload { return &AuditSensitiveRevealed{} },
	})
}

// mustRegister panics on registration error. Used in init() where
// a registration failure means a programmer error — a malformed
// discriminator constant — and the daemon must not start with a
// broken audit registry.
func mustRegister(r *Registry, s Schema) {
	if _, err := r.Register(s); err != nil {
		panic("audit: " + err.Error())
	}
}
