package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// AppendAISpendLog inserts one spend-log row. The TenantID is taken
// from the request context first, then from the log payload.
func (t *tx) AppendAISpendLog(ctx context.Context, log *store.AISpendLog) error {
	if log == nil || log.ID == "" || log.ModelID == "" {
		return fmt.Errorf("postgres: ai_spend_log requires id + model_id")
	}
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = log.TenantID
	}
	createdAt := nowUTC()
	if !log.CreatedAt.IsZero() {
		createdAt = log.CreatedAt.UTC()
	}
	if log.TotalTokens == 0 {
		log.TotalTokens = log.InputTokens + log.OutputTokens + log.CacheCreateTokens + log.CacheReadTokens
	}
	if log.Status == "" {
		log.Status = "ok"
	}
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO ai_spend_logs (id, tenant_id, virtual_key_id, application_id, plan_id,
		     provider_id, model_id, estimated_tokens, input_tokens, output_tokens,
		     cache_create_tokens, cache_read_tokens, total_tokens, cost_usd, latency_ms,
		     status, request_id, messages, response, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		log.ID, tenantID, log.VirtualKeyID, log.ApplicationID, log.PlanID,
		log.ProviderID, log.ModelID, log.EstimatedTokens, log.InputTokens, log.OutputTokens,
		log.CacheCreateTokens, log.CacheReadTokens, log.TotalTokens, log.CostUSD, log.LatencyMS,
		log.Status, log.RequestID, log.Messages, log.Response, createdAt,
	)
	if err != nil {
		return fmt.Errorf("postgres: append ai_spend_log: %w", err)
	}
	return nil
}

