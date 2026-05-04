// Package grpc — logging-context interceptors.
//
// Mirrors the HTTP RequestIDMiddleware: every gRPC call (unary + stream)
// gets a request_id (from `x-request-id` metadata if present, otherwise
// generated) and an optional trace_id (from W3C `traceparent` metadata)
// stashed into the call context, so downstream slog.*Context calls can
// correlate.
package grpc

import (
	"context"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/riokulabs/rioku/internal/logging"
)

const (
	mdRequestID   = "x-request-id"
	mdTraceparent = "traceparent"
)

// UnaryLoggingInterceptor returns a unary interceptor that injects a
// request_id (and optional trace_id) into the call context.
func UnaryLoggingInterceptor() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		_ *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		return handler(injectIDs(ctx), req)
	}
}

// StreamLoggingInterceptor returns a stream interceptor that injects a
// request_id (and optional trace_id) into the call context.
func StreamLoggingInterceptor() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		_ *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		wrapped := &loggingStream{
			ServerStream: ss,
			ctx:          injectIDs(ss.Context()),
		}
		return handler(srv, wrapped)
	}
}

// injectIDs reads request-id / traceparent from incoming metadata, ensures
// a request id exists (generated if absent), and returns a child context
// with the values stashed via the logging package's helpers.
func injectIDs(ctx context.Context) context.Context {
	md, _ := metadata.FromIncomingContext(ctx)

	id := firstMD(md, mdRequestID)
	if id == "" {
		id = "req_" + uuid.New().String()[:8]
	}
	ctx = logging.WithRequestID(ctx, id)

	if tp := firstMD(md, mdTraceparent); tp != "" {
		if tid := parseTraceparent(tp); tid != "" {
			ctx = logging.WithTraceID(ctx, tid)
		}
	}
	return ctx
}

func firstMD(md metadata.MD, key string) string {
	if md == nil {
		return ""
	}
	vals := md.Get(key)
	if len(vals) == 0 {
		return ""
	}
	return vals[0]
}

// parseTraceparent extracts the 32-hex-char trace id from a W3C traceparent
// header value. Duplicated here (rather than imported from gateway) because
// the gateway package depends on grpc transitively — keeping this lean
// avoids an import cycle. Behaviour matches gateway.parseTraceparent.
func parseTraceparent(h string) string {
	const traceIDStart = 3
	const traceIDLen = 32
	if len(h) < traceIDStart+traceIDLen+1 {
		return ""
	}
	if h[2] != '-' || h[traceIDStart+traceIDLen] != '-' {
		return ""
	}
	tid := h[traceIDStart : traceIDStart+traceIDLen]
	allZero := true
	for i := 0; i < traceIDLen; i++ {
		c := tid[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return ""
		}
		if c != '0' {
			allZero = false
		}
	}
	if allZero {
		return ""
	}
	return tid
}

// loggingStream wraps a gRPC ServerStream so the downstream handler sees
// the context with our injected attributes.
type loggingStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *loggingStream) Context() context.Context {
	return s.ctx
}
