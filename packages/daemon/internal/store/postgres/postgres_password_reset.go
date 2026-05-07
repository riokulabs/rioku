package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *tx) CreatePasswordResetToken(ctx context.Context, tokenHash, userID string, expiresAt time.Time) error {
	_, err := t.sqlTx.ExecContext(ctx,
		rewritePlaceholders(
			`INSERT INTO password_reset_tokens (token, user_id, expires_at)
			 VALUES (?, ?, ?)`),
		tokenHash, userID, expiresAt.UTC(),
	)
	if err != nil {
		return fmt.Errorf("postgres: create password reset token: %w", err)
	}
	return nil
}

func (t *tx) GetPasswordResetToken(ctx context.Context, tokenHash string) (*store.PasswordResetToken, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		rewritePlaceholders(
			`SELECT token, user_id, created_at, expires_at, consumed_at
			 FROM password_reset_tokens WHERE token = ?`),
		tokenHash)

	var tok store.PasswordResetToken
	var consumedAt sql.NullTime
	if err := row.Scan(&tok.TokenHash, &tok.UserID, &tok.CreatedAt, &tok.ExpiresAt, &consumedAt); err != nil {
		return nil, fmt.Errorf("postgres: get password reset token: %w", err)
	}
	if consumedAt.Valid {
		tok.ConsumedAt = &consumedAt.Time
	}
	return &tok, nil
}

func (t *tx) ConsumePasswordResetToken(ctx context.Context, tokenHash string) error {
	res, err := t.sqlTx.ExecContext(ctx,
		rewritePlaceholders(
			`UPDATE password_reset_tokens SET consumed_at = NOW()
			 WHERE token = ? AND consumed_at IS NULL`),
		tokenHash,
	)
	if err != nil {
		return fmt.Errorf("postgres: consume password reset token: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("postgres: token not found or already consumed")
	}
	return nil
}
