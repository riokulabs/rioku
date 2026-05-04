// Package logging — per-route log sampling handler.
//
// SamplingHandler decorates an inner slog.Handler with a deterministic
// sample-by-request-id gate. When a record has a `log_sample_rate`
// attribute (float64 in [0.0, 1.0]) AND a `request_id` attribute (any
// stringable value), the handler hashes the request id and drops the
// record when the hash position falls outside the sample window. Records
// without those attributes pass through unchanged so non-route logs
// (boot, shutdown, periodic reports) are never silently dropped.
//
// Determinism matters: two log records for the same request — one from
// the access-log emitter, one from a downstream sink — must agree on
// keep-or-drop. We hash the request_id with FNV-1a (no need for crypto,
// we just want a uniform distribution), divide the hash space at
// rate * MaxUint64, and keep records whose hash sits below the cutoff.
//
// Wiring: SamplingHandler is layered AFTER RedactingHandler in the
// chain so a sampled-out record never reaches expensive downstream
// sinks (file IO, OTLP export). Per-route attribute population is the
// caller's responsibility — the slog record must carry log_sample_rate
// + request_id by the time it reaches this handler. A follow-up issue
// (#119 phase 2) adds the route → rate cache that populates these
// attributes from the daemon's request-handling pipeline.
package logging

import (
	"context"
	"hash/fnv"
	"log/slog"
	"math"
	"strconv"
)

// SamplingHandler drops a fraction of slog records based on per-record
// sampling attributes. Records without a `log_sample_rate` attribute
// pass through unchanged (full-rate is the safe default).
type SamplingHandler struct {
	inner slog.Handler
}

// NewSamplingHandler wraps inner with deterministic request-keyed
// sampling. inner must be non-nil.
func NewSamplingHandler(inner slog.Handler) *SamplingHandler {
	if inner == nil {
		panic("logging: NewSamplingHandler requires non-nil inner handler")
	}
	return &SamplingHandler{inner: inner}
}

// Enabled mirrors the inner handler — sampling is decided at Handle
// time, not Enabled time, since a record's request_id isn't known
// until we have the record itself.
func (h *SamplingHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

// Handle keeps or drops the record per the sampling decision and
// delegates to the inner handler when keeping. A record needs both
// log_sample_rate AND request_id attributes for a deterministic
// decision; missing either passes the record through unchanged so
// boot / shutdown / non-route logs are never silently dropped.
func (h *SamplingHandler) Handle(ctx context.Context, r slog.Record) error {
	rate, hasRate := extractSampleRate(r)
	if !hasRate {
		return h.inner.Handle(ctx, r)
	}
	requestID, hasID := extractRequestID(r)
	if !hasID {
		// No correlation key — fall through. Sampling without a
		// per-request id can't be deterministic, so we keep the
		// record rather than guess.
		return h.inner.Handle(ctx, r)
	}
	if !ShouldSample(requestID, rate) {
		return nil
	}
	return h.inner.Handle(ctx, r)
}

// WithAttrs delegates so pre-bound attrs are honoured downstream.
// Sampling state is per-record (request_id + rate live on each record),
// not per-handler-instance, so we don't need to inspect attrs here.
func (h *SamplingHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &SamplingHandler{inner: h.inner.WithAttrs(attrs)}
}

// WithGroup delegates without modification — sampling is a record-
// level decision and group nesting doesn't affect it.
func (h *SamplingHandler) WithGroup(name string) slog.Handler {
	return &SamplingHandler{inner: h.inner.WithGroup(name)}
}

// ShouldSample is the deterministic keep-or-drop primitive. Two
// callers passing the same requestID + rate get the same answer.
//
// Rate semantics:
//   - rate <= 0.0 → always drop (returns false)
//   - rate >= 1.0 → always keep (returns true)
//   - in between  → keep iff fnv1a(requestID) / MaxUint64 <= rate
//
// fnv1a is fine here — we're not defending against adversarial
// inputs, we just want a uniform distribution. Crypto hashes would
// be a few hundred ns slower per record for no gain.
func ShouldSample(requestID string, rate float64) bool {
	switch {
	case rate <= 0.0:
		return false
	case rate >= 1.0:
		return true
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(requestID))
	pos := float64(h.Sum64()) / float64(math.MaxUint64)
	return pos <= rate
}

// extractSampleRate scans the record's attributes for log_sample_rate.
// Returns (rate, true) when found, (0, false) otherwise. Float64,
// Float32, and string-formatted floats are all accepted to be tolerant
// of how upstream code attaches the attribute.
func extractSampleRate(r slog.Record) (float64, bool) {
	var (
		rate  float64
		found bool
	)
	r.Attrs(func(a slog.Attr) bool {
		if a.Key != "log_sample_rate" {
			return true
		}
		switch v := a.Value.Any().(type) {
		case float64:
			rate, found = v, true
		case float32:
			rate, found = float64(v), true
		case string:
			if parsed, err := strconv.ParseFloat(v, 64); err == nil {
				rate, found = parsed, true
			}
		}
		return !found
	})
	return rate, found
}

// extractRequestID scans the record for a request_id attribute. Any
// string-shaped value is acceptable.
func extractRequestID(r slog.Record) (string, bool) {
	var (
		id    string
		found bool
	)
	r.Attrs(func(a slog.Attr) bool {
		if a.Key != "request_id" {
			return true
		}
		s := a.Value.String()
		if s != "" {
			id, found = s, true
		}
		return !found
	})
	return id, found
}
