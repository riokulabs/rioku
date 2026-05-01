// Package sqlite implements the store.Driver interface using SQLite.
// This is the default for single-node deployments.
package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"

	"github.com/riokulabs/rioku/internal/store"

	_ "modernc.org/sqlite"
)

const timeFormat = "2006-01-02T15:04:05.000Z"

func init() {
	store.Register("sqlite", func() store.Driver {
		return &driver{}
	})
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

type driver struct {
	db     *sql.DB
	notify chan store.ChangeEvent
	mu     sync.RWMutex
	closed bool
}

func (d *driver) Open(_ context.Context, cfg store.DriverConfig) error {
	path := cfg.Path
	if path == "" {
		path = cfg.DSN
	}
	if path == "" {
		return fmt.Errorf("sqlite: path is required")
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("sqlite: open: %w", err)
	}

	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	} {
		if _, err := db.Exec(pragma); err != nil {
			_ = db.Close()
			return fmt.Errorf("sqlite: %s: %w", pragma, err)
		}
	}

	d.db = db
	d.notify = make(chan store.ChangeEvent, 64)
	return nil
}

func (d *driver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closed = true
	if d.notify != nil {
		close(d.notify)
	}
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

func (d *driver) Ping(ctx context.Context) error {
	return d.db.PingContext(ctx)
}

func (d *driver) Migrate(ctx context.Context, direction store.MigrateDirection) error {
	if d.db == nil {
		return errors.New("sqlite: driver not open")
	}
	switch direction {
	case store.MigrateUp:
		return d.migrateUp(ctx)
	case store.MigrateDown:
		return d.migrateDown(ctx)
	default:
		return fmt.Errorf("sqlite: unknown migration direction %d", direction)
	}
}

func (d *driver) CurrentVersion(ctx context.Context) (int, error) {
	var version int
	err := d.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM schema_versions`).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("sqlite: current version: %w", err)
	}
	return version, nil
}

func (d *driver) Begin(ctx context.Context, opts store.TxOptions) (store.Tx, error) {
	sqlTx, err := d.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: opts.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("sqlite: begin tx: %w", err)
	}
	return &tx{sqlTx: sqlTx, notify: d.notify}, nil
}

func (d *driver) Notify() <-chan store.ChangeEvent {
	return d.notify
}

func (d *driver) Health(ctx context.Context) store.DriverHealth {
	if err := d.db.PingContext(ctx); err != nil {
		return store.DriverHealth{OK: false, Mode: store.ModeSingle, Details: map[string]string{"error": err.Error()}}
	}
	return store.DriverHealth{OK: true, Mode: store.ModeSingle}
}

// ---------------------------------------------------------------------------
// tx
// ---------------------------------------------------------------------------

type tx struct {
	sqlTx  *sql.Tx
	notify chan store.ChangeEvent
}

func (t *tx) Commit() error   { return t.sqlTx.Commit() }
func (t *tx) Rollback() error { return t.sqlTx.Rollback() }

// emit sends a non-blocking change event. Logs a warning if the channel is full.
func (t *tx) emit(table, rowID, operation string) {
	select {
	case t.notify <- store.ChangeEvent{Table: table, RowID: rowID, Operation: operation}:
	default:
		slog.Warn("change event dropped (channel full)", "component", "store", "table", table, "row_id", rowID, "operation", operation)
	}
}
