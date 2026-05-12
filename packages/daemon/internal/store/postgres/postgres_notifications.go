// Package postgres — Notifications subsystem CRUD.
//
// Five entities: Items (the inbox), Channels, RoutingRules,
// DeliveryLog, and the per-tenant Config singleton.
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
// Notification Items (per-user inbox)
// ---------------------------------------------------------------------------

func (t *tx) AppendNotificationItem(ctx context.Context, in *store.NotificationItem) (*store.NotificationItem, error) {
	if in == nil || in.UserID == "" || in.Title == "" {
		return nil, fmt.Errorf("postgres: notification_item requires user_id, title")
	}
	id := in.ID
	if id == "" {
		id = newID("notif")
	}
	severity := in.Severity
	if severity == "" {
		severity = "info"
	}
	category := in.Category
	if category == "" {
		category = "general"
	}
	meta := in.Metadata
	if meta == "" {
		meta = "{}"
	}
	occurred := nowUTC()
	if !in.OccurredAt.IsZero() {
		occurred = in.OccurredAt.UTC()
	}

	var readAt sql.NullTime
	if in.ReadAt != nil {
		readAt = sql.NullTime{Time: in.ReadAt.UTC(), Valid: true}
	}
	var archivedAt sql.NullTime
	if in.ArchivedAt != nil {
		archivedAt = sql.NullTime{Time: in.ArchivedAt.UTC(), Valid: true}
	}

	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO notification_items (id, tenant_id, user_id, category, severity, title, body,
		   action_link, metadata, read_at, archived_at, occurred_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.UserID, category, severity, in.Title, in.Body,
		in.ActionLink, meta, readAt, archivedAt, occurred,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert notification_item: %w", err)
	}
	t.emit("notification_items", id, "INSERT")
	return t.GetNotificationItem(ctx, id)
}

func (t *tx) GetNotificationItem(ctx context.Context, id string) (*store.NotificationItem, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, user_id, category, severity, title, body, action_link, metadata,
		   read_at, archived_at, occurred_at
		 FROM notification_items WHERE id = ?`), id)
	n, err := scanNotificationItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrNotificationItemNotFound
	}
	return n, err
}

func (t *tx) ListNotificationItemsByUser(ctx context.Context, tenantID, userID string, q store.NotificationItemQuery) ([]*store.NotificationItem, error) {
	sqlStr := `SELECT id, tenant_id, user_id, category, severity, title, body, action_link, metadata,
		   read_at, archived_at, occurred_at FROM notification_items WHERE user_id = ?`
	args := []any{userID}
	if tenantID != "" {
		sqlStr += ` AND (tenant_id = ? OR tenant_id IS NULL)`
		args = append(args, tenantID)
	}
	if q.Category != "" {
		sqlStr += ` AND category = ?`
		args = append(args, q.Category)
	}
	if q.Severity != "" {
		sqlStr += ` AND severity = ?`
		args = append(args, q.Severity)
	}
	if q.Read != nil {
		if *q.Read {
			sqlStr += ` AND read_at IS NOT NULL`
		} else {
			sqlStr += ` AND read_at IS NULL`
		}
	}
	if q.Archived != nil {
		if *q.Archived {
			sqlStr += ` AND archived_at IS NOT NULL`
		} else {
			sqlStr += ` AND archived_at IS NULL`
		}
	}
	sqlStr += ` ORDER BY occurred_at DESC`
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	sqlStr += ` LIMIT ?`
	args = append(args, limit)
	if q.Offset > 0 {
		sqlStr += ` OFFSET ?`
		args = append(args, q.Offset)
	}
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(sqlStr), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: list notifications: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.NotificationItem
	for rows.Next() {
		n, err := scanNotificationItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (t *tx) CountUnreadNotifications(ctx context.Context, tenantID, userID string) (int, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT COUNT(*) FROM notification_items
		 WHERE user_id = ? AND read_at IS NULL AND archived_at IS NULL
		   AND (tenant_id = ? OR tenant_id IS NULL)`), userID, tenantID)
	var c int
	if err := row.Scan(&c); err != nil {
		return 0, fmt.Errorf("postgres: count unread: %w", err)
	}
	return c, nil
}

