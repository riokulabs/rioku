package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

func (t *tx) CreatePolicy(ctx context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error) {
	id := uuid.New().String()
	now := nowUTC()

	configJSON, err := marshalStructJSON(pol.GetConfig())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal policy config: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(pol.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx,
		`INSERT INTO policies (id, tenant_id, name, type, config, labels, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, pol.GetName(), int32(pol.GetType()), configJSON, labelsJSON, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: insert policy: %w", err)
	}

	t.emit("policies", id, "INSERT")

	return t.GetPolicy(ctx, id)
}

func (t *tx) GetPolicy(ctx context.Context, id string) (*riokuv1.Policy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, name, type, config, labels, created_at, updated_at
		 FROM policies WHERE id = ? AND tenant_id = ?`, id, tenantID)
	return scanPolicy(row)
}

func (t *tx) ListPolicies(ctx context.Context) ([]*riokuv1.Policy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, name, type, config, labels, created_at, updated_at FROM policies WHERE tenant_id = ? ORDER BY id`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list policies: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var policies []*riokuv1.Policy
	for rows.Next() {
		p, err := scanPolicyRows(rows)
		if err != nil {
			return nil, err
		}
		policies = append(policies, p)
	}
	return policies, rows.Err()
}

func (t *tx) UpdatePolicy(ctx context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error) {
	now := nowUTC()

	configJSON, err := marshalStructJSON(pol.GetConfig())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal policy config: %w", err)
	}
	labelsJSON, err := marshalLabelsJSON(pol.GetLabels())
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal labels: %w", err)
	}

	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE policies SET name=?, type=?, config=?, labels=?, updated_at=? WHERE id=? AND tenant_id=?`,
		pol.GetName(), int32(pol.GetType()), configJSON, labelsJSON, now, pol.GetId(), tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: update policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("sqlite: policy %q not found", pol.GetId())
	}

	t.emit("policies", pol.GetId(), "UPDATE")

	return t.GetPolicy(ctx, pol.GetId())
}

func (t *tx) DeletePolicy(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM policies WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: delete policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: policy %q not found", id)
	}
	t.emit("policies", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Policy Bindings
// ---------------------------------------------------------------------------

var validTargetTypes = map[string]bool{"route": true, "service": true}

func (t *tx) AttachPolicy(ctx context.Context, policyID, targetType, targetID string) error {
	if !validTargetTypes[targetType] {
		return fmt.Errorf("sqlite: invalid target_type %q (must be 'route' or 'service')", targetType)
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO policy_bindings (policy_id, target_type, target_id) VALUES (?, ?, ?)`,
		policyID, targetType, targetID,
	)
	if err != nil {
		return fmt.Errorf("sqlite: attach policy: %w", err)
	}
	t.emit("policy_bindings", policyID, "INSERT")
	return nil
}

func (t *tx) DetachPolicy(ctx context.Context, policyID, targetType, targetID string) error {
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM policy_bindings WHERE policy_id=? AND target_type=? AND target_id=?`,
		policyID, targetType, targetID,
	)
	if err != nil {
		return fmt.Errorf("sqlite: detach policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("sqlite: policy binding not found")
	}
	t.emit("policy_bindings", policyID, "DELETE")
	return nil
}

func (t *tx) ListPoliciesByTarget(ctx context.Context, targetType, targetID string) ([]string, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT policy_id FROM policy_bindings WHERE target_type=? AND target_id=?`,
		targetType, targetID,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list policies by target: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("sqlite: scan policy_id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Access policies (#80)
// ---------------------------------------------------------------------------

func (t *tx) CreateAccessPolicy(ctx context.Context, p *store.AccessPolicy) (*store.AccessPolicy, error) {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	now := nowUTC()
	targetIDs, err := json.Marshal(orEmpty(p.TargetIDs))
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal target_ids: %w", err)
	}
	conditions, err := json.Marshal(orEmptyConditions(p.Conditions))
	if err != nil {
		return nil, fmt.Errorf("sqlite: marshal conditions: %w", err)
	}
	enabled := 0
	if p.Enabled {
		enabled = 1
	}
	tenantID := store.TenantIDFromContext(ctx)
	_, err = t.sqlTx.ExecContext(ctx, `
		INSERT INTO access_policies
			(id, tenant_id, name, description, effect, target_type, target_ids_json, conditions_json, priority, enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, p.ID, tenantID, p.Name, p.Description, string(p.Effect), string(p.TargetType),
		string(targetIDs), string(conditions), p.Priority, enabled, now, now)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAccessPolicyDuplicate
		}
		return nil, fmt.Errorf("sqlite: create access_policy: %w", err)
	}
	t.emit("access_policies", p.ID, "INSERT")
	return t.GetAccessPolicy(ctx, p.ID)
}

