package sqlite_test

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// hashKey reproduces what the rioku_apikey plugin sends — hex-
// encoded SHA-256 of the inbound key string.
func hashKey(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// TestResolveAPIKeyChain_StandaloneKey covers the legacy
// pre-Sprint-4 path: a key with no subscription_id resolves
// straight through with the key's own scopes.
func TestResolveAPIKeyChain_StandaloneKey(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	rawKey := "sk-standalone-" + uuid.NewString()
	hash := hashKey(rawKey)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	if _, err := tx.CreateAPIKey(ctx, "standalone", hash, []string{"keys:demo", "config:read"}, nil, ""); err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx2.Rollback() //nolint:errcheck

	chain, err := store.ResolveAPIKeyChain(ctx, tx2, hash, time.Now())
	if err != nil {
		t.Fatalf("ResolveAPIKeyChain: %v", err)
	}
	if !chain.Valid {
		t.Fatalf("chain.Valid = false, reason = %q", chain.Reason)
	}
	if chain.PrincipalID != "" {
		t.Errorf("PrincipalID = %q, want empty (no owner_id was set)", chain.PrincipalID)
	}
	if chain.Subscription != nil || chain.Plan != nil {
		t.Errorf("standalone key shouldn't carry Subscription or Plan: %+v / %+v", chain.Subscription, chain.Plan)
	}
	if got := len(chain.Scopes); got != 2 {
		t.Errorf("len(Scopes) = %d, want 2", got)
	}
}

// TestResolveAPIKeyChain_MissingKey covers the "key hash not in
// table" branch.
func TestResolveAPIKeyChain_MissingKey(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx.Rollback() //nolint:errcheck

	chain, err := store.ResolveAPIKeyChain(ctx, tx, hashKey("never-issued"), time.Now())
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if chain.Valid {
		t.Fatal("expected invalid for missing key")
	}
	if chain.Reason != "missing" {
		t.Errorf("reason = %q, want missing", chain.Reason)
	}
}

// TestResolveAPIKeyChain_RevokedKey covers the revoked branch —
// revocation wins over expiry + subscription state.
func TestResolveAPIKeyChain_RevokedKey(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	rawKey := "sk-revoked-" + uuid.NewString()
	hash := hashKey(rawKey)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	keyID, err := tx.CreateAPIKey(ctx, "revoke-me", hash, []string{"keys:demo"}, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.RevokeAPIKey(ctx, keyID); err != nil {
		t.Fatalf("RevokeAPIKey: %v", err)
	}
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx2.Rollback() //nolint:errcheck

	chain, err := store.ResolveAPIKeyChain(ctx, tx2, hash, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if chain.Valid {
		t.Fatal("revoked key resolved as valid")
	}
	if chain.Reason != "revoked" {
		t.Errorf("reason = %q, want revoked", chain.Reason)
	}
}

// TestResolveAPIKeyChain_ExpiredKey covers expires_at < now.
func TestResolveAPIKeyChain_ExpiredKey(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	rawKey := "sk-expired-" + uuid.NewString()
	hash := hashKey(rawKey)
	pastExpiry := time.Now().Add(-time.Hour)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	if _, err := tx.CreateAPIKey(ctx, "expired", hash, []string{"keys:demo"}, &pastExpiry, ""); err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx2.Rollback() //nolint:errcheck

	chain, err := store.ResolveAPIKeyChain(ctx, tx2, hash, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if chain.Valid {
		t.Fatal("expired key resolved as valid")
	}
	if chain.Reason != "expired" {
		t.Errorf("reason = %q, want expired", chain.Reason)
	}
}

// TestErrAPIKeyNotFoundIsErrors verifies the sentinel propagates
// through tx.GetAPIKeyByHash so the chain helper can map missing
// to Reason="missing" rather than an Internal error.
func TestErrAPIKeyNotFoundIsErrors(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx.Rollback() //nolint:errcheck

	_, err := tx.GetAPIKeyByHash(ctx, "nonexistent-hash")
	if !errors.Is(err, store.ErrAPIKeyNotFound) {
		t.Fatalf("err = %v, want wrap ErrAPIKeyNotFound", err)
	}
}
