// Package sqlite — Notifications subsystem (stage-2).
package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Notification Items (per-user inbox)
// ---------------------------------------------------------------------------

func (t *tx) AppendNotificationItem(ctx context.Context, in *store.NotificationItem) (*store.NotificationItem, error) {
	if in == nil || in.UserID == "" || in.Title == "" {
		return nil, fmt.Errorf("sqlite: notification_item requires user_id, title")
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
		occurred = in.OccurredAt.UTC().Format(timeFormat)
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO notification_items (id, tenant_id, user_id, category, severity, title, body,
		   action_link, metadata, read_at, archived_at, occurred_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.UserID, category, severity, in.Title, in.Body,
		in.ActionLink, meta, formatNullableTime(in.ReadAt), formatNullableTime(in.ArchivedAt), occurred,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: insert notification_item: %w", err)
	}
	t.emit("notification_items", id, "INSERT")
	return t.GetNotificationItem(ctx, id)
}

func (t *tx) GetNotificationItem(ctx context.Context, id string) (*store.NotificationItem, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, user_id, category, severity, title, body, action_link, metadata,
		   read_at, archived_at, occurred_at
		 FROM notification_items WHERE id = ?`, id)
	n, err := scanNotificationItem(row)
	if err == sql.ErrNoRows {
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
	rows, err := t.sqlTx.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list notifications: %w", err)
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
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM notification_items
		 WHERE user_id = ? AND read_at IS NULL AND archived_at IS NULL
		   AND (tenant_id = ? OR tenant_id IS NULL)`, userID, tenantID)
	var c int
	if err := row.Scan(&c); err != nil {
		return 0, fmt.Errorf("sqlite: count unread: %w", err)
	}
	return c, nil
}