func (t *tx) GetAccessPolicy(ctx context.Context, id string) (*store.AccessPolicy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, `
		SELECT id, name, description, effect, target_type, target_ids_json,
		       conditions_json, priority, enabled, created_at, updated_at
		  FROM access_policies WHERE id = ? AND tenant_id = ?
	`, id, tenantID)
	p, err := scanAccessPolicy(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAccessPolicyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("sqlite: get access_policy: %w", err)
	}
	return p, nil
}

func (t *tx) ListAccessPolicies(ctx context.Context) ([]*store.AccessPolicy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, `
		SELECT id, name, description, effect, target_type, target_ids_json,
		       conditions_json, priority, enabled, created_at, updated_at
		  FROM access_policies
		 WHERE tenant_id = ?
		 ORDER BY priority ASC, created_at ASC
	`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list access_policies: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AccessPolicy
	for rows.Next() {
		p, err := scanAccessPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) UpdateAccessPolicy(ctx context.Context, id string, params store.UpdateAccessPolicyParams) (*store.AccessPolicy, error) {
	// Confirm existence first so we can return a stable not-found error.
	if _, err := t.GetAccessPolicy(ctx, id); err != nil {
		return nil, err
	}
	now := nowUTC()
	if params.Name != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET name = ?, updated_at = ? WHERE id = ?`,
			*params.Name, now, id); err != nil {
			if isUniqueViolation(err) {
				return nil, store.ErrAccessPolicyDuplicate
			}
			return nil, fmt.Errorf("sqlite: update access_policy name: %w", err)
		}
	}
	if params.Description != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET description = ?, updated_at = ? WHERE id = ?`,
			*params.Description, now, id); err != nil {
			return nil, fmt.Errorf("sqlite: update access_policy description: %w", err)
		}
	}
	if params.Effect != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET effect = ?, updated_at = ? WHERE id = ?`,
			string(*params.Effect), now, id); err != nil {
			return nil, fmt.Errorf("sqlite: update access_policy effect: %w", err)
		}
	}
	if params.TargetType != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET target_type = ?, updated_at = ? WHERE id = ?`,
			string(*params.TargetType), now, id); err != nil {
			return nil, fmt.Errorf("sqlite: update access_policy target_type: %w", err)
		}
	}
	if params.TargetIDs != nil {
		raw, err := json.Marshal(orEmpty(*params.TargetIDs))
		if err != nil {
			return nil, fmt.Errorf("sqlite: marshal target_ids: %w", err)
		}
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET target_ids_json = ?, updated_at = ? WHERE id = ?`,
			string(raw), now, id); err != nil {
			return nil, fmt.Errorf("sqlite: update access_policy target_ids: %w", err)
		}
	}
	if params.Conditions != nil {
		raw, err := json.Marshal(orEmptyConditions(*params.Conditions))
		if err != nil {
			return nil, fmt.Errorf("sqlite: marshal conditions: %w", err)
		}
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET conditions_json = ?, updated_at = ? WHERE id = ?`,
			string(raw), now, id); err != nil {
			return nil, fmt.Errorf("sqlite: update access_policy conditions: %w", err)
		}
	}
	if params.Priority != nil {
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET priority = ?, updated_at = ? WHERE id = ?`,
			*params.Priority, now, id); err != nil {
			return nil, fmt.Errorf("sqlite: update access_policy priority: %w", err)
		}
	}
	if params.Enabled != nil {
		v := 0
		if *params.Enabled {
			v = 1
		}
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE access_policies SET enabled = ?, updated_at = ? WHERE id = ?`,
			v, now, id); err != nil {
			return nil, fmt.Errorf("sqlite: update access_policy enabled: %w", err)
		}
	}
	t.emit("access_policies", id, "UPDATE")
	return t.GetAccessPolicy(ctx, id)
}

