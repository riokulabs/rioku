package grpc

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// newTestAuth creates an Auth backed by a fresh SQLite store with migrations applied.
func newTestAuth(t *testing.T) (*auth.Auth, store.Driver) {
	t.Helper()
	ctx := context.Background()

	d, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	a := auth.NewAuth([]byte("test-key-32-bytes-long!!!!!!!!!!!"), d)
	return a, d
}

// incomingMD returns a context carrying the given metadata as incoming gRPC metadata.
func incomingMD(pairs ...string) context.Context {
	md := metadata.Pairs(pairs...)
	return metadata.NewIncomingContext(context.Background(), md)
}

// ---------------------------------------------------------------------------
// extractAndValidate tests
// ---------------------------------------------------------------------------

func TestExtractAndValidate_ValidToken(t *testing.T) {
	a, _ := newTestAuth(t)
	ctx := context.Background()

	pair, err := a.IssueTokenPair(ctx, "test-user", []string{"admin"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	mdCtx := incomingMD("authorization", "Bearer "+pair.AccessToken)
	claims, err := extractAndValidate(mdCtx, a)
	if err != nil {
		t.Fatalf("extractAndValidate returned error: %v", err)
	}
	if claims == nil {
		t.Fatal("claims is nil")
		return
	}
	if claims.Subject != "test-user" {
		t.Errorf("Subject = %q, want %q", claims.Subject, "test-user")
	}
	if len(claims.Roles) == 0 || claims.Roles[0] != "admin" {
		t.Errorf("Roles = %v, want [admin]", claims.Roles)
	}
}

func TestExtractAndValidate_BearerCaseInsensitive(t *testing.T) {
	a, _ := newTestAuth(t)
	ctx := context.Background()

	pair, err := a.IssueTokenPair(ctx, "user2", []string{"viewer"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	// Use lowercase "bearer " prefix — the implementation does case-insensitive stripping.
	mdCtx := incomingMD("authorization", "bearer "+pair.AccessToken)
	claims, err := extractAndValidate(mdCtx, a)
	if err != nil {
		t.Fatalf("extractAndValidate returned error: %v", err)
	}
	if claims.Subject != "user2" {
		t.Errorf("Subject = %q, want %q", claims.Subject, "user2")
	}
}

func TestExtractAndValidate_MissingHeader(t *testing.T) {
	a, _ := newTestAuth(t)

	// Context with metadata but no authorization key.
	mdCtx := incomingMD("content-type", "application/grpc")
	_, err := extractAndValidate(mdCtx, a)
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("error is not a gRPC status: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Errorf("Code = %v, want Unauthenticated", st.Code())
	}
}

func TestExtractAndValidate_NoMetadata(t *testing.T) {
	a, _ := newTestAuth(t)

	// Plain context with no incoming metadata at all.
	_, err := extractAndValidate(context.Background(), a)
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("error is not a gRPC status: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Errorf("Code = %v, want Unauthenticated", st.Code())
	}
}

func TestExtractAndValidate_InvalidToken(t *testing.T) {
	a, _ := newTestAuth(t)

	mdCtx := incomingMD("authorization", "Bearer not-a-valid-jwt-at-all")
	_, err := extractAndValidate(mdCtx, a)
	if err == nil {
		t.Fatal("expected error for invalid token, got nil")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("error is not a gRPC status: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Errorf("Code = %v, want Unauthenticated", st.Code())
	}
}

// ---------------------------------------------------------------------------
// ClaimsFromContext tests
// ---------------------------------------------------------------------------

func TestClaimsFromContext(t *testing.T) {
	want := &auth.Claims{
		Subject:   "alice",
		Roles:     []string{"admin", "viewer"},
		TokenType: "access",
	}

	ctx := context.WithValue(context.Background(), claimsKey{}, want)
	got := ClaimsFromContext(ctx)
	if got == nil {
		t.Fatal("ClaimsFromContext returned nil")
		return
	}
	if got.Subject != want.Subject {
		t.Errorf("Subject = %q, want %q", got.Subject, want.Subject)
	}
	if len(got.Roles) != len(want.Roles) {
		t.Errorf("Roles = %v, want %v", got.Roles, want.Roles)
	}
}

func TestClaimsFromContext_Empty(t *testing.T) {
	got := ClaimsFromContext(context.Background())
	if got != nil {
		t.Errorf("ClaimsFromContext(empty) = %v, want nil", got)
	}
}

func TestClaimsFromContext_WrongType(t *testing.T) {
	// A value stored under the key with the wrong type should return nil safely.
	ctx := context.WithValue(context.Background(), claimsKey{}, "not-a-claims-struct")
	got := ClaimsFromContext(ctx)
	if got != nil {
		t.Errorf("ClaimsFromContext(wrong type) = %v, want nil", got)
	}
}

// ---------------------------------------------------------------------------
// UnaryAuthInterceptor tests
// ---------------------------------------------------------------------------

func TestUnaryAuthInterceptor_SkipMethod(t *testing.T) {
	a, _ := newTestAuth(t)
	interceptor := UnaryAuthInterceptor(a)

	handlerCalled := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		handlerCalled = true
		return "ok", nil
	}

	for _, method := range []string{
		"/rioku.v1.HealthService/GetHealth",
		"/rioku.v1.HealthService/GetCaddyStatus",
	} {
		handlerCalled = false
		// No metadata — would fail auth if not skipped.
		_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{
			FullMethod: method,
		}, handler)
		if err != nil {
			t.Errorf("method %s: unexpected error: %v", method, err)
		}
		if !handlerCalled {
			t.Errorf("method %s: handler was not called", method)
		}
	}
}

func TestUnaryAuthInterceptor_WithToken(t *testing.T) {
	a, _ := newTestAuth(t)
	interceptor := UnaryAuthInterceptor(a)
	ctx := context.Background()

	pair, err := a.IssueTokenPair(ctx, "service-account", []string{"admin"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	var capturedCtx context.Context
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		capturedCtx = ctx
		return "result", nil
	}

	mdCtx := incomingMD("authorization", "Bearer "+pair.AccessToken)
	resp, err := interceptor(mdCtx, "request", &grpc.UnaryServerInfo{
		FullMethod: "/rioku.v1.ConfigService/GetConfig",
	}, handler)
	if err != nil {
		t.Fatalf("interceptor returned error: %v", err)
	}
	if resp != "result" {
		t.Errorf("resp = %v, want result", resp)
	}

	claims := ClaimsFromContext(capturedCtx)
	if claims == nil {
		t.Fatal("claims not injected into handler context")
		return
	}
	if claims.Subject != "service-account" {
		t.Errorf("claims.Subject = %q, want %q", claims.Subject, "service-account")
	}
}

func TestUnaryAuthInterceptor_MissingToken(t *testing.T) {
	a, _ := newTestAuth(t)
	interceptor := UnaryAuthInterceptor(a)

	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		t.Error("handler should not be called when auth fails")
		return nil, nil
	}

	_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{
		FullMethod: "/rioku.v1.ConfigService/GetConfig",
	}, handler)
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("error is not a gRPC status: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Errorf("Code = %v, want Unauthenticated", st.Code())
	}
}

// ---------------------------------------------------------------------------
// StreamAuthInterceptor tests
// ---------------------------------------------------------------------------

// mockServerStream is a minimal grpc.ServerStream for testing.
type mockServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (m *mockServerStream) Context() context.Context { return m.ctx }

func TestStreamAuthInterceptor_SkipMethod(t *testing.T) {
	a, _ := newTestAuth(t)
	interceptor := StreamAuthInterceptor(a)

	handlerCalled := false
	handler := func(srv interface{}, stream grpc.ServerStream) error {
		handlerCalled = true
		return nil
	}

	// No metadata — would fail auth if not skipped.
	stream := &mockServerStream{ctx: context.Background()}
	err := interceptor(nil, stream, &grpc.StreamServerInfo{
		FullMethod: "/rioku.v1.HealthService/GetHealth",
	}, handler)
	if err != nil {
		t.Fatalf("unexpected error for skipped method: %v", err)
	}
	if !handlerCalled {
		t.Error("handler was not called for skipped method")
	}
}

func TestStreamAuthInterceptor_WithToken(t *testing.T) {
	a, _ := newTestAuth(t)
	interceptor := StreamAuthInterceptor(a)
	ctx := context.Background()

	pair, err := a.IssueTokenPair(ctx, "stream-user", []string{"viewer"})
	if err != nil {
		t.Fatalf("IssueTokenPair: %v", err)
	}

	var capturedCtx context.Context
	handler := func(srv interface{}, stream grpc.ServerStream) error {
		capturedCtx = stream.Context()
		return nil
	}

	mdCtx := incomingMD("authorization", "Bearer "+pair.AccessToken)
	stream := &mockServerStream{ctx: mdCtx}
	err = interceptor(nil, stream, &grpc.StreamServerInfo{
		FullMethod: "/rioku.v1.TrafficService/StreamTraces",
	}, handler)
	if err != nil {
		t.Fatalf("interceptor returned error: %v", err)
	}

	claims := ClaimsFromContext(capturedCtx)
	if claims == nil {
		t.Fatal("claims not injected into stream context")
		return
	}
	if claims.Subject != "stream-user" {
		t.Errorf("claims.Subject = %q, want %q", claims.Subject, "stream-user")
	}
}

func TestStreamAuthInterceptor_MissingToken(t *testing.T) {
	a, _ := newTestAuth(t)
	interceptor := StreamAuthInterceptor(a)

	handler := func(srv interface{}, stream grpc.ServerStream) error {
		t.Error("handler should not be called when auth fails")
		return nil
	}

	stream := &mockServerStream{ctx: context.Background()}
	err := interceptor(nil, stream, &grpc.StreamServerInfo{
		FullMethod: "/rioku.v1.TrafficService/StreamTraces",
	}, handler)
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("error is not a gRPC status: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Errorf("Code = %v, want Unauthenticated", st.Code())
	}
}

// ---------------------------------------------------------------------------
// authStream.Context test
// ---------------------------------------------------------------------------

func TestAuthStream_Context(t *testing.T) {
	inner := &mockServerStream{ctx: context.Background()}
	injectedCtx := context.WithValue(context.Background(), claimsKey{}, &auth.Claims{Subject: "s"})
	wrapped := &authStream{
		ServerStream: inner,
		ctx:          injectedCtx,
	}

	if wrapped.Context() != injectedCtx {
		t.Error("authStream.Context() did not return the injected context")
	}
}
