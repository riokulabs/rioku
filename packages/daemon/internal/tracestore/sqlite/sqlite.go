// Package sqlite implements the tracestore.Driver interface using SQLite.
// This is the default backend for single-node deployments.
package sqlite

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/tracestore"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

const timeFmt = "2006-01-02T15:04:05.000Z"

func init() {
	tracestore.Register("sqlite", func() tracestore.Driver {
		return &driver{}
	})
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

type driver struct {
	db *sql.DB
}

func (d *driver) Open(_ context.Context, cfg tracestore.DriverConfig) error {
	path := cfg.Path
	if path == "" {
		path = cfg.DSN
	}
	if path == "" {
		return fmt.Errorf("sqlite tracestore: path is required")
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("sqlite tracestore: open: %w", err)
	}

	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	} {
		if _, err := db.Exec(pragma); err != nil {
			_ = db.Close()
			return fmt.Errorf("sqlite tracestore: %s: %w", pragma, err)
		}
	}

	d.db = db

	// Run migrations.
	if err := d.migrate(); err != nil {
		_ = db.Close()
		return fmt.Errorf("sqlite tracestore: migrate: %w", err)
	}

	return nil
}

func (d *driver) migrate() error {
	data, err := migrationFS.ReadFile("migrations/000001_traces.up.sql")
	if err != nil {
		return fmt.Errorf("read migration: %w", err)
	}
	if _, err := d.db.Exec(string(data)); err != nil {
		return fmt.Errorf("apply migration: %w", err)
	}

	// Record schema version (idempotent).
	_, err = d.db.Exec(
		`INSERT OR IGNORE INTO trace_schema_versions (version, dirty, applied_at) VALUES (1, 0, ?)`,
		time.Now().UTC().Format(timeFmt),
	)
	return err
}

func (d *driver) Close() error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

// ---------------------------------------------------------------------------
// WriteBatch
// ---------------------------------------------------------------------------

