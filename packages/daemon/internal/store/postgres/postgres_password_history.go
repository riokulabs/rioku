package postgres

import (
	"context"
	"fmt"
)

// SetUserPassword + AdminResetPassword are stubbed for postgres until
// the full Phase 6 port lands. The SQLite driver carries the v1
// implementation; the postgres flavour follows in a follow-up issue.
func (t *tx) SetUserPassword(_ context.Context, _, _ string) error {
	return fmt.Errorf("postgres: SetUserPassword not implemented")
}

func (t *tx) AdminResetPassword(_ context.Context, _, _ string) error {
	return fmt.Errorf("postgres: AdminResetPassword not implemented")
}
