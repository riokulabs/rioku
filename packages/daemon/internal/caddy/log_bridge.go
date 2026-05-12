package caddy

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"time"
)

// caddyLogLine is the well-known Caddy JSON log shape.
type caddyLogLine struct {
	Level  string  `json:"level"`
	Ts     float64 `json:"ts"`
	Logger string  `json:"logger"`
	Msg    string  `json:"msg"`
}

// caddyLevel maps a Caddy log level string to an slog.Level.
// Caddy uses: debug, info, warn, error, panic, fatal.
func caddyLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error", "panic", "fatal":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// Bridge reads stdout and stderr from a Caddy subprocess line-by-line on
// separate goroutines and re-emits each line through log. It returns once
// both readers reach EOF or ctx is cancelled.
//
// Caddy JSON lines are parsed and re-emitted at the appropriate slog level
// with attrs subsystem=caddy and caddy_logger=<value>. Any remaining JSON
// fields are appended as slog.Any attrs. Non-JSON lines are emitted as INFO
// with msg "caddy raw output" and stream/line attrs.
func Bridge(ctx context.Context, stdout, stderr io.Reader, log *slog.Logger) {
	done := make(chan struct{}, 2)

	go func() {
		bridgeStream(ctx, stdout, "stdout", log)
		done <- struct{}{}
	}()
	go func() {
		bridgeStream(ctx, stderr, "stderr", log)
		done <- struct{}{}
	}()

	<-done
	<-done
}

// bridgeStream reads lines from r and emits them via log. stream is "stdout"
// or "stderr" and is used only for the non-JSON fallback message.
func bridgeStream(ctx context.Context, r io.Reader, stream string, log *slog.Logger) {
	scanner := bufio.NewScanner(r)
	for {
		// Stop if context is cancelled.
		select {
		case <-ctx.Done():
			return
		default:
		}

		if !scanner.Scan() {
			return
		}

		line := scanner.Text()
		emitLine(ctx, line, stream, log)
	}
}

// emitLine parses a single log line and emits it via log.
func emitLine(ctx context.Context, line, stream string, log *slog.Logger) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		// Non-JSON fallback.
		log.InfoContext(ctx, "caddy raw output",
			slog.String("stream", stream),
			slog.String("line", line),
		)
		return
	}

	// Extract known fields.
	var known caddyLogLine
	// Best-effort decode of known fields; ignore errors — raw map already confirmed valid JSON.
	_ = json.Unmarshal([]byte(line), &known)

	level := caddyLevel(known.Level)

	// Convert float ts (unix seconds) to time.Time.
	var t time.Time
	if known.Ts != 0 {
		sec := math.Trunc(known.Ts)
		nsec := (known.Ts - sec) * 1e9
		t = time.Unix(int64(sec), int64(nsec)).UTC()
	}

	// Build attrs: subsystem + caddy_logger + all remaining keys.
	attrs := make([]slog.Attr, 0, 2+len(raw))
	attrs = append(attrs,
		slog.String("subsystem", "caddy"),
		slog.String("caddy_logger", known.Logger),
	)
	if !t.IsZero() {
		attrs = append(attrs, slog.Time("ts", t))
	}

	// Flatten remaining fields (excluding the four known keys).
	skip := map[string]bool{"level": true, "ts": true, "logger": true, "msg": true}
	for k, v := range raw {
		if skip[k] {
			continue
		}
		// Decode the raw JSON value to a Go any for slog.Any.
		var val any
		if err := json.Unmarshal(v, &val); err != nil {
			// Keep as raw string on decode failure.
			attrs = append(attrs, slog.String(k, string(v)))
		} else {
			attrs = append(attrs, slog.Any(k, val))
		}
	}

	log.LogAttrs(ctx, level, known.Msg, attrs...)
}
