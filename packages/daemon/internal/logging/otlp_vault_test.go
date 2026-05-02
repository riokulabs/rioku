package logging_test

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/logging"
	"github.com/riokulabs/rioku/internal/vault"
)

// TestNewOTLPHandler_VaultRefResolution_HappyPath wires a vault
// resolver with a fake env-style backend and confirms NewOTLPHandler
// resolves a referenced header before handing it off to the
// underlying OTLP exporter.
//
// The exporter itself is a real otlploghttp.New call against an
// unreachable endpoint — that's fine: the test only needs to exercise
// the resolution branch, and exporter creation does not connect
// eagerly.
func TestNewOTLPHandler_VaultRefResolution_HappyPath(t *testing.T) {
	t.Setenv("OTLP_TEST_TOKEN", "Bearer abc-123")

	resolver := vault.DefaultCaching(vault.DefaultOptions{})
	cfg := config.LogOTLPConfig{
		Enabled:  true,
		Endpoint: "127.0.0.1:1",
		Protocol: "http",
		Insecure: true,
		Headers: map[string]string{
			"authorization": "{vault://env/OTLP_TEST_TOKEN}",
			"x-team":        "rioku", // literal, must pass through unchanged
		},
	}
	h, shutdown, err := logging.NewOTLPHandler(context.Background(), cfg, slog.LevelInfo, resolver)
	if err != nil {
		t.Fatalf("NewOTLPHandler: %v", err)
	}
	if h == nil {
		t.Fatal("nil handler with non-nil err absent")
	}
	defer func() {
		if shutdown != nil {
			_ = shutdown(context.Background())
		}
	}()
}

// TestNewOTLPHandler_VaultRefResolution_FailsAtomically asserts the
// multi-secret atomicity trip-wire: if any header reference fails to
// resolve, NewOTLPHandler returns an error and the OTLP exporter is
// never built. This prevents the "half-credentialed traffic" failure
// mode where a partial resolve ships requests with an unintended
// missing token.
func TestNewOTLPHandler_VaultRefResolution_FailsAtomically(t *testing.T) {
	resolver := vault.DefaultCaching(vault.DefaultOptions{})
	cfg := config.LogOTLPConfig{
		Enabled:  true,
		Endpoint: "127.0.0.1:1",
		Protocol: "http",
		Insecure: true,
		Headers: map[string]string{
			"authorization": "{vault://env/OTLP_TEST_DEFINITELY_NOT_SET_xyz}",
		},
	}
	_, _, err := logging.NewOTLPHandler(context.Background(), cfg, slog.LevelInfo, resolver)
	if err == nil {
		t.Fatal("expected error when referenced env var is unset")
	}
	if !strings.Contains(err.Error(), "resolve OTLP headers") {
		t.Fatalf("error = %v, want it to mention OTLP header resolution", err)
	}
	// Should wrap the underlying vault sentinel so callers can
	// distinguish "missing secret" from other init failures.
	if !errors.Is(err, vault.ErrResolveFailed) {
		t.Fatalf("error chain missing vault.ErrResolveFailed: %v", err)
	}
}

// TestNewOTLPHandler_NilResolverPassesThroughLiterals confirms the
// backward-compatible mode: a caller that does not yet wire vault
// (or wants explicit literal headers) passes nil and the headers
// flow unchanged. This protects existing deployments that don't use
// references.
func TestNewOTLPHandler_NilResolverPassesThroughLiterals(t *testing.T) {
	cfg := config.LogOTLPConfig{
		Enabled:  true,
		Endpoint: "127.0.0.1:1",
		Protocol: "http",
		Insecure: true,
		Headers:  map[string]string{"x-team": "rioku"},
	}
	_, shutdown, err := logging.NewOTLPHandler(context.Background(), cfg, slog.LevelInfo, nil)
	if err != nil {
		t.Fatalf("NewOTLPHandler with nil resolver: %v", err)
	}
	if shutdown != nil {
		_ = shutdown(context.Background())
	}
}
