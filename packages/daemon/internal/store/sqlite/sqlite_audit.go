package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Config Versions
// ---------------------------------------------------------------------------

const maxConfigVersions = 100

func (t *tx) SaveConfigVersion(ctx context.Context, snapshot []byte, actor string) (int64, error) {
	now := nowUTC()
	res, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO config_versions (snapshot, actor, created_at) VALUES (?, ?, ?)`,
		string(snapshot), actor, now,
	)
	if err != nil {
		return 0, fmt.Errorf("sqlite: insert config_version: %w", err)
	}
	version, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("sqlite: last insert id: %w", err)
	}
	t.emit("config_versions", fmt.Sprintf("%d", version), "INSERT")

	// Prune old versions beyond the max retention.
	_, _ = t.sqlTx.ExecContext(ctx,
		`DELETE FROM config_versions WHERE version NOT IN (
			SELECT version FROM config_versions ORDER BY version DESC LIMIT ?
		)`, maxConfigVersions)

	return version, nil
}

func (t *tx) GetConfigVersion(ctx context.Context, version int64) (*store.ConfigVersion, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT version, snapshot, actor, created_at FROM config_versions WHERE version = ?`, version)

	var cv store.ConfigVersion
	var createdAt string
	if err := row.Scan(&cv.Version, &cv.Snapshot, &cv.Actor, &createdAt); err != nil {
		return nil, fmt.Errorf("sqlite: get config_version: %w", err)
	}
	cv.CreatedAt = parseTime(createdAt)
	return &cv, nil
}

func (t *tx) ListConfigVersions(ctx context.Context, limit int) ([]*store.ConfigVersion, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT version, snapshot, actor, created_at FROM config_versions ORDER BY version DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list config_versions: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var versions []*store.ConfigVersion
	for rows.Next() {
		var cv store.ConfigVersion
		var createdAt string
		if err := rows.Scan(&cv.Version, &cv.Snapshot, &cv.Actor, &createdAt); err != nil {
			return nil, fmt.Errorf("sqlite: scan config_version: %w", err)
		}
		cv.CreatedAt = parseTime(createdAt)
		versions = append(versions, &cv)
	}
	return versions, rows.Err()
}

