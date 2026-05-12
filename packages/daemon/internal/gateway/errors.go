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

	"github.com/riokulabs/rioku/internal/logging"
	"github.com/riokulabs/rioku/internal/rerr"
)

// ProblemDetail and ValidationError are defined in the rerr package.
// These aliases keep existing gateway-internal call sites compiling without change.
type ProblemDetail = rerr.ProblemDetail
type ValidationError = rerr.ValidationError

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

// RequestIDMiddleware ensures every response has an X-Request-ID header
// and propagates the id (plus any W3C `traceparent`-derived trace id) into
// the request context so downstream slog calls can correlate by request.
//
// `X-Request-ID` is preserved if the client supplied one, otherwise
// generated as `req_<8 hex>`.
//
// `traceparent` is parsed per W3C Trace Context: the trace id is the second
// hyphen-delimited field, e.g.
//
//	traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
//	                ↑                                                   ↑
//	                version  trace-id                  parent-id  flags
//
// Malformed traceparent headers are silently ignored — we never want a bad
// header to break a request.
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = "req_" + uuid.New().String()[:8]
		}
		w.Header().Set("X-Request-ID", id)

		ctx := logging.WithRequestID(r.Context(), id)
		if tid := parseTraceparent(r.Header.Get("traceparent")); tid != "" {
			ctx = logging.WithTraceID(ctx, tid)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// parseTraceparent extracts the 32-hex-character trace id from a W3C
// traceparent header value. Returns "" for any malformed input.
func parseTraceparent(h string) string {
	if h == "" {
		return ""
	}
	// Format: <2-hex version>-<32-hex trace-id>-<16-hex parent-id>-<2-hex flags>
	// We accept anything that has the trace-id at the right offset.
	const traceIDStart = 3 // after "00-"
	const traceIDLen = 32
	if len(h) < traceIDStart+traceIDLen+1 {
		return ""
	}
	if h[2] != '-' || h[traceIDStart+traceIDLen] != '-' {
		return ""
	}
	tid := h[traceIDStart : traceIDStart+traceIDLen]
	for i := 0; i < traceIDLen; i++ {
		c := tid[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return ""
		}
	}
	// All-zeroes trace id is invalid per the W3C spec.
	allZero := true
	for i := 0; i < traceIDLen; i++ {
		if tid[i] != '0' {
			allZero = false
			break
		}
	}
	if allZero {
		return ""
	}
	return tid
}
