package gateway

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ProblemDetail implements RFC 7807 Problem Details for HTTP APIs.
type ProblemDetail struct {
	Type     string            `json:"type"`
	Title    string            `json:"title"`
	Status   int               `json:"status"`
	Detail   string            `json:"detail"`
	Instance string            `json:"instance"`
	Errors   []ValidationError `json:"errors,omitempty"`
}

// ValidationError represents a single field-level validation error.
type ValidationError struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
	Value  any    `json:"value,omitempty"`
}

// Error type URIs.
const (
	errTypeValidation = "https://rioku.dev/errors/validation-failed"
	errTypeUnauth     = "https://rioku.dev/errors/unauthenticated"
	errTypeForbidden  = "https://rioku.dev/errors/forbidden"
	errTypeNotFound   = "https://rioku.dev/errors/not-found"
	errTypeConflict   = "https://rioku.dev/errors/version-conflict"
	errTypeInternal   = "https://rioku.dev/errors/internal"
	errTypeUnavail    = "https://rioku.dev/errors/unavailable"
	errTypeRateLimit  = "https://rioku.dev/errors/rate-limited"
	errTypeUnprocess  = "https://rioku.dev/errors/unprocessable"
	errTypeBadGateway = "https://rioku.dev/errors/bad-gateway"
	errTypeTimeout    = "https://rioku.dev/errors/gateway-timeout"
	errTypeLocked     = "https://rioku.dev/errors/account-locked"
)

// grpcToHTTP maps gRPC status codes to HTTP status + problem type.
var grpcToHTTP = map[codes.Code]struct {
	status int
	typ    string
	title  string
}{
	codes.InvalidArgument:    {400, errTypeValidation, "Validation failed"},
	codes.Unauthenticated:    {401, errTypeUnauth, "Authentication required"},
	codes.PermissionDenied:   {403, errTypeForbidden, "Permission denied"},
	codes.NotFound:           {404, errTypeNotFound, "Resource not found"},
	codes.AlreadyExists:      {409, errTypeConflict, "Resource conflict"},
	codes.FailedPrecondition: {409, errTypeConflict, "Precondition failed"},
	codes.ResourceExhausted:  {429, errTypeRateLimit, "Rate limit exceeded"},
	codes.Internal:           {500, errTypeInternal, "Internal server error"},
	codes.Unavailable:        {503, errTypeUnavail, "Service unavailable"},
	codes.DeadlineExceeded:   {504, errTypeTimeout, "Gateway timeout"},
}

// ErrorHandler is a custom grpc-gateway error handler that produces
// RFC 7807 Problem Details responses.
func ErrorHandler(ctx context.Context, mux *runtime.ServeMux, _ runtime.Marshaler, w http.ResponseWriter, r *http.Request, err error) {
	requestID := getOrCreateRequestID(r, w)

	st, _ := status.FromError(err)
	code := st.Code()

	mapping, ok := grpcToHTTP[code]
	if !ok {
		mapping = grpcToHTTP[codes.Internal]
	}

	problem := ProblemDetail{
		Type:     mapping.typ,
		Title:    mapping.title,
		Status:   mapping.status,
		Instance: r.URL.Path,
	}

	// For 5xx: sanitize — never expose internal details to the client.
	if mapping.status >= 500 {
		slog.Error("request failed",
			"component", "gateway",
			"path", r.URL.Path,
			"error", st.Message(),
			"request_id", requestID,
			"method", r.Method,
			"remote_addr", r.RemoteAddr)
		problem.Detail = "An unexpected error occurred. Reference: " + requestID
	} else {
		// 4xx: include the full error detail.
		problem.Detail = st.Message()
		slog.Warn("client error",
			"component", "gateway",
			"path", r.URL.Path,
			"status", mapping.status,
			"error", st.Message(),
			"request_id", requestID,
			"method", r.Method,
			"remote_addr", r.RemoteAddr)
	}

	// Add required response headers per RFC.
	if mapping.status == 401 {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	if mapping.status == 429 || mapping.status == 503 {
		w.Header().Set("Retry-After", "5")
	}

	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(mapping.status)
	_ = json.NewEncoder(w).Encode(problem)
}

// getOrCreateRequestID returns the X-Request-ID from the request or generates one.
func getOrCreateRequestID(r *http.Request, w http.ResponseWriter) string {
	id := r.Header.Get("X-Request-ID")
	if id == "" {
		id = "req_" + uuid.New().String()[:8]
	}
	w.Header().Set("X-Request-ID", id)
	return id
}

// RequestIDMiddleware ensures every response has an X-Request-ID header.
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = "req_" + uuid.New().String()[:8]
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r)
	})
}