func (t *tx) DeleteAccessPolicy(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM access_policies WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: delete access_policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrAccessPolicyNotFound
	}
	t.emit("access_policies", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// RBAC policies (stage-2 admin completion chunk 7b)
// ---------------------------------------------------------------------------

func (t *tx) CreateRbacPolicy(ctx context.Context, p *store.RbacPolicy) (*store.RbacPolicy, error) {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	enabled := 1
	if !p.Enabled {
		enabled = 0
	}
	_, err := t.sqlTx.ExecContext(ctx, `
		INSERT INTO rbac_policies (id, tenant_id, name, description, subject_type, subject_id, role_id, enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, p.ID, tenantID, p.Name, p.Description, p.SubjectType, p.SubjectID, p.RoleID, enabled, now, now)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrRbacPolicyDuplicate
		}
		return nil, fmt.Errorf("sqlite: create rbac_policy: %w", err)
	}
	t.emit("rbac_policies", p.ID, "INSERT")
	return t.GetRbacPolicy(ctx, p.ID)
}

func (t *tx) GetRbacPolicy(ctx context.Context, id string) (*store.RbacPolicy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, `
		SELECT id, tenant_id, name, description, subject_type, subject_id, role_id, enabled, created_at, updated_at
		FROM rbac_policies WHERE id = ? AND tenant_id = ?
	`, id, tenantID)
	p, err := scanRbacPolicy(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrRbacPolicyNotFound
	}
	return p, err
}

func (t *tx) ListRbacPolicies(ctx context.Context) ([]*store.RbacPolicy, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, `
		SELECT id, tenant_id, name, description, subject_type, subject_id, role_id, enabled, created_at, updated_at
		FROM rbac_policies WHERE tenant_id = ? ORDER BY created_at, id
	`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list rbac_policies: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.RbacPolicy
	for rows.Next() {
		p, err := scanRbacPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) UpdateRbacPolicy(ctx context.Context, id string, params store.UpdateRbacPolicyParams) (*store.RbacPolicy, error) {
	if _, err := t.GetRbacPolicy(ctx, id); err != nil {
		return nil, err
	}
	tenantID := store.TenantIDFromContext(ctx)
	now := nowUTC()
	var setClauses []string
	var args []any
	if params.Name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *params.Name)
	}
	if params.Description != nil {
		setClauses = append(setClauses, "description = ?")
		args = append(args, *params.Description)
	}
	if params.SubjectType != nil {
		setClauses = append(setClauses, "subject_type = ?")
		args = append(args, *params.SubjectType)
	}
	if params.SubjectID != nil {
		setClauses = append(setClauses, "subject_id = ?")
		args = append(args, *params.SubjectID)
	}
	if params.RoleID != nil {
		setClauses = append(setClauses, "role_id = ?")
		args = append(args, *params.RoleID)
	}
	if params.Enabled != nil {
		v := 0
		if *params.Enabled {
			v = 1
		}
		setClauses = append(setClauses, "enabled = ?")
		args = append(args, v)
	}
	if len(setClauses) > 0 {
		setClauses = append(setClauses, "updated_at = ?")
		args = append(args, now, id, tenantID)
		query := "UPDATE rbac_policies SET " + strings.Join(setClauses, ", ") +
			" WHERE id = ? AND tenant_id = ?"
		if _, err := t.sqlTx.ExecContext(ctx, query, args...); err != nil {
			if isUniqueViolation(err) {
				return nil, store.ErrRbacPolicyDuplicate
			}
			return nil, fmt.Errorf("sqlite: update rbac_policy: %w", err)
		}
		t.emit("rbac_policies", id, "UPDATE")
	}
	return t.GetRbacPolicy(ctx, id)
}

func (t *tx) DeleteRbacPolicy(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM rbac_policies WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: delete rbac_policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrRbacPolicyNotFound
	}
	t.emit("rbac_policies", id, "DELETE")
	return nil
}

func scanRbacPolicy(s scanner) (*store.RbacPolicy, error) {
	var (
		p          store.RbacPolicy
		enabledInt int
		createdStr string
		updatedStr string
	)
	if err := s.Scan(&p.ID, &p.TenantID, &p.Name, &p.Description, &p.SubjectType, &p.SubjectID, &p.RoleID, &enabledInt, &createdStr, &updatedStr); err != nil {
		return nil, err
	}
	p.Enabled = enabledInt == 1
	p.CreatedAt = parseTime(createdStr)
	p.UpdatedAt = parseTime(updatedStr)
	return &p, nil
}
func scanAccessPolicy(s scanner) (*store.AccessPolicy, error) {
	var (
		p             store.AccessPolicy
		effect        string
		targetType    string
		targetIDsRaw  string
		conditionsRaw string
		enabledInt    int
		createdStr    string
		updatedStr    string
	)
	if err := s.Scan(&p.ID, &p.Name, &p.Description, &effect, &targetType,
		&targetIDsRaw, &conditionsRaw, &p.Priority, &enabledInt, &createdStr, &updatedStr); err != nil {
		return nil, err
	}
	p.Effect = store.AccessPolicyEffect(effect)
	p.TargetType = store.AccessPolicyTargetType(targetType)
	p.Enabled = enabledInt == 1
	p.CreatedAt = parseTime(createdStr)
	p.UpdatedAt = parseTime(updatedStr)
	if err := json.Unmarshal([]byte(targetIDsRaw), &p.TargetIDs); err != nil {
		return nil, fmt.Errorf("sqlite: parse target_ids JSON: %w", err)
	}
	if p.TargetIDs == nil {
		p.TargetIDs = []string{}
	}
	if err := json.Unmarshal([]byte(conditionsRaw), &p.Conditions); err != nil {
		return nil, fmt.Errorf("sqlite: parse conditions JSON: %w", err)
	}
	if p.Conditions == nil {
		p.Conditions = []store.AccessPolicyCondition{}
	}
	return &p, nil
}
