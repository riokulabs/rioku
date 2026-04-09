package auth

import (
	"context"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

// ResolvePermissions flattens a set of roles and their associated permission
// IDs into a deduplicated slice of scope strings. The rolePerms map is keyed
// by role ID and valued with the permission IDs that belong to that role.
func ResolvePermissions(roles []store.Role, rolePerms map[string][]string) []string {
	seen := make(map[string]struct{})
	var scopes []string
	for _, role := range roles {
		perms, ok := rolePerms[role.ID]
		if !ok {
			continue
		}
		for _, p := range perms {
			if _, exists := seen[p]; !exists {
				seen[p] = struct{}{}
				scopes = append(scopes, p)
			}
		}
	}
	return scopes
}

// LoadUserScopes loads the role names and resolved permission scopes for a
// user by querying the store. It is called during session creation and on
// cache-miss validation to populate SessionClaims.Roles and SessionClaims.Scopes.
func LoadUserScopes(ctx context.Context, st store.Driver, userID string) (roles []string, scopes []string, err error) {
	tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, fmt.Errorf("auth: begin tx for user scopes: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Load role assignments.
	userRoles, err := tx.ListUserRoles(ctx, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("auth: list user roles: %w", err)
	}

	roles = make([]string, 0, len(userRoles))
	for _, ur := range userRoles {
		roles = append(roles, ur.RoleName)
	}

	// Load resolved scopes (permission IDs from all assigned roles).
	scopes, err = tx.GetUserScopes(ctx, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("auth: get user scopes: %w", err)
	}
	if scopes == nil {
		scopes = []string{}
	}

	return roles, scopes, nil
}
