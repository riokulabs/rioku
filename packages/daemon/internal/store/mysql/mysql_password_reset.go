package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *tx) CreatePasswordResetToken(ctx context.Context, tokenHash, userID string, expiresAt time.Time) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO password_reset_tokens (token, user_id, expires_at)
		 VALUES (?, ?, ?)`,
		tokenHash, userID, expiresAt.UTC().Format(timeFormat),
	)
	if err != nil {
		return fmt.Errorf("mysql: create password reset token: %w", err)
	}
	return nil
}

func (t *tx) GetPasswordResetToken(ctx context.Context, tokenHash string) (*store.PasswordResetToken, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT token, user_id, created_at, expires_at, consumed_at
		 FROM password_reset_tokens WHERE token = ?`, tokenHash)

	var tok store.PasswordResetToken
	var createdAt, expiresAt string
	var consumedAt sql.NullString
	if err := row.Scan(&tok.TokenHash, &tok.UserID, &createdAt, &expiresAt, &consumedAt); err != nil {
		return nil, fmt.Errorf("mysql: get password reset token: %w", err)
	}
	var err error
	tok.CreatedAt, err = time.Parse(timeFormat, createdAt)
	if err != nil {
		return nil, fmt.Errorf("mysql: parse created_at: %w", err)
	}
	tok.ExpiresAt, err = time.Parse(timeFormat, expiresAt)
	if err != nil {
		return nil, fmt.Errorf("mysql: parse expires_at: %w", err)
	}
	if consumedAt.Valid {
		t2, err := time.Parse(timeFormat, consumedAt.String)
		if err != nil {
			return nil, fmt.Errorf("mysql: parse consumed_at: %w", err)
		}
		tok.ConsumedAt = &t2
	}
	return &tok, nil
}

func (t *tx) ConsumePasswordResetToken(ctx context.Context, tokenHash string) error {
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE password_reset_tokens SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL`,
		now, tokenHash,
	)
	if err != nil {
		return fmt.Errorf("mysql: consume password reset token: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: token not found or already consumed")
	}
	return nil
}