func (t *tx) MarkNotificationRead(ctx context.Context, id string) error {
	res, err := t.sqlTx.ExecContext(ctx,
		`UPDATE notification_items SET read_at = ? WHERE id = ? AND read_at IS NULL`,
		nowUTC(), id)
	if err != nil {
		return fmt.Errorf("sqlite: mark read: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		// Idempotent — could be already read, or not exist. Verify existence.
		row := t.sqlTx.QueryRowContext(ctx, `SELECT 1 FROM notification_items WHERE id = ?`, id)
		var dummy int
		if err := row.Scan(&dummy); err == sql.ErrNoRows {
			return store.ErrNotificationItemNotFound
		}
	}
	t.emit("notification_items", id, "UPDATE")
	return nil
}

func (t *tx) MarkAllNotificationsRead(ctx context.Context, tenantID, userID string) error {
	_, err := t.sqlTx.ExecContext(ctx,
		`UPDATE notification_items SET read_at = ?
		 WHERE user_id = ? AND read_at IS NULL
		   AND (tenant_id = ? OR tenant_id IS NULL)`,
		nowUTC(), userID, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: mark all read: %w", err)
	}
	return nil
}

func (t *tx) ArchiveNotification(ctx context.Context, id string, archived bool) error {
	var stmt string
	if archived {
		stmt = `UPDATE notification_items SET archived_at = ? WHERE id = ?`
	} else {
		stmt = `UPDATE notification_items SET archived_at = NULL WHERE id = ?`
	}
	var res sql.Result
	var err error
	if archived {
		res, err = t.sqlTx.ExecContext(ctx, stmt, nowUTC(), id)
	} else {
		res, err = t.sqlTx.ExecContext(ctx, stmt, id)
	}
	if err != nil {
		return fmt.Errorf("sqlite: archive: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrNotificationItemNotFound
	}
	t.emit("notification_items", id, "UPDATE")
	return nil
}

func scanNotificationItem(s scanner) (*store.NotificationItem, error) {
	var (
		id, userID, category, severity, title, body, metadata, occurredAt string
		tenantID, actionLink, readAt, archivedAt                          *string
	)
	if err := s.Scan(&id, &tenantID, &userID, &category, &severity, &title, &body,
		&actionLink, &metadata, &readAt, &archivedAt, &occurredAt); err != nil {
		return nil, err
	}
	out := &store.NotificationItem{
		ID: id, TenantID: tenantID, UserID: userID, Category: category, Severity: severity,
		Title: title, Body: body, ActionLink: actionLink, Metadata: metadata,
		OccurredAt: parseTime(occurredAt),
	}
	if readAt != nil {
		ts := parseTime(*readAt)
		out.ReadAt = &ts
	}
	if archivedAt != nil {
		ts := parseTime(*archivedAt)
		out.ArchivedAt = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Notification Channels
// ---------------------------------------------------------------------------

func (t *tx) CreateNotificationChannel(ctx context.Context, in *store.NotificationChannel) (*store.NotificationChannel, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.Kind == "" {
		return nil, fmt.Errorf("sqlite: notification_channel requires tenant_id, name, kind")
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
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO notification_channels (id, tenant_id, name, kind, config, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, in.Kind, cfg, boolToInt(in.Enabled), now, now,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "name") {
			return nil, store.ErrNotificationChannelTaken
		}
		return nil, fmt.Errorf("sqlite: insert notification_channel: %w", err)
	}
	t.emit("notification_channels", id, "INSERT")
	return t.GetNotificationChannel(ctx, in.TenantID, id)
}

func (t *tx) GetNotificationChannel(ctx context.Context, tenantID, id string) (*store.NotificationChannel, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, kind, config, enabled, created_at, updated_at
		 FROM notification_channels WHERE id = ? AND tenant_id = ?`, id, tenantID)
	c, err := scanNotificationChannel(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrNotificationChannelNotFound
	}
	return c, err
}

func (t *tx) ListNotificationChannelsByTenant(ctx context.Context, tenantID string) ([]*store.NotificationChannel, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, kind, config, enabled, created_at, updated_at
		 FROM notification_channels WHERE tenant_id = ? ORDER BY name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list channels: %w", err)
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
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE notification_channels SET name=?, kind=?, config=?, enabled=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Name, c.Kind, c.Config, boolToInt(c.Enabled), nowUTC(), id, tenantID); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "name") {
			return nil, store.ErrNotificationChannelTaken
		}
		return nil, fmt.Errorf("sqlite: update channel: %w", err)
	}
	t.emit("notification_channels", id, "UPDATE")
	return t.GetNotificationChannel(ctx, tenantID, id)
}

func (t *tx) DeleteNotificationChannel(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM notification_channels WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: delete channel: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrNotificationChannelNotFound
	}
	t.emit("notification_channels", id, "DELETE")
	return nil
}

func scanNotificationChannel(s scanner) (*store.NotificationChannel, error) {
	var (
		id, tenantID, name, kind, cfg, createdAt, updatedAt string
		enabled                                             int
	)
	if err := s.Scan(&id, &tenantID, &name, &kind, &cfg, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.NotificationChannel{
		ID: id, TenantID: tenantID, Name: name, Kind: kind, Config: cfg, Enabled: enabled == 1,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// Notification Routing Rules
// ---------------------------------------------------------------------------

func (t *tx) CreateRoutingRule(ctx context.Context, in *store.NotificationRoutingRule) (*store.NotificationRoutingRule, error) {
	if in == nil || in.TenantID == "" || in.Name == "" {
		return nil, fmt.Errorf("sqlite: routing_rule requires tenant_id, name")
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
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO notification_routing_rules (id, tenant_id, name, event_filter, channel_ids,
		   enabled, order_hint, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, filter, channels, boolToInt(in.Enabled), in.OrderHint, now, now,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "name") {
			return nil, store.ErrRoutingRuleNameTaken
		}
		return nil, fmt.Errorf("sqlite: insert routing_rule: %w", err)
	}
	t.emit("notification_routing_rules", id, "INSERT")
	return t.GetRoutingRule(ctx, in.TenantID, id)
}

func (t *tx) GetRoutingRule(ctx context.Context, tenantID, id string) (*store.NotificationRoutingRule, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, event_filter, channel_ids, enabled, order_hint, created_at, updated_at
		 FROM notification_routing_rules WHERE id = ? AND tenant_id = ?`, id, tenantID)
	r, err := scanRoutingRule(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrRoutingRuleNotFound
	}
	return r, err
}

func (t *tx) ListRoutingRulesByTenant(ctx context.Context, tenantID string) ([]*store.NotificationRoutingRule, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, event_filter, channel_ids, enabled, order_hint, created_at, updated_at
		 FROM notification_routing_rules WHERE tenant_id = ? ORDER BY order_hint ASC, name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list rules: %w", err)
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
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE notification_routing_rules SET name=?, event_filter=?, channel_ids=?, enabled=?, order_hint=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Name, c.EventFilter, c.ChannelIDs, boolToInt(c.Enabled), c.OrderHint, nowUTC(), id, tenantID); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "name") {
			return nil, store.ErrRoutingRuleNameTaken
		}
		return nil, fmt.Errorf("sqlite: update rule: %w", err)
	}
	t.emit("notification_routing_rules", id, "UPDATE")
	return t.GetRoutingRule(ctx, tenantID, id)
}

