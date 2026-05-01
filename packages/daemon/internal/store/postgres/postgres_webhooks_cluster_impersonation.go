// Package postgres — Webhooks + Cluster Enrollment Tokens +
// Impersonation Sessions (stage-2).
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Webhook Endpoints
// ---------------------------------------------------------------------------

func (t *tx) CreateWebhookEndpoint(ctx context.Context, in *store.WebhookEndpoint) (*store.WebhookEndpoint, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.URL == "" {
		return nil, fmt.Errorf("postgres: webhook_endpoint requires tenant_id, name, url")
	}
	id := in.ID
	if id == "" {
		id = newID("hook")
	}
	events := in.Events
	if events == "" {
		events = "[]"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO webhook_endpoints (id, tenant_id, name, url, secret, events, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.Name, in.URL, in.Secret, events, in.Enabled, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "name") {
			return nil, store.ErrWebhookEndpointNameTaken
		}
		return nil, fmt.Errorf("postgres: insert webhook_endpoint: %w", err)
	}
	t.emit("webhook_endpoints", id, "INSERT")
	return t.GetWebhookEndpoint(ctx, in.TenantID, id)
}

func (t *tx) GetWebhookEndpoint(ctx context.Context, tenantID, id string) (*store.WebhookEndpoint, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, url, secret, events, enabled, created_at, updated_at
		 FROM webhook_endpoints WHERE id = ? AND tenant_id = ?`), id, tenantID)
	e, err := scanWebhookEndpoint(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrWebhookEndpointNotFound
	}
	return e, err
}

func (t *tx) ListWebhookEndpointsByTenant(ctx context.Context, tenantID string) ([]*store.WebhookEndpoint, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, url, secret, events, enabled, created_at, updated_at
		 FROM webhook_endpoints WHERE tenant_id = ? ORDER BY name ASC`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list webhook_endpoints: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.WebhookEndpoint
	for rows.Next() {
		e, err := scanWebhookEndpoint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (t *tx) UpdateWebhookEndpoint(ctx context.Context, tenantID, id string, p store.UpdateWebhookEndpointParams) (*store.WebhookEndpoint, error) {
	c, err := t.GetWebhookEndpoint(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.URL != nil {
		c.URL = *p.URL
	}
	if p.Secret != nil {
		c.Secret = p.Secret
	}
	if p.Events != nil {
		c.Events = *p.Events
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE webhook_endpoints SET name=?, url=?, secret=?, events=?, enabled=?, updated_at=?
		 WHERE id=? AND tenant_id=?`),
		c.Name, c.URL, c.Secret, c.Events, c.Enabled, nowUTC(), id, tenantID); err != nil {
		if isPgUniqueViolation(err, "name") {
			return nil, store.ErrWebhookEndpointNameTaken
		}
		return nil, fmt.Errorf("postgres: update webhook_endpoint: %w", err)
	}
	t.emit("webhook_endpoints", id, "UPDATE")
	return t.GetWebhookEndpoint(ctx, tenantID, id)
}

func (t *tx) DeleteWebhookEndpoint(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM webhook_endpoints WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete webhook_endpoint: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrWebhookEndpointNotFound
	}
	t.emit("webhook_endpoints", id, "DELETE")
	return nil
}

func scanWebhookEndpoint(s scanner) (*store.WebhookEndpoint, error) {
	var (
		id, tenantID, name, url, events string
		secret                          sql.NullString
		enabled                         bool
		createdAt, updatedAt            time.Time
	)
	if err := s.Scan(&id, &tenantID, &name, &url, &secret, &events, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	out := &store.WebhookEndpoint{
		ID: id, TenantID: tenantID, Name: name, URL: url,
		Events: events, Enabled: enabled,
		CreatedAt: createdAt.UTC(), UpdatedAt: updatedAt.UTC(),
	}
	if secret.Valid {
		out.Secret = &secret.String
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Cluster Enrollment Tokens
// ---------------------------------------------------------------------------

func (t *tx) CreateEnrollmentToken(ctx context.Context, in *store.ClusterEnrollmentToken) (*store.ClusterEnrollmentToken, error) {
	if in == nil || in.TokenHash == "" || in.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("postgres: enrollment_token requires token_hash, expires_at")
	}
	id := in.ID
	if id == "" {
		id = newID("etok")
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO cluster_enrollment_tokens (id, token_hash, created_by, expires_at, notes, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`),
		id, in.TokenHash, in.CreatedBy, in.ExpiresAt.UTC(), in.Notes, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert enrollment_token: %w", err)
	}
	t.emit("cluster_enrollment_tokens", id, "INSERT")
	return t.getEnrollmentTokenByID(ctx, id)
}

func (t *tx) getEnrollmentTokenByID(ctx context.Context, id string) (*store.ClusterEnrollmentToken, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, token_hash, created_by, expires_at, consumed_at, consumed_by_node_id, revoked_at, notes, created_at
		 FROM cluster_enrollment_tokens WHERE id = ?`), id)
	tok, err := scanEnrollmentToken(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrEnrollmentTokenNotFound
	}
	return tok, err
}

func (t *tx) GetEnrollmentTokenByHash(ctx context.Context, hash string) (*store.ClusterEnrollmentToken, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, token_hash, created_by, expires_at, consumed_at, consumed_by_node_id, revoked_at, notes, created_at
		 FROM cluster_enrollment_tokens WHERE token_hash = ?`), hash)
	tok, err := scanEnrollmentToken(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrEnrollmentTokenNotFound
	}
	return tok, err
}

