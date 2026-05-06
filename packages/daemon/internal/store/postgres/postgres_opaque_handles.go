package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Opaque handles
// ---------------------------------------------------------------------------

func (t *tx) GetOpaqueHandle(ctx context.Context, tenantID, handle string) (*store.OpaqueHandle, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT handle, tenant_id, value_hash, created_at, expires_at
		 FROM opaque_handles WHERE handle = ? AND tenant_id = ?`),
		handle, tenantID,
	)
	h, err := scanPgOpaqueHandle(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get opaque handle: %w", err)
	}
	return h, nil
}

func (t *tx) GetOpaqueHandleByValueHash(ctx context.Context, tenantID, valueHash string) (*store.OpaqueHandle, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT handle, tenant_id, value_hash, created_at, expires_at
		 FROM opaque_handles WHERE tenant_id = ? AND value_hash = ?`),
		tenantID, valueHash,
	)
	h, err := scanPgOpaqueHandle(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get opaque handle by value hash: %w", err)
	}
	return h, nil
}

func (t *tx) UpsertOpaqueHandle(ctx context.Context, h store.OpaqueHandle) error {
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO opaque_handles (handle, tenant_id, value_hash, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(handle) DO NOTHING`),
		h.Handle, h.TenantID, h.ValueHash, h.CreatedAt.UTC(), h.ExpiresAt,
	)
	if err != nil {
		return fmt.Errorf("postgres: upsert opaque handle: %w", err)
	}
	return nil
}

func scanPgOpaqueHandle(row interface {
	Scan(dest ...any) error
}) (*store.OpaqueHandle, error) {
	var h store.OpaqueHandle
	if err := row.Scan(&h.Handle, &h.TenantID, &h.ValueHash, &h.CreatedAt, &h.ExpiresAt); err != nil {
		return nil, err
	}
	h.CreatedAt = h.CreatedAt.UTC()
	return &h, nil
}
