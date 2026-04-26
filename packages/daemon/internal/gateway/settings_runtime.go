package gateway

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/riokulabs/rioku/internal/config"
)

// RuntimeSettings holds the daemon's runtime-mutable configuration alongside
// the synchronisation primitive that serialises PATCH writes.
//
// Stage-1 scope: only the subset of fields that downstream code reads on
// every request (log level, auth/lockout/rate-limit, trace sampling) are
// exposed via PATCH. Listen addresses, store driver, Caddy binary path and
// similar restart-bound fields stay read-only — admin must edit rioku.yaml
// and restart the daemon.
//
// Mutations made via PATCH apply at runtime but are NOT persisted back to
// rioku.yaml — a daemon restart will revert them. A future stage-2 change
// can layer a "config-overrides" store on top to make changes durable.
type RuntimeSettings struct {
	cfg      *config.Config
	levelVar *slog.LevelVar
	mu       sync.RWMutex
}

// NewRuntimeSettings wraps the daemon's *config.Config + LevelVar.
// `levelVar` may be nil when the daemon is started without the slog handler
// (e.g. the test harness using a custom logger); PATCH calls that target
// the log level will then return 503.
func NewRuntimeSettings(cfg *config.Config, levelVar *slog.LevelVar) *RuntimeSettings {
	return &RuntimeSettings{cfg: cfg, levelVar: levelVar}
}

// Config returns the held *config.Config under a read lock. Callers that
// only need a snapshot of immutable fields can use this directly. Callers
// that need to read mutable fields should use one of the typed Get*()
// methods below to ensure the read sees a coherent snapshot.
func (s *RuntimeSettings) Config() *config.Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

// ─── Log level ──────────────────────────────────────────────────────────────

// SetLogLevel updates the daemon log level both on the in-memory cfg field
// and on the live LevelVar (so already-bound loggers see the change
// immediately). Accepts: debug | info | warn | error.
func (s *RuntimeSettings) SetLogLevel(level string) error {
	parsed, err := parseLevel(level)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.LogLevel = level
	s.cfg.Logging.Level = level
	if s.levelVar != nil {
		s.levelVar.Set(parsed)
	}
	return nil
}

// GetLogLevel returns the current daemon log level.
func (s *RuntimeSettings) GetLogLevel() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.cfg.Logging.Level != "" {
		return s.cfg.Logging.Level
	}
	return s.cfg.LogLevel
}

func parseLevel(s string) (slog.Level, error) {
	switch s {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("invalid log level %q (want one of: debug, info, warn, error)", s)
	}
}

// ─── Auth: password policy ──────────────────────────────────────────────────

// PasswordPolicyPatch is the partial-update payload for the password policy.
// All fields are pointers so PATCH can express "leave this alone" by
// omitting the field from the request body.
type PasswordPolicyPatch struct {
	MinLength        *int  `json:"minLength,omitempty"`
	RequireUppercase *bool `json:"requireUppercase,omitempty"`
	RequireLowercase *bool `json:"requireLowercase,omitempty"`
	RequireDigit     *bool `json:"requireDigit,omitempty"`
	RequireSpecial   *bool `json:"requireSpecial,omitempty"`
	MaxAgeDays       *int  `json:"maxAgeDays,omitempty"`
}

