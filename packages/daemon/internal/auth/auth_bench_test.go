package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// benchSQLiteStore creates a temporary SQLite store for benchmarks.
func benchSQLiteStore(b *testing.B) store.Driver {
	b.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		b.Fatal(err)
	}

	dbPath := filepath.Join(b.TempDir(), "bench.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		b.Fatal(err)
	}
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = drv.Close() })
	return drv
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
		Username:     "benchuser-" + uuid.New().String()[:8],
		PasswordHash: hash,
		Status:       "active",
	})
	if err != nil {
		_ = tx.Rollback()
		b.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	return user.ID
}

// seededPermissions are the permission IDs available from the RBAC migration.
var seededPermissions = []string{
	"config:read", "config:write", "config:import", "config:export",
	"keys:own", "keys:manage",
	"users:read", "users:manage", "users:create", "users:delete",
	"roles:read", "roles:manage",
	"sessions:read", "sessions:manage",
	"audit:read",
	"settings:read", "settings:write",
	"traffic:read",
	"plugins:read", "plugins:manage",
	"cluster:read", "cluster:manage",
}

// benchCreateUserWithRoles creates a user with N roles. Each role gets a
// subset of the seeded permissions (cycling through the available set).
func benchCreateUserWithRoles(b *testing.B, st store.Driver, numRoles, permsPerRole int) string {
	b.Helper()
	ctx := context.Background()
	userID := benchCreateUser(b, st)

	tx, err := st.Begin(ctx, store.TxOptions{})
	if err != nil {
		b.Fatal(err)
	}

	for r := 0; r < numRoles; r++ {
		perms := make([]string, 0, permsPerRole)
		for p := 0; p < permsPerRole && p < len(seededPermissions); p++ {
			idx := (r*permsPerRole + p) % len(seededPermissions)
			perms = append(perms, seededPermissions[idx])
		}
		role, err := tx.CreateRole(ctx, store.CreateRoleParams{
			ID:          uuid.New().String(),
			Name:        fmt.Sprintf("bench-role-%d-%s", r, uuid.New().String()[:8]),
			Description: fmt.Sprintf("Bench role %d", r),
			Permissions: perms,
		})
		if err != nil {
			_ = tx.Rollback()
			b.Fatal(err)
		}
		if err := tx.AssignRole(ctx, userID, role.ID, ""); err != nil {
			_ = tx.Rollback()
			b.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	return userID
}

// ---------------------------------------------------------------------------
// Password benchmarks
// ---------------------------------------------------------------------------

func BenchmarkHashPassword(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_, err := HashPassword("BenchmarkP@ssword123!")
		if err != nil {
			b.Fatal(err)
		}
	}
}

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

// ---------------------------------------------------------------------------
// Fingerprint benchmark
// ---------------------------------------------------------------------------

func BenchmarkComputeFingerprint(b *testing.B) {
	ua := "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/128.0"
	al := "en-US,en;q=0.9"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ComputeFingerprint(ua, al)
	}
}

// ---------------------------------------------------------------------------
// JWT benchmarks
// ---------------------------------------------------------------------------

func BenchmarkJWTSign(b *testing.B) {
	key := make([]byte, 32)
	rand.Read(key)
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

// ---------------------------------------------------------------------------
// TOTP benchmarks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Encryption benchmarks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Session validation benchmarks
// ---------------------------------------------------------------------------

func BenchmarkSessionValidate_CacheHit(b *testing.B) {
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

// ---------------------------------------------------------------------------
// RBAC benchmarks
// ---------------------------------------------------------------------------

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
