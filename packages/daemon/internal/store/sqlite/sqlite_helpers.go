package sqlite

import (
	"log/slog"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func orEmptyConditions(c []store.AccessPolicyCondition) []store.AccessPolicyCondition {
	if c == nil {
		return []store.AccessPolicyCondition{}
	}
	return c
}

// isUniqueViolation returns true for SQLite UNIQUE constraint failures.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") ||
		strings.Contains(msg, "constraint failed: UNIQUE")
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

func nowUTC() string {
	return time.Now().UTC().Format(timeFormat)
}

func parseTime(s string) time.Time {
	t, err := time.Parse(timeFormat, s)
	if err != nil && s != "" {
		slog.Warn("failed to parse time", "component", "store", "value", s, "error", err)
	}
	return t
}

func formatNullableTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(timeFormat)
	return &s
}
