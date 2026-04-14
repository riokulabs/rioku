package logging

import (
	"bytes"
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
	lv, err := Setup(cfg)
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
	lv, err := Setup(cfg)
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
	_, err := Setup(cfg)
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
	_, err := Setup(cfg)
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
	_, err := Setup(cfg)
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
	_, err := Setup(cfg)
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
	_, err := Setup(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		t.Error("log file was not created")
	}
}

func TestSetupRuntimeLevelChange(t *testing.T) {
	cfg := config.LoggingConfig{
		Level:  "error",
		Format: "json",
		Output: "stderr",
	}
	lv, err := Setup(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if slog.Default().Enabled(nil, slog.LevelInfo) {
		t.Error("INFO should be disabled at ERROR level")
	}
	lv.Set(slog.LevelDebug)
	if !slog.Default().Enabled(nil, slog.LevelInfo) {
		t.Error("INFO should be enabled after changing to DEBUG")
	}
}