func (d *driver) WriteBatch(ctx context.Context, traces []*riokuv1.RequestTrace) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlite tracestore: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT OR IGNORE INTO raw_traces (
			trace_id, span_id, session_id, started_at,
			duration_ms, upstream_duration_ms,
			method, path, host, route_id, service_id, upstream_addr,
			status_code, bytes_sent, bytes_recv,
			actor_id, actor_type, policy_ids, rate_limit_hit, auth_result,
			ai_provider, ai_model, ai_input_tokens, ai_output_tokens,
			ai_total_tokens, ai_estimated_cost_usd, ai_is_streaming,
			ai_finish_reason, ai_session_id
		) VALUES (
			?, ?, ?, ?,
			?, ?,
			?, ?, ?, ?, ?, ?,
			?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?,
			?, ?
		)`)
	if err != nil {
		return fmt.Errorf("sqlite tracestore: prepare: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	for _, tr := range traces {
		startedAt := ""
		if tr.GetStartedAt() != nil {
			startedAt = tr.GetStartedAt().AsTime().UTC().Format(timeFmt)
		}

		policyJSON, _ := json.Marshal(tr.GetPolicyIds())
		if tr.GetPolicyIds() == nil {
			policyJSON = []byte("[]")
		}

		rateLimitHit := 0
		if tr.GetRateLimitHit() {
			rateLimitHit = 1
		}

		var (
			aiProvider  string
			aiModel     string
			aiInput     int64
			aiOutput    int64
			aiTotal     int64
			aiCost      float64
			aiStreaming int
			aiFinish    string
			aiSessionID string
		)
		if ai := tr.GetAi(); ai != nil {
			aiProvider = ai.GetProvider()
			aiModel = ai.GetModel()
			aiInput = ai.GetInputTokens()
			aiOutput = ai.GetOutputTokens()
			aiTotal = ai.GetTotalTokens()
			aiCost = ai.GetEstimatedCostUsd()
			if ai.GetIsStreaming() {
				aiStreaming = 1
			}
			aiFinish = ai.GetFinishReason()
			aiSessionID = tr.GetSessionId()
		}

		_, err := stmt.ExecContext(ctx,
			tr.GetTraceId(), tr.GetSpanId(), tr.GetSessionId(), startedAt,
			tr.GetDurationMs(), tr.GetUpstreamDurationMs(),
			tr.GetMethod(), tr.GetPath(), tr.GetHost(),
			tr.GetRouteId(), tr.GetServiceId(), tr.GetUpstreamAddr(),
			tr.GetStatusCode(), tr.GetBytesSent(), tr.GetBytesRecv(),
			tr.GetActorId(), tr.GetActorType(), string(policyJSON),
			rateLimitHit, tr.GetAuthResult(),
			aiProvider, aiModel, aiInput, aiOutput,
			aiTotal, aiCost, aiStreaming,
			aiFinish, aiSessionID,
		)
		if err != nil {
			return fmt.Errorf("sqlite tracestore: insert trace %s: %w", tr.GetTraceId(), err)
		}
	}

	return tx.Commit()
}

// ---------------------------------------------------------------------------
// QueryTraces
// ---------------------------------------------------------------------------

func (d *driver) QueryTraces(ctx context.Context, q *riokuv1.TraceQuery) ([]*riokuv1.RequestTrace, int64, error) {
	var (
		wheres []string
		args   []any
	)

	if q.GetSince() != nil {
		wheres = append(wheres, "started_at >= ?")
		args = append(args, q.GetSince().AsTime().UTC().Format(timeFmt))
	}
	if q.GetUntil() != nil {
		wheres = append(wheres, "started_at <= ?")
		args = append(args, q.GetUntil().AsTime().UTC().Format(timeFmt))
	}
	if len(q.GetRouteIds()) > 0 {
		placeholders := make([]string, len(q.GetRouteIds()))
		for i, rid := range q.GetRouteIds() {
			placeholders[i] = "?"
			args = append(args, rid)
		}
		wheres = append(wheres, "route_id IN ("+strings.Join(placeholders, ",")+")")
	}
	if len(q.GetStatusCodes()) > 0 {
		placeholders := make([]string, len(q.GetStatusCodes()))
		for i, sc := range q.GetStatusCodes() {
			placeholders[i] = "?"
			args = append(args, sc)
		}
		wheres = append(wheres, "status_code IN ("+strings.Join(placeholders, ",")+")")
	}
	if q.GetActorId() != "" {
		wheres = append(wheres, "actor_id = ?")
		args = append(args, q.GetActorId())
	}
	if q.GetSessionId() != "" {
		wheres = append(wheres, "session_id = ?")
		args = append(args, q.GetSessionId())
	}
	if q.GetAiOnly() {
		wheres = append(wheres, "ai_provider != ''")
	}

	whereClause := ""
	if len(wheres) > 0 {
		whereClause = " WHERE " + strings.Join(wheres, " AND ")
	}

	// Count total.
	countSQL := "SELECT COUNT(*) FROM raw_traces" + whereClause
	var total int64
	if err := d.db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("sqlite tracestore: count: %w", err)
	}

	// Pagination: interpret PageSize as limit, PageToken as offset.
	limit := int32(50) // default
	offset := int32(0)
	if p := q.GetPage(); p != nil {
		if p.GetPageSize() > 0 {
			limit = p.GetPageSize()
		}
		if tok := p.GetPageToken(); tok != "" {
			if v, err := strconv.Atoi(tok); err == nil {
				offset = int32(v)
			}
		}
	}

	dataSQL := "SELECT " + traceColumns + " FROM raw_traces" + whereClause +
		" ORDER BY started_at DESC LIMIT ? OFFSET ?"
	dataArgs := make([]any, len(args)+2)
	copy(dataArgs, args)
	dataArgs[len(args)] = limit
	dataArgs[len(args)+1] = offset

	rows, err := d.db.QueryContext(ctx, dataSQL, dataArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("sqlite tracestore: query: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var traces []*riokuv1.RequestTrace
	for rows.Next() {
		tr, err := scanTrace(rows)
		if err != nil {
			return nil, 0, err
		}
		traces = append(traces, tr)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("sqlite tracestore: rows: %w", err)
	}

	return traces, total, nil
}

// ---------------------------------------------------------------------------
// GetTrace
// ---------------------------------------------------------------------------

func (d *driver) GetTrace(ctx context.Context, traceID string) (*riokuv1.RequestTrace, error) {
	query := "SELECT " + traceColumns + " FROM raw_traces WHERE trace_id = ?"
	rows, err := d.db.QueryContext(ctx, query, traceID)
	if err != nil {
		return nil, fmt.Errorf("sqlite tracestore: get trace: %w", err)
	}
	defer func() { _ = rows.Close() }()

	if !rows.Next() {
		return nil, nil
	}
	tr, err := scanTrace(rows)
	if err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite tracestore: rows: %w", err)
	}
	return tr, nil
}

// ---------------------------------------------------------------------------
// Bucket writes
// ---------------------------------------------------------------------------

func (d *driver) WriteStatsBucket(ctx context.Context, b tracestore.StatsBucket) error {
	_, err := d.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO stats_buckets
			(bucket_start, request_count, error_count, p50_latency_ms, p95_latency_ms, p99_latency_ms, bytes_sent, bytes_recv)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		b.BucketStart.UTC().Format(timeFmt),
		b.RequestCount, b.ErrorCount,
		b.P50LatencyMS, b.P95LatencyMS, b.P99LatencyMS,
		b.BytesSent, b.BytesRecv,
	)
	if err != nil {
		return fmt.Errorf("sqlite tracestore: write stats bucket: %w", err)
	}
	return nil
}

func (d *driver) WriteRouteBucket(ctx context.Context, b tracestore.RouteBucket) error {
	_, err := d.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO route_buckets
			(bucket_start, route_id, request_count, error_count, avg_latency_ms)
		VALUES (?, ?, ?, ?, ?)`,
		b.BucketStart.UTC().Format(timeFmt),
		b.RouteID, b.RequestCount, b.ErrorCount, b.AvgLatencyMS,
	)
	if err != nil {
		return fmt.Errorf("sqlite tracestore: write route bucket: %w", err)
	}
	return nil
}