func (t *tx) MarkNotificationRead(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE notification_items SET read_at = ? WHERE id = ? AND read_at IS NULL`),
		nowUTC(), id)
	if err != nil {
		return fmt.Errorf("postgres: mark read: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		// Idempotent — could be already read, or not exist. Verify existence.
		row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
			`SELECT 1 FROM notification_items WHERE id = ?`), id)
		var dummy int
		if err := row.Scan(&dummy); errors.Is(err, sql.ErrNoRows) {
			return store.ErrNotificationItemNotFound
		}
	}
	t.emit("notification_items", id, "UPDATE")
	return nil
}

// MarkNotificationUnread is the inverse of MarkNotificationRead: clears the
// read_at timestamp. Idempotent on already-unread rows; returns
// ErrNotificationItemNotFound for unknown ids.
func (t *tx) MarkNotificationUnread(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE notification_items SET read_at = NULL WHERE id = ? AND read_at IS NOT NULL`),
		id)
	if err != nil {
		return fmt.Errorf("postgres: mark unread: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
			`SELECT 1 FROM notification_items WHERE id = ?`), id)
		var dummy int
		if err := row.Scan(&dummy); errors.Is(err, sql.ErrNoRows) {
			return store.ErrNotificationItemNotFound
		}
	}
	t.emit("notification_items", id, "UPDATE")
	return nil
}

func (t *tx) MarkAllNotificationsRead(ctx context.Context, tenantID, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE notification_items SET read_at = ?
		 WHERE user_id = ? AND read_at IS NULL
		   AND (tenant_id = ? OR tenant_id IS NULL)`),
		nowUTC(), userID, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: mark all read: %w", err)
	}
	return nil
}

func (t *tx) ArchiveNotification(ctx context.Context, id string, archived bool) error {
	var res sql.Result
	var err error
	if archived {
		res, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE notification_items SET archived_at = ? WHERE id = ?`),
			nowUTC(), id)
	} else {
		res, err = t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE notification_items SET archived_at = NULL WHERE id = ?`),
			id)
	}
	if err != nil {
		return fmt.Errorf("postgres: archive: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrNotificationItemNotFound
	}
	t.emit("notification_items", id, "UPDATE")
	return nil
}

func scanNotificationItem(s scanner) (*store.NotificationItem, error) {
	var (
		id, userID, category, severity, title, body, metadata string
		tenantID, actionLink                                  sql.NullString
		readAt, archivedAt                                    sql.NullTime
		occurredAt                                            time.Time
	)
	if err := s.Scan(&id, &tenantID, &userID, &category, &severity, &title, &body,
		&actionLink, &metadata, &readAt, &archivedAt, &occurredAt); err != nil {
		return nil, err
	}
	out := &store.NotificationItem{
		ID:         id,
		UserID:     userID,
		Category:   category,
		Severity:   severity,
		Title:      title,
		Body:       body,
		Metadata:   metadata,
		OccurredAt: occurredAt.UTC(),
	}
	if tenantID.Valid {
		s := tenantID.String
		out.TenantID = &s
	}
	if actionLink.Valid {
		s := actionLink.String
		out.ActionLink = &s
	}
	if readAt.Valid {
		ts := readAt.Time.UTC()
		out.ReadAt = &ts
	}
	if archivedAt.Valid {
		ts := archivedAt.Time.UTC()
		out.ArchivedAt = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Notification Channels
// ---------------------------------------------------------------------------

func (t *tx) CreateNotificationChannel(ctx context.Context, in *store.NotificationChannel) (*store.NotificationChannel, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.Kind == "" {
		return nil, fmt.Errorf("postgres: notification_channel requires tenant_id, name, kind")
	}
	id := in.ID
	if id == "" {
		id = newID("nchan")
	}
	cfg := in.Config
	if cfg == "" {
		cfg = "{}"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO notification_channels (id, tenant_id, name, kind, config, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.Name, in.Kind, cfg, in.Enabled, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "name") {
			return nil, store.ErrNotificationChannelTaken
		}
		return nil, fmt.Errorf("postgres: insert notification_channel: %w", err)
	}
	t.emit("notification_channels", id, "INSERT")
	return t.GetNotificationChannel(ctx, in.TenantID, id)
}

func (t *tx) GetNotificationChannel(ctx context.Context, tenantID, id string) (*store.NotificationChannel, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, kind, config, enabled, created_at, updated_at
		 FROM notification_channels WHERE id = ? AND tenant_id = ?`), id, tenantID)
	c, err := scanNotificationChannel(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrNotificationChannelNotFound
	}
	return c, err
}

