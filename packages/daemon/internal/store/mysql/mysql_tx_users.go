package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

func (t *tx) CreateUser(ctx context.Context, u *store.User) (*store.User, error) {
	id := uuid.New().String()
	now := nowUTC()

	username := strings.ToLower(u.Username)

	var email, displayName, totpSecret sql.NullString
	if u.Email != nil {
		email = sql.NullString{String: *u.Email, Valid: true}
	}
	if u.DisplayName != nil {
		displayName = sql.NullString{String: *u.DisplayName, Valid: true}
	}
	if u.TOTPSecret != nil {
		totpSecret = sql.NullString{String: *u.TOTPSecret, Valid: true}
	}

	totpEnabled := 0
	if u.TOTPEnabled {
		totpEnabled = 1
	}
	forcePasswordChange := 0
	if u.ForcePasswordChange {
		forcePasswordChange = 1
	}

	var lockedUntil sql.NullString
	if u.LockedUntil != nil {
		lockedUntil = sql.NullString{String: u.LockedUntil.UTC().Format(timeFormat), Valid: true}
	}
	var lastLogin sql.NullString
	if u.LastLogin != nil {
		lastLogin = sql.NullString{String: u.LastLogin.UTC().Format(timeFormat), Valid: true}
	}

	passwordChangedAt := now
	if !u.PasswordChangedAt.IsZero() {
		passwordChangedAt = u.PasswordChangedAt.UTC().Format(timeFormat)
	}

	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO users (id, username, email, display_name, password_hash, status,
		                     totp_secret, totp_enabled, force_password_change,
		                     failed_attempts, locked_until, last_login,
		                     password_changed_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, username, email, displayName, u.PasswordHash, u.Status,
		totpSecret, totpEnabled, forcePasswordChange,
		u.FailedAttempts, lockedUntil, lastLogin,
		passwordChangedAt, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert user: %w", err)
	}

	t.emit("users", id, "INSERT")

	return t.GetUser(ctx, id)
}

func (t *tx) GetUser(ctx context.Context, id string) (*store.User, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users WHERE id = ?`, id)
	return scanUser(row)
}

func (t *tx) GetUserByUsername(ctx context.Context, username string) (*store.User, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users WHERE LOWER(username) = LOWER(?)`, username)
	return scanUser(row)
}

func (t *tx) ListUsers(ctx context.Context) ([]*store.User, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users ORDER BY username`)
	if err != nil {
		return nil, fmt.Errorf("mysql: list users: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var users []*store.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (t *tx) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := t.sqlTx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("mysql: count users: %w", err)
	}
	return n, nil
}

func (t *tx) GetUserByEmail(ctx context.Context, email string) (*store.User, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, username, email, display_name, password_hash, status,
		        totp_secret, totp_enabled, force_password_change,
		        failed_attempts, locked_until, last_login,
		        password_changed_at, created_at, updated_at
		 FROM users WHERE LOWER(email) = LOWER(?)`, email)
	return scanUser(row)
}

func (t *tx) UpdateUser(ctx context.Context, u *store.User) (*store.User, error) {
	now := nowUTC()

	var email, displayName, totpSecret sql.NullString
	if u.Email != nil {
		email = sql.NullString{String: *u.Email, Valid: true}
	}
	if u.DisplayName != nil {
		displayName = sql.NullString{String: *u.DisplayName, Valid: true}
	}
	if u.TOTPSecret != nil {
		totpSecret = sql.NullString{String: *u.TOTPSecret, Valid: true}
	}

	totpEnabled := 0
	if u.TOTPEnabled {
		totpEnabled = 1
	}
	forcePasswordChange := 0
	if u.ForcePasswordChange {
		forcePasswordChange = 1
	}

	var lockedUntil sql.NullString
	if u.LockedUntil != nil {
		lockedUntil = sql.NullString{String: u.LockedUntil.UTC().Format(timeFormat), Valid: true}
	}
	var lastLogin sql.NullString
	if u.LastLogin != nil {
		lastLogin = sql.NullString{String: u.LastLogin.UTC().Format(timeFormat), Valid: true}
	}

	passwordChangedAt := u.PasswordChangedAt.UTC().Format(timeFormat)

	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE users SET username=?, email=?, display_name=?, password_hash=?, status=?,
		                  totp_secret=?, totp_enabled=?, force_password_change=?,
		                  failed_attempts=?, locked_until=?, last_login=?,
		                  password_changed_at=?, updated_at=?
		 WHERE id=?`,
		strings.ToLower(u.Username), email, displayName, u.PasswordHash, u.Status,
		totpSecret, totpEnabled, forcePasswordChange,
		u.FailedAttempts, lockedUntil, lastLogin,
		passwordChangedAt, now, u.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: update user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("mysql: user %q not found", u.ID)
	}

	t.emit("users", u.ID, "UPDATE")

	return t.GetUser(ctx, u.ID)
}

func (t *tx) DeleteUser(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("mysql: delete user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: user %q not found", id)
	}
	t.emit("users", id, "DELETE")
	return nil
}

func (t *tx) IncrementFailedAttempts(ctx context.Context, userID string, lockUntil *time.Time) error {
	var res sql.Result
	var err error

	if lockUntil != nil {
		res, err = t.sqlTx.ExecContext(ctx,
			`UPDATE users SET failed_attempts = failed_attempts + 1,
			                  locked_until = ?, status = 'locked', updated_at = ?
			 WHERE id = ?`,
			lockUntil.UTC().Format(timeFormat), nowUTC(), userID,
		)
	} else {
		res, err = t.sqlTx.ExecContext(ctx,
			`UPDATE users SET failed_attempts = failed_attempts + 1, updated_at = ?
			 WHERE id = ?`,
			nowUTC(), userID,
		)
	}
	if err != nil {
		return fmt.Errorf("mysql: increment failed_attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: user %q not found", userID)
	}
	t.emit("users", userID, "UPDATE")
	return nil
}

func (t *tx) ResetFailedAttempts(ctx context.Context, userID string) error {
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE users SET failed_attempts = 0, locked_until = NULL, status = 'active', updated_at = ?
		 WHERE id = ?`,
		nowUTC(), userID,
	)
	if err != nil {
		return fmt.Errorf("mysql: reset failed_attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: user %q not found", userID)
	}
	t.emit("users", userID, "UPDATE")
	return nil
}

