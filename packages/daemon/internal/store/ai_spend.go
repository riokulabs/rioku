package store

import (
	"errors"
	"time"
)

// AI spend log + rollup entities (Sprint 5 Phase 1, #166).
//
// Per D8 the spend log is per-request (7-day default retention)
// and the rollup is per (tenant, virtual_key, model, date)
// (indefinite retention). The AI gateway emits one spend-log
// row per request via AppendAISpendLog; a background aggregator
// folds the latest entries into ai_spend_rollups via
// AggregateAISpend.

// AISpendLog is one AI request's accounting record.
type AISpendLog struct {
	ID                string
	TenantID          string
	VirtualKeyID      *string
	ApplicationID     *string
	PlanID            *string
	ProviderID        *string
	ModelID           string
	EstimatedTokens   int32
	InputTokens       int32
	OutputTokens      int32
	CacheCreateTokens int32
	CacheReadTokens   int32
	TotalTokens       int32
	CostUSD           float64
	LatencyMS         int32
	Status            string
	RequestID         string
	// Messages + Response are nullable; populated only when the
	// per-tenant ai_capture_payloads flag is on.
	Messages  *string
	Response  *string
	CreatedAt time.Time
}

// AISpendQuery filters the read path. All fields are optional;
// each non-zero value AND-narrows the result.
type AISpendQuery struct {
	VirtualKeyID string
	ModelID      string
	Status       string
	Since        *time.Time
	Until        *time.Time
	Limit        int
	Offset       int
}

// AISpendRollup is one (tenant, virtual_key, model, date) bucket.
type AISpendRollup struct {
	TenantID          string
	VirtualKeyID      string
	ModelID           string
	RollupDate        time.Time
	RequestCount      int32
	ErrorCount        int32
	InputTokensTotal  int64
	OutputTokensTotal int64
	TotalTokens       int64
	CostUSDTotal      float64
	UpdatedAt         time.Time
}

// AISpendRollupQuery filters the rollup read path.
type AISpendRollupQuery struct {
	VirtualKeyID string
	ModelID      string
	Since        *time.Time
	Until        *time.Time
	Limit        int
}

var (
	ErrAISpendLogNotFound = errors.New("store: ai_spend_log not found")
)