func (t *tx) ListNotificationChannelsByTenant(ctx context.Context, tenantID string) ([]*store.NotificationChannel, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, kind, config, enabled, created_at, updated_at
		 FROM notification_channels WHERE tenant_id = ? ORDER BY name ASC`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list channels: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.NotificationChannel
	for rows.Next() {
		c, err := scanNotificationChannel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (t *tx) UpdateNotificationChannel(ctx context.Context, tenantID, id string, p store.UpdateNotificationChannelParams) (*store.NotificationChannel, error) {
	c, err := t.GetNotificationChannel(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.Kind != nil {
		c.Kind = *p.Kind
	}
	if p.Config != nil {
		c.Config = *p.Config
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE notification_channels SET name=?, kind=?, config=?, enabled=?, updated_at=?
		 WHERE id=? AND tenant_id=?`),
		c.Name, c.Kind, c.Config, c.Enabled, nowUTC(), id, tenantID); err != nil {
		if isPgUniqueViolation(err, "name") {
			return nil, store.ErrNotificationChannelTaken
		}
		return nil, fmt.Errorf("postgres: update channel: %w", err)
	}
	t.emit("notification_channels", id, "UPDATE")
	return t.GetNotificationChannel(ctx, tenantID, id)
}

func (t *tx) DeleteNotificationChannel(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM notification_channels WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete channel: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrNotificationChannelNotFound
	}
	t.emit("notification_channels", id, "DELETE")
	return nil
}

