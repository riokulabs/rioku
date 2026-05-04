// Package logging — OTLP log shipping.
//
// Wraps go.opentelemetry.io/otel/sdk/log to convert slog records
// into OTel log records for export. OTLPHandler implements slog.Handler
// so it can be installed as a multi-handler alongside the
// existing stderr/file output.
package logging

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	otlploggrpc "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	otlploghttp "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/log/global"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"

	"github.com/riokulabs/rioku/internal/config"
)

// OTLPHandler is an slog.Handler that forwards records to the OTel
// LoggerProvider. Used in tandem with the existing stderr/file
// handler so logs reach both destinations.
type OTLPHandler struct {
	logger   log.Logger
	minLevel slog.Level
	provider *sdklog.LoggerProvider // for Shutdown
}

// SecretResolver is the narrow surface NewOTLPHandler uses to resolve
// vault references in the OTLP Headers map. *vault.Resolver and
// *vault.CachingResolver both satisfy this interface; callers that
// don't need ref resolution may pass nil and the literal Headers
// values are sent unchanged.
type SecretResolver interface {
	ResolveAll(ctx context.Context, values map[string]string) (map[string]string, error)
}

// NewOTLPHandler builds an OTLP-shipping slog handler from the given
// config. Returns the handler plus a Shutdown function the caller
// should defer/run on daemon stop.
//
// When resolver is non-nil, every value in cfg.Headers is interpreted
// as a vault reference (when it matches the {vault://...} shape) and
// resolved before the OTLP exporter sees it. A literal value passes
// through unchanged. Per D12, the resolved plaintext is held only in
// the exporter's in-memory option list — it is never logged, audited,
// or written back to the config file.
func NewOTLPHandler(ctx context.Context, cfg config.LogOTLPConfig, level slog.Level, resolver SecretResolver) (*OTLPHandler, func(context.Context) error, error) {
	if !cfg.Enabled {
		return nil, nil, fmt.Errorf("logging: OTLP not enabled")
	}
	if cfg.Endpoint == "" {
		return nil, nil, fmt.Errorf("logging: OTLP endpoint is required")
	}

	// Resolve vault refs in Headers if a resolver is wired. All-or-
	// nothing semantics from vault.Resolver.ResolveAll: a single
	// missing ref fails the whole OTLP init rather than shipping
	// half-credentialed traffic.
	headers := cfg.Headers
	if resolver != nil && len(headers) > 0 {
		resolved, err := resolver.ResolveAll(ctx, headers)
		if err != nil {
			return nil, nil, fmt.Errorf("logging: resolve OTLP headers: %w", err)
		}
		headers = resolved
	}

	// Build the exporter.
	var exporter sdklog.Exporter
	var err error
	switch cfg.Protocol {
	case "", "http", "http/protobuf":
		opts := []otlploghttp.Option{otlploghttp.WithEndpoint(cfg.Endpoint)}
		if cfg.Insecure {
			opts = append(opts, otlploghttp.WithInsecure())
		}
		if len(headers) > 0 {
			opts = append(opts, otlploghttp.WithHeaders(headers))
		}
		exporter, err = otlploghttp.New(ctx, opts...)
	case "grpc":
		opts := []otlploggrpc.Option{otlploggrpc.WithEndpoint(cfg.Endpoint)}
		if cfg.Insecure {
			opts = append(opts, otlploggrpc.WithInsecure())
		}
		if len(headers) > 0 {
			opts = append(opts, otlploggrpc.WithHeaders(headers))
		}
		exporter, err = otlploggrpc.New(ctx, opts...)
	default:
		return nil, nil, fmt.Errorf("logging: invalid OTLP protocol %q", cfg.Protocol)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("logging: build OTLP exporter: %w", err)
	}

	// Build the resource.
	serviceName := cfg.ServiceName
	if serviceName == "" {
		serviceName = "rioku-daemon"
	}
	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(serviceName)),
	)
	if err != nil {
		_ = exporter.Shutdown(ctx)
		return nil, nil, fmt.Errorf("logging: build OTel resource: %w", err)
	}

	// Build the LoggerProvider.
	provider := sdklog.NewLoggerProvider(
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
		sdklog.WithResource(res),
	)
	global.SetLoggerProvider(provider)

	return &OTLPHandler{
		logger:   provider.Logger("rioku/daemon/logging"),
		minLevel: level,
		provider: provider,
	}, provider.Shutdown, nil
}

// Enabled implements slog.Handler.
func (h *OTLPHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.minLevel
}

// Handle implements slog.Handler. Converts the slog.Record to an
// OTel log.Record and emits it.
func (h *OTLPHandler) Handle(ctx context.Context, r slog.Record) error {
	var rec log.Record
	rec.SetTimestamp(r.Time)
	rec.SetObservedTimestamp(time.Now())
	rec.SetSeverity(slogLevelToOtel(r.Level))
	rec.SetSeverityText(r.Level.String())
	rec.SetBody(log.StringValue(r.Message))

	// Copy attributes.
	r.Attrs(func(a slog.Attr) bool {
		rec.AddAttributes(slogAttrToOtel(a))
		return true
	})

	h.logger.Emit(ctx, rec)
	return nil
}

