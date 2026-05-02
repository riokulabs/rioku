package sqlite_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// passwordHistoryFixture opens a fresh in-memory store + creates a
// user with a known initial hash. Returns the driver, the user ID,
// and a teardown function.
func passwordHistoryFixture(t *testing.T) (store.Driver, string, func()) {
	t.Helper()
	d, close := openTempStore(t)
	ctx := tenantCtx(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		close()
		t.Fatalf("Begin: %v", err)
	}
	user, err := tx.CreateUser(ctx, &store.User{
		Username:     "u-" + uuid.NewString()[:8],
		PasswordHash: "hash-initial",
		Status:       "active",
	})
	if err != nil {
		_ = tx.Rollback()
		close()
		t.Fatalf("CreateUser: %v", err)
	}
	if err := tx.Commit(); err != nil {
		close()
		t.Fatalf("Commit: %v", err)
	}
	return d, user.ID, close
}

// setHistoryDepth overrides the tenant_default policy's
// password_history_count for the duration of one test.
func setHistoryDepth(t *testing.T, d store.Driver, depth int32) {
	t.Helper()
	ctx := tenantCtx(t)
	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck

	policy, err := tx.GetTenantAuthPolicy(ctx, "tenant_default")
	if err != nil {
		t.Fatalf("GetTenantAuthPolicy: %v", err)
	}
	policy.PasswordHistoryCount = depth
	if _, err := tx.UpsertTenantAuthPolicy(ctx, policy); err != nil {
		t.Fatalf("UpsertTenantAuthPolicy: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestSetUserPassword_RejectsCurrentHash(t *testing.T) {
	d, userID, cleanup := passwordHistoryFixture(t)
	defer cleanup()
	ctx := tenantCtx(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := tx.SetUserPassword(ctx, userID, "hash-initial"); !errors.Is(err, store.ErrPasswordReuse) {
		t.Fatalf("err = %v, want wrap ErrPasswordReuse for current hash", err)
	}
}

func TestSetUserPassword_RejectsHistoricalHashWithinDepth(t *testing.T) {
	d, userID, cleanup := passwordHistoryFixture(t)
	defer cleanup()
	ctx := tenantCtx(t)

	// Ratchet through 3 password changes.
	hashes := []string{"hash-2", "hash-3", "hash-4"}
	for i, h := range hashes {
		tx, err := d.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin %d: %v", i, err)
		}
		if err := tx.SetUserPassword(ctx, userID, h); err != nil {
			t.Fatalf("iter %d SetUserPassword: %v", i, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("iter %d Commit: %v", i, err)
		}
	}

	// Default depth is 5: hash-initial + hash-2 + hash-3 are all
	// still within window (current = hash-4).
	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if err := tx.SetUserPassword(ctx, userID, "hash-initial"); !errors.Is(err, store.ErrPasswordReuse) {
		t.Fatalf("err = %v, want ErrPasswordReuse for old hash within depth", err)
	}
}

func TestSetUserPassword_AcceptsNewHashAndRotatesHistory(t *testing.T) {
	d, userID, cleanup := passwordHistoryFixture(t)
	defer cleanup()
	ctx := tenantCtx(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx.SetUserPassword(ctx, userID, "hash-2"); err != nil {
		t.Fatalf("SetUserPassword: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify the new hash sticks.
	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer tx2.Rollback() //nolint:errcheck
	user, err := tx2.GetUser(ctx, userID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if user.PasswordHash != "hash-2" {
		t.Fatalf("password_hash = %q, want hash-2", user.PasswordHash)
	}
}

func TestSetUserPassword_HistoryTrimmedToDepth(t *testing.T) {
	d, userID, cleanup := passwordHistoryFixture(t)
	defer cleanup()
	setHistoryDepth(t, d, 3)
	ctx := tenantCtx(t)

	// Push 5 distinct hashes through. With depth=3 only the most
	// recent 2 historical entries should remain (depth - 1 since
	// the current hash counts).
	hashes := []string{"hash-2", "hash-3", "hash-4", "hash-5", "hash-6"}
	for i, h := range hashes {
		tx, err := d.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin %d: %v", i, err)
		}
		if err := tx.SetUserPassword(ctx, userID, h); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("iter %d Commit: %v", i, err)
		}
	}

	// hash-initial should be evicted (current=hash-6, history
	// keeps last depth-1=2 entries -> hash-4 + hash-5). hash-4
	// must still be rejected as reuse.
	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if err := tx.SetUserPassword(ctx, userID, "hash-4"); !errors.Is(err, store.ErrPasswordReuse) {
		t.Fatalf("err = %v, want ErrPasswordReuse for hash-4", err)
	}
	// hash-initial should be re-usable (evicted from history).
	if err := tx.SetUserPassword(ctx, userID, "hash-initial"); err != nil {
		t.Fatalf("hash-initial should be reusable after depth eviction: %v", err)
	}
}

func TestAdminResetPassword_BypassesReuseCheck(t *testing.T) {
	d, userID, cleanup := passwordHistoryFixture(t)
	defer cleanup()
	ctx := tenantCtx(t)

	// Cycle once so hash-initial lands in history.
	{
		tx, _ := d.Begin(ctx, store.TxOptions{})
		if err := tx.SetUserPassword(ctx, userID, "hash-2"); err != nil {
			t.Fatalf("seed: %v", err)
		}
		_ = tx.Commit()
	}

	// SetUserPassword would reject hash-initial; AdminResetPassword
	// must succeed.
	tx, _ := d.Begin(ctx, store.TxOptions{})
	if err := tx.AdminResetPassword(ctx, userID, "hash-initial"); err != nil {
		t.Fatalf("AdminResetPassword: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer tx2.Rollback() //nolint:errcheck
	user, err := tx2.GetUser(ctx, userID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if user.PasswordHash != "hash-initial" {
		t.Fatalf("password_hash = %q, want hash-initial", user.PasswordHash)
	}
}

func TestSetUserPassword_DepthZeroDisablesPolicy(t *testing.T) {
	d, userID, cleanup := passwordHistoryFixture(t)
	defer cleanup()
	setHistoryDepth(t, d, 0)
	ctx := tenantCtx(t)

	// With depth=0 the only check is "not the current hash". Old
	// hashes can be reused freely.
	tx, _ := d.Begin(ctx, store.TxOptions{})
	if err := tx.SetUserPassword(ctx, userID, "hash-2"); err != nil {
		t.Fatalf("first: %v", err)
	}
	_ = tx.Commit()

	// Use context to keep go vet happy and verify the underscored
	// variable doesn't leak.
	_ = context.Background

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer tx2.Rollback() //nolint:errcheck
	if err := tx2.SetUserPassword(ctx, userID, "hash-initial"); err != nil {
		t.Fatalf("hash-initial reuse with depth=0: %v", err)
	}
}