func (t *tx) ListActiveEnrollmentTokens(ctx context.Context) ([]*store.ClusterEnrollmentToken, error) {
	now := time.Now().UTC()
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, token_hash, created_by, expires_at, consumed_at, consumed_by_node_id, revoked_at, notes, created_at
		 FROM cluster_enrollment_tokens
		 WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
		 ORDER BY created_at DESC`), now)
	if err != nil {
		return nil, fmt.Errorf("postgres: list enrollment_tokens: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.ClusterEnrollmentToken
	for rows.Next() {
		tok, err := scanEnrollmentToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, tok)
	}
	return out, rows.Err()
}

// ConsumeEnrollmentToken atomically marks the token as consumed by
// nodeID. Returns ErrEnrollmentTokenAlreadyUsed if it was already
// consumed/revoked, and ErrEnrollmentTokenExpired if past expiry.
func (t *tx) ConsumeEnrollmentToken(ctx context.Context, hash, nodeID string) (*store.ClusterEnrollmentToken, error) {
	tok, err := t.GetEnrollmentTokenByHash(ctx, hash)
	if err != nil {
		return nil, err
	}
	if tok.ConsumedAt != nil || tok.RevokedAt != nil {
		return nil, store.ErrEnrollmentTokenAlreadyUsed
	}
	if time.Now().UTC().After(tok.ExpiresAt) {
		return nil, store.ErrEnrollmentTokenExpired
	}
	now := nowUTC()
	_, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE cluster_enrollment_tokens SET consumed_at = ?, consumed_by_node_id = ? WHERE id = ?`),
		now, nodeID, tok.ID)
	if err != nil {
		return nil, fmt.Errorf("postgres: consume enrollment_token: %w", err)
	}
	t.emit("cluster_enrollment_tokens", tok.ID, "UPDATE")
	return t.getEnrollmentTokenByID(ctx, tok.ID)
}

