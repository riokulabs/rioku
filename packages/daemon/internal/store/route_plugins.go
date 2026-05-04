package store

import (
	"errors"
	"time"
)

// Per-route plugin configuration entities (Sprint 4 Phase 2 #171,
// Phase 3 #172). The plugin handler modules already ship in the
// bundled rioku-caddy binary; these structs hold the per-route
// configuration the admin REST surface persists and the daemon
// compiler reads when emitting the per-route Caddy handler chain.

// ---------------------------------------------------------------------------
// Route OAS validator config (#171)
// ---------------------------------------------------------------------------

type RouteOASConfig struct {
	RouteID                string
	TenantID               string
	OASURL                 string
	OASInline              string
	RefreshIntervalSeconds int32
	ValidateRequestBody    bool
	ValidateRequestParams  bool
	RejectUnknown          bool
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// ---------------------------------------------------------------------------
// Route WAF config + denial log (#172)
// ---------------------------------------------------------------------------

// WAFMode is "block" (matched requests get a 403) or
// "detect_only" (matched requests pass through, but each match
// is recorded in waf_denials for tuning).
type WAFMode string

const (
	WAFModeBlock      WAFMode = "block"
	WAFModeDetectOnly WAFMode = "detect_only"
)

type RouteWAFConfig struct {
	RouteID          string
	TenantID         string
	Enabled          bool
	Mode             WAFMode
	RuleSet          string // "crs" by default; alternates land as new rule sets ship
	ParanoiaLevel    int32  // 1-4
	ExcludedRuleIDs  []string
	RequestBodyLimit int32
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// WAFDenial records a Coraza rule match. The handler emits one
// per match (when in detect_only mode) or per blocked request
// (when in block mode). The admin's Security timeline page
// reads these via QueryWAFDenials; pruning piggybacks on
// audit_retention_config.
type WAFDenial struct {
	ID         string
	TenantID   string
	RouteID    *string // nullable — the matching route may be deleted
	RuleID     string
	Severity   string
	Action     string // "block" | "log"
	RequestURI string
	ClientIP   string
	MatchedAt  time.Time
	Metadata   string // JSON object
}

// WAFDenialQuery scopes the read path. All filters are optional;
// each non-zero value AND-narrows the result. Limit defaults to
// 200 (capped at 1000) per the existing audit-query pattern.
type WAFDenialQuery struct {
	RouteID  string
	RuleID   string
	Severity string
	Since    *time.Time
	Until    *time.Time
	Limit    int
	Offset   int
}

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

var (
	ErrRouteOASConfigNotFound = errors.New("store: route_oas_config not found")
	ErrRouteWAFConfigNotFound = errors.New("store: route_waf_config not found")
)
