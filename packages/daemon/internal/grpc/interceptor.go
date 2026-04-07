package grpc

import (
	"context"
	"strings"

	"github.com/riokulabs/rioku/internal/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type claimsKey struct{}

// ClaimsFromContext extracts auth claims from a gRPC context.
func ClaimsFromContext(ctx context.Context) *auth.Claims {
	c, _ := ctx.Value(claimsKey{}).(*auth.Claims)
	return c
}

// skipAuthMethods are gRPC methods that don't require authentication.
var skipAuthMethods = map[string]bool{
	"/rioku.v1.HealthService/GetHealth":      true,
	"/rioku.v1.HealthService/GetCaddyStatus": true,
}

// UnaryAuthInterceptor returns a gRPC unary interceptor that validates
// Bearer tokens from the authorization metadata.
func UnaryAuthInterceptor(a *auth.Auth) grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		if skipAuthMethods[info.FullMethod] {
			return handler(ctx, req)
		}

		claims, err := extractAndValidate(ctx, a)
		if err != nil {
			return nil, err
		}

		ctx = context.WithValue(ctx, claimsKey{}, claims)
		return handler(ctx, req)
	}
}

// StreamAuthInterceptor returns a gRPC stream interceptor that validates
// Bearer tokens from the authorization metadata.
func StreamAuthInterceptor(a *auth.Auth) grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		if skipAuthMethods[info.FullMethod] {
			return handler(srv, ss)
		}

		claims, err := extractAndValidate(ss.Context(), a)
		if err != nil {
			return err
		}

		wrapped := &authStream{
			ServerStream: ss,
			ctx:          context.WithValue(ss.Context(), claimsKey{}, claims),
		}
		return handler(srv, wrapped)
	}
}

func extractAndValidate(ctx context.Context, a *auth.Auth) (*auth.Claims, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "missing metadata")
	}

	vals := md.Get("authorization")
	if len(vals) == 0 {
		return nil, status.Error(codes.Unauthenticated, "missing authorization header")
	}

	token := vals[0]
	if strings.HasPrefix(strings.ToLower(token), "bearer ") {
		token = token[7:]
	}

	claims, err := a.ValidateBearer(ctx, token)
	if err != nil {
		// Never leak internal auth error details to the client.
		return nil, status.Error(codes.Unauthenticated, "invalid or expired token")
	}

	return claims, nil
}

// authStream wraps a gRPC ServerStream to inject claims into the context.
type authStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *authStream) Context() context.Context {
	return s.ctx
}
