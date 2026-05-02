package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/config"
)

func TestSetupStderrJSON(t *testing.T) {
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "json",
		Output: "stderr",
	}
	lv, _, err := Setup(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if lv.Level() != slog.LevelInfo {
		t.Errorf("level = %v, want INFO", lv.Level())
	}
}

func TestSetupLevelFiltering(t *testing.T) {
	cfg := config.LoggingConfig{
		Level:  "warn",
		Format: "json",
		Output: "stderr",
	}
	lv, _, err := Setup(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if lv.Level() != slog.LevelWarn {
		t.Errorf("level = %v, want WARN", lv.Level())
	}
	lv.Set(slog.LevelDebug)
	if lv.Level() != slog.LevelDebug {
		t.Errorf("after Set: level = %v, want DEBUG", lv.Level())
	}
}

func TestSetupFileOutput(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "subdir", "test.log")
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "json",
		Output: "file",
		File:   config.LogFileConfig{Path: logPath},
	}
	_, _, err := Setup(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	slog.Info("test message", "key", "value")

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(bytes.TrimSpace(data)) {
		t.Errorf("log file content is not valid JSON: %s", data)
	}
	if !strings.Contains(string(data), "test message") {
		t.Errorf("log file missing expected message: %s", data)
	}
}

func TestSetupInvalidFormat(t *testing.T) {
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "xml",
		Output: "stderr",
	}
	_, _, err := Setup(cfg, nil)
	if err == nil {
		t.Error("expected error for invalid format")
	}
}

func TestSetupInvalidLevel(t *testing.T) {
	cfg := config.LoggingConfig{
		Level:  "trace",
		Format: "json",
		Output: "stderr",
	}
	_, _, err := Setup(cfg, nil)
	if err == nil {
		t.Error("expected error for invalid level")
	}
}

func TestSetupInvalidOutput(t *testing.T) {
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "json",
		Output: "syslog",
	}
	_, _, err := Setup(cfg, nil)
	if err == nil {
		t.Error("expected error for invalid output")
	}
}

func TestSetupFileCreatesDirectory(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "deep", "nested", "dir", "test.log")
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "json",
		Output: "file",
		File:   config.LogFileConfig{Path: logPath},
	}
	_, _, err := Setup(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		t.Error("log file was not created")
	}
}

func TestSetupJSONOutputFields(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "fields.log")
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "json",
		Output: "file",
		File:   config.LogFileConfig{Path: logPath},
	}
	_, _, err := Setup(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.Default().With("component", "test")
	logger.Info("hello world", "key", "value")

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	var entry map[string]interface{}
	if err := json.Unmarshal(bytes.TrimSpace(data), &entry); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	for _, field := range []string{"time", "level", "msg", "component", "key"} {
		if _, ok := entry[field]; !ok {
			t.Errorf("missing expected field %q in JSON output", field)
		}
	}
	if entry["msg"] != "hello world" {
		t.Errorf("msg = %v, want %q", entry["msg"], "hello world")
	}
	if entry["component"] != "test" {
		t.Errorf("component = %v, want %q", entry["component"], "test")
	}
}

func BenchmarkSlogStructured(b *testing.B) {
	dir := b.TempDir()
	logPath := filepath.Join(dir, "bench.log")
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "json",
		Output: "file",
		File:   config.LogFileConfig{Path: logPath},
	}
	if _, _, err := Setup(cfg, nil); err != nil {
		b.Fatal(err)
	}
	logger := slog.Default().With("component", "gateway")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		logger.Error("request failed",
			"path", "/api/v1/config",
			"error", "connection refused",
			"request_id", "req_abc123",
			"method", "GET",
			"remote_addr", "192.168.1.1:54321")
	}
}

func TestSetupRuntimeLevelChange(t *testing.T) {
	cfg := config.LoggingConfig{
		Level:  "error",
		Format: "json",
		Output: "stderr",
	}
	lv, _, err := Setup(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if slog.Default().Enabled(context.Background(), slog.LevelInfo) {
		t.Error("INFO should be disabled at ERROR level")
	}
	lv.Set(slog.LevelDebug)
	if !slog.Default().Enabled(context.Background(), slog.LevelInfo) {
		t.Error("INFO should be enabled after changing to DEBUG")
	}
}