func (t *tx) DeleteRoutingRule(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM notification_routing_rules WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("sqlite: delete rule: %w", err)
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
		if _, err := t.sqlTx.ExecContext(ctx,
			`UPDATE notification_routing_rules SET order_hint = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
			i, now, id, tenantID); err != nil {
			return fmt.Errorf("sqlite: reorder rule %s: %w", id, err)
		}
	}
	return nil
}

func scanRoutingRule(s scanner) (*store.NotificationRoutingRule, error) {
	var (
		id, tenantID, name, filter, channels, createdAt, updatedAt string
		enabled                                                    int
		orderHint                                                  int32
	)
	if err := s.Scan(&id, &tenantID, &name, &filter, &channels, &enabled, &orderHint, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.NotificationRoutingRule{
		ID: id, TenantID: tenantID, Name: name, EventFilter: filter, ChannelIDs: channels,
		Enabled: enabled == 1, OrderHint: orderHint,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// Delivery Log
// ---------------------------------------------------------------------------

func (t *tx) AppendDeliveryLogEntry(ctx context.Context, in *store.NotificationDeliveryLogEntry) (*store.NotificationDeliveryLogEntry, error) {
	if in == nil || in.TenantID == "" || in.Status == "" {
		return nil, fmt.Errorf("sqlite: delivery_log requires tenant_id, status")
	}
	id := in.ID
	if id == "" {
		id = newID("nlog")
	}
	meta := in.Metadata
	if meta == "" {
		meta = "{}"
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO notification_delivery_log (id, tenant_id, channel_id, notification_id, status,
		   attempts, first_attempted_at, last_attempted_at, last_error, metadata)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.ChannelID, in.NotificationID, in.Status,
		in.Attempts, formatNullableTime(in.FirstAttemptedAt), formatNullableTime(in.LastAttemptedAt),
		in.LastError, meta,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: insert delivery_log: %w", err)
	}
	t.emit("notification_delivery_log", id, "INSERT")
	return t.GetDeliveryLogEntry(ctx, in.TenantID, id)
}

func (t *tx) GetDeliveryLogEntry(ctx context.Context, tenantID, id string) (*store.NotificationDeliveryLogEntry, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, channel_id, notification_id, status, attempts,
		   first_attempted_at, last_attempted_at, last_error, metadata
		 FROM notification_delivery_log WHERE id = ? AND tenant_id = ?`, id, tenantID)
	e, err := scanDeliveryLog(row)
	if err == sql.ErrNoRows {
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
	rows, err := t.sqlTx.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list delivery_log: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.NotificationDeliveryLogEntry
	for rows.Next() {
		e, err := scanDeliveryLog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func scanDeliveryLog(s scanner) (*store.NotificationDeliveryLogEntry, error) {
	var (
		id, tenantID, status, metadata             string
		channelID, notificationID                  *string
		attempts                                   int32
		firstAttemptedAt, lastAttemptedAt, lastErr *string
	)
	if err := s.Scan(&id, &tenantID, &channelID, &notificationID, &status, &attempts,
		&firstAttemptedAt, &lastAttemptedAt, &lastErr, &metadata); err != nil {
		return nil, err
	}
	out := &store.NotificationDeliveryLogEntry{
		ID: id, TenantID: tenantID, ChannelID: channelID, NotificationID: notificationID,
		Status: status, Attempts: attempts, LastError: lastErr, Metadata: metadata,
	}
	if firstAttemptedAt != nil {
		ts := parseTime(*firstAttemptedAt)
		out.FirstAttemptedAt = &ts
	}
	if lastAttemptedAt != nil {
		ts := parseTime(*lastAttemptedAt)
		out.LastAttemptedAt = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Tenant Notification Config (singleton)
// ---------------------------------------------------------------------------

func (t *tx) GetTenantNotificationConfig(ctx context.Context, tenantID string) (*store.TenantNotificationConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT tenant_id, enabled, opt_in_mode, max_retries, retry_backoff_seconds, channel_priority, updated_at
		 FROM tenant_notification_configs WHERE tenant_id = ?`, tenantID)
	var (
		tID, optInMode, channelPriority, updatedAt string
		enabled                                    int
		maxRetries, retryBackoff                   int32
	)
	err := row.Scan(&tID, &enabled, &optInMode, &maxRetries, &retryBackoff, &channelPriority, &updatedAt)
	if err == sql.ErrNoRows {
		// Return defaults if no row exists yet (singleton-on-demand semantics).
		return &store.TenantNotificationConfig{
			TenantID: tenantID, Enabled: true, OptInMode: "opt-in",
			MaxRetries: 3, RetryBackoffSeconds: 30, ChannelPriority: "[]",
			UpdatedAt: time.Time{},
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("sqlite: get tenant_notification_config: %w", err)
	}
	return &store.TenantNotificationConfig{
		TenantID: tID, Enabled: enabled == 1, OptInMode: optInMode,
		MaxRetries: maxRetries, RetryBackoffSeconds: retryBackoff,
		ChannelPriority: channelPriority, UpdatedAt: parseTime(updatedAt),
	}, nil
}

func (t *tx) UpsertTenantNotificationConfig(ctx context.Context, c *store.TenantNotificationConfig) (*store.TenantNotificationConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("sqlite: tenant_notification_config requires tenant_id")
	}
	priority := c.ChannelPriority
	if priority == "" {
		priority = "[]"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO tenant_notification_configs (tenant_id, enabled, opt_in_mode, max_retries, retry_backoff_seconds, channel_priority, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (tenant_id) DO UPDATE SET enabled=excluded.enabled, opt_in_mode=excluded.opt_in_mode,
		   max_retries=excluded.max_retries, retry_backoff_seconds=excluded.retry_backoff_seconds,
		   channel_priority=excluded.channel_priority, updated_at=excluded.updated_at`,
		c.TenantID, boolToInt(c.Enabled), c.OptInMode, c.MaxRetries, c.RetryBackoffSeconds, priority, now,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite: upsert tenant_notification_config: %w", err)
	}
	t.emit("tenant_notification_configs", c.TenantID, "UPSERT")
	return t.GetTenantNotificationConfig(ctx, c.TenantID)
}
