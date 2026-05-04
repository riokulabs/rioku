package gateway

import (
	"log/slog"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/config"
)

func TestRuntimeSettings_SetLogLevelUpdatesLevelVar(t *testing.T) {
	cfg := config.Default()
	cfg.LogLevel = "info"
	var lv slog.LevelVar
	lv.Set(slog.LevelInfo)
	rs := NewRuntimeSettings(cfg, &lv)

	if err := rs.SetLogLevel("debug"); err != nil {
		t.Fatalf("SetLogLevel: %v", err)
	}
	if lv.Level() != slog.LevelDebug {
		t.Errorf("levelVar = %v, want debug", lv.Level())
	}
	if got := rs.GetLogLevel(); got != "debug" {
		t.Errorf("GetLogLevel = %q, want debug", got)
	}
	if cfg.Logging.Level != "debug" || cfg.LogLevel != "debug" {
		t.Errorf("cfg fields not updated: Logging.Level=%q LogLevel=%q", cfg.Logging.Level, cfg.LogLevel)
	}
}

func TestRuntimeSettings_SetLogLevelInvalid(t *testing.T) {
	cfg := config.Default()
	rs := NewRuntimeSettings(cfg, nil)
	if err := rs.SetLogLevel("verbose"); err == nil {
		t.Error("expected error for invalid level")
	}
}

func TestRuntimeSettings_SetLogLevelNilLevelVar(t *testing.T) {
	cfg := config.Default()
	rs := NewRuntimeSettings(cfg, nil)
	// Must still update cfg fields even when no LevelVar is bound.
	if err := rs.SetLogLevel("warn"); err != nil {
		t.Fatalf("SetLogLevel without LevelVar: %v", err)
	}
	if rs.GetLogLevel() != "warn" {
		t.Error("cfg level not updated when LevelVar nil")
	}
}

func TestRuntimeSettings_PasswordPolicyPatch(t *testing.T) {
	cfg := config.Default()
	rs := NewRuntimeSettings(cfg, nil)

	min := 16
	upper := true
	if err := rs.ApplyPasswordPolicyPatch(PasswordPolicyPatch{
		MinLength:        &min,
		RequireUppercase: &upper,
	}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if cfg.Auth.PasswordPolicy.MinLength != 16 {
		t.Errorf("MinLength = %d, want 16", cfg.Auth.PasswordPolicy.MinLength)
	}
	if !cfg.Auth.PasswordPolicy.RequireUppercase {
		t.Error("RequireUppercase not set")
	}
}

func TestRuntimeSettings_PasswordPolicyValidation(t *testing.T) {
	cfg := config.Default()
	rs := NewRuntimeSettings(cfg, nil)

	tooSmall := 4
	if err := rs.ApplyPasswordPolicyPatch(PasswordPolicyPatch{MinLength: &tooSmall}); err == nil {
		t.Error("expected validation error for MinLength=4")
	}
	tooBig := 999
	if err := rs.ApplyPasswordPolicyPatch(PasswordPolicyPatch{MinLength: &tooBig}); err == nil {
		t.Error("expected validation error for MinLength=999")
	}
	negAge := -1
	if err := rs.ApplyPasswordPolicyPatch(PasswordPolicyPatch{MaxAgeDays: &negAge}); err == nil {
		t.Error("expected validation error for negative MaxAgeDays")
	}
}

func TestRuntimeSettings_LockoutPatch(t *testing.T) {
	cfg := config.Default()
	rs := NewRuntimeSettings(cfg, nil)

	maxA := 5
	durMin := 30
	resetMin := 15
	if err := rs.ApplyLockoutPatch(LockoutPatch{
		MaxAttempts:            &maxA,
		LockoutDurationMinutes: &durMin,
		ResetAfterMinutes:      &resetMin,
	}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if cfg.Auth.Lockout.MaxAttempts != 5 {
		t.Errorf("MaxAttempts = %d, want 5", cfg.Auth.Lockout.MaxAttempts)
	}
	if cfg.Auth.Lockout.LockoutDuration != 30*time.Minute {
		t.Errorf("LockoutDuration = %v, want 30m", cfg.Auth.Lockout.LockoutDuration)
	}
	if cfg.Auth.Lockout.ResetAfter != 15*time.Minute {
		t.Errorf("ResetAfter = %v, want 15m", cfg.Auth.Lockout.ResetAfter)
	}
}

func TestRuntimeSettings_LockoutValidation(t *testing.T) {
	cfg := config.Default()
	rs := NewRuntimeSettings(cfg, nil)

	zero := 0
	if err := rs.ApplyLockoutPatch(LockoutPatch{MaxAttempts: &zero}); err == nil {
		t.Error("expected error for MaxAttempts=0")
	}
	neg := -5
	if err := rs.ApplyLockoutPatch(LockoutPatch{LockoutDurationMinutes: &neg}); err == nil {
		t.Error("expected error for negative duration")
	}
}

func TestRuntimeSettings_RateLimitPatch(t *testing.T) {
	cfg := config.Default()
	rs := NewRuntimeSettings(cfg, nil)

	rpm := 120
	burst := 30
	if err := rs.ApplyRateLimitPatch(RateLimitPatch{
		RequestsPerMinute: &rpm,
		BurstSize:         &burst,
	}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if cfg.Auth.RateLimit.RequestsPerMinute != 120 {
		t.Errorf("RPM = %d, want 120", cfg.Auth.RateLimit.RequestsPerMinute)
	}
	if cfg.Auth.RateLimit.BurstSize != 30 {
		t.Errorf("Burst = %d, want 30", cfg.Auth.RateLimit.BurstSize)
	}
}

func TestRuntimeSettings_TracesSamplingPatch(t *testing.T) {
	cfg := config.Default()
	rs := NewRuntimeSettings(cfg, nil)

	rate := 0.42
	if err := rs.ApplyTracesSamplingPatch(TracesSamplingPatch{Rate: &rate}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if cfg.Traces.Sampling.Rate == nil || *cfg.Traces.Sampling.Rate != 0.42 {
		t.Errorf("sampling rate not set: %v", cfg.Traces.Sampling.Rate)
	}

	bad := 1.5
	if err := rs.ApplyTracesSamplingPatch(TracesSamplingPatch{Rate: &bad}); err == nil {
		t.Error("expected error for rate > 1.0")
	}
	negative := -0.1
	if err := rs.ApplyTracesSamplingPatch(TracesSamplingPatch{Rate: &negative}); err == nil {
		t.Error("expected error for rate < 0.0")
	}
}

func TestRuntimeSettings_OmittedFieldsAreLeftAlone(t *testing.T) {
	cfg := config.Default()
	cfg.Auth.PasswordPolicy.MinLength = 12
	cfg.Auth.PasswordPolicy.RequireUppercase = false
	rs := NewRuntimeSettings(cfg, nil)

	// Patch only MinLength; RequireUppercase must stay false.
	min := 20
	if err := rs.ApplyPasswordPolicyPatch(PasswordPolicyPatch{MinLength: &min}); err != nil {
		t.Fatal(err)
	}
	if cfg.Auth.PasswordPolicy.RequireUppercase {
		t.Error("RequireUppercase should not have been touched")
	}
	if cfg.Auth.PasswordPolicy.MinLength != 20 {
		t.Errorf("MinLength = %d, want 20", cfg.Auth.PasswordPolicy.MinLength)
	}
}
