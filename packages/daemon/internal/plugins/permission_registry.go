// Permission registry — translates plugin manifest permission
// declarations into catalog rows so role grants can target them.
//
// Lifecycle:
//
//   1. Plugin sideload OR install-from-marketplace lands a Plugin row.
//   2. After the row is inserted, the gateway calls Register with the
//      plugin id + the manifest's `permissions` slice.
//   3. The store inserts rows under source="plugin-manifest" and
//      source_plugin_id=<plugin-id>.
//   4. On uninstall, the gateway calls Unregister which deletes those
//      rows. Per migration 000049's source-handling rule, plugin-
//      sourced rows are deleted outright — they were never built-in.
//
// Permission ids must follow the canonical "resource:action" form. The
// registry parses each id to derive resource + action; ids that don't
// contain a colon are treated as resource-only with action="*".

package plugins

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/riokulabs/rioku/internal/store"
)

// ErrInvalidPermissionID is returned by Register when a permission
// string fails to parse into a resource:action pair.
var ErrInvalidPermissionID = errors.New("plugins: permission id must be 'resource:action'")

// Register inserts the supplied permission strings into the daemon
// catalog as plugin-sourced rows. Re-registering the same plugin's
// own ids is idempotent. Re-registering an id owned by a different
// source returns store.ErrPermissionConflict.
//
// `permissions` items take the canonical form "resource:action".
//
// The function opens its own transaction. Callers that need atomicity
// with another mutation should compose at the Tx level by calling
// store.Driver.Begin themselves and invoking
// tx.RegisterPluginPermissions directly.
func Register(ctx context.Context, st store.Driver, pluginID string, permissions []string) error {
	if pluginID == "" {
		return fmt.Errorf("plugins: Register: pluginID required")
	}
	rows, err := BuildPermissionRows(permissions)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	tx, err := st.Begin(ctx, store.TxOptions{})
	if err != nil {
		return fmt.Errorf("plugins: Register: begin: %w", err)
	}
	if err := tx.RegisterPluginPermissions(ctx, pluginID, rows); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("plugins: Register: commit: %w", err)
	}
	return nil
}

// Unregister removes catalog rows owned by the supplied plugin id and
// returns the count removed. Idempotent: removing a plugin whose perms
// were never registered returns (0, nil).
func Unregister(ctx context.Context, st store.Driver, pluginID string) (int, error) {
	if pluginID == "" {
		return 0, fmt.Errorf("plugins: Unregister: pluginID required")
	}
	tx, err := st.Begin(ctx, store.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("plugins: Unregister: begin: %w", err)
	}
	n, err := tx.UnregisterPluginPermissions(ctx, pluginID)
	if err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("plugins: Unregister: commit: %w", err)
	}
	return n, nil
}

// BuildPermissionRows parses canonical "resource:action" strings into
// store.Permission rows. Empty strings and duplicate ids are dropped.
func BuildPermissionRows(permissions []string) ([]*store.Permission, error) {
	seen := make(map[string]struct{}, len(permissions))
	rows := make([]*store.Permission, 0, len(permissions))
	for _, raw := range permissions {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		resource, action := parsePermissionID(id)
		if resource == "" {
			return nil, fmt.Errorf("%w: %q", ErrInvalidPermissionID, raw)
		}
		rows = append(rows, &store.Permission{
			ID:          id,
			Resource:    resource,
			Action:      action,
			Description: fmt.Sprintf("Plugin-declared permission %s", id),
		})
	}
	return rows, nil
}

// parsePermissionID splits a canonical id into (resource, action).
// "resource:action" → ("resource", "action"); a bare "resource" is
// treated as ("resource", "*"); an empty input returns ("", "").
func parsePermissionID(id string) (string, string) {
	if id == "" {
		return "", ""
	}
	idx := strings.Index(id, ":")
	if idx < 0 {
		return id, "*"
	}
	return id[:idx], id[idx+1:]
}
