// Package store defines the Driver interface for config persistence
// and provides concrete implementations for SQLite, Postgres, and MySQL/MariaDB.
//
// The Driver interface is backend-agnostic: each dialect (sqlite, postgres, mysql)
// provides its own implementation using raw SQL. All mutations happen inside
// transactions (Tx) so callers get atomic reads and writes.
package store

import (
	"context"
	"fmt"
	"sync"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// Sentinel errors for RBAC and TOTP operations.
var (
	ErrRoleImmutable         = fmt.Errorf("store: superadmin role cannot be modified or deleted")
	ErrRoleNotFound          = fmt.Errorf("store: role not found")
	ErrRoleCycle             = fmt.Errorf("store: role inheritance forms a cycle")
	ErrRoleDepthExceeded     = fmt.Errorf("store: role inheritance depth limit exceeded")
	ErrNoUnusedBackupCode    = fmt.Errorf("store: no unused backup codes")
	ErrAccessPolicyNotFound  = fmt.Errorf("store: access policy not found")
	ErrAccessPolicyDuplicate = fmt.Errorf("store: access policy with that name already exists")
	ErrPasswordReuse         = fmt.Errorf("store: password matches a recent entry in the user's history")
)

// RoleInheritanceMaxDepth caps the recursion depth when resolving a
// role's effective permission set. Beyond this depth the resolver
// fails with ErrRoleDepthExceeded — the limit catches both legitimate
// over-deep nesting and pathological cycles that the visited-set
// check somehow misses.
const RoleInheritanceMaxDepth = 16

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// DriverConfig holds connection parameters for opening a store.
type DriverConfig struct {
	// Driver selects the backend: "sqlite", "postgres", or "mysql".
	Driver string
	// DSN is the connection string or file path.
	DSN string

	// SQLite-specific
	Path string

	// Postgres-specific
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration

	// MySQL / Galera-specific
	Galera              bool
	ExpectedClusterSize int
	Nodes               []NodeConfig
	HealthPollInterval  time.Duration
	CertFailureRetryMax int
}

// NodeConfig describes a single database node in a multi-node cluster.
type NodeConfig struct {
	DSN string
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

// MigrateDirection indicates whether to migrate up or down.
type MigrateDirection int

const (
	// MigrateUp applies pending migrations.
	MigrateUp MigrateDirection = iota
	// MigrateDown rolls back the most recent migration.
	MigrateDown
)

// ---------------------------------------------------------------------------
// Driver mode and health
// ---------------------------------------------------------------------------

// DriverMode indicates the operational mode of the store backend.
type DriverMode int

const (
	// ModeSingle is the default for SQLite (single-node, read-write).
	ModeSingle DriverMode = iota
	// ModePrimary indicates a Postgres primary or Galera full member.
	ModePrimary
	// ModeReplica indicates a Postgres replica (read-only).
	ModeReplica
	// ModeDonor indicates a Galera donor node (avoid for writes).
	ModeDonor
	// ModeDesync indicates a Galera desynced node (avoid entirely).
	ModeDesync
	// ModeDegraded indicates quorum loss or an unhealthy backend.
	ModeDegraded
)

// DriverHealth reports the health of the store backend.
type DriverHealth struct {
	// OK is true when the backend is operating normally.
	OK bool
	// Mode reflects the current operational mode.
	Mode DriverMode
	// Details contains backend-specific key/value pairs such as
	// wsrep_cluster_size, pg replication lag, etc.
	Details map[string]string
}

// ---------------------------------------------------------------------------
// Change notification
// ---------------------------------------------------------------------------

// ChangeEvent is emitted when a config mutation occurs.
type ChangeEvent struct {
	// Table is the name of the affected table (e.g. "routes", "services").
	Table string
	// RowID is the primary key of the affected row.
	RowID string
	// Operation is one of "INSERT", "UPDATE", or "DELETE".
	Operation string
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

// TxOptions configures a transaction.
type TxOptions struct {
	// ReadOnly hints that the transaction will not perform writes.
	// Backends may optimise accordingly (e.g. route to a replica).
	ReadOnly bool
}

// Tx represents a store transaction. All CRUD operations live on the
// transaction so that callers get atomic reads and writes.
type Tx interface {
	// Commit persists the transaction.
	Commit() error
	// Rollback aborts the transaction. It is safe to call after Commit.
	Rollback() error

	// --- Routes ---

	CreateRoute(ctx context.Context, route *riokuv1.Route) (*riokuv1.Route, error)
	GetRoute(ctx context.Context, id string) (*riokuv1.Route, error)
	ListRoutes(ctx context.Context) ([]*riokuv1.Route, error)
	UpdateRoute(ctx context.Context, route *riokuv1.Route) (*riokuv1.Route, error)
	DeleteRoute(ctx context.Context, id string) error

	// --- Services ---

	CreateService(ctx context.Context, svc *riokuv1.Service) (*riokuv1.Service, error)
	GetService(ctx context.Context, id string) (*riokuv1.Service, error)
	ListServices(ctx context.Context) ([]*riokuv1.Service, error)
	UpdateService(ctx context.Context, svc *riokuv1.Service) (*riokuv1.Service, error)
	DeleteService(ctx context.Context, id string) error

	// --- Policies ---

	CreatePolicy(ctx context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error)
	GetPolicy(ctx context.Context, id string) (*riokuv1.Policy, error)
	ListPolicies(ctx context.Context) ([]*riokuv1.Policy, error)
	UpdatePolicy(ctx context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error)
	DeletePolicy(ctx context.Context, id string) error

	// --- Policy Bindings ---

	// AttachPolicy binds a policy to a target (e.g. a route or service).
	AttachPolicy(ctx context.Context, policyID, targetType, targetID string) error
	// DetachPolicy removes a policy binding from a target.
	DetachPolicy(ctx context.Context, policyID, targetType, targetID string) error
	// ListPoliciesByTarget returns the IDs of policies attached to the given target.
	ListPoliciesByTarget(ctx context.Context, targetType, targetID string) ([]string, error)

	// --- API Keys ---

	// CreateAPIKey stores a new API key and returns its generated ID.
	CreateAPIKey(ctx context.Context, name, keyHash string, scopes []string, expiresAt *time.Time, ownerID string) (string, error)
	GetAPIKey(ctx context.Context, id string) (*APIKey, error)
	// GetAPIKeyByHash looks up a key by its hash (used during authentication).
	GetAPIKeyByHash(ctx context.Context, keyHash string) (*APIKey, error)
	ListAPIKeys(ctx context.Context) ([]*APIKey, error)
	ListAPIKeysByOwner(ctx context.Context, ownerID string) ([]*APIKey, error)
	RevokeAPIKey(ctx context.Context, id string) error
	// UpdateAPIKey applies partial changes to a key's metadata: name,
	// scopes, expires_at. Pointer fields are nil when unchanged. The
	// key's hash, usage stats, and tenant binding are immutable; for
	// secret rotation use RotateAPIKey at the handler level (revoke +
	// create new). Returns the post-update key, or an error wrapping
	// "not found" when the id doesn't exist in the active tenant.
	UpdateAPIKey(ctx context.Context, id string, params UpdateAPIKeyParams) (*APIKey, error)
	// RecordAPIKeyUse bumps the key's usage_count by 1 and sets
	// last_used_at to `at`. Called from the auth path on every
	// authenticated API key request (#85). Best-effort: callers are
	// expected to ignore errors so usage tracking never blocks a
	// valid request.
	RecordAPIKeyUse(ctx context.Context, id string, at time.Time) error

	// --- Config Versions ---

	// SaveConfigVersion persists a JSON-encoded ConfigSnapshot and returns
	// the new version number.
	SaveConfigVersion(ctx context.Context, snapshot []byte, actor string) (int64, error)
	GetConfigVersion(ctx context.Context, version int64) (*ConfigVersion, error)
	ListConfigVersions(ctx context.Context, limit int) ([]*ConfigVersion, error)
	// LatestConfigVersion returns the highest stored version number, or 0.
	LatestConfigVersion(ctx context.Context) (int64, error)

	// --- Audit Log ---

	AppendAuditEntry(ctx context.Context, entry *riokuv1.AuditEntry) error
	QueryAuditLog(ctx context.Context, query AuditQuery) ([]*riokuv1.AuditEntry, error)
	// CountAuditLog returns the number of entries matching `query`,
	// ignoring Limit/Offset. Used by the REST audit endpoint to
	// expose total counts for paginated UIs (#82).
	CountAuditLog(ctx context.Context, query AuditQuery) (int, error)
	// GetAuditEntry returns a single entry by id. Used by the
	// per-entry detail endpoint that exposes the full diff body.
	GetAuditEntry(ctx context.Context, id string) (*riokuv1.AuditEntry, error)
	// ListAuditActors returns distinct `actor` strings matching the
	// optional prefix, capped at `limit`. Used by the audit page's
	// actor typeahead.
	ListAuditActors(ctx context.Context, prefix string, limit int) ([]string, error)
	// ListAuditResourceIDs returns distinct `entity_id` strings for
	// the supplied entity_type (optional) matching the optional
	// prefix. Used by the audit page's resource-id typeahead.
	ListAuditResourceIDs(ctx context.Context, entityType, prefix string, limit int) ([]string, error)

	// --- Users ---

	CreateUser(ctx context.Context, u *User) (*User, error)
	GetUser(ctx context.Context, id string) (*User, error)
	GetUserByUsername(ctx context.Context, username string) (*User, error)
	ListUsers(ctx context.Context) ([]*User, error)
	UpdateUser(ctx context.Context, u *User) (*User, error)
	DeleteUser(ctx context.Context, id string) error

	// IncrementFailedAttempts increments failed_attempts and optionally sets
	// locked_until + status='locked' if threshold is reached.
	IncrementFailedAttempts(ctx context.Context, userID string, lockUntil *time.Time) error
	// ResetFailedAttempts sets failed_attempts=0 and clears locked_until on successful login.
	ResetFailedAttempts(ctx context.Context, userID string) error
	// UpdateLastLogin sets last_login to now for the given user.
	UpdateLastLogin(ctx context.Context, userID string) error

	// --- Sessions ---

	CreateSession(ctx context.Context, s *Session) (*Session, error)
	GetSession(ctx context.Context, id string) (*Session, error)
	ListSessionsByUser(ctx context.Context, userID string) ([]*Session, error)
	DeleteSession(ctx context.Context, id string) error
	DeleteSessionsByUser(ctx context.Context, userID string) error
	// DeleteSessionsByUserExcept deletes all sessions for the user except the given session ID.
	DeleteSessionsByUserExcept(ctx context.Context, userID, exceptSessionID string) error
	// UpdateSessionLastActive sets last_active to the given time for the given session.
	UpdateSessionLastActive(ctx context.Context, id string, t time.Time) error
	// DeleteExpiredSessions hard deletes sessions where expires_at < now OR
	// last_active < now-24h. Returns number of rows deleted.
	DeleteExpiredSessions(ctx context.Context) (int64, error)

	// --- Roles ---

	// CreateRole creates a custom role with the given permissions.
	CreateRole(ctx context.Context, params CreateRoleParams) (*Role, error)
	// GetRole returns a role by ID, including its permission list.
	GetRole(ctx context.Context, id string) (*Role, error)
	// ListRoles returns all roles with their permission lists.
	ListRoles(ctx context.Context) ([]*Role, error)
	// UpdateRole updates a role's name, description, or permission set.
	// Returns ErrRoleImmutable if the role is the superadmin role.
	UpdateRole(ctx context.Context, id string, params UpdateRoleParams) (*Role, error)
	// DeleteRole deletes a custom role. Returns ErrRoleImmutable if the role is superadmin.
	DeleteRole(ctx context.Context, id string) error
	// EffectivePermissions resolves a role's full permission set
	// including all inherited permissions from ancestors. Returns
	// ErrRoleCycle when the inheritance chain forms a cycle and
	// ErrRoleDepthExceeded when it nests deeper than the policy
	// limit (RoleInheritanceMaxDepth). Built-in roles never have
	// parents, so for them this matches the role's own Permissions
	// list. Implements the #117 escalation-prevention guard. The
	// returned slice is sorted; duplicates are deduplicated.
	EffectivePermissions(ctx context.Context, roleID string) ([]string, error)

	// --- Permissions ---

	// ListPermissions returns all available atomic permissions.
	ListPermissions(ctx context.Context) ([]*Permission, error)
	// GetUserScopes returns all granted scope strings for a user (may include wildcards).
	GetUserScopes(ctx context.Context, userID string) ([]string, error)

	// --- User Roles ---

	// AssignRole grants a role to a user. grantedBy is the actor's user ID.
	AssignRole(ctx context.Context, userID, roleID, grantedBy string) error
	// RevokeRole removes a role from a user.
	RevokeRole(ctx context.Context, userID, roleID string) error
	// ListUserRoles returns all roles assigned to a user.
	ListUserRoles(ctx context.Context, userID string) ([]*UserRole, error)
	// ListUsersWithRole returns all user IDs that have the given role.
	ListUsersWithRole(ctx context.Context, roleID string) ([]string, error)

	// --- TOTP Backup Codes ---

	// CreateTOTPBackupCodes stores a set of hashed backup codes for a user.
	// All existing unused codes for the user are deleted first.
	CreateTOTPBackupCodes(ctx context.Context, userID string, codeHashes []string) error
	// ListUnusedTOTPBackupCodes returns all unused backup codes for a user.
	ListUnusedTOTPBackupCodes(ctx context.Context, userID string) ([]*TOTPBackupCode, error)
	// MarkTOTPBackupCodeUsed marks a specific backup code (by ID) as used.
	MarkTOTPBackupCodeUsed(ctx context.Context, codeID string) error
	// DeleteTOTPBackupCodes removes all backup codes for a user (called on TOTP disable/reset).
	DeleteTOTPBackupCodes(ctx context.Context, userID string) error

	// --- Tenants (stage-2) ---

	// CreateTenant persists a new tenant. The supplied Tenant must have
	// Slug + Name set; ID is generated if empty. Returns ErrTenantSlugTaken
	// when the slug collides.
	CreateTenant(ctx context.Context, t *Tenant) (*Tenant, error)
	// GetTenant returns a tenant by id, or ErrTenantNotFound.
	GetTenant(ctx context.Context, id string) (*Tenant, error)
	// GetTenantBySlug looks up a tenant by URL-safe slug — used by the
	// tenant-resolution middleware to translate `/api/v1/t/:slug/...`.
	GetTenantBySlug(ctx context.Context, slug string) (*Tenant, error)
	// ListTenants returns every tenant ordered by created_at ASC.
	// Super-admin only — there's no per-tenant pagination.
	ListTenants(ctx context.Context) ([]*Tenant, error)
	// UpdateTenant applies a partial update. Returns the post-update row,
	// or ErrTenantNotFound when the id doesn't exist. The default tenant
	// (slug "default") is renameable but its slug is immutable.
	UpdateTenant(ctx context.Context, id string, params UpdateTenantParams) (*Tenant, error)
	// DeleteTenant removes a tenant and cascades through every FK
	// (memberships, sessions, routes, services, policies, ...). The
	// default tenant cannot be deleted; ErrTenantImmutable is returned.
	DeleteTenant(ctx context.Context, id string) error

	// --- Memberships (stage-2) ---

	// CreateMembership persists a new (tenant_id, user_id, state) tuple.
	// Returns ErrMembershipExists if the pair already has a membership
	// (regardless of state — operators can re-activate via Update).
	CreateMembership(ctx context.Context, m *Membership) (*Membership, error)
	// GetMembership returns a membership by id, or ErrMembershipNotFound.
	GetMembership(ctx context.Context, id string) (*Membership, error)
	// GetMembershipByTenantUser returns the membership for a (tenant, user)
	// pair, or ErrMembershipNotFound.
	GetMembershipByTenantUser(ctx context.Context, tenantID, userID string) (*Membership, error)
	// ListMembershipsByTenant returns every membership in a tenant. Used
	// by the Users page in the admin panel.
	ListMembershipsByTenant(ctx context.Context, tenantID string) ([]*Membership, error)
	// ListMembershipsByUser returns every tenant the user belongs to.
	// Used by the tenant-picker after login.
	ListMembershipsByUser(ctx context.Context, userID string) ([]*Membership, error)
	// UpdateMembershipState transitions a membership through the state
	// machine (pending -> active -> deactivated -> removed). Invalid
	// transitions return ErrMembershipInvalidState.
	UpdateMembershipState(ctx context.Context, id, state string) (*Membership, error)
	// DeleteMembership hard-deletes a membership. Prefer
	// UpdateMembershipState("removed") for audit retention; this is for
	// administrative cleanup.
	DeleteMembership(ctx context.Context, id string) error

	// --- Membership Roles (stage-2) ---

	// AssignMembershipRole grants `roleID` to the membership. Idempotent.
	AssignMembershipRole(ctx context.Context, membershipID, roleID, grantedBy string) error
	// RevokeMembershipRole removes a role grant. No-op if absent.
	RevokeMembershipRole(ctx context.Context, membershipID, roleID string) error
	// ListMembershipRoles returns every role granted to a membership.
	ListMembershipRoles(ctx context.Context, membershipID string) ([]Role, error)

	// --- Dashboards (stage-2) ---

	CreateDashboard(ctx context.Context, d *Dashboard) (*Dashboard, error)
	GetDashboard(ctx context.Context, tenantID, id string) (*Dashboard, error)
	ListDashboardsByTenant(ctx context.Context, tenantID string) ([]*Dashboard, error)
	UpdateDashboard(ctx context.Context, tenantID, id string, params UpdateDashboardParams) (*Dashboard, error)
	DeleteDashboard(ctx context.Context, tenantID, id string) error
	// SetDefaultDashboard atomically clears is_default on every other
	// dashboard in the tenant and sets it on `id`. Returns the updated
	// row, or ErrDashboardNotFound.
	SetDefaultDashboard(ctx context.Context, tenantID, id string) (*Dashboard, error)
	// SetDashboardHomeForUser appends `userID` to the dashboard's
	// `home_for_users` JSON array (idempotent) and removes them from
	// any other dashboard's home list in the same tenant. Per-user.
	SetDashboardHomeForUser(ctx context.Context, tenantID, id, userID string) (*Dashboard, error)

	// --- Widgets (stage-2) ---

	CreateWidget(ctx context.Context, w *Widget) (*Widget, error)
	GetWidget(ctx context.Context, id string) (*Widget, error)
	ListWidgetsByDashboard(ctx context.Context, dashboardID string) ([]*Widget, error)
	UpdateWidget(ctx context.Context, id string, params UpdateWidgetParams) (*Widget, error)
	DeleteWidget(ctx context.Context, dashboardID, id string) error
	// UpdateDashboardLayout rewrites every widget's layout in one
	// transaction. The map is keyed by widget id; missing widgets
	// are left unchanged.
	UpdateDashboardLayout(ctx context.Context, dashboardID string, layouts map[string]string) error

	// --- Dashboard versions (stage-2) ---

	CreateDashboardVersion(ctx context.Context, v *DashboardVersion) (*DashboardVersion, error)
	GetDashboardVersion(ctx context.Context, id string) (*DashboardVersion, error)
	ListDashboardVersions(ctx context.Context, dashboardID string) ([]*DashboardVersion, error)

	// --- Dashboard shares (stage-2 admin completion chunk 8) ---

	CreateDashboardShare(ctx context.Context, s *DashboardShare) (*DashboardShare, error)
	ListDashboardShares(ctx context.Context, dashboardID string) ([]*DashboardShare, error)
	DeleteDashboardShare(ctx context.Context, id string) error

	// --- Webhooks (stage-2) ---

	CreateWebhookEndpoint(ctx context.Context, e *WebhookEndpoint) (*WebhookEndpoint, error)
	GetWebhookEndpoint(ctx context.Context, tenantID, id string) (*WebhookEndpoint, error)
	ListWebhookEndpointsByTenant(ctx context.Context, tenantID string) ([]*WebhookEndpoint, error)
	UpdateWebhookEndpoint(ctx context.Context, tenantID, id string, params UpdateWebhookEndpointParams) (*WebhookEndpoint, error)
	DeleteWebhookEndpoint(ctx context.Context, tenantID, id string) error

	// --- Cluster enrollment tokens (stage-2) ---

	CreateEnrollmentToken(ctx context.Context, t *ClusterEnrollmentToken) (*ClusterEnrollmentToken, error)
	GetEnrollmentTokenByHash(ctx context.Context, hash string) (*ClusterEnrollmentToken, error)
	ListActiveEnrollmentTokens(ctx context.Context) ([]*ClusterEnrollmentToken, error)
	ConsumeEnrollmentToken(ctx context.Context, hash, nodeID string) (*ClusterEnrollmentToken, error)
	RevokeEnrollmentToken(ctx context.Context, id string) error

	// --- Impersonation sessions (stage-2) ---

	CreateImpersonationSession(ctx context.Context, s *ImpersonationSession) (*ImpersonationSession, error)
	GetImpersonationSession(ctx context.Context, id string) (*ImpersonationSession, error)
	ListActiveImpersonationSessions(ctx context.Context) ([]*ImpersonationSession, error)
	EndImpersonationSession(ctx context.Context, id, reason string) (*ImpersonationSession, error)
	TouchImpersonationSession(ctx context.Context, id string) error

	// --- Settings configs (stage-2): singleton-per-tenant ---

	GetNetworkConfig(ctx context.Context, tenantID string) (*NetworkConfig, error)
	UpsertNetworkConfig(ctx context.Context, c *NetworkConfig) (*NetworkConfig, error)

	GetTenantAuthPolicy(ctx context.Context, tenantID string) (*TenantAuthPolicy, error)
	UpsertTenantAuthPolicy(ctx context.Context, c *TenantAuthPolicy) (*TenantAuthPolicy, error)

	// --- Password history (#115) ---

	// SetUserPassword updates a user's password after enforcing the
	// reuse policy. The new hash is rejected with ErrPasswordReuse
	// when it matches any of the user's last
	// tenant_auth_policies.password_history_count hashes (the
	// current hash counts as one). On success the previous hash is
	// rotated into password_history and trimmed to the depth.
	SetUserPassword(ctx context.Context, userID, newHash string) error

	// AdminResetPassword bypasses the reuse policy. The new hash is
	// applied unconditionally and rotated into history. Callers are
	// responsible for emitting the audit entry that names the
	// admin actor — store-layer audit fan-in is too coarse to
	// distinguish a normal change from an admin override.
	AdminResetPassword(ctx context.Context, userID, newHash string) error

	GetObservabilityConfig(ctx context.Context, tenantID string) (*ObservabilityConfig, error)
	UpsertObservabilityConfig(ctx context.Context, c *ObservabilityConfig) (*ObservabilityConfig, error)

	GetAuditRetentionConfig(ctx context.Context, tenantID string) (*AuditRetentionConfig, error)
	UpsertAuditRetentionConfig(ctx context.Context, c *AuditRetentionConfig) (*AuditRetentionConfig, error)

	// --- PKI/TLS (stage-2) ---

	CreateCertAuthority(ctx context.Context, ca *CertAuthority) (*CertAuthority, error)
	GetCertAuthority(ctx context.Context, tenantID, id string) (*CertAuthority, error)
	ListCertAuthoritiesByTenant(ctx context.Context, tenantID string) ([]*CertAuthority, error)
	UpdateCertAuthority(ctx context.Context, tenantID, id string, params UpdateCertAuthorityParams) (*CertAuthority, error)
	DeleteCertAuthority(ctx context.Context, tenantID, id string) error

	CreateCertEnrollment(ctx context.Context, e *CertEnrollment) (*CertEnrollment, error)
	GetCertEnrollment(ctx context.Context, tenantID, id string) (*CertEnrollment, error)
	ListCertEnrollmentsByTenant(ctx context.Context, tenantID string) ([]*CertEnrollment, error)
	UpdateCertEnrollment(ctx context.Context, tenantID, id string, params UpdateCertEnrollmentParams) (*CertEnrollment, error)
	RevokeCertEnrollmentRow(ctx context.Context, tenantID, id, reason string) (*CertEnrollment, error)

	CreateTLSCertificate(ctx context.Context, c *TLSCertificate) (*TLSCertificate, error)
	GetTLSCertificate(ctx context.Context, tenantID, id string) (*TLSCertificate, error)
	ListTLSCertificatesByTenant(ctx context.Context, tenantID string) ([]*TLSCertificate, error)
	UpdateTLSCertificate(ctx context.Context, tenantID, id string, params UpdateTLSCertificateParams) (*TLSCertificate, error)
	DeleteTLSCertificate(ctx context.Context, tenantID, id string) error

	GetTLSConfig(ctx context.Context, tenantID string) (*TLSConfig, error)
	UpsertTLSConfig(ctx context.Context, c *TLSConfig) (*TLSConfig, error)

	// --- Plugins (stage-2) ---

	CreatePlugin(ctx context.Context, p *Plugin) (*Plugin, error)
	GetPlugin(ctx context.Context, tenantID, id string) (*Plugin, error)
	ListPluginsByScope(ctx context.Context, tenantID string) ([]*Plugin, error)
	UpdatePlugin(ctx context.Context, tenantID, id string, params UpdatePluginParams) (*Plugin, error)
	DeletePlugin(ctx context.Context, tenantID, id string) error

	CreatePluginSigner(ctx context.Context, s *PluginSigner) (*PluginSigner, error)
	GetPluginSigner(ctx context.Context, tenantID, id string) (*PluginSigner, error)
	ListPluginSignersByScope(ctx context.Context, tenantID string) ([]*PluginSigner, error)
	UpdatePluginSigner(ctx context.Context, tenantID, id string, params UpdatePluginSignerParams) (*PluginSigner, error)
	DeletePluginSigner(ctx context.Context, tenantID, id string) error
	ListPluginsBySigner(ctx context.Context, signerID string) ([]*Plugin, error)

	// --- Notifications (stage-2) ---

	// Items (per-user inbox)
	AppendNotificationItem(ctx context.Context, n *NotificationItem) (*NotificationItem, error)
	GetNotificationItem(ctx context.Context, id string) (*NotificationItem, error)
	ListNotificationItemsByUser(ctx context.Context, tenantID, userID string, q NotificationItemQuery) ([]*NotificationItem, error)
	CountUnreadNotifications(ctx context.Context, tenantID, userID string) (int, error)
	MarkNotificationRead(ctx context.Context, id string) error
	MarkAllNotificationsRead(ctx context.Context, tenantID, userID string) error
	ArchiveNotification(ctx context.Context, id string, archived bool) error

	// Channels
	CreateNotificationChannel(ctx context.Context, c *NotificationChannel) (*NotificationChannel, error)
	GetNotificationChannel(ctx context.Context, tenantID, id string) (*NotificationChannel, error)
	ListNotificationChannelsByTenant(ctx context.Context, tenantID string) ([]*NotificationChannel, error)
	UpdateNotificationChannel(ctx context.Context, tenantID, id string, params UpdateNotificationChannelParams) (*NotificationChannel, error)
	DeleteNotificationChannel(ctx context.Context, tenantID, id string) error

	// Routing rules
	CreateRoutingRule(ctx context.Context, r *NotificationRoutingRule) (*NotificationRoutingRule, error)
	GetRoutingRule(ctx context.Context, tenantID, id string) (*NotificationRoutingRule, error)
	ListRoutingRulesByTenant(ctx context.Context, tenantID string) ([]*NotificationRoutingRule, error)
	UpdateRoutingRule(ctx context.Context, tenantID, id string, params UpdateRoutingRuleParams) (*NotificationRoutingRule, error)
	DeleteRoutingRule(ctx context.Context, tenantID, id string) error
	ReorderRoutingRules(ctx context.Context, tenantID string, orderedIDs []string) error

	// Delivery log (append-only)
	AppendDeliveryLogEntry(ctx context.Context, e *NotificationDeliveryLogEntry) (*NotificationDeliveryLogEntry, error)
	GetDeliveryLogEntry(ctx context.Context, tenantID, id string) (*NotificationDeliveryLogEntry, error)
	ListDeliveryLogByTenant(ctx context.Context, tenantID string, q DeliveryLogQuery) ([]*NotificationDeliveryLogEntry, error)

	// Tenant config (singleton)
	GetTenantNotificationConfig(ctx context.Context, tenantID string) (*TenantNotificationConfig, error)
	UpsertTenantNotificationConfig(ctx context.Context, c *TenantNotificationConfig) (*TenantNotificationConfig, error)

	// --- AI subsystem (stage-2) ---

	// Providers
	CreateAIProvider(ctx context.Context, p *AIProvider) (*AIProvider, error)
	GetAIProvider(ctx context.Context, tenantID, id string) (*AIProvider, error)
	ListAIProvidersByTenant(ctx context.Context, tenantID string) ([]*AIProvider, error)
	UpdateAIProvider(ctx context.Context, tenantID, id string, params UpdateAIProviderParams) (*AIProvider, error)
	DeleteAIProvider(ctx context.Context, tenantID, id string) error

	// Provider models
	AddProviderModel(ctx context.Context, m *AIProviderModel) (*AIProviderModel, error)
	UpdateProviderModel(ctx context.Context, providerID, modelID string, params UpdateAIProviderModelParams) (*AIProviderModel, error)
	RemoveProviderModel(ctx context.Context, providerID, modelID string) error
	ListProviderModels(ctx context.Context, providerID string) ([]*AIProviderModel, error)

	// MCP servers
	CreateMCPServer(ctx context.Context, s *AIMCPServer) (*AIMCPServer, error)
	GetMCPServer(ctx context.Context, tenantID, id string) (*AIMCPServer, error)
	ListMCPServersByTenant(ctx context.Context, tenantID string) ([]*AIMCPServer, error)
	UpdateMCPServer(ctx context.Context, tenantID, id string, params UpdateAIMCPServerParams) (*AIMCPServer, error)
	DeleteMCPServer(ctx context.Context, tenantID, id string) error

	// Tools
	CreateAITool(ctx context.Context, t *AITool) (*AITool, error)
	GetAITool(ctx context.Context, tenantID, id string) (*AITool, error)
	ListAIToolsByTenant(ctx context.Context, tenantID string) ([]*AITool, error)
	UpdateAITool(ctx context.Context, tenantID, id string, params UpdateAIToolParams) (*AITool, error)
	DeleteAITool(ctx context.Context, tenantID, id string) error

	// Agents
	CreateAIAgent(ctx context.Context, a *AIAgent) (*AIAgent, error)
	GetAIAgent(ctx context.Context, tenantID, id string) (*AIAgent, error)
	ListAIAgentsByTenant(ctx context.Context, tenantID string) ([]*AIAgent, error)
	UpdateAIAgent(ctx context.Context, tenantID, id string, params UpdateAIAgentParams) (*AIAgent, error)
	DeleteAIAgent(ctx context.Context, tenantID, id string) error

	// Tool bindings
	CreateAIToolBinding(ctx context.Context, b *AIToolBinding) (*AIToolBinding, error)
	GetAIToolBinding(ctx context.Context, tenantID, id string) (*AIToolBinding, error)
	ListAIToolBindingsByTenant(ctx context.Context, tenantID string) ([]*AIToolBinding, error)
	ListAIToolBindingsByAgent(ctx context.Context, agentID string) ([]*AIToolBinding, error)
	UpdateAIToolBinding(ctx context.Context, tenantID, id string, params UpdateAIToolBindingParams) (*AIToolBinding, error)
	DeleteAIToolBinding(ctx context.Context, tenantID, id string) error

	// Semantic rate limits
	CreateAIRateLimit(ctx context.Context, l *AISemanticRateLimit) (*AISemanticRateLimit, error)
	GetAIRateLimit(ctx context.Context, tenantID, id string) (*AISemanticRateLimit, error)
	ListAIRateLimitsByTenant(ctx context.Context, tenantID string) ([]*AISemanticRateLimit, error)
	UpdateAIRateLimit(ctx context.Context, tenantID, id string, params UpdateAIRateLimitParams) (*AISemanticRateLimit, error)
	DeleteAIRateLimit(ctx context.Context, tenantID, id string) error

	// Traces (append-only)
	AppendAITrace(ctx context.Context, t *AITrace) (*AITrace, error)
	GetAITrace(ctx context.Context, tenantID, id string) (*AITrace, error)
	ListAITracesByTenant(ctx context.Context, tenantID string, query AITraceQuery) ([]*AITrace, error)
	ListAITracesByAgent(ctx context.Context, agentID string, query AITraceQuery) ([]*AITrace, error)

	// --- Sites (stage-2) ---

	CreateSite(ctx context.Context, s *Site) (*Site, error)
	GetSite(ctx context.Context, tenantID, id string) (*Site, error)
	ListSitesByTenant(ctx context.Context, tenantID string) ([]*Site, error)
	UpdateSite(ctx context.Context, tenantID, id string, params UpdateSiteParams) (*Site, error)
	ToggleSite(ctx context.Context, tenantID, id string, enabled bool) (*Site, error)
	DeleteSite(ctx context.Context, tenantID, id string) error

	// --- Middlewares (stage-2) ---

	CreateMiddleware(ctx context.Context, m *Middleware) (*Middleware, error)
	GetMiddleware(ctx context.Context, tenantID, id string) (*Middleware, error)
	ListMiddlewaresByTenant(ctx context.Context, tenantID string) ([]*Middleware, error)
	UpdateMiddleware(ctx context.Context, tenantID, id string, params UpdateMiddlewareParams) (*Middleware, error)
	DeleteMiddleware(ctx context.Context, tenantID, id string) error

	// --- RBAC Policies (stage-2 admin completion chunk 7b) ---

	// CreateRbacPolicy persists a new rbac policy.
	CreateRbacPolicy(ctx context.Context, p *RbacPolicy) (*RbacPolicy, error)
	// GetRbacPolicy returns a policy by id, scoped to the active tenant.
	GetRbacPolicy(ctx context.Context, id string) (*RbacPolicy, error)
	// ListRbacPolicies returns every rbac policy in the active tenant.
	ListRbacPolicies(ctx context.Context) ([]*RbacPolicy, error)
	// UpdateRbacPolicy applies a partial update; returns the post-update row.
	UpdateRbacPolicy(ctx context.Context, id string, params UpdateRbacPolicyParams) (*RbacPolicy, error)
	// DeleteRbacPolicy removes a policy by id.
	DeleteRbacPolicy(ctx context.Context, id string) error

	// --- Access Policies ---

	// CreateAccessPolicy persists a new access policy and returns it with
	// its assigned ID + timestamps.
	CreateAccessPolicy(ctx context.Context, p *AccessPolicy) (*AccessPolicy, error)
	// GetAccessPolicy returns a policy by ID, or ErrAccessPolicyNotFound.
	GetAccessPolicy(ctx context.Context, id string) (*AccessPolicy, error)
	// ListAccessPolicies returns every access policy ordered by
	// (priority ASC, created_at ASC) — i.e. evaluation order.
	ListAccessPolicies(ctx context.Context) ([]*AccessPolicy, error)
	// UpdateAccessPolicy applies a partial update. Returns the post-update
	// row, or ErrAccessPolicyNotFound.
	UpdateAccessPolicy(ctx context.Context, id string, params UpdateAccessPolicyParams) (*AccessPolicy, error)
	// DeleteAccessPolicy removes a policy. Returns ErrAccessPolicyNotFound
	// if no row matched.
	DeleteAccessPolicy(ctx context.Context, id string) error
}

// ---------------------------------------------------------------------------
// Helper types (not in proto)
// ---------------------------------------------------------------------------

// Tenant represents a logical workspace boundary. Every tenant-scoped
// entity carries a tenant_id FK referencing tenants(id). The default
// tenant (slug "default") is seeded by migration 13 and is the parent
// of all data created before stage-2.
type Tenant struct {
	ID                 string
	Slug               string
	Name               string
	Plan               string  // community | pro | enterprise
	URLMode            string  // path | subdomain
	Accent             *string // hex color, nullable
	LogoURL            *string
	DefaultDashboardID *string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// UpdateTenantParams is the partial-update payload for UpdateTenant.
// nil pointers leave the field unchanged.
type UpdateTenantParams struct {
	Name               *string
	Plan               *string
	URLMode            *string
	Accent             *string
	LogoURL            *string
	DefaultDashboardID *string
}

// Membership ties a User to a Tenant with a state machine
// (pending -> active -> deactivated -> removed).
type Membership struct {
	ID              string
	TenantID        string
	UserID          string
	State           string // pending | active | deactivated | removed
	InvitedBy       *string
	InvitedAt       *time.Time
	JoinedAt        *time.Time
	InviteTokenHash *string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Tenant + Membership sentinel errors.
var (
	ErrTenantNotFound         = fmt.Errorf("store: tenant not found")
	ErrTenantSlugTaken        = fmt.Errorf("store: tenant slug already in use")
	ErrTenantImmutable        = fmt.Errorf("store: default tenant cannot be deleted")
	ErrMembershipNotFound     = fmt.Errorf("store: membership not found")
	ErrMembershipExists       = fmt.Errorf("store: membership for that tenant+user already exists")
	ErrMembershipInvalidState = fmt.Errorf("store: invalid membership state transition")
)

// RbacPolicy maps a subject (user / group / service-account) to a role
// within a tenant. Distinct from AccessPolicy (request-time conditional
// access) and the legacy proto Policy (Caddy handler config blob); RBAC
// policies are evaluated at session-claim resolution time and feed the
// effective-scopes calculation. Persisted in the rbac_policies table
// (migration 24).
type RbacPolicy struct {
	ID          string
	TenantID    string
	Name        string
	Description string
	SubjectType string // user | group | service-account
	SubjectID   string
	RoleID      string
	Enabled     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// UpdateRbacPolicyParams is the partial-update payload for
// UpdateRbacPolicy. nil pointers leave the field unchanged.
type UpdateRbacPolicyParams struct {
	Name        *string
	Description *string
	SubjectType *string
	SubjectID   *string
	RoleID      *string
	Enabled     *bool
}

// RbacPolicy sentinel errors.
var (
	ErrRbacPolicyNotFound  = fmt.Errorf("store: rbac policy not found")
	ErrRbacPolicyDuplicate = fmt.Errorf("store: rbac policy with that subject + role already exists")
)

// Site represents a per-tenant gateway entry — a customer-facing
// domain with TLS mode + handler-stack presets. Compiles into a
// Caddy server block.
type Site struct {
	ID                string
	TenantID          string
	Name              string
	Domain            string
	TLSMode           string // auto | manual | off
	Enabled           bool
	UpstreamServiceID *string
	BasicAuthEnabled  bool
	BasicAuthRealm    *string
	RateLimitPreset   string // none | lenient | standard | strict
	RedirectRules     string // JSON array — passthrough for the compiler
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// UpdateSiteParams is the partial-update payload for UpdateSite.
type UpdateSiteParams struct {
	Name              *string
	Domain            *string
	TLSMode           *string
	UpstreamServiceID *string
	BasicAuthEnabled  *bool
	BasicAuthRealm    *string
	RateLimitPreset   *string
	RedirectRules     *string
}

// Middleware represents a per-tenant reusable handler-stack
// component (rate-limit, auth, transform, cors, cache, logging,
// custom). Routes attach Middlewares by id; the order is the
// route's responsibility.
type Middleware struct {
	ID        string
	TenantID  string
	Name      string
	Kind      string // rate-limit | auth | transform | cors | cache | logging | custom
	Config    string // JSON config blob — kind-specific shape
	Enabled   bool
	OrderHint int32
	CreatedAt time.Time
	UpdatedAt time.Time
}

// UpdateMiddlewareParams is the partial-update payload.
type UpdateMiddlewareParams struct {
	Name      *string
	Kind      *string
	Config    *string
	Enabled   *bool
	OrderHint *int32
}

// Site + Middleware sentinel errors.
var (
	ErrSiteNotFound        = fmt.Errorf("store: site not found")
	ErrSiteDomainTaken     = fmt.Errorf("store: site with that domain already exists in this tenant")
	ErrMiddlewareNotFound  = fmt.Errorf("store: middleware not found")
	ErrMiddlewareNameTaken = fmt.Errorf("store: middleware with that name already exists in this tenant")
)

// Dashboard represents a per-tenant analytics surface — a named
// container for Widgets that the admin renders. Mode (metabase vs
// grafana) and scope (personal/tenant/shared) determine visibility
// and rendering style.
type Dashboard struct {
	ID            string
	TenantID      string
	Name          string
	Description   string
	Mode          string // metabase | grafana
	Scope         string // personal | tenant | shared
	OwnerUserID   *string
	IsDefault     bool
	SharedRoleIDs string // JSON array of role IDs
	HomeForUsers  string // JSON array of user IDs
	Variables     string // JSON array of variable definitions
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// UpdateDashboardParams is the partial-update payload.
type UpdateDashboardParams struct {
	Name          *string
	Description   *string
	Mode          *string
	Scope         *string
	OwnerUserID   *string
	SharedRoleIDs *string // JSON
	Variables     *string // JSON
}

// Widget represents a visualization tile inside a Dashboard.
// `Config` holds the wizard state; when LockedAdvanced is true, the
// compiler reads RawQuery instead.
type Widget struct {
	ID             string
	DashboardID    string
	Kind           string
	Title          string
	DataSource     string
	Config         string // JSON wizard state
	RawQuery       *string
	LockedAdvanced bool
	Layout         string // JSON {x,y,w,h}
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// UpdateWidgetParams is the partial-update payload.
type UpdateWidgetParams struct {
	Kind           *string
	Title          *string
	DataSource     *string
	Config         *string
	RawQuery       *string
	LockedAdvanced *bool
	Layout         *string
}

// DashboardVersion is a point-in-time snapshot of a Dashboard plus
// its Widgets. Used by the version-history page and restore button.
// The snapshot_json blob is the wire format that round-trips through
// import/export — i.e. self-contained.
type DashboardVersion struct {
	ID           string
	DashboardID  string
	Version      int32
	CreatedBy    *string
	CreatedAt    time.Time
	Note         string
	SnapshotJSON string
}

// Dashboard sentinel errors.
var (
	ErrDashboardNotFound = fmt.Errorf("store: dashboard not found")
	ErrWidgetNotFound    = fmt.Errorf("store: widget not found")
	ErrVersionNotFound   = fmt.Errorf("store: dashboard version not found")
)

// DashboardShare authorises one role to view a dashboard. Multiple
// shares per dashboard = multiple role grants. Persisted in
// dashboard_shares (migration 25).
type DashboardShare struct {
	ID          string
	TenantID    string
	DashboardID string
	RoleID      string
	CreatedBy   *string
	ExpiresAt   *time.Time
	CreatedAt   time.Time
}

// AIProvider configures upstream LLM providers (openai, anthropic, ...).
type AIProvider struct {
	ID         string
	TenantID   string
	Name       string
	Kind       string // openai | anthropic | gemini | ollama | custom
	BaseURL    string
	Credential *string // encrypted/masked reference, never returned in REST listings
	Enabled    bool
	Metadata   string // JSON blob, kind-specific
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type UpdateAIProviderParams struct {
	Name       *string
	Kind       *string
	BaseURL    *string
	Credential *string
	Enabled    *bool
	Metadata   *string
}

// AIProviderModel maps an upstream model id to a friendly alias used by agents.
type AIProviderModel struct {
	ID               string
	ProviderID       string
	UpstreamModelID  string
	Alias            string
	RateLimitRPM     int32
	DailyQuotaTokens int64
	Enabled          bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type UpdateAIProviderModelParams struct {
	Alias            *string
	RateLimitRPM     *int32
	DailyQuotaTokens *int64
	Enabled          *bool
}

// AIMCPServer is a remote MCP endpoint exposing tools to agents.
type AIMCPServer struct {
	ID                 string
	TenantID           string
	Name               string
	URL                string
	AuthKind           string // none | bearer | api-key
	AuthCredential     *string
	Health             string // healthy | degraded | unreachable | disabled
	Enabled            bool
	AuthorizedAgentIDs string // JSON array
	LastCheckedAt      *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type UpdateAIMCPServerParams struct {
	Name               *string
	URL                *string
	AuthKind           *string
	AuthCredential     *string
	Health             *string
	Enabled            *bool
	AuthorizedAgentIDs *string
	LastCheckedAt      *time.Time
}

// AITool is a callable an agent can invoke.
type AITool struct {
	ID           string
	TenantID     string
	Name         string
	Kind         string // native | mcp | http
	Description  string
	SchemaJSON   string
	HTTPEndpoint *string
	MCPServerID  *string
	Dangerous    bool
	Enabled      bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type UpdateAIToolParams struct {
	Name         *string
	Kind         *string
	Description  *string
	SchemaJSON   *string
	HTTPEndpoint *string
	MCPServerID  *string
	Dangerous    *bool
	Enabled      *bool
}

// AIAgent is a configured persona/role bound to a provider+model.
type AIAgent struct {
	ID               string
	TenantID         string
	ProviderID       *string
	Name             string
	Description      string
	Model            string
	SystemPrompt     string
	Guardrails       string  // JSON
	ScopedCredential *string // optional per-agent override
	Enabled          bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type UpdateAIAgentParams struct {
	ProviderID       *string
	Name             *string
	Description      *string
	Model            *string
	SystemPrompt     *string
	Guardrails       *string
	ScopedCredential *string
	Enabled          *bool
}

// AIToolBinding wires an Agent to a Tool with an optional CEL guard.
type AIToolBinding struct {
	ID        string
	TenantID  string
	AgentID   string
	ToolID    string
	Condition string // CEL
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type UpdateAIToolBindingParams struct {
	Condition *string
	Enabled   *bool
}

// AISemanticRateLimit fires when prompts cluster around exemplar text.
type AISemanticRateLimit struct {
	ID                  string
	TenantID            string
	Name                string
	Scope               string // tenant | agent | tool
	AgentID             *string
	ToolID              *string
	Exemplars           string // JSON array
	SimilarityThreshold float64
	WindowSeconds       int32
	Threshold           int32
	Action              string // block | degrade | log
	Enabled             bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type UpdateAIRateLimitParams struct {
	Name                *string
	Scope               *string
	AgentID             *string
	ToolID              *string
	Exemplars           *string
	SimilarityThreshold *float64
	WindowSeconds       *int32
	Threshold           *int32
	Action              *string
	Enabled             *bool
}

// AITrace is an append-only record of one agent invocation.
type AITrace struct {
	ID            string
	TenantID      string
	AgentID       *string
	ProviderID    *string
	Model         string
	Status        string // success | error | timeout
	InputTokens   int32
	OutputTokens  int32
	DurationMS    int32
	Prompt        *string // sensitive — gated on read
	Completion    *string // sensitive — gated on read
	ToolCallsJSON string
	Error         *string
	OccurredAt    time.Time
}

// AITraceQuery filters trace lookups; Status="" means any.
type AITraceQuery struct {
	Status *string
	Since  *time.Time
	Until  *time.Time
	Limit  int
	Offset int
}

// NotificationItem is one inbox entry for a single user.
type NotificationItem struct {
	ID         string
	TenantID   *string // nullable for super-admin broadcasts
	UserID     string
	Category   string
	Severity   string // info | warn | error | success
	Title      string
	Body       string
	ActionLink *string
	Metadata   string // JSON
	ReadAt     *time.Time
	ArchivedAt *time.Time
	OccurredAt time.Time
}

// NotificationItemQuery filters inbox lookups.
type NotificationItemQuery struct {
	Category string
	Severity string
	Read     *bool // nil=all, true=read-only, false=unread-only
	Archived *bool
	Limit    int
	Offset   int
}

// NotificationChannel is an outbound delivery destination
// (email, slack, webhook, ...).
type NotificationChannel struct {
	ID        string
	TenantID  string
	Name      string
	Kind      string // email | slack | webhook | pagerduty | teams | sms
	Config    string // JSON kind-specific config
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type UpdateNotificationChannelParams struct {
	Name    *string
	Kind    *string
	Config  *string
	Enabled *bool
}

// NotificationRoutingRule maps event filters to channels.
type NotificationRoutingRule struct {
	ID          string
	TenantID    string
	Name        string
	EventFilter string // JSON
	ChannelIDs  string // JSON array
	Enabled     bool
	OrderHint   int32
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type UpdateRoutingRuleParams struct {
	Name        *string
	EventFilter *string
	ChannelIDs  *string
	Enabled     *bool
	OrderHint   *int32
}

// NotificationDeliveryLogEntry is an audit row per delivery attempt.
type NotificationDeliveryLogEntry struct {
	ID               string
	TenantID         string
	ChannelID        *string
	NotificationID   *string
	Status           string // delivered | retrying | failed | pending
	Attempts         int32
	FirstAttemptedAt *time.Time
	LastAttemptedAt  *time.Time
	LastError        *string
	Metadata         string
}

// DeliveryLogQuery filters delivery log lookups.
type DeliveryLogQuery struct {
	Status string
	Limit  int
	Offset int
}

// TenantNotificationConfig is a singleton-per-tenant master switch.
type TenantNotificationConfig struct {
	TenantID            string
	Enabled             bool
	OptInMode           string // opt-in | opt-out
	MaxRetries          int32
	RetryBackoffSeconds int32
	ChannelPriority     string // JSON ordered array of channel kinds
	UpdatedAt           time.Time
}

// Plugin represents an installed (or pending-install) plugin.
type Plugin struct {
	ID             string
	TenantScope    *string // nullable for global plugins
	Slug           string
	Name           string
	Version        string
	Enabled        bool
	BuildState     string // stable | building | failed
	CosignVerified bool
	SignerID       *string
	Config         string // JSON
	Metadata       string // JSON
	LastBuildLog   *string
	InstalledAt    time.Time
	UpdatedAt      time.Time
}

type UpdatePluginParams struct {
	Name           *string
	Version        *string
	Enabled        *bool
	BuildState     *string
	CosignVerified *bool
	SignerID       *string
	Config         *string
	Metadata       *string
	LastBuildLog   *string
}

// PluginSigner is a verified key/fingerprint trust anchor.
type PluginSigner struct {
	ID          string
	TenantScope *string // nullable for global signers
	Name        string
	Fingerprint string
	Status      string // verified | revoked | pending
	Notes       string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type UpdatePluginSignerParams struct {
	Name        *string
	Fingerprint *string
	Status      *string
	Notes       *string
}

// Plugin sentinel errors.
var (
	ErrPluginNotFound       = fmt.Errorf("store: plugin not found")
	ErrPluginSlugTaken      = fmt.Errorf("store: plugin slug already in use in this scope")
	ErrPluginSignerNotFound = fmt.Errorf("store: plugin signer not found")
	ErrPluginSignerFPTaken  = fmt.Errorf("store: plugin signer fingerprint already in use in this scope")
)

// CertAuthority is a per-tenant root or intermediate CA.
type CertAuthority struct {
	ID                string
	TenantID          string
	Name              string
	Kind              string // internal | external
	Subject           string
	NotBefore         *time.Time
	NotAfter          *time.Time
	FingerprintSHA256 *string
	CertificatePEM    string
	PrivateKeyRef     *string // pointer to keyring entry, never the raw key
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type UpdateCertAuthorityParams struct {
	Name              *string
	Kind              *string
	Subject           *string
	NotBefore         *time.Time
	NotAfter          *time.Time
	FingerprintSHA256 *string
	CertificatePEM    *string
	PrivateKeyRef     *string
}

// CertEnrollment is a certificate issuance request through a CA.
type CertEnrollment struct {
	ID                string
	TenantID          string
	CAID              *string
	Subject           string
	DNSSANs           string // JSON array
	State             string // pending | issued | revoked | failed
	RequestedAt       time.Time
	IssuedAt          *time.Time
	RevokedAt         *time.Time
	RevocationReason  *string
	CertificatePEM    string
	ChainPEM          string
	FingerprintSHA256 *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type UpdateCertEnrollmentParams struct {
	State             *string
	IssuedAt          *time.Time
	CertificatePEM    *string
	ChainPEM          *string
	FingerprintSHA256 *string
}

// TLSCertificate is a TLS cert managed by the daemon.
type TLSCertificate struct {
	ID                string
	TenantID          string
	Domain            string
	Issuer            string
	Source            string // acme | manual
	ExpiresAt         *time.Time
	AutoRenew         bool
	FingerprintSHA256 *string
	CertificatePEM    string
	PrivateKeyRef     *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type UpdateTLSCertificateParams struct {
	Issuer            *string
	Source            *string
	ExpiresAt         *time.Time
	AutoRenew         *bool
	FingerprintSHA256 *string
	CertificatePEM    *string
	PrivateKeyRef     *string
}

// TLSConfig is a singleton-per-tenant ACME provider + cipher policy.
type TLSConfig struct {
	TenantID       string
	ACMEProvider   string // lets-encrypt | zerossl | custom
	ACMEEmail      string
	ACMEDirectory  *string
	AllowedCiphers string // JSON array
	MinProtocol    string // 1.2 | 1.3
	UpdatedAt      time.Time
}

// NetworkConfig is a singleton-per-tenant network config.
type NetworkConfig struct {
	TenantID             string
	ListenAddresses      string // JSON array
	HTTP3Enabled         bool
	CaddyConfigOverrides string // JSON
	ReadTimeoutSeconds   int32
	WriteTimeoutSeconds  int32
	IdleTimeoutSeconds   int32
	UpdatedAt            time.Time
}

// TenantAuthPolicy is a singleton-per-tenant password/TOTP policy.
type TenantAuthPolicy struct {
	TenantID             string
	TOTPPolicy           string // all | admins | optional
	MinLength            int32
	RequireUppercase     bool
	RequireLowercase     bool
	RequireDigit         bool
	RequireSymbol        bool
	IdleHours            int32
	AbsoluteHours        int32
	MaxFailedAttempts    int32
	LockoutMinutes       int32
	PasswordHistoryCount int32 // #115 reuse-prevention depth (last N hashes)
	UpdatedAt            time.Time
}

// ObservabilityConfig holds metrics/log/trace settings per tenant.
type ObservabilityConfig struct {
	TenantID              string
	MetricsScrapeEndpoint string
	MetricsScrapeAuth     string // JSON
	MetricsRetentionDays  int32
	LogLevels             string // JSON map
	LogFormat             string // json | text
	LogRotation           string // JSON
	TracesRetentionDays   int32
	TracesSampleRate      float64
	UpdatedAt             time.Time
}

// WebhookEndpoint is a per-tenant outbound HTTP webhook for
// infra-targeted events (vs. notification_channels which target
// users).
type WebhookEndpoint struct {
	ID        string
	TenantID  string
	Name      string
	URL       string
	Secret    *string // HMAC signing secret, encrypted in production
	Events    string  // JSON array of event types
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type UpdateWebhookEndpointParams struct {
	Name    *string
	URL     *string
	Secret  *string
	Events  *string
	Enabled *bool
}

// ClusterEnrollmentToken is a single-use token for bootstrapping a
// new cluster node. Not tenant-scoped — cluster is global.
type ClusterEnrollmentToken struct {
	ID               string
	TokenHash        string // hash of the actual token; raw token returned once at create
	CreatedBy        *string
	ExpiresAt        time.Time
	ConsumedAt       *time.Time
	ConsumedByNodeID *string
	RevokedAt        *time.Time
	Notes            string
	CreatedAt        time.Time
}

// ImpersonationSession is a super-admin impersonation audit row
// with TOTP gating + session deadlines. UserID nullable for
// read-only impersonation (no user context, just a tenant view).
type ImpersonationSession struct {
	ID           string
	SuperAdminID string
	TenantID     *string
	UserID       *string
	Reason       string
	StartedAt    time.Time
	ExpiresAt    time.Time
	LastActiveAt *time.Time
	EndedAt      *time.Time
	EndReason    *string // explicit_exit | idle_timeout | absolute_timeout | revoked
}

// Webhook + cluster + impersonation sentinel errors.
var (
	ErrWebhookEndpointNotFound      = fmt.Errorf("store: webhook endpoint not found")
	ErrWebhookEndpointNameTaken     = fmt.Errorf("store: webhook endpoint name already in use in this tenant")
	ErrEnrollmentTokenNotFound      = fmt.Errorf("store: enrollment token not found")
	ErrEnrollmentTokenAlreadyUsed   = fmt.Errorf("store: enrollment token already consumed or revoked")
	ErrEnrollmentTokenExpired       = fmt.Errorf("store: enrollment token expired")
	ErrImpersonationSessionNotFound = fmt.Errorf("store: impersonation session not found")
	ErrImpersonationSessionEnded    = fmt.Errorf("store: impersonation session already ended")
)

// AuditRetentionConfig is a singleton-per-tenant audit retention policy.
type AuditRetentionConfig struct {
	TenantID                 string
	RetentionDaysRead        int32
	RetentionDaysWrite       int32
	RetentionDaysDestructive int32
	AutoExport               string // daily | weekly | monthly | never
	AutoExportFormat         string // csv | jsonl
	AutoExportDestination    *string
	UpdatedAt                time.Time
}

// PKI/TLS sentinel errors.
var (
	ErrCertAuthorityNotFound  = fmt.Errorf("store: cert authority not found")
	ErrCertAuthorityNameTaken = fmt.Errorf("store: cert authority name already in use in this tenant")
	ErrCertEnrollmentNotFound = fmt.Errorf("store: cert enrollment not found")
	ErrTLSCertificateNotFound = fmt.Errorf("store: tls certificate not found")
	ErrTLSCertificateTaken    = fmt.Errorf("store: tls certificate domain already in use in this tenant")
)

// Notification sentinel errors.
var (
	ErrNotificationItemNotFound    = fmt.Errorf("store: notification item not found")
	ErrNotificationChannelNotFound = fmt.Errorf("store: notification channel not found")
	ErrNotificationChannelTaken    = fmt.Errorf("store: notification channel name already in use")
	ErrRoutingRuleNotFound         = fmt.Errorf("store: notification routing rule not found")
	ErrRoutingRuleNameTaken        = fmt.Errorf("store: notification routing rule name already in use")
	ErrDeliveryLogEntryNotFound    = fmt.Errorf("store: delivery log entry not found")
)

// AI sentinel errors.
var (
	ErrAIProviderNotFound      = fmt.Errorf("store: ai provider not found")
	ErrAIProviderNameTaken     = fmt.Errorf("store: ai provider name already in use")
	ErrAIProviderModelNotFound = fmt.Errorf("store: ai provider model not found")
	ErrAIToolNotFound          = fmt.Errorf("store: ai tool not found")
	ErrAIToolNameTaken         = fmt.Errorf("store: ai tool name already in use")
	ErrAIAgentNotFound         = fmt.Errorf("store: ai agent not found")
	ErrAIAgentNameTaken        = fmt.Errorf("store: ai agent name already in use")
	ErrAIBindingNotFound       = fmt.Errorf("store: ai tool binding not found")
	ErrAIBindingExists         = fmt.Errorf("store: ai tool binding for that agent+tool already exists")
	ErrAIRateLimitNotFound     = fmt.Errorf("store: ai rate limit not found")
	ErrAIRateLimitNameTaken    = fmt.Errorf("store: ai rate limit name already in use")
	ErrAITraceNotFound         = fmt.Errorf("store: ai trace not found")
	ErrMCPServerNotFound       = fmt.Errorf("store: mcp server not found")
	ErrMCPServerNameTaken      = fmt.Errorf("store: mcp server name already in use")
)

// APIKey represents a stored API key.
type APIKey struct {
	ID         string
	TenantID   string
	Name       string
	KeyHash    string
	Scopes     []string
	OwnerID    string // user ID of creator, empty for system keys
	ExpiresAt  *time.Time
	CreatedAt  time.Time
	RevokedAt  *time.Time
	LastUsedAt *time.Time // nil = never used; updated by RecordAPIKeyUse (#85)
	UsageCount int64      // monotonically increasing counter (#85)
}

// UpdateAPIKeyParams is the partial-update payload for UpdateAPIKey.
// nil pointers leave the field unchanged; ExpiresAt may be set to a
// pointer-to-zero-time to explicitly clear an existing expiry, in
// which case the storage layer treats it as "no expiry".
type UpdateAPIKeyParams struct {
	Name      *string
	Scopes    *[]string
	ExpiresAt **time.Time
}

// ConfigVersion represents a stored config snapshot.
type ConfigVersion struct {
	Version   int64
	Snapshot  []byte // JSON-encoded ConfigSnapshot
	CreatedAt time.Time
	Actor     string
}

// AuditQuery defines filters for querying the audit log.
// Unlike the proto AuditQuery, this uses time.Time for timestamps
// so store backends can work without proto dependencies.
type AuditQuery struct {
	Actor      string
	EntityType string
	EntityID   string
	Since      *time.Time
	Until      *time.Time
	Limit      int
	Offset     int
}

// User represents a daemon user account.
type User struct {
	ID                  string
	Username            string
	Email               *string
	DisplayName         *string
	PasswordHash        string
	Status              string // "active", "suspended", "locked"
	TOTPSecret          *string
	TOTPEnabled         bool
	ForcePasswordChange bool
	FailedAttempts      int
	LockedUntil         *time.Time
	LastLogin           *time.Time
	PasswordChangedAt   time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// Session represents a server-side auth session.
type Session struct {
	ID          string
	UserID      string
	Fingerprint string
	CreatedAt   time.Time
	ExpiresAt   time.Time
	LastActive  time.Time
	IPAddress   *string
	UserAgent   *string
}

// ---------------------------------------------------------------------------
// Driver interface
// ---------------------------------------------------------------------------

// Driver is the core store abstraction. Concrete implementations live in
// the sqlite, postgres, and mysql sub-packages.
type Driver interface {
	// Open initialises the backend using the supplied configuration.
	Open(ctx context.Context, cfg DriverConfig) error
	// Close releases all resources held by the backend.
	Close() error
	// Ping verifies that the backend is reachable.
	Ping(ctx context.Context) error
	// Migrate runs schema migrations in the given direction.
	Migrate(ctx context.Context, direction MigrateDirection) error
	// CurrentVersion returns the migration version currently applied.
	CurrentVersion(ctx context.Context) (int, error)
	// Begin starts a new transaction with the given options.
	Begin(ctx context.Context, opts TxOptions) (Tx, error)
	// Notify returns a channel that emits ChangeEvents whenever the
	// stored configuration is mutated. Backends that do not support
	// notifications may return a nil channel.
	Notify() <-chan ChangeEvent
	// Health reports the current health and mode of the backend.
	Health(ctx context.Context) DriverHealth
}

// ---------------------------------------------------------------------------
// Driver registration
// ---------------------------------------------------------------------------

var (
	driversMu sync.RWMutex
	drivers   = map[string]func() Driver{}
)

// Register makes a driver factory available by name.
// It is intended to be called from init() in driver packages.
func Register(name string, factory func() Driver) {
	driversMu.Lock()
	defer driversMu.Unlock()
	drivers[name] = factory
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

// New creates a Driver by name. Supported drivers: "raft", "sqlite", "postgres", "mysql".
func New(name string) (Driver, error) {
	driversMu.RLock()
	factory, ok := drivers[name]
	driversMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unknown store driver: %q", name)
	}
	return factory(), nil
}

// ---------------------------------------------------------------------------
// Access policies (#80) — conditional access rules
// ---------------------------------------------------------------------------

// AccessPolicyEffect is either "allow" or "deny".
type AccessPolicyEffect string

const (
	AccessPolicyAllow AccessPolicyEffect = "allow"
	AccessPolicyDeny  AccessPolicyEffect = "deny"
)

// AccessPolicyTargetType describes how `TargetIDs` should be interpreted.
type AccessPolicyTargetType string

const (
	// AccessPolicyTargetRoles — TargetIDs is a list of role IDs.
	AccessPolicyTargetRoles AccessPolicyTargetType = "roles"
	// AccessPolicyTargetUsers — TargetIDs is a list of user IDs.
	AccessPolicyTargetUsers AccessPolicyTargetType = "users"
	// AccessPolicyTargetAll — TargetIDs is ignored; the policy applies to
	// every authenticated subject.
	AccessPolicyTargetAll AccessPolicyTargetType = "all"
)

// AccessPolicyCondition is an opaque-to-the-store description of one
// condition the policy engine evaluates. Type values include "time", "ip",
// "mfa", "geo", "device", and "custom"; the daemon's auth middleware owns
// validation + evaluation.
type AccessPolicyCondition struct {
	Type   string         `json:"type"`
	Config map[string]any `json:"config"`
}

// AccessPolicy is a conditional access-control rule evaluated by the auth
// middleware. Lower priority numbers evaluate first; on tie, created_at
// ASC.
type AccessPolicy struct {
	ID          string
	Name        string
	Description string
	Effect      AccessPolicyEffect
	TargetType  AccessPolicyTargetType
	TargetIDs   []string
	Conditions  []AccessPolicyCondition
	Priority    int
	Enabled     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// UpdateAccessPolicyParams is the partial-update payload for
// UpdateAccessPolicy. Nil fields mean "leave alone".
type UpdateAccessPolicyParams struct {
	Name        *string
	Description *string
	Effect      *AccessPolicyEffect
	TargetType  *AccessPolicyTargetType
	TargetIDs   *[]string
	Conditions  *[]AccessPolicyCondition
	Priority    *int
	Enabled     *bool
}
