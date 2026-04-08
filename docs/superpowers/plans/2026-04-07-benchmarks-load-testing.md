# Implementation Plan: Benchmarks and Load Testing (Plan 4 of 4)

**Date**: 2026-04-07
**Spec**: `contrib-docs/design/testing-infrastructure.md` (Part 5: Go Performance Testing)
**Branch**: `feat/benchmarks-load-testing`
**Estimated tasks**: 7 | **Estimated steps**: 42

---

## Task 1: Auth Benchmark Suite

**Priority**: Highest — auth functions are in the critical request path
**File**: `packages/daemon/internal/auth/auth_bench_test.go`
**Depends on**: Nothing (existing code only)

### Step 1.1: Create auth benchmark file with package header and imports

```go
// File: packages/daemon/internal/auth/auth_bench_test.go
package auth

import (
	"context"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/store/sqlite"
)
```

### Step 1.2: Benchmark `HashPassword` — confirm ~300ms, detect regressions

This is the single most expensive auth operation. If argon2id params change, this catches it.

```go
func BenchmarkHashPassword(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_, err := HashPassword("BenchmarkP@ssword123!")
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

**Expected**: ~300ms/op on modern hardware. The benchmark count will be low (b.N ~4-5 for 1s).

### Step 1.3: Benchmark `VerifyPassword` — constant-time verification

```go
func BenchmarkVerifyPassword(b *testing.B) {
	hash, err := HashPassword("BenchmarkP@ssword123!")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := VerifyPassword("BenchmarkP@ssword123!", hash)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

### Step 1.4: Benchmark `ComputeFingerprint` — pure CPU, no I/O

```go
func BenchmarkComputeFingerprint(b *testing.B) {
	ua := "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/128.0"
	al := "en-US,en;q=0.9"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ComputeFingerprint(ua, al)
	}
}
```

**Expected**: <1us/op (SHA-256 of short string).

### Step 1.5: Benchmark JWT sign and verify

```go
func BenchmarkJWTSign(b *testing.B) {
	key := make([]byte, 32)
	rand.Read(key)
	// Auth needs a store for refresh tokens, but sign() doesn't touch store.
	// Use the exported IssueTokenPair approach with a real SQLite store.
	st := benchSQLiteStore(b)
	a := NewAuth(key, st)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := a.IssueTokenPair(context.Background(), "bench-user", []string{"admin"})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkJWTVerify(b *testing.B) {
	key := make([]byte, 32)
	rand.Read(key)
	st := benchSQLiteStore(b)
	a := NewAuth(key, st)

	pair, err := a.IssueTokenPair(context.Background(), "bench-user", []string{"admin"})
	if err != nil {
		b.Fatal(err)
	}
	token := pair.AccessToken

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := a.ValidateAccessToken(token)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

**Expected**: Sign ~5-10us/op (HMAC-SHA256 + JSON marshal). Verify ~3-7us/op.

### Step 1.6: Benchmark TOTP code computation and validation

```go
func BenchmarkComputeTOTPCode(b *testing.B) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		b.Fatal(err)
	}
	now := time.Now()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := ComputeTOTPCode(secret, now)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkValidateTOTPCode(b *testing.B) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		b.Fatal(err)
	}
	now := time.Now()
	code, err := ComputeTOTPCode(secret, now)
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ValidateTOTPCode(secret, code, now)
	}
}
```

**Expected**: ComputeTOTP ~2-5us/op (HMAC-SHA1). ValidateTOTP ~6-15us/op (3-window check).

### Step 1.7: Benchmark AES-256-GCM encrypt/decrypt

```go
func BenchmarkEncryptField(b *testing.B) {
	key := make([]byte, 32)
	rand.Read(key)
	enc, err := NewEncryptor(key)
	if err != nil {
		b.Fatal(err)
	}
	plaintext := "JBSWY3DPEHPK3PXP" // typical TOTP secret length
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := enc.Encrypt(plaintext)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkDecryptField(b *testing.B) {
	key := make([]byte, 32)
	rand.Read(key)
	enc, err := NewEncryptor(key)
	if err != nil {
		b.Fatal(err)
	}
	ciphertext, err := enc.Encrypt("JBSWY3DPEHPK3PXP")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := enc.Decrypt(ciphertext)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

**Expected**: <1us/op each (AES-NI hardware acceleration).

### Step 1.8: Benchmark session validation — cache hit path (hot path)

This is the most performance-critical benchmark. Every authenticated request hits this.

```go
func BenchmarkSessionValidate_CacheHit(b *testing.B) {
	st := benchSQLiteStore(b)
	sm := NewSessionManager(st, true)
	ctx := context.Background()

	// Create a test user and session via the store.
	userID := benchCreateUser(b, st)
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("User-Agent", "BenchAgent")
	req.Header.Set("Accept-Language", "en-US")
	req.RemoteAddr = "127.0.0.1:12345"

	sess, err := sm.CreateSession(ctx, userID, req)
	if err != nil {
		b.Fatal(err)
	}

	// First validate populates cache.
	_, err = sm.ValidateSession(ctx, sess.ID, req)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := sm.ValidateSession(ctx, sess.ID, req)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

**Expected**: <1us/op (LRU map lookup + fingerprint check, no DB).

### Step 1.9: Benchmark session validation — cache miss path

```go
func BenchmarkSessionValidate_CacheMiss(b *testing.B) {
	st := benchSQLiteStore(b)
	sm := NewSessionManager(st, true)
	ctx := context.Background()

	userID := benchCreateUser(b, st)
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("User-Agent", "BenchAgent")
	req.Header.Set("Accept-Language", "en-US")
	req.RemoteAddr = "127.0.0.1:12345"

	sess, err := sm.CreateSession(ctx, userID, req)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Evict from cache before each validation to force DB path.
		sm.cache.Delete(sess.ID)
		_, err := sm.ValidateSession(ctx, sess.ID, req)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

**Expected**: ~20-50us/op (SQLite read + RBAC resolution).

### Step 1.10: Benchmark `LoadUserScopes` with multiple roles

```go
func BenchmarkLoadUserScopes(b *testing.B) {
	st := benchSQLiteStore(b)
	ctx := context.Background()

	userID := benchCreateUserWithRoles(b, st, 5, 20) // 5 roles x 20 perms each

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, err := LoadUserScopes(ctx, st, userID)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

### Step 1.11: Benchmark `HasPermission` with wildcard scopes

```go
func BenchmarkHasPermission(b *testing.B) {
	claims := &SessionClaims{
		Scopes: []string{
			"config:read", "config:write", "users:*", "audit:read",
			"sessions:read", "sessions:revoke", "keys:read", "keys:create",
			"routes:read", "routes:write", "services:read", "services:write",
		},
	}
	b.Run("direct_match", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			claims.HasPermission("config:read")
		}
	})
	b.Run("wildcard_match", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			claims.HasPermission("users:create")
		}
	})
	b.Run("no_match", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			claims.HasPermission("admin:delete")
		}
	})
}
```

### Step 1.12: Add test helper functions

```go
// benchSQLiteStore creates a temporary SQLite store for benchmarks.
func benchSQLiteStore(b *testing.B) store.Driver {
	b.Helper()
	dir := b.TempDir()
	st, err := sqlite.Open(dir + "/bench.db")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { st.Close() })
	return st
}

