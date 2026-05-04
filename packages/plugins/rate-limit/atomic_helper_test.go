package ratelimit

import "sync/atomic"

// addInt64 wraps atomic.AddInt64 so the main test file doesn't need
// to import sync/atomic just for one helper.
func addInt64(p *int64) { atomic.AddInt64(p, 1) }
