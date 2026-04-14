package auth

import (
	"fmt"
	"strings"
)

// ValidateKeyScopes checks that every requested scope is covered by the
// user's own scopes. Wildcard rules:
//   - "*" covers everything
//   - "config:*" covers "config:read", "config:write", etc.
//   - Exact match: "config:read" covers "config:read"
func ValidateKeyScopes(requested, userScopes []string) error {
	for _, req := range requested {
		if !scopeCovered(req, userScopes) {
			return fmt.Errorf("scope %q exceeds your permissions", req)
		}
	}
	return nil
}

// scopeCovered returns true if scope is matched by any entry in allowed.
func scopeCovered(scope string, allowed []string) bool {
	for _, a := range allowed {
		if a == "*" || a == scope {
			return true
		}
		if strings.HasSuffix(a, ":*") {
			prefix := strings.TrimSuffix(a, "*")
			if strings.HasPrefix(scope, prefix) {
				return true
			}
		}
	}
	return false
}
