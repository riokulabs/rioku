package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

func (t *tx) CreateAPIKey(ctx context.Context, name, keyHash string, scopes []string, expiresAt *time.Time, ownerID string) (string, error) {
	id := uuid.New().String()
	now := nowUTC()

	scopesJSON, err := json.Marshal(scopes)
	if err != nil {
		return "", fmt.Errorf("sqlite: marshal scopes: %w", err)
	}

	var expiresStr *string
	if expiresAt != nil {
		s := expiresAt.UTC().Format(timeFormat)
		expiresStr = &s
	}

	var ownerIDVal *string
	if ownerID != "" {
		ownerIDVal = &ownerID
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO api_keys (id, tenant_id, name, key_hash, scopes, expires_at, created_at, owner_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, name, keyHash, string(scopesJSON), expiresStr, now, ownerIDVal,
	)
	if err != nil {
		return "", fmt.Errorf("sqlite: insert api_key: %w", err)
	}

	t.emit("api_keys", id, "INSERT")

	return id, nil
}

func (t *tx) GetAPIKey(ctx context.Context, id string) (*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count, subscription_id, application_id
		 FROM api_keys WHERE id = ? AND tenant_id = ?`, id, tenantID)
	return scanAPIKey(row)
}

// GetAPIKeyByHash is invoked by the auth middleware before any tenant
// context exists. The hash is unique system-wide; the resolved key
// carries its tenant_id so the caller can attach it to the request
// context for downstream tenant filtering.
//
// Returns ErrAPIKeyNotFound when the hash isn't present so the
// rioku_apikey resolution chain (#179) can map missing-key to a
// 401 instead of an Internal error.
func (t *tx) GetAPIKeyByHash(ctx context.Context, keyHash string) (*store.APIKey, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count, subscription_id, application_id
		 FROM api_keys WHERE key_hash = ?`, keyHash)
	key, err := scanAPIKey(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) || strings.Contains(err.Error(), "no rows in result set") {
			return nil, store.ErrAPIKeyNotFound
		}
		return nil, err
	}
	return key, nil
}

func (t *tx) ListAPIKeys(ctx context.Context) ([]*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count, subscription_id, application_id
		 FROM api_keys WHERE revoked_at IS NULL AND tenant_id = ?`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list api_keys: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var keys []*store.APIKey
	for rows.Next() {
		k, err := scanAPIKeyRows(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (t *tx) ListAPIKeysByOwner(ctx context.Context, ownerID string) ([]*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id, last_used_at, usage_count, subscription_id, application_id
		 FROM api_keys WHERE revoked_at IS NULL AND owner_id = ? AND tenant_id = ?`, ownerID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list api_keys by owner: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var keys []*store.APIKey
	for rows.Next() {
		k, err := scanAPIKeyRows(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (t *tx) RevokeAPIKey(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL`,
		now, id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("sqlite: revoke api_key: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: api_key %q not found or already revoked", id)
	}
	t.emit("api_keys", id, "UPDATE")
	return nil
}

// UpdateAPIKey applies partial changes to a key's metadata.
func (t *tx) UpdateAPIKey(ctx context.Context, id string, params store.UpdateAPIKeyParams) (*store.APIKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	// Build the SET clause from the supplied fields. Skip the UPDATE
	// entirely when nothing was supplied so we don't bump updated_at
	// for a no-op call.
	var (
		setClauses []string
		args       []any
	)
	if params.Name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *params.Name)
	}
	if params.Scopes != nil {
		raw, err := json.Marshal(*params.Scopes)
		if err != nil {
			return nil, fmt.Errorf("sqlite: marshal scopes: %w", err)
		}
		setClauses = append(setClauses, "scopes = ?")
		args = append(args, string(raw))
	}
	if params.ExpiresAt != nil {
		if *params.ExpiresAt == nil {
			setClauses = append(setClauses, "expires_at = NULL")
		} else {
			setClauses = append(setClauses, "expires_at = ?")
			args = append(args, (*params.ExpiresAt).UTC().Format(timeFormat))
		}
	}
	if len(setClauses) > 0 {
		args = append(args, id, tenantID)
		query := "UPDATE api_keys SET " + strings.Join(setClauses, ", ") +
			" WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL"
		res, err := t.sqlTx.ExecContext(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("sqlite: update api_key: %w", err)
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return nil, fmt.Errorf("sqlite: api_key %q not found", id)
		}
		t.emit("api_keys", id, "UPDATE")
	}
	return t.GetAPIKey(ctx, id)
}

// RecordAPIKeyUse atomically bumps usage_count and overwrites
// last_used_at. No-op (no error) when the key id doesn't exist —
// the caller is the auth path and a missing row at this point is
// already an authentication failure handled upstream.
func (t *tx) RecordAPIKeyUse(ctx context.Context, id string, at time.Time) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`UPDATE api_keys SET last_used_at = ?, usage_count = usage_count + 1 WHERE id = ?`,
		at.UTC().Format(timeFormat), id,
	)
	if err != nil {
		return fmt.Errorf("sqlite: record api_key use: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