func (d *driver) WriteStatusBucket(ctx context.Context, b tracestore.StatusBucket) error {
	_, err := d.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO status_buckets
			(bucket_start, status_class, request_count)
		VALUES (?, ?, ?)`,
		b.BucketStart.UTC().Format(timeFmt),
		b.StatusClass, b.RequestCount,
	)
	if err != nil {
		return fmt.Errorf("sqlite tracestore: write status bucket: %w", err)
	}
	return nil
}

func (d *driver) WriteModelBucket(ctx context.Context, b tracestore.ModelBucket) error {
	_, err := d.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO model_buckets
			(bucket_start, provider, model, request_count, total_tokens, estimated_cost_usd)
		VALUES (?, ?, ?, ?, ?, ?)`,
		b.BucketStart.UTC().Format(timeFmt),
		b.Provider, b.Model, b.RequestCount, b.TotalTokens, b.EstimatedCostUSD,
	)
	if err != nil {
		return fmt.Errorf("sqlite tracestore: write model bucket: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Bucket reads
// ---------------------------------------------------------------------------

func (d *driver) GetStatsBuckets(ctx context.Context, since, until time.Time) ([]tracestore.StatsBucket, error) {
	rows, err := d.db.QueryContext(ctx, `
		SELECT bucket_start, request_count, error_count,
		       p50_latency_ms, p95_latency_ms, p99_latency_ms,
		       bytes_sent, bytes_recv
		FROM stats_buckets
		WHERE bucket_start BETWEEN ? AND ?
		ORDER BY bucket_start`,
		since.UTC().Format(timeFmt), until.UTC().Format(timeFmt),
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite tracestore: get stats buckets: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var buckets []tracestore.StatsBucket
	for rows.Next() {
		var b tracestore.StatsBucket
		var bs string
		if err := rows.Scan(&bs, &b.RequestCount, &b.ErrorCount,
			&b.P50LatencyMS, &b.P95LatencyMS, &b.P99LatencyMS,
			&b.BytesSent, &b.BytesRecv); err != nil {
			return nil, fmt.Errorf("sqlite tracestore: scan stats bucket: %w", err)
		}
		b.BucketStart, _ = time.Parse(timeFmt, bs)
		buckets = append(buckets, b)
	}
	return buckets, rows.Err()
}

func (d *driver) GetRouteBuckets(ctx context.Context, since, until time.Time) ([]tracestore.RouteBucket, error) {
	rows, err := d.db.QueryContext(ctx, `
		SELECT bucket_start, route_id, request_count, error_count, avg_latency_ms
		FROM route_buckets
		WHERE bucket_start BETWEEN ? AND ?
		ORDER BY bucket_start`,
		since.UTC().Format(timeFmt), until.UTC().Format(timeFmt),
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite tracestore: get route buckets: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var buckets []tracestore.RouteBucket
	for rows.Next() {
		var b tracestore.RouteBucket
		var bs string
		if err := rows.Scan(&bs, &b.RouteID, &b.RequestCount, &b.ErrorCount, &b.AvgLatencyMS); err != nil {
			return nil, fmt.Errorf("sqlite tracestore: scan route bucket: %w", err)
		}
		b.BucketStart, _ = time.Parse(timeFmt, bs)
		buckets = append(buckets, b)
	}
	return buckets, rows.Err()
}

func (d *driver) GetStatusBuckets(ctx context.Context, since, until time.Time) ([]tracestore.StatusBucket, error) {
	rows, err := d.db.QueryContext(ctx, `
		SELECT bucket_start, status_class, request_count
		FROM status_buckets
		WHERE bucket_start BETWEEN ? AND ?
		ORDER BY bucket_start`,
		since.UTC().Format(timeFmt), until.UTC().Format(timeFmt),
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite tracestore: get status buckets: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var buckets []tracestore.StatusBucket
	for rows.Next() {
		var b tracestore.StatusBucket
		var bs string
		if err := rows.Scan(&bs, &b.StatusClass, &b.RequestCount); err != nil {
			return nil, fmt.Errorf("sqlite tracestore: scan status bucket: %w", err)
		}
		b.BucketStart, _ = time.Parse(timeFmt, bs)
		buckets = append(buckets, b)
	}
	return buckets, rows.Err()
}

func (d *driver) GetModelBuckets(ctx context.Context, since, until time.Time) ([]tracestore.ModelBucket, error) {
	rows, err := d.db.QueryContext(ctx, `
		SELECT bucket_start, provider, model, request_count, total_tokens, estimated_cost_usd
		FROM model_buckets
		WHERE bucket_start BETWEEN ? AND ?
		ORDER BY bucket_start`,
		since.UTC().Format(timeFmt), until.UTC().Format(timeFmt),
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite tracestore: get model buckets: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var buckets []tracestore.ModelBucket
	for rows.Next() {
		var b tracestore.ModelBucket
		var bs string
		if err := rows.Scan(&bs, &b.Provider, &b.Model, &b.RequestCount, &b.TotalTokens, &b.EstimatedCostUSD); err != nil {
			return nil, fmt.Errorf("sqlite tracestore: scan model bucket: %w", err)
		}
		b.BucketStart, _ = time.Parse(timeFmt, bs)
		buckets = append(buckets, b)
	}
	return buckets, rows.Err()
}

// ---------------------------------------------------------------------------
// Session queries
// ---------------------------------------------------------------------------

func (d *driver) GetSessionTraces(ctx context.Context, sessionID string) ([]*riokuv1.RequestTrace, error) {
	query := "SELECT " + traceColumns + " FROM raw_traces WHERE session_id = ? ORDER BY started_at"
	rows, err := d.db.QueryContext(ctx, query, sessionID)
	if err != nil {
		return nil, fmt.Errorf("sqlite tracestore: get session traces: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var traces []*riokuv1.RequestTrace
	for rows.Next() {
		tr, err := scanTrace(rows)
		if err != nil {
			return nil, err
		}
		traces = append(traces, tr)
	}
	return traces, rows.Err()
}

func (d *driver) ListSessions(ctx context.Context, activeOnly bool, since time.Time, limit, offset int) ([]tracestore.SessionSummary, int64, error) {
	innerWhere := " WHERE session_id != ''"

	havingParts := []string{}
	havingArgs := []any{}
	if !since.IsZero() {
		havingParts = append(havingParts, "MAX(started_at) >= ?")
		havingArgs = append(havingArgs, since.UTC().Format(timeFmt))
	}
	if activeOnly {
		cutoff := time.Now().UTC().Add(-5 * time.Minute).Format(timeFmt)
		havingParts = append(havingParts, "MAX(started_at) >= ?")
		havingArgs = append(havingArgs, cutoff)
	}

	havingSQL := ""
	if len(havingParts) > 0 {
		havingSQL = " HAVING " + strings.Join(havingParts, " AND ")
	}

	// Count total sessions.
	countSQL := `SELECT COUNT(*) FROM (
		SELECT session_id
		FROM raw_traces` + innerWhere + `
		GROUP BY session_id` + havingSQL + `
	)`
	countArgs := append([]any{}, havingArgs...)

	var total int64
	if err := d.db.QueryRowContext(ctx, countSQL, countArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("sqlite tracestore: count sessions: %w", err)
	}

	// Fetch sessions.
	dataSQL := `
		SELECT session_id,
		       COUNT(*) as turn_count,
		       MIN(started_at) as first_seen,
		       MAX(started_at) as last_seen,
		       COALESCE(SUM(ai_total_tokens), 0) as total_tokens,
		       COALESCE(SUM(ai_estimated_cost_usd), 0.0) as total_cost
		FROM raw_traces` + innerWhere + `
		GROUP BY session_id` + havingSQL + `
		ORDER BY last_seen DESC
		LIMIT ? OFFSET ?`
	dataArgs := append([]any{}, havingArgs...)
	dataArgs = append(dataArgs, limit, offset)

	rows, err := d.db.QueryContext(ctx, dataSQL, dataArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("sqlite tracestore: list sessions: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var sessions []tracestore.SessionSummary
	for rows.Next() {
		var s tracestore.SessionSummary
		var firstSeen, lastSeen string
		if err := rows.Scan(&s.SessionID, &s.TurnCount, &firstSeen, &lastSeen,
			&s.TotalTokens, &s.EstimatedCostUSD); err != nil {
			return nil, 0, fmt.Errorf("sqlite tracestore: scan session: %w", err)
		}
		s.StartedAt, _ = time.Parse(timeFmt, firstSeen)
		s.LastSeenAt, _ = time.Parse(timeFmt, lastSeen)
		sessions = append(sessions, s)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("sqlite tracestore: rows: %w", err)
	}

	return sessions, total, nil
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

func (d *driver) Prune(ctx context.Context, rawRetention, aggRetention, aiRetention time.Duration) (int64, error) {
	now := time.Now().UTC()
	var totalDeleted int64

	// Prune raw traces.
	rawCutoff := now.Add(-rawRetention).Format(timeFmt)
	res, err := d.db.ExecContext(ctx, `DELETE FROM raw_traces WHERE started_at < ?`, rawCutoff)
	if err != nil {
		return 0, fmt.Errorf("sqlite tracestore: prune raw_traces: %w", err)
	}
	n, _ := res.RowsAffected()
	totalDeleted += n

	// Prune aggregate buckets.
	aggCutoff := now.Add(-aggRetention).Format(timeFmt)

	res, err = d.db.ExecContext(ctx, `DELETE FROM stats_buckets WHERE bucket_start < ?`, aggCutoff)
	if err != nil {
		return totalDeleted, fmt.Errorf("sqlite tracestore: prune stats_buckets: %w", err)
	}
	n, _ = res.RowsAffected()
	totalDeleted += n

	res, err = d.db.ExecContext(ctx, `DELETE FROM route_buckets WHERE bucket_start < ?`, aggCutoff)
	if err != nil {
		return totalDeleted, fmt.Errorf("sqlite tracestore: prune route_buckets: %w", err)
	}
	n, _ = res.RowsAffected()
	totalDeleted += n

	res, err = d.db.ExecContext(ctx, `DELETE FROM status_buckets WHERE bucket_start < ?`, aggCutoff)
	if err != nil {
		return totalDeleted, fmt.Errorf("sqlite tracestore: prune status_buckets: %w", err)
	}
	n, _ = res.RowsAffected()
	totalDeleted += n

	res, err = d.db.ExecContext(ctx, `DELETE FROM model_buckets WHERE bucket_start < ?`, aggCutoff)
	if err != nil {
		return totalDeleted, fmt.Errorf("sqlite tracestore: prune model_buckets: %w", err)
	}
	n, _ = res.RowsAffected()
	totalDeleted += n

	return totalDeleted, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const traceColumns = `trace_id, span_id, session_id, started_at,
	duration_ms, upstream_duration_ms,
	method, path, host, route_id, service_id, upstream_addr,
	status_code, bytes_sent, bytes_recv,
	actor_id, actor_type, policy_ids, rate_limit_hit, auth_result,
	ai_provider, ai_model, ai_input_tokens, ai_output_tokens,
	ai_total_tokens, ai_estimated_cost_usd, ai_is_streaming,
	ai_finish_reason, ai_session_id`

func scanTrace(rows *sql.Rows) (*riokuv1.RequestTrace, error) {
	var (
		traceID, spanID, sessionID, startedAt            string
		durationMS, upstreamDurationMS                   int64
		method, path, host, routeID, serviceID, upstream string
		statusCode                                       int32
		bytesSent, bytesRecv                             int64
		actorID, actorType, policyJSON, authResult       string
		rateLimitHit                                     int
		aiProvider, aiModel, aiFinish, aiSessionID       string
		aiInput, aiOutput, aiTotal                       int64
		aiCost                                           float64
		aiStreaming                                      int
	)

	err := rows.Scan(
		&traceID, &spanID, &sessionID, &startedAt,
		&durationMS, &upstreamDurationMS,
		&method, &path, &host, &routeID, &serviceID, &upstream,
		&statusCode, &bytesSent, &bytesRecv,
		&actorID, &actorType, &policyJSON, &rateLimitHit, &authResult,
		&aiProvider, &aiModel, &aiInput, &aiOutput,
		&aiTotal, &aiCost, &aiStreaming,
		&aiFinish, &aiSessionID,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlite tracestore: scan trace: %w", err)
	}

	t, _ := time.Parse(timeFmt, startedAt)

	tr := &riokuv1.RequestTrace{
		TraceId:            traceID,
		SpanId:             spanID,
		SessionId:          sessionID,
		StartedAt:          timestamppb.New(t),
		DurationMs:         durationMS,
		UpstreamDurationMs: upstreamDurationMS,
		Method:             method,
		Path:               path,
		Host:               host,
		RouteId:            routeID,
		ServiceId:          serviceID,
		UpstreamAddr:       upstream,
		StatusCode:         statusCode,
		BytesSent:          bytesSent,
		BytesRecv:          bytesRecv,
		ActorId:            actorID,
		ActorType:          actorType,
		RateLimitHit:       rateLimitHit != 0,
		AuthResult:         authResult,
	}

	// Parse policy_ids JSON.
	if policyJSON != "" && policyJSON != "[]" {
		var pids []string
		if err := json.Unmarshal([]byte(policyJSON), &pids); err == nil {
			tr.PolicyIds = pids
		}
	}

	// Reconstruct AITrace if provider is non-empty.
	if aiProvider != "" {
		tr.Ai = &riokuv1.AITrace{
			Provider:         aiProvider,
			Model:            aiModel,
			InputTokens:      aiInput,
			OutputTokens:     aiOutput,
			TotalTokens:      aiTotal,
			EstimatedCostUsd: aiCost,
			IsStreaming:      aiStreaming != 0,
			FinishReason:     aiFinish,
		}
	}

	return tr, nil
}
