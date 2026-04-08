package store

import "time"

// Role represents a named collection of permissions.
type Role struct {
	ID          string
	Name        string
	Description string
	IsBuiltin   bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
	// Permissions is populated on detailed lookups, not list queries.
	Permissions []string // permission IDs (may include wildcards like "config:*")
}

// Permission represents an atomic access control unit.
type Permission struct {
	ID          string
	Resource    string
	Action      string
	Description string
}

// UserRole represents a role assignment with audit metadata.
type UserRole struct {
	UserID    string
	RoleID    string
	RoleName  string
	GrantedBy string // user ID, may be empty for seed data
	GrantedAt time.Time
}

// CreateRoleParams holds the input for creating a custom role.
type CreateRoleParams struct {
	ID          string // caller provides UUID
	Name        string
	Description string
	Permissions []string // permission IDs to assign
}

// UpdateRoleParams holds the input for updating a role's metadata or permissions.
type UpdateRoleParams struct {
	Name        *string  // nil = no change
	Description *string  // nil = no change
	AddPerms    []string // permission IDs to add
	RemovePerms []string // permission IDs to remove
}

// TOTPBackupCode represents a single-use backup code for TOTP recovery.
type TOTPBackupCode struct {
	ID       string
	UserID   string
	CodeHash string // argon2id hash of the 8-digit plaintext code
	UsedAt   *time.Time
}