func (t *tx) RevokeEnrollmentToken(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE cluster_enrollment_tokens SET revoked_at = ?
		 WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL`),
		nowUTC(), id)
	if err != nil {
		return fmt.Errorf("postgres: revoke enrollment_token: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Could be already consumed/revoked or doesn't exist.
		row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
			`SELECT 1 FROM cluster_enrollment_tokens WHERE id = ?`), id)
		var dummy int
		if err := row.Scan(&dummy); errors.Is(err, sql.ErrNoRows) {
			return store.ErrEnrollmentTokenNotFound
		}
		return store.ErrEnrollmentTokenAlreadyUsed
	}
	t.emit("cluster_enrollment_tokens", id, "UPDATE")
	return nil
}

func scanEnrollmentToken(s scanner) (*store.ClusterEnrollmentToken, error) {
	var (
		id, tokenHash, notes  string
		createdBy             sql.NullString
		consumedByNodeID      sql.NullString
		expiresAt, createdAt  time.Time
		consumedAt, revokedAt sql.NullTime
	)
	if err := s.Scan(&id, &tokenHash, &createdBy, &expiresAt, &consumedAt, &consumedByNodeID,
		&revokedAt, &notes, &createdAt); err != nil {
		return nil, err
	}
	out := &store.ClusterEnrollmentToken{
		ID: id, TokenHash: tokenHash,
		ExpiresAt: expiresAt.UTC(), Notes: notes,
		CreatedAt: createdAt.UTC(),
	}
	if createdBy.Valid {
		out.CreatedBy = &createdBy.String
	}
	if consumedByNodeID.Valid {
		out.ConsumedByNodeID = &consumedByNodeID.String
	}
	if consumedAt.Valid {
		ts := consumedAt.Time.UTC()
		out.ConsumedAt = &ts
	}
	if revokedAt.Valid {
		ts := revokedAt.Time.UTC()
		out.RevokedAt = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Impersonation Sessions
// ---------------------------------------------------------------------------

func (t *tx) CreateImpersonationSession(ctx context.Context, in *store.ImpersonationSession) (*store.ImpersonationSession, error) {
	if in == nil || in.SuperAdminID == "" || in.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("postgres: impersonation_session requires super_admin_id, expires_at")
	}
	id := in.ID
	if id == "" {
		id = newID("imp")
	}
	now := nowUTC()
	startedAt := now
	if !in.StartedAt.IsZero() {
		startedAt = in.StartedAt.UTC()
	}
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO impersonation_sessions (id, super_admin_id, tenant_id, user_id, reason,
		   started_at, expires_at, last_active_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.SuperAdminID, in.TenantID, in.UserID, in.Reason,
		startedAt, in.ExpiresAt.UTC(), in.LastActiveAt,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert impersonation_session: %w", err)
	}
	t.emit("impersonation_sessions", id, "INSERT")
	return t.GetImpersonationSession(ctx, id)
}

func (t *tx) GetImpersonationSession(ctx context.Context, id string) (*store.ImpersonationSession, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, super_admin_id, tenant_id, user_id, reason, started_at, expires_at,
		   last_active_at, ended_at, end_reason
		 FROM impersonation_sessions WHERE id = ?`), id)
	s, err := scanImpersonationSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrImpersonationSessionNotFound
	}
	return s, err
}

func (t *tx) ListActiveImpersonationSessions(ctx context.Context) ([]*store.ImpersonationSession, error) {
	now := time.Now().UTC()
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, super_admin_id, tenant_id, user_id, reason, started_at, expires_at,
		   last_active_at, ended_at, end_reason
		 FROM impersonation_sessions WHERE ended_at IS NULL AND expires_at > ?
		 ORDER BY started_at DESC`), now)
	if err != nil {
		return nil, fmt.Errorf("postgres: list impersonation_sessions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.ImpersonationSession
	for rows.Next() {
		s, err := scanImpersonationSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *tx) EndImpersonationSession(ctx context.Context, id, reason string) (*store.ImpersonationSession, error) {
	current, err := t.GetImpersonationSession(ctx, id)
	if err != nil {
		return nil, err
	}
	if current.EndedAt != nil {
		return nil, store.ErrImpersonationSessionEnded
	}
	if reason == "" {
		reason = "explicit_exit"
	}
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE impersonation_sessions SET ended_at = ?, end_reason = ? WHERE id = ?`),
		nowUTC(), reason, id); err != nil {
		return nil, fmt.Errorf("postgres: end impersonation_session: %w", err)
	}
	t.emit("impersonation_sessions", id, "UPDATE")
	return t.GetImpersonationSession(ctx, id)
}

func (t *tx) TouchImpersonationSession(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE impersonation_sessions SET last_active_at = ? WHERE id = ? AND ended_at IS NULL`),
		nowUTC(), id)
	if err != nil {
		return fmt.Errorf("postgres: touch impersonation_session: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrImpersonationSessionNotFound
	}
	return nil
}

func scanImpersonationSession(s scanner) (*store.ImpersonationSession, error) {
	var (
		id, superAdminID, reason string
		tenantID, userID         sql.NullString
		endReason                sql.NullString
		startedAt, expiresAt     time.Time
		lastActiveAt, endedAt    sql.NullTime
	)
	if err := s.Scan(&id, &superAdminID, &tenantID, &userID, &reason, &startedAt, &expiresAt,
		&lastActiveAt, &endedAt, &endReason); err != nil {
		return nil, err
	}
	out := &store.ImpersonationSession{
		ID: id, SuperAdminID: superAdminID, Reason: reason,
		StartedAt: startedAt.UTC(), ExpiresAt: expiresAt.UTC(),
	}
	if tenantID.Valid {
		out.TenantID = &tenantID.String
	}
	if userID.Valid {
		out.UserID = &userID.String
	}
	if endReason.Valid {
		out.EndReason = &endReason.String
	}
	if lastActiveAt.Valid {
		ts := lastActiveAt.Time.UTC()
		out.LastActiveAt = &ts
	}
	if endedAt.Valid {
		ts := endedAt.Time.UTC()
		out.EndedAt = &ts
	}
	return out, nil
}
