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
	ErrNoUnusedBackupCode    = fmt.Errorf("store: no unused backup codes")
	ErrAccessPolicyNotFound  = fmt.Errorf("store: access policy not found")
	ErrAccessPolicyDuplicate = fmt.Errorf("store: access policy with that name already exists")
)

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

// APIKey represents a stored API key.
type APIKey struct {
	ID         string
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
