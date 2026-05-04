package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// SetUserPassword updates the user's password_hash after enforcing
// the reuse policy (#115, #186). The new hash is rejected with
// ErrPasswordReuse when it matches any of the user's last N
// historical hashes — N defaults to the
// tenant_auth_policies.password_history_count for the calling
// tenant. The current hash counts as one slot.
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
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT password_hash FROM users WHERE id = ?`), userID,
	)
	var hash string
	if err := row.Scan(&hash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("postgres: user %q not found", userID)
		}
		return "", fmt.Errorf("postgres: fetch user hash: %w", err)
	}
	return hash, nil
}

// fetchPasswordHistoryDepth reads the configured retention depth.
// When tenant_auth_policies has no row for the tenant the OWASP-
// recommended floor of 5 is returned.
func (t *tx) fetchPasswordHistoryDepth(ctx context.Context, tenantID string) (int, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT password_history_count FROM tenant_auth_policies WHERE tenant_id = ?`), tenantID,
	)
	var depth int
	switch err := row.Scan(&depth); {
	case err == nil:
		if depth < 0 {
			depth = 0
		}
		return depth, nil
	case errors.Is(err, sql.ErrNoRows):
		return 5, nil
	default:
		return 0, fmt.Errorf("postgres: fetch password history depth: %w", err)
	}
}

// checkHistoryReuse returns ErrPasswordReuse when newHash matches
// any of the most recent depth-1 historical entries.
func (t *tx) checkHistoryReuse(ctx context.Context, userID, newHash string, depth int) error {
	limit := depth - 1
	if limit <= 0 {
		return nil
	}
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`),
		userID, limit,
	)
	if err != nil {
		return fmt.Errorf("postgres: fetch password history: %w", err)
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

	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?`),
		newHash, now, now, userID,
	); err != nil {
		return fmt.Errorf("postgres: update password: %w", err)
	}

	if prevHash != "" {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`INSERT INTO password_history (id, user_id, password_hash) VALUES (?, ?, ?)`),
			uuid.New().String(), userID, prevHash,
		); err != nil {
			return fmt.Errorf("postgres: insert password history: %w", err)
		}
	}

	// Trim history to (depth - 1) entries — the current hash on
	// users.password_hash counts as the depth-th entry.
	limit := depth - 1
	if limit < 0 {
		limit = 0
	}
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM password_history
		 WHERE user_id = ?
		   AND id NOT IN (
		       SELECT id FROM password_history
		       WHERE user_id = ?
		       ORDER BY created_at DESC
		       LIMIT ?
		   )`),
		userID, userID, limit,
	); err != nil {
		return fmt.Errorf("postgres: trim password history: %w", err)
	}

	t.emit("users", userID, "UPDATE")
	return nil
}
