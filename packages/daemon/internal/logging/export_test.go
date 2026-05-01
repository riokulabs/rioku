// export_test.go exposes internal helpers for whitebox testing.
// This file is compiled only during tests.
package logging

import (
	"log/slog"

	otellog "go.opentelemetry.io/otel/log"
)

// SlogLevelToOtelExported re-exports slogLevelToOtel for tests.
func SlogLevelToOtelExported(l slog.Level) otellog.Severity {
	return slogLevelToOtel(l)
}

// SlogAttrToOtelExported re-exports slogAttrToOtel for tests.
func SlogAttrToOtelExported(a slog.Attr) otellog.KeyValue {
	return slogAttrToOtel(a)
}
