package store

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

// aiHelperTimeFormat mirrors the per-driver `timeFormat` constants used by the
// MySQL and SQLite AI tables. The string layout has stayed identical across
// drivers since these tables were introduced; centralising it here lets the
// shared scan helpers parse occurred_at without depending on driver-private
// helpers.
const aiHelperTimeFormat = "2006-01-02T15:04:05.000Z"

// rowScanner is the minimal Scan adapter shared by *sql.Row and *sql.Rows.
// Mirrors the per-driver `scanner` interfaces so the same helper accepts
// either single-row or multi-row cursors.
type rowScanner interface {
	Scan(dest ...any) error
}

// rowQuerier is satisfied by both *sql.DB and *sql.Tx and is the only handle
// the shared list helpers need to issue a query.
type rowQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// parseAIHelperTime parses a stored timestamp string back into time.Time. Logs
// a warning and returns the zero value when parsing fails so the helper stays
// behaviour-compatible with the per-driver `parseTime` it replaces.
func parseAIHelperTime(s string) time.Time {
	t, err := time.Parse(aiHelperTimeFormat, s)
	if err != nil && s != "" {
		slog.Warn("failed to parse time", "component", "store", "value", s, "error", err)
	}
	return t
}

// ScanAIProviderModel scans the canonical `ai_provider_models` SELECT column
// list (id, provider_id, upstream_model_id, alias, rate_limit_rpm,
// daily_quota_tokens, enabled, created_at, updated_at) into an
// *AIProviderModel. The same column list is used by both MySQL and SQLite
// implementations.
func ScanAIProviderModel(s rowScanner) (*AIProviderModel, error) {
	var (
		id, providerID, upstreamID, alias, createdAt, updatedAt string
		rateLimitRPM                                            int32
		dailyQuota                                              int64
		enabled                                                 int
	)
	if err := s.Scan(&id, &providerID, &upstreamID, &alias, &rateLimitRPM, &dailyQuota, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &AIProviderModel{
		ID: id, ProviderID: providerID, UpstreamModelID: upstreamID, Alias: alias,
		RateLimitRPM: rateLimitRPM, DailyQuotaTokens: dailyQuota, Enabled: enabled == 1,
		CreatedAt: parseAIHelperTime(createdAt), UpdatedAt: parseAIHelperTime(updatedAt),
	}, nil
}

// ListAIProviderModels runs the canonical `ai_provider_models WHERE provider_id = ?`
// query and decodes each row via ScanAIProviderModel. The dialect-specific
// errors are returned wrapped with the supplied errPrefix (e.g. "mysql" or
// "sqlite") so callers retain their existing error context.
func ListAIProviderModels(ctx context.Context, q rowQuerier, errPrefix, providerID string) ([]*AIProviderModel, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, provider_id, upstream_model_id, alias, rate_limit_rpm, daily_quota_tokens, enabled, created_at, updated_at
		 FROM ai_provider_models WHERE provider_id = ? ORDER BY alias ASC`, providerID)
	if err != nil {
		return nil, fmt.Errorf("%s: list provider_models: %w", errPrefix, err)
	}
	defer func() { _ = rows.Close() }()
	var out []*AIProviderModel
	for rows.Next() {
		m, err := ScanAIProviderModel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ScanAITrace decodes a row from the canonical `ai_traces` SELECT column list
// (id, tenant_id, agent_id, provider_id, model, status, input_tokens,
// output_tokens, duration_ms, prompt, completion, tool_calls_json, error,
// occurred_at) into an *AITrace.
func ScanAITrace(s rowScanner) (*AITrace, error) {
	var (
		id, tenantID, model, status, calls, occurredAt  string
		agentID, providerID, prompt, completion, errStr *string
		inputTokens, outputTokens, durationMS           int32
	)
	if err := s.Scan(&id, &tenantID, &agentID, &providerID, &model, &status, &inputTokens,
		&outputTokens, &durationMS, &prompt, &completion, &calls, &errStr, &occurredAt); err != nil {
		return nil, err
	}
	return &AITrace{
		ID: id, TenantID: tenantID, AgentID: agentID, ProviderID: providerID, Model: model,
		Status: status, InputTokens: inputTokens, OutputTokens: outputTokens, DurationMS: durationMS,
		Prompt: prompt, Completion: completion, ToolCallsJSON: calls, Error: errStr,
		OccurredAt: parseAIHelperTime(occurredAt),
	}, nil
}

// QueryAITraces builds the canonical `ai_traces` SELECT (with optional status,
// since, until filters and pagination) and decodes each row via ScanAITrace.
// whereClause is appended after `WHERE ` and whereArg is the leading positional
// argument; both are dialect-agnostic because the existing MySQL and SQLite
// callers already use the same `?` placeholder for these tables. Errors are
// wrapped with errPrefix so dialect callers keep their existing error context.
func QueryAITraces(ctx context.Context, q rowQuerier, errPrefix string, query AITraceQuery, whereClause string, whereArg any) ([]*AITrace, error) {
	sqlStr := `SELECT id, tenant_id, agent_id, provider_id, model, status, input_tokens,
		   output_tokens, duration_ms, prompt, completion, tool_calls_json, error, occurred_at
		 FROM ai_traces WHERE ` + whereClause
	args := []any{whereArg}
	if query.Status != nil && *query.Status != "" {
		sqlStr += ` AND status = ?`
		args = append(args, *query.Status)
	}
	if query.Since != nil {
		sqlStr += ` AND occurred_at >= ?`
		args = append(args, query.Since.UTC().Format(aiHelperTimeFormat))
	}
	if query.Until != nil {
		sqlStr += ` AND occurred_at <= ?`
		args = append(args, query.Until.UTC().Format(aiHelperTimeFormat))
	}
	sqlStr += ` ORDER BY occurred_at DESC, id DESC`
	limit := query.Limit
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	sqlStr += ` LIMIT ?`
	args = append(args, limit)
	if query.Offset > 0 {
		sqlStr += ` OFFSET ?`
		args = append(args, query.Offset)
	}

	rows, err := q.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("%s: query traces: %w", errPrefix, err)
	}
	defer func() { _ = rows.Close() }()
	var out []*AITrace
	for rows.Next() {
		tr, err := ScanAITrace(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, tr)
	}
	return out, rows.Err()
}