// benchCreateUser creates a minimal user in the store for benchmarks.
func benchCreateUser(b *testing.B, st store.Driver) string {
	b.Helper()
	ctx := context.Background()
	tx, err := st.Begin(ctx, store.TxOptions{})
	if err != nil {
		b.Fatal(err)
	}
	hash, _ := HashPassword("BenchP@ss1")
	user, err := tx.CreateUser(ctx, &store.User{
		Username:     "benchuser",
		PasswordHash: hash,
		Status:       "active",
	})
	if err != nil {
		tx.Rollback()
		b.Fatal(err)
	}
	tx.Commit()
	return user.ID
}

// benchCreateUserWithRoles creates a user with N roles and M permissions each.
func benchCreateUserWithRoles(b *testing.B, st store.Driver, numRoles, permsPerRole int) string {
	b.Helper()
	ctx := context.Background()
	userID := benchCreateUser(b, st)

	tx, err := st.Begin(ctx, store.TxOptions{})
	if err != nil {
		b.Fatal(err)
	}

	for r := 0; r < numRoles; r++ {
		roleName := fmt.Sprintf("bench-role-%d", r)
		role, err := tx.CreateRole(ctx, roleName, fmt.Sprintf("Bench role %d", r))
		if err != nil {
			tx.Rollback()
			b.Fatal(err)
		}
		for p := 0; p < permsPerRole; p++ {
			permID := fmt.Sprintf("bench:perm-%d-%d", r, p)
			if err := tx.AssignPermissionToRole(ctx, role.ID, permID); err != nil {
				tx.Rollback()
				b.Fatal(err)
			}
		}
		if err := tx.AssignRoleToUser(ctx, userID, role.ID); err != nil {
			tx.Rollback()
			b.Fatal(err)
		}
	}
	tx.Commit()
	return userID
}
```

**Note**: The `fmt` import is needed for `benchCreateUserWithRoles`. Add it to the import block.

### Verification

```bash
cd packages/daemon && go test -bench=Benchmark -benchmem -run=^$ ./internal/auth/ -count=1
```

---

## Task 2: Caddy Compiler Benchmark Suite

**Priority**: High — config compilation happens on every config change and drives Caddy reload
**File**: `packages/daemon/internal/caddy/compiler_bench_test.go`
**Depends on**: Nothing (existing code only)

### Step 2.1: Create benchmark file with scaled route generation

```go
// File: packages/daemon/internal/caddy/compiler_bench_test.go
package caddy

