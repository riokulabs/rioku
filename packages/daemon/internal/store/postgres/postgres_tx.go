package postgres

import (
	"database/sql"

	"github.com/riokulabs/rioku/internal/store"
)

// tx wraps *sql.Tx and implements store.Tx. All CRUD methods are stubs
// returning "not implemented" errors until filled in by subsequent phases.
//
// SQL REWRITING — REQUIRED FOR EVERY METHOD IMPLEMENTATION
// When implementing a method stub below, always pass your SQL through
// rewritePlaceholders before executing it:
//
//	query := rewritePlaceholders("SELECT ... WHERE id = ?")
//	row := t.sqlTx.QueryRowContext(ctx, query, id)
//
// PostgreSQL uses $1, $2, ... syntax while SQLite uses `?`. The helper in
// placeholder.go converts `?` to $N at runtime. Skipping this call causes
// a silent runtime failure — PostgreSQL rejects `?` at the wire level and
// returns an error that is easy to miss during integration testing.
type tx struct {
	sqlTx  *sql.Tx
	notify chan store.ChangeEvent
}

func (t *tx) Commit() error   { return t.sqlTx.Commit() }
func (t *tx) Rollback() error { return t.sqlTx.Rollback() }