// WithAttrs implements slog.Handler.
func (h *OTLPHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	// Pre-build a set of OTel KeyValues from the attrs so they are
	// attached on every subsequent Handle call.
	kvs := make([]log.KeyValue, 0, len(attrs))
	for _, a := range attrs {
		kvs = append(kvs, slogAttrToOtel(a))
	}
	return &otlpHandlerWithAttrs{
		OTLPHandler: h,
		preAttrs:    kvs,
	}
}

// WithGroup implements slog.Handler.
func (h *OTLPHandler) WithGroup(name string) slog.Handler {
	// Groups are honoured by prepending the group name to attribute keys.
	return &otlpHandlerWithGroup{
		OTLPHandler: h,
		group:       name,
	}
}

// otlpHandlerWithAttrs is a variant of OTLPHandler that carries pre-computed
// attributes from a WithAttrs call.
type otlpHandlerWithAttrs struct {
	*OTLPHandler
	preAttrs []log.KeyValue
}

func (h *otlpHandlerWithAttrs) Handle(ctx context.Context, r slog.Record) error {
	var rec log.Record
	rec.SetTimestamp(r.Time)
	rec.SetObservedTimestamp(time.Now())
	rec.SetSeverity(slogLevelToOtel(r.Level))
	rec.SetSeverityText(r.Level.String())
	rec.SetBody(log.StringValue(r.Message))
	rec.AddAttributes(h.preAttrs...)
	r.Attrs(func(a slog.Attr) bool {
		rec.AddAttributes(slogAttrToOtel(a))
		return true
	})
	h.logger.Emit(ctx, rec)
	return nil
}

func (h *otlpHandlerWithAttrs) WithAttrs(attrs []slog.Attr) slog.Handler {
	kvs := make([]log.KeyValue, len(h.preAttrs), len(h.preAttrs)+len(attrs))
	copy(kvs, h.preAttrs)
	for _, a := range attrs {
		kvs = append(kvs, slogAttrToOtel(a))
	}
	return &otlpHandlerWithAttrs{OTLPHandler: h.OTLPHandler, preAttrs: kvs}
}

func (h *otlpHandlerWithAttrs) WithGroup(name string) slog.Handler {
	return &otlpHandlerWithGroup{OTLPHandler: h.OTLPHandler, group: name}
}

// otlpHandlerWithGroup is a variant that prefixes attribute keys with a group.
type otlpHandlerWithGroup struct {
	*OTLPHandler
	group string
}

func (h *otlpHandlerWithGroup) Handle(ctx context.Context, r slog.Record) error {
	var rec log.Record
	rec.SetTimestamp(r.Time)
	rec.SetObservedTimestamp(time.Now())
	rec.SetSeverity(slogLevelToOtel(r.Level))
	rec.SetSeverityText(r.Level.String())
	rec.SetBody(log.StringValue(r.Message))
	r.Attrs(func(a slog.Attr) bool {
		kv := slogAttrToOtel(a)
		rec.AddAttributes(log.KeyValue{Key: h.group + "." + kv.Key, Value: kv.Value})
		return true
	})
	h.logger.Emit(ctx, rec)
	return nil
}

func (h *otlpHandlerWithGroup) WithAttrs(attrs []slog.Attr) slog.Handler {
	kvs := make([]log.KeyValue, 0, len(attrs))
	for _, a := range attrs {
		kv := slogAttrToOtel(a)
		kvs = append(kvs, log.KeyValue{Key: h.group + "." + kv.Key, Value: kv.Value})
	}
	return &otlpHandlerWithAttrs{OTLPHandler: h.OTLPHandler, preAttrs: kvs}
}

func (h *otlpHandlerWithGroup) WithGroup(name string) slog.Handler {
	return &otlpHandlerWithGroup{OTLPHandler: h.OTLPHandler, group: h.group + "." + name}
}

// slogLevelToOtel maps slog.Level to OTel's log severity numbers.
// Reference: https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
func slogLevelToOtel(l slog.Level) log.Severity {
	switch {
	case l < slog.LevelInfo:
		return log.SeverityDebug
	case l < slog.LevelWarn:
		return log.SeverityInfo
	case l < slog.LevelError:
		return log.SeverityWarn
	default:
		return log.SeverityError
	}
}

// slogAttrToOtel converts a slog.Attr to an OTel log.KeyValue.
func slogAttrToOtel(a slog.Attr) log.KeyValue {
	switch a.Value.Kind() {
	case slog.KindString:
		return log.String(a.Key, a.Value.String())
	case slog.KindInt64:
		return log.Int64(a.Key, a.Value.Int64())
	case slog.KindUint64:
		return log.Int64(a.Key, int64(a.Value.Uint64()))
	case slog.KindFloat64:
		return log.Float64(a.Key, a.Value.Float64())
	case slog.KindBool:
		return log.Bool(a.Key, a.Value.Bool())
	case slog.KindDuration:
		return log.String(a.Key, a.Value.Duration().String())
	case slog.KindTime:
		return log.String(a.Key, a.Value.Time().Format(time.RFC3339Nano))
	default:
		return log.String(a.Key, a.Value.String())
	}
}
