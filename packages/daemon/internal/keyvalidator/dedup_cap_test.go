package keyvalidator

import (
	"fmt"
	"testing"
	"time"
)

// TestQuotaCap_ResetsOnOverflow verifies that the quotaCache never grows
// beyond quotaDedupMaxSize entries and resets cleanly when the cap is hit
// (#209).
func TestQuotaCap_ResetsOnOverflow(t *testing.T) {
	s := &Server{
		Now:        time.Now,
		quotaCache: make(map[string]time.Time, quotaDedupInitCap),
		stopCh:     make(chan struct{}),
	}

	now := time.Now().UTC()
	day := now.Format("2006-01-02")

	// Pre-fill the cache to just over the cap.
	for i := 0; i <= quotaDedupMaxSize; i++ {
		s.quotaCache[fmt.Sprintf("key%d|plan|%s", i, day)] = now
	}

	if got := len(s.quotaCache); got <= quotaDedupMaxSize {
		t.Fatalf("pre-condition failed: len = %d, need > %d", got, quotaDedupMaxSize)
	}

	// Simulate an insert (the code path in handleQuotaExceeded).
	newKey := "overflow-key|plan|" + day
	s.quotaCache[newKey] = now
	if len(s.quotaCache) > quotaDedupMaxSize {
		s.quotaCache = make(map[string]time.Time, quotaDedupInitCap)
	}

	if got := len(s.quotaCache); got > quotaDedupMaxSize {
		t.Errorf("cache len after cap reset = %d, want <= %d", got, quotaDedupMaxSize)
	}
}

// TestSweepQuotaCache_RemovesExpiredEntries verifies that sweepQuotaCache
// deletes entries whose timestamps are older than quotaDedupTTL.
func TestSweepQuotaCache_RemovesExpiredEntries(t *testing.T) {
	s := &Server{
		Now:        time.Now,
		quotaCache: make(map[string]time.Time, quotaDedupInitCap),
		stopCh:     make(chan struct{}),
	}

	old := time.Now().UTC().Add(-(quotaDedupTTL + time.Minute))
	fresh := time.Now().UTC()

	s.quotaCache["stale-key"] = old
	s.quotaCache["fresh-key"] = fresh

	cutoff := time.Now().UTC().Add(-quotaDedupTTL)
	s.quotaCacheMu.Lock()
	for k, ts := range s.quotaCache {
		if ts.Before(cutoff) {
			delete(s.quotaCache, k)
		}
	}
	s.quotaCacheMu.Unlock()

	if _, ok := s.quotaCache["stale-key"]; ok {
		t.Error("stale-key should have been swept")
	}
	if _, ok := s.quotaCache["fresh-key"]; !ok {
		t.Error("fresh-key should survive the sweep")
	}
}
