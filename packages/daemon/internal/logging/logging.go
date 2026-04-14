// Package logging initialises the global slog logger for the daemon.
package logging

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/mattn/go-isatty"
	"github.com/riokulabs/rioku/internal/config"
)

// Setup initializes structured logging based on the provided config.
// Returns a LevelVar that can be used to change log level at runtime.
func Setup(cfg config.LoggingConfig) (*slog.LevelVar, error) {
	var level slog.Level
	switch cfg.Level {
	case "debug":
		level = slog.LevelDebug
	case "info":
		level = slog.LevelInfo
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		return nil, fmt.Errorf("invalid log level: %q", cfg.Level)
	}

	var lv slog.LevelVar
	lv.Set(level)

	var w io.Writer
	switch cfg.Output {
	case "stderr", "":
		w = os.Stderr
	case "file":
		f, err := openLogFile(cfg.File.Path)
		if err != nil {
			return nil, fmt.Errorf("open log file: %w", err)
		}
		w = f
	case "both":
		f, err := openLogFile(cfg.File.Path)
		if err != nil {
			fmt.Fprintf(os.Stderr, "WARNING: could not open log file %s: %v (using stderr only)\n", cfg.File.Path, err)
			w = os.Stderr
		} else {
			w = &resilientMultiWriter{primary: os.Stderr, secondary: f}
		}
	default:
		return nil, fmt.Errorf("invalid log output: %q", cfg.Output)
	}

	opts := &slog.HandlerOptions{Level: &lv}
	var handler slog.Handler
	switch cfg.Format {
	case "auto", "":
		if isatty.IsTerminal(os.Stderr.Fd()) || isatty.IsCygwinTerminal(os.Stderr.Fd()) {
			handler = slog.NewTextHandler(w, opts)
		} else {
			handler = slog.NewJSONHandler(w, opts)
		}
	case "json":
		handler = slog.NewJSONHandler(w, opts)
	case "text":
		handler = slog.NewTextHandler(w, opts)
	default:
		return nil, fmt.Errorf("invalid log format: %q", cfg.Format)
	}

	slog.SetDefault(slog.New(handler))
	return &lv, nil
}

func openLogFile(path string) (*os.File, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return nil, fmt.Errorf("create log directory %s: %w", dir, err)
	}
	return os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0640)
}

type resilientMultiWriter struct {
	primary   io.Writer
	secondary io.Writer
	failCount atomic.Int64
}

func (w *resilientMultiWriter) Write(p []byte) (n int, err error) {
	n, err = w.primary.Write(p)
	if _, secErr := w.secondary.Write(p); secErr != nil {
		if w.failCount.Add(1)%1000 == 1 {
			fmt.Fprintf(w.primary, "WARNING: log file write failed: %v (suppressing further warnings)\n", secErr)
		}
	}
	return n, err
}