func (t *tx) UpdateLastLogin(ctx context.Context, userID string) error {
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?`,
		now, now, userID,
	)
	if err != nil {
		return fmt.Errorf("mysql: update last_login: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: user %q not found", userID)
	}
	t.emit("users", userID, "UPDATE")
	return nil
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

func (t *tx) CreateSession(ctx context.Context, s *store.Session) (*store.Session, error) {
	var ipAddress, userAgent sql.NullString
	if s.IPAddress != nil {
		ipAddress = sql.NullString{String: *s.IPAddress, Valid: true}
	}
	if s.UserAgent != nil {
		userAgent = sql.NullString{String: *s.UserAgent, Valid: true}
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO sessions (id, tenant_id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.ID, tenantID, s.UserID, s.Fingerprint,
		s.CreatedAt.UTC().Format(timeFormat),
		s.ExpiresAt.UTC().Format(timeFormat),
		s.LastActive.UTC().Format(timeFormat),
		ipAddress, userAgent,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert session: %w", err)
	}

	t.emit("sessions", s.ID, "INSERT")

	return t.GetSession(ctx, s.ID)
}

// GetSession does NOT filter by tenant. Sessions live for the user's
// active tenant only — but the auth middleware looks up the session
// before any tenant context exists.
func (t *tx) GetSession(ctx context.Context, id string) (*store.Session, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent
		 FROM sessions WHERE id = ?`, id)
	return scanSession(row)
}

func (t *tx) ListSessionsByUser(ctx context.Context, userID string) ([]*store.Session, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, user_id, fingerprint, created_at, expires_at, last_active, ip_address, user_agent
		 FROM sessions WHERE user_id = ? ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list sessions by user: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var sessions []*store.Session
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

func (t *tx) DeleteSession(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("mysql: delete session: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: session %q not found", id)
	}
	t.emit("sessions", id, "DELETE")
	return nil
}

func (t *tx) DeleteSessionsByUser(ctx context.Context, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("mysql: delete sessions by user: %w", err)
	}
	t.emit("sessions", userID, "DELETE")
	return nil
}

func (t *tx) DeleteSessionsByUserExcept(ctx context.Context, userID, exceptSessionID string) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM sessions WHERE user_id = ? AND id != ?`, userID, exceptSessionID)
	if err != nil {
		return fmt.Errorf("mysql: delete sessions by user except: %w", err)
	}
	t.emit("sessions", userID, "DELETE")
	return nil
}

func (t *tx) UpdateSessionLastActive(ctx context.Context, id string, at time.Time) error {
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE sessions SET last_active = ? WHERE id = ?`,
		at.UTC().Format(timeFormat), id,
	)
	if err != nil {
		return fmt.Errorf("mysql: update session last_active: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mysql: session %q not found", id)
	}
	t.emit("sessions", id, "UPDATE")
	return nil
}

func (t *tx) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	now := nowUTC()
	yesterday := time.Now().UTC().Add(-24 * time.Hour).Format(timeFormat)
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM sessions WHERE expires_at < ? OR last_active < ?`,
		now, yesterday,
	)
	if err != nil {
		return 0, fmt.Errorf("mysql: delete expired sessions: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}
