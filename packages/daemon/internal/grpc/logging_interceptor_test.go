package grpc

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/riokulabs/rioku/internal/logging"
)

func TestUnaryLoggingInterceptor_GeneratesRequestID(t *testing.T) {
	interceptor := UnaryLoggingInterceptor()
	var seenReq, seenTrace string
	handler := func(ctx context.Context, _ interface{}) (interface{}, error) {
		seenReq = logging.RequestIDFromContext(ctx)
		seenTrace = logging.TraceIDFromContext(ctx)
		return nil, nil
	}
	_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{}, handler)
	if err != nil {
		t.Fatalf("interceptor: %v", err)
	}
	if seenReq == "" {
		t.Error("expected generated request_id when none in metadata")
	}
	if seenTrace != "" {
		t.Errorf("trace_id should be empty, got %q", seenTrace)
	}
}

func TestUnaryLoggingInterceptor_PassesThroughHeaders(t *testing.T) {
	interceptor := UnaryLoggingInterceptor()
	var seenReq, seenTrace string
	handler := func(ctx context.Context, _ interface{}) (interface{}, error) {
		seenReq = logging.RequestIDFromContext(ctx)
		seenTrace = logging.TraceIDFromContext(ctx)
		return nil, nil
	}

	md := metadata.Pairs(
		"x-request-id", "req_supplied",
		"traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
	)
	ctx := metadata.NewIncomingContext(context.Background(), md)
	_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{}, handler)
	if err != nil {
		t.Fatalf("interceptor: %v", err)
	}
	if seenReq != "req_supplied" {
		t.Errorf("request_id passthrough failed: got %q", seenReq)
	}
	if seenTrace != "0af7651916cd43dd8448eb211c80319c" {
		t.Errorf("trace_id parse failed: got %q", seenTrace)
	}
}

func TestParseTraceparent(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", "0af7651916cd43dd8448eb211c80319c"},
		{"", ""},
		{"00-too-short", ""},
		{"00-0af7651916cd43dd8448eb211c80319G-b7ad6b7169203331-01", ""}, // non-hex char
		{"00-00000000000000000000000000000000-b7ad6b7169203331-01", ""}, // all-zero invalid
		{"abc", ""},
	}
	for _, tc := range cases {
		if got := parseTraceparent(tc.in); got != tc.want {
			t.Errorf("parseTraceparent(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
