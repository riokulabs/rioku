package store

import (
	"context"
	"sort"
	"time"
)

// computeEffectivePermissions walks the role-inheritance chain
// starting at startRoleID and returns the union of every role's
// own permissions in that chain. Cycle detection: a role that is
// re-encountered raises ErrRoleCycle. Depth guard: chains longer
// than RoleInheritanceMaxDepth raise ErrRoleDepthExceeded.
//
// getRole is a closure rather than a Tx receiver so the helper can
// be reused from each driver without import cycles. Drivers thread
// their own GetRole into this function.
//
// The returned slice is sorted, deduplicated, and never nil (an
// empty slice signals "no permissions" so callers don't have to
// nil-check).
func computeEffectivePermissions(
	ctx context.Context,
	getRole func(context.Context, string) (*Role, error),
	startRoleID string,
) ([]string, error) {
	visited := make(map[string]struct{})
	perms := make(map[string]struct{})
	cur := startRoleID
	depth := 0
	for cur != "" {
		if _, seen := visited[cur]; seen {
			return nil, ErrRoleCycle
		}
		visited[cur] = struct{}{}
		depth++
		if depth > RoleInheritanceMaxDepth {
			return nil, ErrRoleDepthExceeded
		}
		r, err := getRole(ctx, cur)
		if err != nil {
			return nil, err
		}
		for _, p := range r.Permissions {
			perms[p] = struct{}{}
		}
		if r.ParentRoleID == nil {
			break
		}
		cur = *r.ParentRoleID
	}
	out := make([]string, 0, len(perms))
	for p := range perms {
		out = append(out, p)
	}
	sort.Strings(out)
	return out, nil
}

// ComputeEffectivePermissions is the exported entry point drivers
// call from their EffectivePermissions Tx method. Pass tx.GetRole
// as the resolver.
func ComputeEffectivePermissions(
	ctx context.Context,
	getRole func(context.Context, string) (*Role, error),
	startRoleID string,
) ([]string, error) {
	return computeEffectivePermissions(ctx, getRole, startRoleID)
}

// ErrRoleEscalation is returned by ValidateNoEscalation when the
// caller attempts to grant a permission they don't themselves hold.
// REST handlers map this to 403 Forbidden + an audit entry per #117.
var ErrRoleEscalation = errs("store: role would grant permissions exceeding the actor's effective set")

// errs is a small constructor mirroring fmt.Errorf for sentinel
// error declarations that need a const-style message. Avoids a
// package-init-order surprise vs. fmt.Errorf at file scope.
func errs(s string) error { return errString(s) }

type errString string

func (e errString) Error() string { return string(e) }

// ValidateNoEscalation checks that every permission in granted is
// already in actorPermissions. If any granted permission isn't
// covered by the actor's set, it returns an error wrapping
// ErrRoleEscalation. Used by CreateRole / UpdateRole REST handlers
// before persisting the change.
//
// Wildcard semantics: if actorPermissions contains a wildcard like
// "config:*" or the global "*", any permission matched by that
// wildcard counts as covered. Wildcards must appear as separate
// entries in actorPermissions; this function does not split or
// canonicalize identifiers.
func ValidateNoEscalation(actorPermissions, granted []string) error {
	actorSet := make(map[string]struct{}, len(actorPermissions))
	for _, p := range actorPermissions {
		actorSet[p] = struct{}{}
	}
	// Hot-path: actor is super-admin (holds the global "*").
	if _, ok := actorSet["*"]; ok {
		return nil
	}
	for _, want := range granted {
		if _, ok := actorSet[want]; ok {
			continue
		}
		if covers, _ := wildcardCovers(actorSet, want); covers {
			continue
		}
		return errwrap(ErrRoleEscalation, "actor lacks "+want)
	}
	return nil
}

// wildcardCovers reports whether any wildcard entry in actorSet
// covers want. Pattern: "<resource>:*" matches "<resource>:<action>"
// for any action; "*" matches anything. Other wildcard shapes are
// not supported in v1.
func wildcardCovers(actorSet map[string]struct{}, want string) (bool, string) {
	idx := -1
	for i := 0; i < len(want); i++ {
		if want[i] == ':' {
			idx = i
			break
		}
	}
	if idx < 0 {
		return false, ""
	}
	resource := want[:idx]
	pattern := resource + ":*"
	if _, ok := actorSet[pattern]; ok {
		return true, pattern
	}
	return false, ""
}

// errwrap wraps a sentinel with a message; doing it here avoids
// importing fmt in the hot path of the validate function.
func errwrap(sentinel error, msg string) error {
	return wrappedErr{sentinel: sentinel, msg: msg}
}

type wrappedErr struct {
	sentinel error
	msg      string
}

func (e wrappedErr) Error() string {
	return e.sentinel.Error() + ": " + e.msg
}

func (e wrappedErr) Unwrap() error { return e.sentinel }

// Role represents a named collection of permissions.
type Role struct {
	ID          string
	Name        string
	Description string
	IsBuiltin   bool
	// ParentRoleID, when non-nil, names the role this one inherits
	// from. Effective permissions are the union of this role's own
	// permissions and the transitive closure of all ancestors. Cycle
	// detection is enforced at the store layer (#117).
	ParentRoleID *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
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
	ID           string // caller provides UUID
	Name         string
	Description  string
	Permissions  []string // permission IDs to assign
	ParentRoleID *string  // nil = no parent; otherwise inherits from this role (#117)
}

// UpdateRoleParams holds the input for updating a role's metadata or permissions.
type UpdateRoleParams struct {
	Name         *string  // nil = no change
	Description  *string  // nil = no change
	AddPerms     []string // permission IDs to add
	RemovePerms  []string // permission IDs to remove
	ParentRoleID *string  // nil = no change; non-nil "" = clear; otherwise set
	// ClearParent, when true, sets parent_role_id to NULL.
	// Distinguishes "leave parent alone" (false) from
	// "explicitly remove parent" (true) — the pointer-to-string
	// pattern can't carry the "set to NULL" intent on its own.
	ClearParent bool
}

// TOTPBackupCode represents a single-use backup code for TOTP recovery.
type TOTPBackupCode struct {
	ID       string
	UserID   string
	CodeHash string // argon2id hash of the 8-digit plaintext code
	UsedAt   *time.Time
}