import (
	"fmt"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// generateSnapshot creates a ConfigSnapshot with n routes and n/5 services.
func generateSnapshot(n int) *riokuv1.ConfigSnapshot {
	numServices := n / 5
	if numServices < 1 {
		numServices = 1
	}

	services := make([]*riokuv1.Service, numServices)
	for i := 0; i < numServices; i++ {
		svcID := fmt.Sprintf("svc-%d", i)
		services[i] = &riokuv1.Service{
			Id:   svcID,
			Name: fmt.Sprintf("service-%d", i),
			Upstreams: []*riokuv1.Upstream{
				{Address: fmt.Sprintf("127.0.0.1:%d", 9000+i)},
				{Address: fmt.Sprintf("127.0.0.1:%d", 10000+i)},
			},
			LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
			HealthCheck: &riokuv1.HealthCheck{
				Enabled:         true,
				Path:            "/healthz",
				IntervalSeconds: 10,
				TimeoutSeconds:  5,
			},
		}
	}

	routes := make([]*riokuv1.Route, n)
	for i := 0; i < n; i++ {
		svcIdx := i % numServices
		routes[i] = &riokuv1.Route{
			Id:      fmt.Sprintf("route-%d", i),
			Name:    fmt.Sprintf("route-%d", i),
			Enabled: true,
			Matchers: []*riokuv1.Matcher{
				{
					Hosts: []string{fmt.Sprintf("app%d.example.com", i)},
					Paths: []*riokuv1.PathMatcher{
						{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/api/*"},
					},
					Methods: []string{"GET", "POST"},
				},
			},
			Target: &riokuv1.Route_ServiceId{
				ServiceId: fmt.Sprintf("svc-%d", svcIdx),
			},
		}
	}

	return &riokuv1.ConfigSnapshot{
		Version:  1,
		Routes:   routes,
		Services: services,
	}
}
```

### Step 2.2: Benchmark `Compile` at 10/100/1000 routes

```go
func BenchmarkCompile(b *testing.B) {
	for _, n := range []int{10, 100, 1000} {
		b.Run(fmt.Sprintf("%d_routes", n), func(b *testing.B) {
			snap := generateSnapshot(n)
			compiler := NewCompiler(
				[]string{":443", ":80"},
				AdminConfig{InternalAddr: "127.0.0.1:54321"},
			)
			b.ResetTimer()
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				_, err := compiler.Compile(snap)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
```

**Expected**: ~10us for 10 routes, ~100us for 100 routes, ~1ms for 1000 routes. Linear scaling is acceptable.

### Step 2.3: Benchmark `CompileRoute` in isolation

```go
func BenchmarkCompileRoute(b *testing.B) {
	compiler := NewCompiler([]string{":443"}, AdminConfig{})
	services := map[string]*riokuv1.Service{
		"svc-1": {
			Id:   "svc-1",
			Name: "test-service",
			Upstreams: []*riokuv1.Upstream{
				{Address: "127.0.0.1:9001"},
				{Address: "127.0.0.1:9002", Weight: 3},
			},
			LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_WEIGHTED_ROUND_ROBIN,
		},
	}
	route := &riokuv1.Route{
		Id:      "route-1",
		Name:    "bench-route",
		Enabled: true,
		Matchers: []*riokuv1.Matcher{
			{
				Hosts:   []string{"api.example.com"},
				Paths:   []*riokuv1.PathMatcher{{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/v1/*"}},
				Methods: []string{"GET", "POST", "PUT", "DELETE"},
				Headers: []*riokuv1.HeaderMatcher{{Name: "X-Api-Version", Value: "2"}},
			},
		},
		Target: &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, err := compiler.CompileRoute(route, services)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

### Step 2.4: Benchmark compile with admin server block (two-server output)

```go
func BenchmarkCompile_WithAdminBlock(b *testing.B) {
	snap := generateSnapshot(100)
	compiler := NewCompiler(
		[]string{":443", ":80"},
		AdminConfig{
			InternalAddr: "127.0.0.1:54321",
			ListenAddr:   ":7778",
			Domain:       "admin.example.com",
		},
	)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, err := compiler.Compile(snap)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

### Verification

```bash
cd packages/daemon && go test -bench=Benchmark -benchmem -run=^$ ./internal/caddy/ -count=1
```

---

## Task 3: Gateway Middleware Benchmark Suite

**Priority**: High — middleware overhead is added to every request
**File**: `packages/daemon/internal/gateway/gateway_bench_test.go`
**Depends on**: Nothing (existing code only)

### Step 3.1: Create benchmark file with imports and helpers

```go
// File: packages/daemon/internal/gateway/gateway_bench_test.go
package gateway

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
)

// noopHandler is a do-nothing HTTP handler for benchmarking middleware overhead.
var noopHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})
```

### Step 3.2: Benchmark rate limiter — single caller (baseline)

```go
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
```

**Expected**: <2us/op (mutex lock + map lookup + unlock).

### Step 3.3: Benchmark rate limiter — 10K concurrent callers (contention)

```go
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
```

### Step 3.4: Benchmark rate limiter — by session key extraction

```go
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
```

### Step 3.5: Benchmark rate limiter — 429 response path

```go
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
```

### Step 3.6: Benchmark `extractIP` helper

```go
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
```

### Verification

```bash
cd packages/daemon && go test -bench=Benchmark -benchmem -run=^$ ./internal/gateway/ -count=1
```

---

## Task 4: Config Engine and Store Benchmark Suite

**Priority**: High — config engine operations are in the write path for all mutations
**File**: `packages/daemon/internal/config/engine_bench_test.go`
**Depends on**: Nothing (existing code only)

### Step 4.1: Create engine benchmark file

```go
// File: packages/daemon/internal/config/engine_bench_test.go
package config

import (
	"context"
	"fmt"
	"testing"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/store/sqlite"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

func benchEngine(b *testing.B) *Engine {
	b.Helper()
	dir := b.TempDir()
	st, err := sqlite.Open(dir + "/bench.db")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { st.Close() })

	compiler := caddy.NewCompiler(
		[]string{":443"},
		caddy.AdminConfig{InternalAddr: "127.0.0.1:54321"},
	)
	return NewEngine(st, compiler)
}
```

### Step 4.2: Benchmark `ApplyChange` — single route creation

```go
func BenchmarkApplyChange_CreateRoute(b *testing.B) {
	engine := benchEngine(b)
	ctx := context.Background()

	// Pre-create a service to reference.
	svcChange := &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name: "bench-svc",
					Upstreams: []*riokuv1.Upstream{
						{Address: "127.0.0.1:9001"},
					},
				},
			},
		},
	}
	result, err := engine.ApplyChange(ctx, svcChange, "bench")
	if err != nil {
		b.Fatal(err)
	}
	_ = result

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		change := &riokuv1.ConfigChange{
			Operation: &riokuv1.ConfigChange_Route{
				Route: &riokuv1.RouteOp{
					Action: riokuv1.RouteOp_UPSERT,
					Route: &riokuv1.Route{
						Name:    fmt.Sprintf("bench-route-%d", i),
						Enabled: true,
						Matchers: []*riokuv1.Matcher{
							{
								Hosts: []string{fmt.Sprintf("app%d.example.com", i)},
								Paths: []*riokuv1.PathMatcher{
									{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/api/*"},
								},
							},
						},
						Target: &riokuv1.Route_Upstream{
							Upstream: &riokuv1.Upstream{Address: "127.0.0.1:9001"},
						},
					},
				},
			},
		}
		_, err := engine.ApplyChange(ctx, change, "bench")
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

### Step 4.3: Benchmark `GetConfig` at varying dataset sizes

```go
func BenchmarkGetConfig(b *testing.B) {
	for _, n := range []int{10, 100, 500} {
		b.Run(fmt.Sprintf("%d_routes", n), func(b *testing.B) {
			engine := benchEngine(b)
			ctx := context.Background()

			// Seed n routes.
			for i := 0; i < n; i++ {
				change := &riokuv1.ConfigChange{
					Operation: &riokuv1.ConfigChange_Route{
						Route: &riokuv1.RouteOp{
							Action: riokuv1.RouteOp_UPSERT,
							Route: &riokuv1.Route{
								Name:    fmt.Sprintf("seed-route-%d", i),
								Enabled: true,
								Matchers: []*riokuv1.Matcher{
									{Hosts: []string{fmt.Sprintf("r%d.example.com", i)}},
								},
								Target: &riokuv1.Route_Upstream{
									Upstream: &riokuv1.Upstream{Address: "127.0.0.1:9001"},
								},
							},
						},
					},
				}
				if _, err := engine.ApplyChange(ctx, change, "seed"); err != nil {
					b.Fatal(err)
				}
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := engine.GetConfig(ctx)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
```

### Step 4.4: Benchmark `CompileCaddyConfig` end-to-end (engine + compiler)

```go
func BenchmarkCompileCaddyConfig(b *testing.B) {
	for _, n := range []int{10, 100, 500} {
		b.Run(fmt.Sprintf("%d_routes", n), func(b *testing.B) {
			engine := benchEngine(b)
			ctx := context.Background()

			for i := 0; i < n; i++ {
				change := &riokuv1.ConfigChange{
					Operation: &riokuv1.ConfigChange_Route{
						Route: &riokuv1.RouteOp{
							Action: riokuv1.RouteOp_UPSERT,
							Route: &riokuv1.Route{
								Name:    fmt.Sprintf("seed-route-%d", i),
								Enabled: true,
								Matchers: []*riokuv1.Matcher{
									{Hosts: []string{fmt.Sprintf("r%d.example.com", i)}},
								},
								Target: &riokuv1.Route_Upstream{
									Upstream: &riokuv1.Upstream{Address: "127.0.0.1:9001"},
								},
							},
						},
					},
				}
				if _, err := engine.ApplyChange(ctx, change, "seed"); err != nil {
					b.Fatal(err)
				}
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := engine.CompileCaddyConfig(ctx)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
```

### Step 4.5: Benchmark `ImportConfig` (bulk write)

```go
func BenchmarkImportConfig(b *testing.B) {
	for _, n := range []int{10, 100} {
		b.Run(fmt.Sprintf("%d_entities", n), func(b *testing.B) {
			engine := benchEngine(b)
			ctx := context.Background()

			services := make([]*riokuv1.Service, n/5)
			for i := range services {
				services[i] = &riokuv1.Service{
					Id:   fmt.Sprintf("import-svc-%d", i),
					Name: fmt.Sprintf("import-svc-%d", i),
					Upstreams: []*riokuv1.Upstream{
						{Address: fmt.Sprintf("127.0.0.1:%d", 9000+i)},
					},
				}
			}
			routes := make([]*riokuv1.Route, n)
			for i := range routes {
				routes[i] = &riokuv1.Route{
					Name:    fmt.Sprintf("import-route-%d", i),
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{fmt.Sprintf("import%d.example.com", i)}},
					},
					Target: &riokuv1.Route_Upstream{
						Upstream: &riokuv1.Upstream{Address: "127.0.0.1:9001"},
					},
				}
			}
			snap := &riokuv1.ConfigSnapshot{
				Routes:   routes,
				Services: services,
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := engine.ImportConfig(ctx, snap, "bench")
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
```

### Verification

```bash
cd packages/daemon && go test -bench=Benchmark -benchmem -run=^$ ./internal/config/ -count=1
```

---

## Task 5: Benchmark Infrastructure and Make Targets

**Priority**: Medium — enables regression detection workflow
**Files**:
- `packages/daemon/bench/baseline.txt` (initially empty placeholder)
- `Makefile` (new targets)

### Step 5.1: Create bench directory and baseline placeholder

```bash
mkdir -p packages/daemon/bench
```

Create `packages/daemon/bench/baseline.txt`:
```
# Benchmark baseline — generated by: make bench-baseline
# Run `make bench-baseline` to update after intentional performance changes.
```

Create `packages/daemon/bench/.gitkeep` (empty file to ensure the directory is tracked).

### Step 5.2: Add `bench` target to Makefile

Append after the existing `test-integration` target:

```makefile
## bench: Run all Go benchmarks (output to packages/daemon/bench/results.txt)
bench:
	cd $(PKG)/daemon && $(GO) test -bench=. -benchmem -count=5 -run=^$$ ./... 2>&1 | tee bench/results.txt
	@echo "Results saved to packages/daemon/bench/results.txt"
```

**Key details**:
- `-count=5` gives `benchstat` enough samples for statistical significance
- `-run=^$$` skips unit tests (only run benchmarks)
- `2>&1 | tee` preserves output on terminal AND saves to file
- The `$$` is required in Makefile to escape the `$` for the shell regex

### Step 5.3: Add `bench-baseline` target

```makefile
## bench-baseline: Save current benchmark results as the new baseline
bench-baseline: bench
	cp $(PKG)/daemon/bench/results.txt $(PKG)/daemon/bench/baseline.txt
	@echo "Baseline updated: packages/daemon/bench/baseline.txt"
```

### Step 5.4: Add `bench-compare` target

```makefile
## bench-compare: Compare current benchmarks against baseline (requires benchstat)
bench-compare: bench
	@if ! command -v benchstat >/dev/null 2>&1; then \
		echo "Installing benchstat..."; \
		$(GO) install golang.org/x/perf/cmd/benchstat@latest; \
	fi
	benchstat $(PKG)/daemon/bench/baseline.txt $(PKG)/daemon/bench/results.txt
```

### Step 5.5: Update `.PHONY` declaration

Add `bench bench-compare bench-baseline` to the existing `.PHONY` line at the top of the Makefile.

### Verification

```bash
make bench          # should run benchmarks and save results.txt
make bench-baseline # should copy results.txt to baseline.txt
make bench-compare  # should show benchstat comparison (same-to-same first time)
```

---

## Task 6: Load Tester Binary and Profiles

**Priority**: Medium — enables overhead measurement (direct vs proxied)
**Files**:
- `sandbox/loadtest/main.go`
- `sandbox/loadtest/profiles/standard.json`
- `sandbox/loadtest/profiles/stress.json`
- `sandbox/loadtest/profiles/soak.json`
- `sandbox/loadtest/profiles/spike.json`
- `sandbox/loadtest/profiles/config-change.json`
- `sandbox/loadtest/baseline.json` (initially empty)

### Step 6.1: Create load test directory structure

```bash
mkdir -p sandbox/loadtest/profiles
```

### Step 6.2: Create `sandbox/loadtest/main.go`

The load tester is a standalone Go binary that:
1. Reads a profile JSON from `--profile` flag
2. Runs in `--mode=direct` (hit upstream apps) or `--mode=proxied` (hit through Rioku)
3. Outputs structured JSON results to stdout
4. Optionally captures `runtime.MemStats` snapshots with `--monitor`
5. Optionally writes pprof profiles with `--pprof`

```go
// File: sandbox/loadtest/main.go
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"runtime"
	"runtime/pprof"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Profile defines a load test profile loaded from JSON.
type Profile struct {
	Name        string        `json:"name"`
	TargetRPS   int           `json:"target_rps"`
	Duration    Duration      `json:"duration"`
	Concurrency int           `json:"concurrency"`
	Routes      []RouteTarget `json:"routes"`
	// Spike mode: ramp up to SpikeRPS then back down.
	SpikeRPS    int      `json:"spike_rps,omitempty"`
	SpikeAt     Duration `json:"spike_at,omitempty"`
	SpikeDur    Duration `json:"spike_duration,omitempty"`
	// Config change test: trigger config mutation at this offset.
	ConfigChangeAt Duration `json:"config_change_at,omitempty"`
}

// RouteTarget defines a single route to test.
type RouteTarget struct {
	Name       string `json:"name"`
	DirectURL  string `json:"direct_url"`
	ProxiedURL string `json:"proxied_url"`
	Host       string `json:"host"`
	Weight     int    `json:"weight"` // relative weight for request distribution
}

// Duration wraps time.Duration for JSON unmarshaling from string.
type Duration struct {
	time.Duration
}

func (d *Duration) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	dur, err := time.ParseDuration(s)
	if err != nil {
		return err
	}
	d.Duration = dur
	return nil
}

func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.Duration.String())
}

// RouteResult holds latency stats for a single route.
type RouteResult struct {
	RPS      int     `json:"rps"`
	P50Ms    float64 `json:"p50_ms"`
	P95Ms    float64 `json:"p95_ms"`
	P99Ms    float64 `json:"p99_ms"`
	P999Ms   float64 `json:"p999_ms"`
	Errors   int64   `json:"errors"`
	Requests int64   `json:"requests"`
}

// OverheadResult shows the delta between direct and proxied.
type OverheadResult struct {
	P50DeltaMs  float64 `json:"p50_delta_ms"`
	P99DeltaMs  float64 `json:"p99_delta_ms"`
}

// ResourceStats holds runtime resource measurements.
type ResourceStats struct {
	PeakHeapMB          float64 `json:"peak_heap_mb"`
	GoroutinesStart     int     `json:"goroutines_start"`
	GoroutinesEnd       int     `json:"goroutines_end"`
	GCPauseP99Ms        float64 `json:"gc_pause_p99_ms"`
	HeapGrowthRateKBSec float64 `json:"heap_growth_rate_kb_per_sec"`
}

// FullResult is the output format written to stdout.
type FullResult struct {
	Profile   string                    `json:"profile"`
	Direct    map[string]*RouteResult   `json:"direct,omitempty"`
	Proxied   map[string]*RouteResult   `json:"proxied,omitempty"`
	Overhead  map[string]*OverheadResult `json:"overhead,omitempty"`
	Resources *ResourceStats            `json:"resources,omitempty"`
}

func main() {
	profilePath := flag.String("profile", "", "path to profile JSON")
	mode := flag.String("mode", "both", "direct, proxied, or both")
	monitor := flag.Bool("monitor", false, "capture runtime.MemStats snapshots")
	pprofFlag := flag.Bool("pprof", false, "write pprof heap/goroutine profiles")
	outputPath := flag.String("output", "", "write results to file (default: stdout)")
	flag.Parse()

	if *profilePath == "" {
		fmt.Fprintln(os.Stderr, "usage: loadtest --profile <path.json> [--mode direct|proxied|both] [--monitor] [--pprof]")
		os.Exit(1)
	}

	profileData, err := os.ReadFile(*profilePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read profile: %v\n", err)
		os.Exit(1)
	}

	var profile Profile
	if err := json.Unmarshal(profileData, &profile); err != nil {
		fmt.Fprintf(os.Stderr, "parse profile: %v\n", err)
		os.Exit(1)
	}

	result := &FullResult{Profile: profile.Name}

	// Pprof: capture start profiles.
	if *pprofFlag {
		writeProfile("goroutine-start.prof", "goroutine")
		writeHeapProfile("heap-start.prof")
	}

	// Monitor: capture MemStats in background.
	var resourceStats *ResourceStats
	var monitorCancel context.CancelFunc
	if *monitor {
		var monitorCtx context.Context
		monitorCtx, monitorCancel = context.WithCancel(context.Background())
		resourceStats = startMonitor(monitorCtx)
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        profile.Concurrency * 2,
			MaxIdleConnsPerHost: profile.Concurrency,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	if *mode == "direct" || *mode == "both" {
		fmt.Fprintln(os.Stderr, "Running direct mode...")
		result.Direct = runLoad(client, profile, "direct")
	}
	if *mode == "proxied" || *mode == "both" {
		fmt.Fprintln(os.Stderr, "Running proxied mode...")
		result.Proxied = runLoad(client, profile, "proxied")
	}

	// Compute overhead if both modes were run.
	if result.Direct != nil && result.Proxied != nil {
		result.Overhead = make(map[string]*OverheadResult)
		for name, proxied := range result.Proxied {
			if direct, ok := result.Direct[name]; ok {
				result.Overhead[name] = &OverheadResult{
					P50DeltaMs: proxied.P50Ms - direct.P50Ms,
					P99DeltaMs: proxied.P99Ms - direct.P99Ms,
				}
			}
		}
	}

	// Stop monitor and capture final stats.
	if *monitor && monitorCancel != nil {
		monitorCancel()
		time.Sleep(100 * time.Millisecond) // let goroutine finish
		resourceStats.GoroutinesEnd = runtime.NumGoroutine()
		result.Resources = resourceStats
	}

	// Pprof: capture end profiles.
	if *pprofFlag {
		writeProfile("goroutine-end.prof", "goroutine")
		writeHeapProfile("heap-end.prof")
	}

	// Output results.
	out, _ := json.MarshalIndent(result, "", "  ")
	if *outputPath != "" {
		os.WriteFile(*outputPath, out, 0644)
		fmt.Fprintf(os.Stderr, "Results written to %s\n", *outputPath)
	} else {
		fmt.Println(string(out))
	}
}

// runLoad executes the load test for a given mode and returns per-route results.
func runLoad(client *http.Client, profile Profile, mode string) map[string]*RouteResult {
	duration := profile.Duration.Duration
	concurrency := profile.Concurrency
	targetRPS := profile.TargetRPS

	// Build weighted route distribution.
	var weightedRoutes []RouteTarget
	for _, rt := range profile.Routes {
		w := rt.Weight
		if w <= 0 {
			w = 1
		}
		for j := 0; j < w; j++ {
			weightedRoutes = append(weightedRoutes, rt)
		}
	}

	// Collect latencies per route.
	type sample struct {
		route   string
		latency time.Duration
		isError bool
	}
	samples := make(chan sample, targetRPS*int(duration.Seconds()))

	// Rate limiter: one tick per request at target RPS.
	interval := time.Second / time.Duration(targetRPS)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()

	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)
	var reqCount atomic.Int64

	go func() {
		routeIdx := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				rt := weightedRoutes[routeIdx%len(weightedRoutes)]
				routeIdx++

				sem <- struct{}{}
				wg.Add(1)
				go func(rt RouteTarget) {
					defer func() { <-sem; wg.Done() }()

					var url string
					if mode == "direct" {
						url = rt.DirectURL
					} else {
						url = rt.ProxiedURL
					}

					req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
					if rt.Host != "" && mode == "proxied" {
						req.Host = rt.Host
					}

					start := time.Now()
					resp, err := client.Do(req)
					elapsed := time.Since(start)

					isErr := err != nil
					if resp != nil {
						io.Copy(io.Discard, resp.Body)
						resp.Body.Close()
						if resp.StatusCode >= 500 {
							isErr = true
						}
					}

					samples <- sample{route: rt.Name, latency: elapsed, isError: isErr}
					reqCount.Add(1)
				}(rt)
			}
		}
	}()

	<-ctx.Done()
	wg.Wait()
	close(samples)

	// Aggregate per-route.
	type routeData struct {
		latencies []time.Duration
		errors    int64
	}
	byRoute := make(map[string]*routeData)
	for s := range samples {
		rd, ok := byRoute[s.route]
		if !ok {
			rd = &routeData{}
			byRoute[s.route] = rd
		}
		rd.latencies = append(rd.latencies, s.latency)
		if s.isError {
			rd.errors++
		}
	}

	results := make(map[string]*RouteResult)
	for name, rd := range byRoute {
		sort.Slice(rd.latencies, func(i, j int) bool { return rd.latencies[i] < rd.latencies[j] })
		n := len(rd.latencies)
		results[name] = &RouteResult{
			RPS:      n / int(duration.Seconds()),
			P50Ms:    percentileMs(rd.latencies, 0.50),
			P95Ms:    percentileMs(rd.latencies, 0.95),
			P99Ms:    percentileMs(rd.latencies, 0.99),
			P999Ms:   percentileMs(rd.latencies, 0.999),
			Errors:   rd.errors,
			Requests: int64(n),
		}
	}
	return results
}

func percentileMs(sorted []time.Duration, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(float64(len(sorted))*p)) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return float64(sorted[idx].Microseconds()) / 1000.0
}

// startMonitor captures MemStats snapshots every 5 seconds and returns
// the ResourceStats struct (populated on cancel).
func startMonitor(ctx context.Context) *ResourceStats {
	stats := &ResourceStats{
		GoroutinesStart: runtime.NumGoroutine(),
	}
	var peakHeap uint64
	var heapSamples []float64
	var sampleTimes []float64
	startTime := time.Now()

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		var ms runtime.MemStats
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runtime.ReadMemStats(&ms)
				if ms.HeapAlloc > peakHeap {
					peakHeap = ms.HeapAlloc
				}
				heapSamples = append(heapSamples, float64(ms.HeapAlloc)/1024.0) // KB
				sampleTimes = append(sampleTimes, time.Since(startTime).Seconds())

				// GC pause p99.
				pauses := ms.PauseNs[:ms.NumGC%256]
				if len(pauses) > 0 {
					sorted := make([]uint64, len(pauses))
					copy(sorted, pauses)
					sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
					p99Idx := int(float64(len(sorted)) * 0.99)
					if p99Idx >= len(sorted) {
						p99Idx = len(sorted) - 1
					}
					stats.GCPauseP99Ms = float64(sorted[p99Idx]) / 1e6
				}
			}
		}
	}()

	// Compute final stats when context is cancelled.
	go func() {
		<-ctx.Done()
		stats.PeakHeapMB = float64(peakHeap) / (1024 * 1024)

		// Linear regression for heap growth rate.
		if len(heapSamples) >= 3 {
			stats.HeapGrowthRateKBSec = linearSlope(sampleTimes, heapSamples)
		}
	}()

	return stats
}

// linearSlope computes the slope of a simple linear regression (y = mx + b).
func linearSlope(x, y []float64) float64 {
	n := float64(len(x))
	if n < 2 {
		return 0
	}
	var sumX, sumY, sumXY, sumX2 float64
	for i := range x {
		sumX += x[i]
		sumY += y[i]
		sumXY += x[i] * y[i]
		sumX2 += x[i] * x[i]
	}
	denom := n*sumX2 - sumX*sumX
	if denom == 0 {
		return 0
	}
	return (n*sumXY - sumX*sumY) / denom
}

func writeProfile(filename, profileName string) {
	f, err := os.Create("sandbox/loadtest/" + filename)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create %s: %v\n", filename, err)
		return
	}
	defer f.Close()
	p := pprof.Lookup(profileName)
	if p != nil {
		p.WriteTo(f, 0)
	}
}

func writeHeapProfile(filename string) {
	f, err := os.Create("sandbox/loadtest/" + filename)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create %s: %v\n", filename, err)
		return
	}
	defer f.Close()
	runtime.GC() // force GC before heap profile for accuracy
	pprof.WriteHeapProfile(f)
}
```

### Step 6.3: Create `sandbox/loadtest/profiles/standard.json`

```json
{
  "name": "standard",
  "target_rps": 1000,
  "duration": "60s",
  "concurrency": 50,
  "routes": [
    {
      "name": "users",
      "direct_url": "http://127.0.0.1:9001/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "users.local",
      "weight": 3
    },
    {
      "name": "products",
      "direct_url": "http://127.0.0.1:9002/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "products.local",
      "weight": 3
    },
    {
      "name": "webhooks",
      "direct_url": "http://127.0.0.1:9003/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "webhooks.local",
      "weight": 2
    },
    {
      "name": "auth-service",
      "direct_url": "http://127.0.0.1:9004/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "auth.local",
      "weight": 1
    },
    {
      "name": "media",
      "direct_url": "http://127.0.0.1:9005/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "media.local",
      "weight": 1
    }
  ]
}
```

### Step 6.4: Create `sandbox/loadtest/profiles/stress.json`

```json
{
  "name": "stress",
  "target_rps": 10000,
  "duration": "120s",
  "concurrency": 200,
  "routes": [
    {
      "name": "users",
      "direct_url": "http://127.0.0.1:9001/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "users.local",
      "weight": 3
    },
    {
      "name": "products",
      "direct_url": "http://127.0.0.1:9002/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "products.local",
      "weight": 3
    },
    {
      "name": "webhooks",
      "direct_url": "http://127.0.0.1:9003/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "webhooks.local",
      "weight": 2
    },
    {
      "name": "auth-service",
      "direct_url": "http://127.0.0.1:9004/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "auth.local",
      "weight": 1
    },
    {
      "name": "media",
      "direct_url": "http://127.0.0.1:9005/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "media.local",
      "weight": 1
    }
  ]
}
```

### Step 6.5: Create `sandbox/loadtest/profiles/soak.json`

```json
{
  "name": "soak",
  "target_rps": 1000,
  "duration": "600s",
  "concurrency": 50,
  "routes": [
    {
      "name": "users",
      "direct_url": "http://127.0.0.1:9001/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "users.local",
      "weight": 2
    },
    {
      "name": "products",
      "direct_url": "http://127.0.0.1:9002/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "products.local",
      "weight": 2
    },
    {
      "name": "webhooks",
      "direct_url": "http://127.0.0.1:9003/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "webhooks.local",
      "weight": 2
    },
    {
      "name": "auth-service",
      "direct_url": "http://127.0.0.1:9004/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "auth.local",
      "weight": 2
    },
    {
      "name": "media",
      "direct_url": "http://127.0.0.1:9005/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "media.local",
      "weight": 2
    }
  ]
}
```

### Step 6.6: Create `sandbox/loadtest/profiles/spike.json`

```json
{
  "name": "spike",
  "target_rps": 100,
  "duration": "60s",
  "concurrency": 200,
  "spike_rps": 10000,
  "spike_at": "15s",
  "spike_duration": "15s",
  "routes": [
    {
      "name": "users",
      "direct_url": "http://127.0.0.1:9001/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "users.local",
      "weight": 2
    },
    {
      "name": "products",
      "direct_url": "http://127.0.0.1:9002/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "products.local",
      "weight": 2
    },
    {
      "name": "webhooks",
      "direct_url": "http://127.0.0.1:9003/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "webhooks.local",
      "weight": 2
    },
    {
      "name": "auth-service",
      "direct_url": "http://127.0.0.1:9004/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "auth.local",
      "weight": 2
    },
    {
      "name": "media",
      "direct_url": "http://127.0.0.1:9005/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "media.local",
      "weight": 2
    }
  ]
}
```

### Step 6.7: Create `sandbox/loadtest/profiles/config-change.json`

```json
{
  "name": "config-change",
  "target_rps": 1000,
  "duration": "60s",
  "concurrency": 50,
  "config_change_at": "30s",
  "routes": [
    {
      "name": "users",
      "direct_url": "http://127.0.0.1:9001/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "users.local",
      "weight": 2
    },
    {
      "name": "products",
      "direct_url": "http://127.0.0.1:9002/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "products.local",
      "weight": 2
    },
    {
      "name": "webhooks",
      "direct_url": "http://127.0.0.1:9003/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "webhooks.local",
      "weight": 2
    },
    {
      "name": "auth-service",
      "direct_url": "http://127.0.0.1:9004/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "auth.local",
      "weight": 2
    },
    {
      "name": "media",
      "direct_url": "http://127.0.0.1:9005/",
      "proxied_url": "http://127.0.0.1:7778/",
      "host": "media.local",
      "weight": 2
    }
  ]
}
```

### Verification

```bash
# Build the load tester:
cd sandbox/loadtest && go build -o ../../bin/rioku-loadtest .

# Quick validation (low RPS, short duration):
./bin/rioku-loadtest --profile sandbox/loadtest/profiles/standard.json --mode direct
```

---

## Task 7: Load Testing Make Targets and CI Bench Job

**Priority**: Medium — ties everything together for CI
**Files**:
- `Makefile` (additional targets)
- `.github/workflows/ci.yml` (bench job — document only, do not create)

### Step 7.1: Add `sandbox-load` target

```makefile
## sandbox-load: Run standard load profile (direct + proxied), requires running sandbox
sandbox-load:
	@echo "Building load tester..."
	cd sandbox/loadtest && $(GO) build -o ../../$(BIN_DIR)/rioku-loadtest .
	@echo "Running standard load profile..."
	./$(BIN_DIR)/rioku-loadtest \
		--profile sandbox/loadtest/profiles/standard.json \
		--mode both \
		--output sandbox/loadtest/results.json
	@echo "Results: sandbox/loadtest/results.json"
```

### Step 7.2: Add `sandbox-load-monitor` target

```makefile
## sandbox-load-monitor: Run soak load profile with resource monitoring
sandbox-load-monitor:
	@echo "Building load tester..."
	cd sandbox/loadtest && $(GO) build -o ../../$(BIN_DIR)/rioku-loadtest .
	@echo "Running soak profile with monitoring..."
	./$(BIN_DIR)/rioku-loadtest \
		--profile sandbox/loadtest/profiles/soak.json \
		--mode proxied \
		--monitor \
		--pprof \
		--output sandbox/loadtest/soak-results.json
	@echo "Results: sandbox/loadtest/soak-results.json"
	@echo "Profiles: sandbox/loadtest/heap-*.prof, goroutine-*.prof"
```

### Step 7.3: Add `sandbox-load-compare` target

```makefile
## sandbox-load-compare: Compare load results against baseline
sandbox-load-compare: sandbox-load
	@if [ ! -f sandbox/loadtest/baseline.json ]; then \
		echo "No baseline found. Run: cp sandbox/loadtest/results.json sandbox/loadtest/baseline.json"; \
		exit 1; \
	fi
	@echo "==> Comparing against baseline..."
	@$(GO) run sandbox/loadtest/compare.go sandbox/loadtest/baseline.json sandbox/loadtest/results.json
```

**Note**: `sandbox/loadtest/compare.go` is a simple comparison script to implement. For the initial version, a shell-based approach using `jq` is simpler:

```makefile
## sandbox-load-compare: Compare load results against baseline
sandbox-load-compare: sandbox-load
	@if [ ! -f sandbox/loadtest/baseline.json ]; then \
		echo "No baseline found. Run: cp sandbox/loadtest/results.json sandbox/loadtest/baseline.json"; \
		exit 1; \
	fi
	@echo "==> Load test comparison (baseline vs current):"
	@echo "Baseline:"
	@cat sandbox/loadtest/baseline.json | python3 -m json.tool 2>/dev/null || cat sandbox/loadtest/baseline.json
	@echo ""
	@echo "Current:"
	@cat sandbox/loadtest/results.json | python3 -m json.tool 2>/dev/null || cat sandbox/loadtest/results.json
```

### Step 7.4: Update `.PHONY` with load targets

Add `sandbox-load sandbox-load-monitor sandbox-load-compare` to the `.PHONY` declaration.

### Step 7.5: Create `sandbox/loadtest/baseline.json` placeholder

```json
{
  "_comment": "Load test baseline. Run: make sandbox-load && cp sandbox/loadtest/results.json sandbox/loadtest/baseline.json"
}
```

### Step 7.6: Document CI bench job (reference only)

The CI bench job should be added to `.github/workflows/ci.yml` as specified in Part 6 of the testing infrastructure spec. Key points:

- Runs on `pull_request` events only
- Checks out both current branch and `develop` baseline
- Runs `go test -bench=. -benchmem -count=5 ./...` on both
- Uses `benchstat` to compare
- Posts PR comment with regression/improvement table
- Advisory only (does not block merge)

The exact YAML is documented in the spec at `contrib-docs/design/testing-infrastructure.md` lines 934-962.

### Step 7.7: Add `sandbox/loadtest/go.mod`

The load tester needs its own go.mod since it is a standalone binary outside the daemon module:

```
module github.com/riokulabs/rioku/sandbox/loadtest

go 1.24
```

### Verification

```bash
# With sandbox running:
make sandbox-load              # should build loadtest binary and produce results.json
make sandbox-load-monitor      # should run soak with --monitor and --pprof
```

---

## Execution Order

| Order | Task | Est. Time | Blocking? |
|-------|------|-----------|-----------|
| 1 | Task 5: Benchmark infrastructure + Make targets | 30min | No (creates directories, Makefile changes) |
| 2 | Task 1: Auth benchmarks | 60min | No (new file) |
| 3 | Task 2: Caddy compiler benchmarks | 30min | No (new file) |
| 4 | Task 3: Gateway middleware benchmarks | 30min | No (new file) |
| 5 | Task 4: Config engine benchmarks | 45min | No (new file) |
| 6 | Task 6: Load tester binary + profiles | 60min | No (new directory) |
| 7 | Task 7: Load testing Make targets + CI docs | 30min | Depends on Task 6 |

Tasks 1-4 are independent and can be parallelized.

---

## Key Files Created/Modified

### New files:
- `packages/daemon/internal/auth/auth_bench_test.go`
- `packages/daemon/internal/caddy/compiler_bench_test.go`
- `packages/daemon/internal/gateway/gateway_bench_test.go`
- `packages/daemon/internal/config/engine_bench_test.go`
- `packages/daemon/bench/baseline.txt`
- `sandbox/loadtest/main.go`
- `sandbox/loadtest/go.mod`
- `sandbox/loadtest/baseline.json`
- `sandbox/loadtest/profiles/standard.json`
- `sandbox/loadtest/profiles/stress.json`
- `sandbox/loadtest/profiles/soak.json`
- `sandbox/loadtest/profiles/spike.json`
- `sandbox/loadtest/profiles/config-change.json`

### Modified files:
- `Makefile` — 6 new targets: `bench`, `bench-compare`, `bench-baseline`, `sandbox-load`, `sandbox-load-monitor`, `sandbox-load-compare`

---

## Success Criteria

1. `make bench` runs all benchmarks across auth, caddy, gateway, config packages and produces `packages/daemon/bench/results.txt`
2. `make bench-compare` shows benchstat output comparing current vs baseline
3. Auth hot path (`SessionValidate_CacheHit`) benchmarks at <1us/op
4. Caddy compile at 1000 routes benchmarks at <2ms/op
5. Rate limiter single-caller benchmarks at <2us/op
6. Load tester binary builds and produces structured JSON output with direct/proxied/overhead breakdown
7. `--monitor` flag captures MemStats and detects linear heap growth
8. All 5 load profiles parse and execute correctly
9. `make sandbox-load` produces reproducible results against running sandbox
