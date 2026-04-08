package gateway

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
)

// RateLimiter implements an in-memory sliding window rate limiter.
type RateLimiter struct {
	mu      sync.Mutex
	windows map[string]*window
	config  config.RateLimitConfig
	done    chan struct{}
}

type window struct {
	count   int
	resetAt time.Time
}

// NewRateLimiter creates a rate limiter with the given configuration and
// starts a background goroutine to sweep expired windows every 5 minutes.
func NewRateLimiter(cfg config.RateLimitConfig) *RateLimiter {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config:  cfg,
		done:    make(chan struct{}),
	}
	go rl.cleanup()
	return rl
}

// Stop terminates the background cleanup goroutine.
func (rl *RateLimiter) Stop() {
	close(rl.done)
}

// cleanup sweeps expired windows every 5 minutes.
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-rl.done:
			return
		case now := <-ticker.C:
			rl.mu.Lock()
			for key, w := range rl.windows {
				if now.After(w.resetAt) {
					delete(rl.windows, key)
				}
			}
			rl.mu.Unlock()
		}
	}
}

// Middleware returns HTTP middleware that rate-limits requests. Keying is based
// on the RateLimitConfig: IP (from X-Forwarded-For or RemoteAddr), session ID,
// or user ID.
func (rl *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if rl.config.RequestsPerMinute <= 0 {
				next.ServeHTTP(w, r)
				return
			}

			key := rl.extractKey(r)
			now := time.Now()
			limit := rl.config.RequestsPerMinute

			rl.mu.Lock()
			win, ok := rl.windows[key]
			if !ok || now.After(win.resetAt) {
				// Window expired or doesn't exist — start a new one.
				win = &window{
					count:   0,
					resetAt: now.Add(time.Minute),
				}
				rl.windows[key] = win
			}

			if win.count >= limit {
				retryAfter := int(time.Until(win.resetAt).Seconds()) + 1
				rl.mu.Unlock()

				w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(win.resetAt.Unix(), 10))
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(http.StatusTooManyRequests)
				json.NewEncoder(w).Encode(ProblemDetail{
					Type:     errTypeRateLimit,
					Title:    "Rate limit exceeded",
					Status:   429,
					Detail:   "Too many requests. Please wait before retrying.",
					Instance: r.URL.Path,
				})
				return
			}

			win.count++
			remaining := limit - win.count
			resetAt := win.resetAt
			rl.mu.Unlock()

			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetAt.Unix(), 10))

			next.ServeHTTP(w, r)
		})
	}
}

// extractKey determines the rate limit key from the request based on config
// precedence: user ID > session ID > IP.
func (rl *RateLimiter) extractKey(r *http.Request) string {
	ctx := r.Context()

	// Prefer user ID if configured.
	if rl.config.ByUser {
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil && sc.UserID != "" {
			return "user:" + sc.UserID
		}
		if c := auth.ClaimsFromContext(ctx); c != nil && c.Subject != "" {
			return "user:" + c.Subject
		}
	}

	// Session ID.
	if rl.config.BySession {
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil && sc.SessionID != "" {
			return "session:" + sc.SessionID
		}
	}

	// IP (default fallback, or explicit ByIP).
	return "ip:" + extractIP(r)
}

// extractIP returns the client IP from X-Forwarded-For or RemoteAddr.
func extractIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// X-Forwarded-For may contain "client, proxy1, proxy2".
		if idx := strings.IndexByte(xff, ','); idx != -1 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}
	// Fall back to RemoteAddr (host:port).
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
