package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// SetUserPassword updates the user's password_hash after enforcing
// the reuse policy (#115). The new hash is rejected with
// ErrPasswordReuse when it matches any of the user's last N
// historical hashes — N defaults to the
// tenant_auth_policies.password_history_count for the calling
// tenant. The current hash counts as one slot.
//
// The tenant id is read from the request context — users are global
// (no users.tenant_id column) so the policy that applies is the one
// for the tenant the request is operating under.
//
// On success the *previous* hash is appended to password_history,
// the new hash becomes the user's current hash, and the history is
// trimmed to the depth.
func (t *tx) SetUserPassword(ctx context.Context, userID, newHash string) error {
	currentHash, err := t.fetchUserHash(ctx, userID)
	if err != nil {
		return err
	}

	tenantID := store.TenantIDFromContext(ctx)
	depth, err := t.fetchPasswordHistoryDepth(ctx, tenantID)
	if err != nil {
		return err
	}

	// Same as the current hash: trivially a reuse.
	if newHash == currentHash {
		return store.ErrPasswordReuse
	}

	if err := t.checkHistoryReuse(ctx, userID, newHash, depth); err != nil {
		return err
	}

	return t.commitNewPassword(ctx, userID, currentHash, newHash, depth)
}

// AdminResetPassword applies a new hash unconditionally. The
// reuse-policy check is skipped — admins recovering a locked-out
// user must be able to set whatever value the user/admin chooses,
// even if it appears in history.
//
// The previous hash still rotates into history so the next normal
// change picks up the prior state. Callers are responsible for
// emitting the audit entry naming the admin actor (the store
// layer cannot distinguish admin contexts from user-self-service
// without an extra parameter; we keep the audit decision in the
// handler).
func (t *tx) AdminResetPassword(ctx context.Context, userID, newHash string) error {
	currentHash, err := t.fetchUserHash(ctx, userID)
	if err != nil {
		return err
	}

	tenantID := store.TenantIDFromContext(ctx)
	depth, err := t.fetchPasswordHistoryDepth(ctx, tenantID)
	if err != nil {
		return err
	}

	return t.commitNewPassword(ctx, userID, currentHash, newHash, depth)
}

// --- helpers ---

func (t *tx) fetchUserHash(ctx context.Context, userID string) (string, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT password_hash FROM users WHERE id = ?`, userID,
	)
	var hash string
	if err := row.Scan(&hash); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("sqlite: user %q not found", userID)
		}
		return "", fmt.Errorf("sqlite: fetch user hash: %w", err)
	}
	return hash, nil
}

// fetchPasswordHistoryDepth reads the configured retention depth.
// When tenant_auth_policies has no row for the tenant the OWASP-
// recommended floor of 5 is returned.
func (t *tx) fetchPasswordHistoryDepth(ctx context.Context, tenantID string) (int, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT password_history_count FROM tenant_auth_policies WHERE tenant_id = ?`, tenantID,
	)
	var depth int
	switch err := row.Scan(&depth); err {
	case nil:
		if depth < 0 {
			depth = 0
		}
		return depth, nil
	case sql.ErrNoRows:
		return 5, nil
	default:
		return 0, fmt.Errorf("sqlite: fetch password history depth: %w", err)
	}
}

// checkHistoryReuse returns ErrPasswordReuse when newHash matches
// any of the most recent depth-1 historical entries. depth includes
// the current password (which is checked separately by the caller),
// so this query asks for at most depth-1 rows.
func (t *tx) checkHistoryReuse(ctx context.Context, userID, newHash string, depth int) error {
	limit := depth - 1
	if limit <= 0 {
		return nil
	}
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
		userID, limit,
	)
	if err != nil {
		return fmt.Errorf("sqlite: fetch password history: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			return err
		}
		if h == newHash {
			return store.ErrPasswordReuse
		}
	}
	return rows.Err()
}

// commitNewPassword updates the user, appends the previous hash to
// history, and trims history beyond the configured depth.
func (t *tx) commitNewPassword(ctx context.Context, userID, prevHash, newHash string, depth int) error {
	now := nowUTC()

	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?`,
		newHash, now, now, userID,
	); err != nil {
		return fmt.Errorf("sqlite: update password: %w", err)
	}

	if prevHash != "" {
		if _, err := t.sqlTx.ExecContext(ctx,
			`INSERT INTO password_history (id, user_id, password_hash) VALUES (?, ?, ?)`,
			uuid.New().String(), userID, prevHash,
		); err != nil {
			return fmt.Errorf("sqlite: insert password history: %w", err)
		}
	}

	// Trim history to (depth - 1) entries — the current hash on
	// users.password_hash counts as the depth-th entry.
	limit := depth - 1
	if limit < 0 {
		limit = 0
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM password_history
		 WHERE user_id = ?
		 AND id NOT IN (
		     SELECT id FROM password_history
		     WHERE user_id = ?
		     ORDER BY created_at DESC
		     LIMIT ?
		 )`,
		userID, userID, limit,
	); err != nil {
		return fmt.Errorf("sqlite: trim password history: %w", err)
	}

	t.emit("users", userID, "UPDATE")
	return nil
}