func (t *tx) GetAISpendLog(ctx context.Context, id string) (*store.AISpendLog, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, virtual_key_id, application_id, plan_id, provider_id,
		        model_id, estimated_tokens, input_tokens, output_tokens, cache_create_tokens,
		        cache_read_tokens, total_tokens, cost_usd, latency_ms, status, request_id,
		        messages, response, created_at
		 FROM ai_spend_logs WHERE id = ? AND tenant_id = ?`), id, tenantID)
	log, err := scanAISpendLog(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrAISpendLogNotFound
	}
	return log, err
}

func (t *tx) QueryAISpendLogs(ctx context.Context, q store.AISpendQuery) ([]*store.AISpendLog, error) {
	tenantID := store.TenantIDFromContext(ctx)
	sqlStr := `SELECT id, tenant_id, virtual_key_id, application_id, plan_id, provider_id,
	                  model_id, estimated_tokens, input_tokens, output_tokens, cache_create_tokens,
	                  cache_read_tokens, total_tokens, cost_usd, latency_ms, status, request_id,
	                  messages, response, created_at
	           FROM ai_spend_logs WHERE tenant_id = ?`
	args := []any{tenantID}
	if q.VirtualKeyID != "" {
		sqlStr += ` AND virtual_key_id = ?`
		args = append(args, q.VirtualKeyID)
	}
	if q.ModelID != "" {
		sqlStr += ` AND model_id = ?`
		args = append(args, q.ModelID)
	}
	if q.Status != "" {
		sqlStr += ` AND status = ?`
		args = append(args, q.Status)
	}
	if q.Since != nil {
		sqlStr += ` AND created_at >= ?`
		args = append(args, q.Since.UTC())
	}
	if q.Until != nil {
		sqlStr += ` AND created_at <= ?`
		args = append(args, q.Until.UTC())
	}
	sqlStr += ` ORDER BY created_at DESC`
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	sqlStr += ` LIMIT ?`
	args = append(args, limit)
	if q.Offset > 0 {
		sqlStr += ` OFFSET ?`
		args = append(args, q.Offset)
	}
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(sqlStr), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: query ai_spend_logs: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AISpendLog
	for rows.Next() {
		log, err := scanAISpendLog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, log)
	}
	return out, rows.Err()
}

func (t *tx) PruneAISpendLogs(ctx context.Context, before time.Time) (int64, error) {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM ai_spend_logs WHERE tenant_id = ? AND created_at < ?`),
		tenantID, before.UTC(),
	)
	if err != nil {
		return 0, fmt.Errorf("postgres: prune ai_spend_logs: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// AggregateAISpendDay folds spend-log rows for the given UTC day
// into the rollup table. Idempotent on the (tenant, virtual_key,
// model, date) PK — re-runs upsert. Returns the row count
// processed for telemetry.
func (t *tx) AggregateAISpendDay(ctx context.Context, day time.Time) (int64, error) {
	tenantID := store.TenantIDFromContext(ctx)
	dayUTC := day.UTC()
	dayStart := time.Date(dayUTC.Year(), dayUTC.Month(), dayUTC.Day(), 0, 0, 0, 0, time.UTC)
	dayEnd := dayStart.Add(24 * time.Hour)

	// Pull aggregated values from the spend log for the day.
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT COALESCE(virtual_key_id, ''), model_id,
		        COUNT(*) AS req_count,
		        SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS err_count,
		        COALESCE(SUM(input_tokens), 0),
		        COALESCE(SUM(output_tokens), 0),
		        COALESCE(SUM(total_tokens), 0),
		        COALESCE(SUM(cost_usd), 0)
		 FROM ai_spend_logs
		 WHERE tenant_id = ?
		   AND created_at >= ?
		   AND created_at < ?
		 GROUP BY virtual_key_id, model_id`),
		tenantID, dayStart, dayEnd,
	)
	if err != nil {
		return 0, fmt.Errorf("postgres: aggregate spend: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var processed int64
	now := nowUTC()
	for rows.Next() {
		var (
			vkID, modelID                             string
			reqCount, errCount                        int32
			inTokensSum, outTokensSum, totalTokensSum int64
			costSum                                   float64
		)
		if err := rows.Scan(&vkID, &modelID, &reqCount, &errCount,
			&inTokensSum, &outTokensSum, &totalTokensSum, &costSum); err != nil {
			return processed, err
		}
		_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`INSERT INTO ai_spend_rollups (tenant_id, virtual_key_id, model_id, rollup_date,
			     request_count, error_count, input_tokens_total, output_tokens_total,
			     total_tokens, cost_usd_total, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (tenant_id, virtual_key_id, model_id, rollup_date) DO UPDATE SET
			     request_count = excluded.request_count,
			     error_count = excluded.error_count,
			     input_tokens_total = excluded.input_tokens_total,
			     output_tokens_total = excluded.output_tokens_total,
			     total_tokens = excluded.total_tokens,
			     cost_usd_total = excluded.cost_usd_total,
			     updated_at = excluded.updated_at`),
			tenantID, vkID, modelID, dayStart,
			reqCount, errCount, inTokensSum, outTokensSum, totalTokensSum,
			costSum, now,
		)
		if err != nil {
			return processed, fmt.Errorf("postgres: upsert ai_spend_rollups: %w", err)
		}
		processed++
	}
	return processed, rows.Err()
}

func (t *tx) QueryAISpendRollups(ctx context.Context, q store.AISpendRollupQuery) ([]*store.AISpendRollup, error) {
	tenantID := store.TenantIDFromContext(ctx)
	sqlStr := `SELECT tenant_id, virtual_key_id, model_id, rollup_date, request_count,
	                  error_count, input_tokens_total, output_tokens_total, total_tokens,
	                  cost_usd_total, updated_at
	           FROM ai_spend_rollups WHERE tenant_id = ?`
	args := []any{tenantID}
	if q.VirtualKeyID != "" {
		sqlStr += ` AND virtual_key_id = ?`
		args = append(args, q.VirtualKeyID)
	}
	if q.ModelID != "" {
		sqlStr += ` AND model_id = ?`
		args = append(args, q.ModelID)
	}
	if q.Since != nil {
		sqlStr += ` AND rollup_date >= ?`
		s := q.Since.UTC()
		args = append(args, time.Date(s.Year(), s.Month(), s.Day(), 0, 0, 0, 0, time.UTC))
	}
	if q.Until != nil {
		sqlStr += ` AND rollup_date <= ?`
		u := q.Until.UTC()
		args = append(args, time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC))
	}
	sqlStr += ` ORDER BY rollup_date DESC`
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 365
	}
	sqlStr += ` LIMIT ?`
	args = append(args, limit)

	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(sqlStr), args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: query ai_spend_rollups: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []*store.AISpendRollup
	for rows.Next() {
		var (
			r          store.AISpendRollup
			rollupDate time.Time
			updatedAt  time.Time
		)
		if err := rows.Scan(&r.TenantID, &r.VirtualKeyID, &r.ModelID, &rollupDate,
			&r.RequestCount, &r.ErrorCount, &r.InputTokensTotal, &r.OutputTokensTotal,
			&r.TotalTokens, &r.CostUSDTotal, &updatedAt); err != nil {
			return nil, err
		}
		r.RollupDate = rollupDate.UTC()
		r.UpdatedAt = updatedAt.UTC()
		out = append(out, &r)
	}
	return out, rows.Err()
}

func scanAISpendLog(s scanner) (*store.AISpendLog, error) {
	var (
		log                                 store.AISpendLog
		virtualKeyID, applicationID, planID sql.NullString
		providerID, messages, response      sql.NullString
		createdAt                           time.Time
	)
	if err := s.Scan(
		&log.ID, &log.TenantID, &virtualKeyID, &applicationID, &planID, &providerID,
		&log.ModelID, &log.EstimatedTokens, &log.InputTokens, &log.OutputTokens,
		&log.CacheCreateTokens, &log.CacheReadTokens, &log.TotalTokens, &log.CostUSD,
		&log.LatencyMS, &log.Status, &log.RequestID, &messages, &response, &createdAt,
	); err != nil {
		return nil, err
	}
	if virtualKeyID.Valid {
		s := virtualKeyID.String
		log.VirtualKeyID = &s
	}
	if applicationID.Valid {
		s := applicationID.String
		log.ApplicationID = &s
	}
	if planID.Valid {
		s := planID.String
		log.PlanID = &s
	}
	if providerID.Valid {
		s := providerID.String
		log.ProviderID = &s
	}
	if messages.Valid {
		s := messages.String
		log.Messages = &s
	}
	if response.Valid {
		s := response.String
		log.Response = &s
	}
	log.CreatedAt = createdAt.UTC()
	return &log, nil
}