func scanNotificationChannel(s scanner) (*store.NotificationChannel, error) {
	var (
		id, tenantID, name, kind, cfg string
		enabled                       bool
		createdAt, updatedAt          time.Time
	)
	if err := s.Scan(&id, &tenantID, &name, &kind, &cfg, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.NotificationChannel{
		ID:        id,
		TenantID:  tenantID,
		Name:      name,
		Kind:      kind,
		Config:    cfg,
		Enabled:   enabled,
		CreatedAt: createdAt.UTC(),
		UpdatedAt: updatedAt.UTC(),
	}, nil
}

// ---------------------------------------------------------------------------
// Notification Routing Rules
// ---------------------------------------------------------------------------

func (t *tx) CreateRoutingRule(ctx context.Context, in *store.NotificationRoutingRule) (*store.NotificationRoutingRule, error) {
	if in == nil || in.TenantID == "" || in.Name == "" {
		return nil, fmt.Errorf("postgres: routing_rule requires tenant_id, name")
	}
	id := in.ID
	if id == "" {
		id = newID("nrule")
	}
	filter := in.EventFilter
	if filter == "" {
		filter = "{}"
	}
	channels := in.ChannelIDs
	if channels == "" {
		channels = "[]"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO notification_routing_rules (id, tenant_id, name, event_filter, channel_ids,
		   enabled, order_hint, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.Name, filter, channels, in.Enabled, in.OrderHint, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "name") {
			return nil, store.ErrRoutingRuleNameTaken
		}
		return nil, fmt.Errorf("postgres: insert routing_rule: %w", err)
	}
	t.emit("notification_routing_rules", id, "INSERT")
	return t.GetRoutingRule(ctx, in.TenantID, id)
}

func (t *tx) GetRoutingRule(ctx context.Context, tenantID, id string) (*store.NotificationRoutingRule, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, event_filter, channel_ids, enabled, order_hint, created_at, updated_at
		 FROM notification_routing_rules WHERE id = ? AND tenant_id = ?`), id, tenantID)
	r, err := scanRoutingRule(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrRoutingRuleNotFound
	}
	return r, err
}

func (t *tx) ListRoutingRulesByTenant(ctx context.Context, tenantID string) ([]*store.NotificationRoutingRule, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, event_filter, channel_ids, enabled, order_hint, created_at, updated_at
		 FROM notification_routing_rules WHERE tenant_id = ? ORDER BY order_hint ASC, name ASC`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list rules: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.NotificationRoutingRule
	for rows.Next() {
		r, err := scanRoutingRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (t *tx) UpdateRoutingRule(ctx context.Context, tenantID, id string, p store.UpdateRoutingRuleParams) (*store.NotificationRoutingRule, error) {
	c, err := t.GetRoutingRule(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.EventFilter != nil {
		c.EventFilter = *p.EventFilter
	}
	if p.ChannelIDs != nil {
		c.ChannelIDs = *p.ChannelIDs
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if p.OrderHint != nil {
		c.OrderHint = *p.OrderHint
	}
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE notification_routing_rules SET name=?, event_filter=?, channel_ids=?, enabled=?, order_hint=?, updated_at=?
		 WHERE id=? AND tenant_id=?`),
		c.Name, c.EventFilter, c.ChannelIDs, c.Enabled, c.OrderHint, nowUTC(), id, tenantID); err != nil {
		if isPgUniqueViolation(err, "name") {
			return nil, store.ErrRoutingRuleNameTaken
		}
		return nil, fmt.Errorf("postgres: update rule: %w", err)
	}
	t.emit("notification_routing_rules", id, "UPDATE")
	return t.GetRoutingRule(ctx, tenantID, id)
}

func (t *tx) DeleteRoutingRule(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM notification_routing_rules WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete rule: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrRoutingRuleNotFound
	}
	t.emit("notification_routing_rules", id, "DELETE")
	return nil
}

func (t *tx) ReorderRoutingRules(ctx context.Context, tenantID string, orderedIDs []string) error {
	now := nowUTC()
	for i, id := range orderedIDs {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE notification_routing_rules SET order_hint = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`),
			i, now, id, tenantID); err != nil {
			return fmt.Errorf("postgres: reorder rule %s: %w", id, err)
		}
	}
	return nil
}

func scanRoutingRule(s scanner) (*store.NotificationRoutingRule, error) {
	var (
		id, tenantID, name, filter, channels string
		enabled                              bool
		orderHint                            int32
		createdAt, updatedAt                 time.Time
	)
	if err := s.Scan(&id, &tenantID, &name, &filter, &channels, &enabled, &orderHint, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.NotificationRoutingRule{
		ID:          id,
		TenantID:    tenantID,
		Name:        name,
		EventFilter: filter,
		ChannelIDs:  channels,
		Enabled:     enabled,
		OrderHint:   orderHint,
		CreatedAt:   createdAt.UTC(),
		UpdatedAt:   updatedAt.UTC(),
	}, nil
}

// ---------------------------------------------------------------------------
// Delivery Log
// ---------------------------------------------------------------------------

func (t *tx) AppendDeliveryLogEntry(ctx context.Context, in *store.NotificationDeliveryLogEntry) (*store.NotificationDeliveryLogEntry, error) {
	if in == nil || in.TenantID == "" || in.Status == "" {
		return nil, fmt.Errorf("postgres: delivery_log requires tenant_id, status")
	}
	id := in.ID
	if id == "" {
		id = newID("nlog")
	}
	meta := in.Metadata
	if meta == "" {
		meta = "{}"
	}

	var firstAttemptedAt sql.NullTime
	if in.FirstAttemptedAt != nil {
		firstAttemptedAt = sql.NullTime{Time: in.FirstAttemptedAt.UTC(), Valid: true}
	}
	var lastAttemptedAt sql.NullTime
	if in.LastAttemptedAt != nil {
		lastAttemptedAt = sql.NullTime{Time: in.LastAttemptedAt.UTC(), Valid: true}
	}

	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO notification_delivery_log (id, tenant_id, channel_id, notification_id, status,
		   attempts, first_attempted_at, last_attempted_at, last_error, metadata)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.ChannelID, in.NotificationID, in.Status,
		in.Attempts, firstAttemptedAt, lastAttemptedAt,
		in.LastError, meta,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: insert delivery_log: %w", err)
	}
	t.emit("notification_delivery_log", id, "INSERT")
	return t.GetDeliveryLogEntry(ctx, in.TenantID, id)
}

func (t *tx) GetDeliveryLogEntry(ctx context.Context, tenantID, id string) (*store.NotificationDeliveryLogEntry, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, channel_id, notification_id, status, attempts,
		   first_attempted_at, last_attempted_at, last_error, metadata
		 FROM notification_delivery_log WHERE id = ? AND tenant_id = ?`), id, tenantID)
	e, err := scanDeliveryLogEntry(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrDeliveryLogEntryNotFound
	}
	return e, err
}

func (t *tx) ListDeliveryLogByTenant(ctx context.Context, tenantID string, q store.DeliveryLogQuery) ([]*store.NotificationDeliveryLogEntry, error) {
	sqlStr := `SELECT id, tenant_id, channel_id, notification_id, status, attempts,
		   first_attempted_at, last_attempted_at, last_error, metadata
		 FROM notification_delivery_log WHERE tenant_id = ?`
	args := []any{tenantID}
	if q.Status != "" {
		sqlStr += ` AND status = ?`
		args = append(args, q.Status)
	}
	sqlStr += ` ORDER BY last_attempted_at DESC, id DESC`
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	sqlStr += ` LIMIT ?`
	args = append(args, limit)
	if q.Offset > 0 {
		sqlStr += ` OFFSET ?`
		args = append(args, q.Offset)
	}
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(sqlStr), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: list delivery_log: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.NotificationDeliveryLogEntry
	for rows.Next() {
		e, err := scanDeliveryLogEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func scanDeliveryLogEntry(s scanner) (*store.NotificationDeliveryLogEntry, error) {
	var (
		id, tenantID, status, metadata    string
		channelID, notificationID         sql.NullString
		attempts                          int32
		firstAttemptedAt, lastAttemptedAt sql.NullTime
		lastErr                           sql.NullString
	)
	if err := s.Scan(&id, &tenantID, &channelID, &notificationID, &status, &attempts,
		&firstAttemptedAt, &lastAttemptedAt, &lastErr, &metadata); err != nil {
		return nil, err
	}
	out := &store.NotificationDeliveryLogEntry{
		ID:       id,
		TenantID: tenantID,
		Status:   status,
		Attempts: attempts,
		Metadata: metadata,
	}
	if channelID.Valid {
		s := channelID.String
		out.ChannelID = &s
	}
	if notificationID.Valid {
		s := notificationID.String
		out.NotificationID = &s
	}
	if lastErr.Valid {
		s := lastErr.String
		out.LastError = &s
	}
	if firstAttemptedAt.Valid {
		ts := firstAttemptedAt.Time.UTC()
		out.FirstAttemptedAt = &ts
	}
	if lastAttemptedAt.Valid {
		ts := lastAttemptedAt.Time.UTC()
		out.LastAttemptedAt = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Tenant Notification Config (singleton)
// ---------------------------------------------------------------------------

func (t *tx) GetTenantNotificationConfig(ctx context.Context, tenantID string) (*store.TenantNotificationConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT tenant_id, enabled, opt_in_mode, max_retries, retry_backoff_seconds, channel_priority, updated_at
		 FROM tenant_notification_configs WHERE tenant_id = ?`), tenantID)
	var (
		tID, optInMode, channelPriority string
		enabled                         bool
		maxRetries, retryBackoff        int32
		updatedAt                       time.Time
	)
	err := row.Scan(&tID, &enabled, &optInMode, &maxRetries, &retryBackoff, &channelPriority, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		// Return defaults if no row exists yet (singleton-on-demand semantics).
		return &store.TenantNotificationConfig{
			TenantID: tenantID, Enabled: true, OptInMode: "opt-in",
			MaxRetries: 3, RetryBackoffSeconds: 30, ChannelPriority: "[]",
			UpdatedAt: time.Time{},
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get tenant_notification_config: %w", err)
	}
	return &store.TenantNotificationConfig{
		TenantID:            tID,
		Enabled:             enabled,
		OptInMode:           optInMode,
		MaxRetries:          maxRetries,
		RetryBackoffSeconds: retryBackoff,
		ChannelPriority:     channelPriority,
		UpdatedAt:           updatedAt.UTC(),
	}, nil
}

func (t *tx) UpsertTenantNotificationConfig(ctx context.Context, c *store.TenantNotificationConfig) (*store.TenantNotificationConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("postgres: tenant_notification_config requires tenant_id")
	}
	priority := c.ChannelPriority
	if priority == "" {
		priority = "[]"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO tenant_notification_configs (tenant_id, enabled, opt_in_mode, max_retries, retry_backoff_seconds, channel_priority, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (tenant_id) DO UPDATE SET
		   enabled = EXCLUDED.enabled,
		   opt_in_mode = EXCLUDED.opt_in_mode,
		   max_retries = EXCLUDED.max_retries,
		   retry_backoff_seconds = EXCLUDED.retry_backoff_seconds,
		   channel_priority = EXCLUDED.channel_priority,
		   updated_at = EXCLUDED.updated_at`),
		c.TenantID, c.Enabled, c.OptInMode, c.MaxRetries, c.RetryBackoffSeconds, priority, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: upsert tenant_notification_config: %w", err)
	}
	t.emit("tenant_notification_configs", c.TenantID, "UPSERT")
	return t.GetTenantNotificationConfig(ctx, c.TenantID)
}
