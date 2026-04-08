package gateway

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
)

// noopHandler is a do-nothing HTTP handler for benchmarking middleware overhead.
var noopHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

func BenchmarkRateLimiter_SingleCaller(b *testing.B) {
	rl := NewRateLimiter(config.RateLimitConfig{
		RequestsPerMinute: 100_000, // high limit to avoid 429s during bench
		ByIP:              true,
	})
	defer rl.Stop()

	handler := rl.Middleware()(noopHandler)
	req := httptest.NewRequest("GET", "/api/v1/routes", nil)
	req.RemoteAddr = "10.0.0.1:1234"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}
}

func BenchmarkRateLimiter_Concurrent10K(b *testing.B) {
	rl := NewRateLimiter(config.RateLimitConfig{
		RequestsPerMinute: 1_000_000,
		ByIP:              true,
	})
	defer rl.Stop()

	handler := rl.Middleware()(noopHandler)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		// Each goroutine gets a unique IP to test map contention with many keys.
		ip := fmt.Sprintf("10.0.%d.%d:1234", b.N%256, b.N%256)
		req := httptest.NewRequest("GET", "/api/v1/routes", nil)
		req.RemoteAddr = ip
		for pb.Next() {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
		}
	})
}

func BenchmarkRateLimiter_BySession(b *testing.B) {
	rl := NewRateLimiter(config.RateLimitConfig{
		RequestsPerMinute: 100_000,
		BySession:         true,
	})
	defer rl.Stop()

	handler := rl.Middleware()(noopHandler)

	// Inject session claims into context.
	claims := &auth.SessionClaims{
		SessionID: "bench-session-id",
		UserID:    "bench-user-id",
		Username:  "benchuser",
		Roles:     []string{"admin"},
		Scopes:    []string{"*"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("GET", "/api/v1/routes", nil)
		req = req.WithContext(auth.WithSessionClaims(req.Context(), claims))
		req.RemoteAddr = "10.0.0.1:1234"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}
}

func BenchmarkRateLimiter_Rejected(b *testing.B) {
	rl := NewRateLimiter(config.RateLimitConfig{
		RequestsPerMinute: 1, // immediately exhausted
		ByIP:              true,
	})
	defer rl.Stop()

	handler := rl.Middleware()(noopHandler)
	req := httptest.NewRequest("GET", "/api/v1/routes", nil)
	req.RemoteAddr = "10.0.0.1:1234"

	// Exhaust the limit.
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}
}

func BenchmarkExtractIP(b *testing.B) {
	b.Run("xff_single", func(b *testing.B) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("X-Forwarded-For", "203.0.113.50")
		for i := 0; i < b.N; i++ {
			extractIP(req)
		}
	})
	b.Run("xff_chain", func(b *testing.B) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("X-Forwarded-For", "203.0.113.50, 70.41.3.18, 150.172.238.178")
		for i := 0; i < b.N; i++ {
			extractIP(req)
		}
	})
	b.Run("remote_addr", func(b *testing.B) {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "203.0.113.50:48372"
		for i := 0; i < b.N; i++ {
			extractIP(req)
		}
	})
}
