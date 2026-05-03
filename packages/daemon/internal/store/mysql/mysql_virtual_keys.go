package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *tx) CreateVirtualKey(ctx context.Context, p store.CreateVirtualKeyParams) (*store.VirtualKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = p.TenantID
	}
	allowedJSON, err := marshalAllowedModels(p.AllowedModels)
	if err != nil {
		return nil, err
	}
	if p.BudgetWindow == "" {
		p.BudgetWindow = store.BudgetWindowMonth
	}
	now := nowUTC()
	var createdBy *string
	if p.CreatedBy != "" {
		createdBy = &p.CreatedBy
	}
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO virtual_keys (id, tenant_id, name, provider_id, credential_ref,
		     allowed_models, rpm_limit, tpm_limit, budget_usd, budget_window,
		     created_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, tenantID, p.Name, p.ProviderID, p.CredentialRef,
		allowedJSON, p.RPMLimit, p.TPMLimit, p.BudgetUSD, string(p.BudgetWindow),
		createdBy, now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrVirtualKeyNameTaken
		}
		return nil, fmt.Errorf("mysql: create virtual_key: %w", err)
	}
	t.emit("virtual_keys", p.ID, "INSERT")
	return t.GetVirtualKey(ctx, p.ID)
}

const vkSelectColumns = `id, tenant_id, name, provider_id, credential_ref,
	allowed_models, rpm_limit, tpm_limit, budget_usd, budget_window,
	revoked_at, created_by, created_at, updated_at`

func (t *tx) GetVirtualKey(ctx context.Context, id string) (*store.VirtualKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT `+vkSelectColumns+` FROM virtual_keys WHERE id = ? AND tenant_id = ?`,
		id, tenantID)
	k, err := scanVirtualKey(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrVirtualKeyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("mysql: get virtual_key: %w", err)
	}
	return k, nil
}

func (t *tx) ListVirtualKeys(ctx context.Context) ([]*store.VirtualKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT `+vkSelectColumns+` FROM virtual_keys WHERE tenant_id = ? ORDER BY name`,
		tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list virtual_keys: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.VirtualKey
	for rows.Next() {
		k, err := scanVirtualKey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (t *tx) UpdateVirtualKey(ctx context.Context, id string, p store.UpdateVirtualKeyParams) (*store.VirtualKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	sets := []string{}
	args := []any{}
	if p.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *p.Name)
	}
	if p.ProviderID != nil {
		sets = append(sets, "provider_id = ?")
		args = append(args, *p.ProviderID)
	}
	if p.CredentialRef != nil {
		sets = append(sets, "credential_ref = ?")
		args = append(args, *p.CredentialRef)
	}
	if p.AllowedModels != nil {
		j, err := marshalAllowedModels(*p.AllowedModels)
		if err != nil {
			return nil, err
		}
		sets = append(sets, "allowed_models = ?")
		args = append(args, j)
	}
	if p.RPMLimit != nil {
		sets = append(sets, "rpm_limit = ?")
		args = append(args, *p.RPMLimit)
	}
	if p.TPMLimit != nil {
		sets = append(sets, "tpm_limit = ?")
		args = append(args, *p.TPMLimit)
	}
	if p.BudgetUSD != nil {
		sets = append(sets, "budget_usd = ?")
		args = append(args, *p.BudgetUSD)
	}
	if p.BudgetWindow != nil {
		sets = append(sets, "budget_window = ?")
		args = append(args, string(*p.BudgetWindow))
	}
	if len(sets) == 0 {
		return t.GetVirtualKey(ctx, id)
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, nowUTC(), id, tenantID)
	q := `UPDATE virtual_keys SET ` + strings.Join(sets, ", ") + ` WHERE id = ? AND tenant_id = ?`
	res, err := t.sqlTx.ExecContext(ctx, q, args...)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrVirtualKeyNameTaken
		}
		return nil, fmt.Errorf("mysql: update virtual_key: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.ErrVirtualKeyNotFound
	}
	t.emit("virtual_keys", id, "UPDATE")
	return t.GetVirtualKey(ctx, id)
}

func (t *tx) RotateVirtualKey(ctx context.Context, id, newCredentialRef string) (*store.VirtualKey, error) {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE virtual_keys SET credential_ref = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
		newCredentialRef, nowUTC(), id, tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: rotate virtual_key: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.ErrVirtualKeyNotFound
	}
	t.emit("virtual_keys", id, "UPDATE")
	return t.GetVirtualKey(ctx, id)
}

func (t *tx) RevokeVirtualKey(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE virtual_keys SET revoked_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL`,
		nowUTC(), nowUTC(), id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("mysql: revoke virtual_key: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrVirtualKeyNotFound
	}
	t.emit("virtual_keys", id, "UPDATE")
	return nil
}

func (t *tx) DeleteVirtualKey(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM virtual_keys WHERE id = ? AND tenant_id = ?`, id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("mysql: delete virtual_key: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrVirtualKeyNotFound
	}
	t.emit("virtual_keys", id, "DELETE")
	return nil
}

func scanVirtualKey(s scanner) (*store.VirtualKey, error) {
	var (
		k                                store.VirtualKey
		allowedJSON                      string
		budgetWindow, createdAt, updated string
		revokedAt, createdBy             sql.NullString
	)
	if err := s.Scan(
		&k.ID, &k.TenantID, &k.Name, &k.ProviderID, &k.CredentialRef,
		&allowedJSON, &k.RPMLimit, &k.TPMLimit, &k.BudgetUSD, &budgetWindow,
		&revokedAt, &createdBy, &createdAt, &updated,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(allowedJSON), &k.AllowedModels); err != nil {
		return nil, fmt.Errorf("mysql: parse allowed_models: %w", err)
	}
	k.BudgetWindow = store.BudgetWindow(budgetWindow)
	if revokedAt.Valid {
		t := parseTime(revokedAt.String)
		k.RevokedAt = &t
	}
	if createdBy.Valid {
		s := createdBy.String
		k.CreatedBy = &s
	}
	k.CreatedAt = parseTime(createdAt)
	k.UpdatedAt = parseTime(updated)
	return &k, nil
}

// marshalAllowedModels guarantees a valid JSON array on disk
// (the column has no DEFAULT for the JSON shape on every dialect).
func marshalAllowedModels(models []string) (string, error) {
	if models == nil {
		models = []string{}
	}
	b, err := json.Marshal(models)
	if err != nil {
		return "", fmt.Errorf("mysql: marshal allowed_models: %w", err)
	}
	return string(b), nil
}
