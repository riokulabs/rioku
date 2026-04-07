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
	CreateAPIKey(ctx context.Context, name, keyHash string, scopes []string, expiresAt *time.Time) (string, error)
	GetAPIKey(ctx context.Context, id string) (*APIKey, error)
	// GetAPIKeyByHash looks up a key by its hash (used during authentication).
	GetAPIKeyByHash(ctx context.Context, keyHash string) (*APIKey, error)
	ListAPIKeys(ctx context.Context) ([]*APIKey, error)
	RevokeAPIKey(ctx context.Context, id string) error

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
}

// ---------------------------------------------------------------------------
// Helper types (not in proto)
// ---------------------------------------------------------------------------

// APIKey represents a stored API key.
type APIKey struct {
	ID        string
	Name      string
	KeyHash   string
	Scopes    []string
	ExpiresAt *time.Time
	CreatedAt time.Time
	RevokedAt *time.Time
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