func (t *tx) LatestConfigVersion(ctx context.Context) (int64, error) {
	var version int64
	err := t.sqlTx.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM config_versions`).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("sqlite: latest config version: %w", err)
	}
	return version, nil
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

func (t *tx) AppendAuditEntry(ctx context.Context, entry *riokuv1.AuditEntry) error {
	id := entry.GetId()
	if id == "" {
		id = uuid.New().String()
	}
	now := nowUTC()
	if entry.GetOccurredAt() != nil {
		now = entry.GetOccurredAt().AsTime().UTC().Format(timeFormat)
	}

	tenantID := store.TenantIDFromContext(ctx)
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO audit_log (id, tenant_id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, tenantID, entry.GetActor(), entry.GetEntityType(), entry.GetEntityId(),
		entry.GetOperation(), entry.GetDiff(), entry.GetConfigVersion(), now,
	)
	if err != nil {
		return fmt.Errorf("sqlite: append audit entry: %w", err)
	}
	t.emit("audit_log", id, "INSERT")
	return nil
}

func (t *tx) QueryAuditLog(ctx context.Context, query store.AuditQuery) ([]*riokuv1.AuditEntry, error) {
	tenantID := store.TenantIDFromContext(ctx)
	q := `SELECT id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at FROM audit_log WHERE tenant_id = ?`
	args := []any{tenantID}

	if query.Actor != "" {
		q += ` AND actor = ?`
		args = append(args, query.Actor)
	}
	if query.EntityType != "" {
		q += ` AND entity_type = ?`
		args = append(args, query.EntityType)
	}
	if query.EntityID != "" {
		q += ` AND entity_id = ?`
		args = append(args, query.EntityID)
	}
	if query.Since != nil {
		q += ` AND occurred_at >= ?`
		args = append(args, query.Since.UTC().Format(timeFormat))
	}
	if query.Until != nil {
		q += ` AND occurred_at <= ?`
		args = append(args, query.Until.UTC().Format(timeFormat))
	}

	q += ` ORDER BY occurred_at DESC`

	// Enforce a maximum limit to prevent OOM on unbounded queries.
	limit := query.Limit
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	q += ` LIMIT ?`
	args = append(args, limit)

	// OFFSET only makes sense with LIMIT.
	if query.Offset > 0 {
		q += ` OFFSET ?`
		args = append(args, query.Offset)
	}

	rows, err := t.sqlTx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: query audit log: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var entries []*riokuv1.AuditEntry
	for rows.Next() {
		var (
			id            string
			actor         string
			entityType    string
			entityID      string
			operation     string
			diff          string
			configVersion int64
			occurredAt    string
		)
		if err := rows.Scan(&id, &actor, &entityType, &entityID, &operation, &diff, &configVersion, &occurredAt); err != nil {
			return nil, fmt.Errorf("sqlite: scan audit entry: %w", err)
		}
		entries = append(entries, &riokuv1.AuditEntry{
			Id:            id,
			Actor:         actor,
			EntityType:    entityType,
			EntityId:      entityID,
			Operation:     operation,
			Diff:          diff,
			ConfigVersion: configVersion,
			OccurredAt:    timestamppb.New(parseTime(occurredAt)),
		})
	}
	return entries, rows.Err()
}

// CountAuditLog mirrors QueryAuditLog's WHERE clause but returns
// COUNT(*) so the REST layer can expose total counts for paginated
// UIs (#82). Limit/Offset are intentionally ignored — counting only
// what the current page shows would defeat the point.
func (t *tx) CountAuditLog(ctx context.Context, query store.AuditQuery) (int, error) {
	tenantID := store.TenantIDFromContext(ctx)
	q := `SELECT COUNT(*) FROM audit_log WHERE tenant_id = ?`
	args := []any{tenantID}

	if query.Actor != "" {
		q += ` AND actor = ?`
		args = append(args, query.Actor)
	}
	if query.EntityType != "" {
		q += ` AND entity_type = ?`
		args = append(args, query.EntityType)
	}
	if query.EntityID != "" {
		q += ` AND entity_id = ?`
		args = append(args, query.EntityID)
	}
	if query.Since != nil {
		q += ` AND occurred_at >= ?`
		args = append(args, query.Since.UTC().Format(timeFormat))
	}
	if query.Until != nil {
		q += ` AND occurred_at <= ?`
		args = append(args, query.Until.UTC().Format(timeFormat))
	}

	var count int
	if err := t.sqlTx.QueryRowContext(ctx, q, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("sqlite: count audit log: %w", err)
	}
	return count, nil
}

// GetAuditEntry returns a single audit entry by id, scoped to the
// active tenant.
func (t *tx) GetAuditEntry(ctx context.Context, id string) (*riokuv1.AuditEntry, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, actor, entity_type, entity_id, operation, diff, config_version, occurred_at
		 FROM audit_log WHERE id = ? AND tenant_id = ?`, id, tenantID)
	var (
		gotID         string
		actor         string
		entityType    string
		entityID      string
		operation     string
		diff          string
		configVersion int64
		occurredAt    string
	)
	if err := row.Scan(&gotID, &actor, &entityType, &entityID, &operation, &diff, &configVersion, &occurredAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("sqlite: audit entry %q not found", id)
		}
		return nil, fmt.Errorf("sqlite: get audit entry: %w", err)
	}
	return &riokuv1.AuditEntry{
		Id:            gotID,
		Actor:         actor,
		EntityType:    entityType,
		EntityId:      entityID,
		Operation:     operation,
		Diff:          diff,
		ConfigVersion: configVersion,
		OccurredAt:    timestamppb.New(parseTime(occurredAt)),
	}, nil
}

// ListAuditActors returns distinct actors matching `prefix`, capped at
// `limit` (default 50, max 1000).
func (t *tx) ListAuditActors(ctx context.Context, prefix string, limit int) ([]string, error) {
	tenantID := store.TenantIDFromContext(ctx)
	if limit <= 0 || limit > 1000 {
		limit = 50
	}
	q := `SELECT DISTINCT actor FROM audit_log WHERE tenant_id = ?`
	args := []any{tenantID}
	if prefix != "" {
		q += ` AND actor LIKE ?`
		args = append(args, prefix+"%")
	}
	q += ` ORDER BY actor LIMIT ?`
	args = append(args, limit)

	rows, err := t.sqlTx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list audit actors: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ListAuditResourceIDs returns distinct entity_ids matching the
// optional entity_type filter and `prefix`. Used by the audit page's
// "resource id" typeahead.
func (t *tx) ListAuditResourceIDs(ctx context.Context, entityType, prefix string, limit int) ([]string, error) {
	tenantID := store.TenantIDFromContext(ctx)
	if limit <= 0 || limit > 1000 {
		limit = 50
	}
	q := `SELECT DISTINCT entity_id FROM audit_log WHERE tenant_id = ?`
	args := []any{tenantID}
	if entityType != "" {
		q += ` AND entity_type = ?`
		args = append(args, entityType)
	}
	if prefix != "" {
		q += ` AND entity_id LIKE ?`
		args = append(args, prefix+"%")
	}
	q += ` ORDER BY entity_id LIMIT ?`
	args = append(args, limit)

	rows, err := t.sqlTx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list audit resource_ids: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
