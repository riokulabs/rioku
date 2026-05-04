package observability

import "time"

// SetClock overrides the registry's clock. Test-only — exposed via
// export_test.go so the production type doesn't carry a public test
// hook on its method set.
func (r *JWKSRegistry) SetClock(now func() time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.now = now
}