// ApplyPasswordPolicyPatch validates + applies a partial update.
func (s *RuntimeSettings) ApplyPasswordPolicyPatch(p PasswordPolicyPatch) error {
	if p.MinLength != nil && (*p.MinLength < 6 || *p.MinLength > 128) {
		return fmt.Errorf("minLength must be between 6 and 128")
	}
	if p.MaxAgeDays != nil && (*p.MaxAgeDays < 0 || *p.MaxAgeDays > 3650) {
		return fmt.Errorf("maxAgeDays must be between 0 and 3650")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	pp := &s.cfg.Auth.PasswordPolicy
	if p.MinLength != nil {
		pp.MinLength = *p.MinLength
	}
	if p.RequireUppercase != nil {
		pp.RequireUppercase = *p.RequireUppercase
	}
	if p.RequireLowercase != nil {
		pp.RequireLowercase = *p.RequireLowercase
	}
	if p.RequireDigit != nil {
		pp.RequireDigit = *p.RequireDigit
	}
	if p.RequireSpecial != nil {
		pp.RequireSpecial = *p.RequireSpecial
	}
	if p.MaxAgeDays != nil {
		pp.MaxAgeDays = *p.MaxAgeDays
	}
	return nil
}

// ─── Auth: lockout ──────────────────────────────────────────────────────────

// LockoutPatch is the partial-update payload for the account-lockout policy.
type LockoutPatch struct {
	MaxAttempts            *int `json:"maxAttempts,omitempty"`
	LockoutDurationMinutes *int `json:"lockoutDurationMinutes,omitempty"`
	ResetAfterMinutes      *int `json:"resetAfterMinutes,omitempty"`
}

// ApplyLockoutPatch validates + applies a partial update.
func (s *RuntimeSettings) ApplyLockoutPatch(p LockoutPatch) error {
	if p.MaxAttempts != nil && *p.MaxAttempts < 1 {
		return fmt.Errorf("maxAttempts must be >= 1")
	}
	if p.LockoutDurationMinutes != nil && *p.LockoutDurationMinutes < 0 {
		return fmt.Errorf("lockoutDurationMinutes must be >= 0")
	}
	if p.ResetAfterMinutes != nil && *p.ResetAfterMinutes < 0 {
		return fmt.Errorf("resetAfterMinutes must be >= 0")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	lo := &s.cfg.Auth.Lockout
	if p.MaxAttempts != nil {
		lo.MaxAttempts = *p.MaxAttempts
	}
	if p.LockoutDurationMinutes != nil {
		lo.LockoutDuration = time.Duration(*p.LockoutDurationMinutes) * time.Minute
	}
	if p.ResetAfterMinutes != nil {
		lo.ResetAfter = time.Duration(*p.ResetAfterMinutes) * time.Minute
	}
	return nil
}

// ─── Auth: rate limit ───────────────────────────────────────────────────────

// RateLimitPatch is the partial-update payload for the auth rate limiter.
type RateLimitPatch struct {
	RequestsPerMinute *int `json:"requestsPerMinute,omitempty"`
	BurstSize         *int `json:"burstSize,omitempty"`
}

// ApplyRateLimitPatch validates + applies a partial update.
func (s *RuntimeSettings) ApplyRateLimitPatch(p RateLimitPatch) error {
	if p.RequestsPerMinute != nil && *p.RequestsPerMinute < 1 {
		return fmt.Errorf("requestsPerMinute must be >= 1")
	}
	if p.BurstSize != nil && *p.BurstSize < 1 {
		return fmt.Errorf("burstSize must be >= 1")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rl := &s.cfg.Auth.RateLimit
	if p.RequestsPerMinute != nil {
		rl.RequestsPerMinute = *p.RequestsPerMinute
	}
	if p.BurstSize != nil {
		rl.BurstSize = *p.BurstSize
	}
	return nil
}

// ─── Traces: sampling ───────────────────────────────────────────────────────

// TracesSamplingPatch is the partial-update payload for the trace sampler.
// `rate` is a float in [0, 1].
type TracesSamplingPatch struct {
	Rate *float64 `json:"rate,omitempty"`
}

// ApplyTracesSamplingPatch validates + applies a partial update.
func (s *RuntimeSettings) ApplyTracesSamplingPatch(p TracesSamplingPatch) error {
	if p.Rate != nil && (*p.Rate < 0.0 || *p.Rate > 1.0) {
		return fmt.Errorf("rate must be between 0.0 and 1.0")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.Rate != nil {
		v := *p.Rate
		s.cfg.Traces.Sampling.Rate = &v
	}
	return nil
}
