package mysql

import (
	"context"
	"fmt"
)

// SetUserPassword + AdminResetPassword are stubbed for mysql until
// the full Phase 6 port lands. The SQLite driver carries the v1
// implementation; the mysql flavour follows in a follow-up issue.
func (t *tx) SetUserPassword(_ context.Context, _, _ string) error {
	return fmt.Errorf("mysql: SetUserPassword not implemented")
}

func (t *tx) AdminResetPassword(_ context.Context, _, _ string) error {
	return fmt.Errorf("mysql: AdminResetPassword not implemented")
}
