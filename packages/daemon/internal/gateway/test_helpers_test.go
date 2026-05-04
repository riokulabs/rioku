package gateway

import (
	"sync"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
)

// passwordHashOnce + cachedHashes memoise Argon2id hashes per
// plaintext password across the gateway test binary. Argon2id is
// intentionally CPU-expensive (~50-100ms per call); when 18 setup
// helpers each invoke auth.HashPassword once per test, the suite
// spends ~15-30s of pure key-derivation work that adds nothing to
// what's actually being tested.
//
// Drop-in for auth.HashPassword in test code:
//
//	hash := cachedHashPassword(t, password)
//
// On a hash failure the test is t.Fatal'd verbatim.
var (
	passwordHashOnce sync.Map // string -> *passwordHashEntry
)

type passwordHashEntry struct {
	once sync.Once
	hash string
	err  error
}

func cachedHashPassword(t *testing.T, password string) string {
	t.Helper()
	entryAny, _ := passwordHashOnce.LoadOrStore(password, &passwordHashEntry{})
	entry := entryAny.(*passwordHashEntry)
	entry.once.Do(func() {
		entry.hash, entry.err = auth.HashPassword(password)
	})
	if entry.err != nil {
		t.Fatalf("HashPassword: %v", entry.err)
	}
	return entry.hash
}
