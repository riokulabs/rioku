// Package postgres implements the store.Driver interface using PostgreSQL.
// Used for small cluster deployments (primary + replicas). Requires PG 15+.
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"sync"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/riokulabs/rioku/internal/store"
)

func init() {
	store.Register("postgres", func() store.Driver {
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
	dsn := cfg.DSN
	if dsn == "" {
		return fmt.Errorf("postgres: DSN is required")
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("postgres: open: %w", err)
	}

	maxOpen := cfg.MaxOpenConns
	if maxOpen <= 0 {
		maxOpen = 25
	}
	maxIdle := cfg.MaxIdleConns
	if maxIdle <= 0 {
		maxIdle = 5
	}
	lifetime := cfg.ConnMaxLifetime
	if lifetime <= 0 {
		lifetime = 5 * time.Minute
	}

	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(lifetime)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return fmt.Errorf("postgres: ping: %w", err)
	}

	d.db = db
	d.notify = make(chan store.ChangeEvent, 256)
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
	if d.db == nil {
		return errors.New("postgres: driver not open")
	}
	return d.db.PingContext(ctx)
}

func (d *driver) Migrate(ctx context.Context, direction store.MigrateDirection) error {
	switch direction {
	case store.MigrateUp:
		return d.migrateUp(ctx)
	case store.MigrateDown:
		return d.migrateDown(ctx)
	default:
		return fmt.Errorf("postgres: unknown migration direction %d", direction)
	}
}

// ensureSchemaVersionsTable creates the schema_versions table if it does not
// exist. This is required before any CurrentVersion call during migration.
func (d *driver) ensureSchemaVersionsTable(ctx context.Context) error {
	_, err := d.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_versions (
			version   INTEGER PRIMARY KEY,
			dirty     BOOLEAN NOT NULL DEFAULT FALSE,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`)
	if err != nil {
		return fmt.Errorf("postgres: ensure schema_versions: %w", err)
	}
	return nil
}

// migrateUp reads all *.up.sql files from migrations/postgres/ and applies
// any with a version number higher than the currently recorded version.
//
// Each migration file is executed inside its own transaction. The dirty flag
// is set to TRUE before the DDL runs and updated to FALSE only after a
// successful commit. A crash or error between those two points leaves the row
// with dirty=TRUE so the next run fails loudly instead of silently skipping
// the version. PostgreSQL supports transactional DDL so this is safe for all
// migration statements we use (note: CREATE INDEX CONCURRENTLY cannot run
// inside a transaction and must not be used in migration files).
func (d *driver) migrateUp(ctx context.Context) error {
	if err := d.ensureSchemaVersionsTable(ctx); err != nil {
		return err
	}

	current, _ := d.CurrentVersion(ctx)

	files, err := collectMigrationFiles("up")
	if err != nil {
		return fmt.Errorf("postgres: collect up migrations: %w", err)
	}

	for _, mf := range files {
		if mf.version <= current {
			continue
		}

		data, err := store.MigrationFS.ReadFile(mf.path)
		if err != nil {
			return fmt.Errorf("postgres: read up migration %d (%s): %w", mf.version, mf.path, err)
		}

		if err := d.applyMigration(ctx, mf.version, string(data)); err != nil {
			return err
		}
	}

	return nil
}

// applyMigration executes a single migration inside a transaction. It marks
// the version as dirty=TRUE before running the SQL body, then marks it
// dirty=FALSE on success. A failure at any point rolls back the transaction
// and, if the dirty INSERT had already been committed by an earlier partial
// attempt, leaves the dirty row visible so the operator can investigate.
func (d *driver) applyMigration(ctx context.Context, version int, sql string) error {
	txn, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("postgres: begin migration tx for version %d: %w", version, err)
	}
	// Always roll back on the way out; a committed tx makes Rollback a no-op.
	defer func() { _ = txn.Rollback() }()

	// Mark dirty=TRUE before touching the schema so a crash is detectable.
	_, err = txn.ExecContext(ctx,
		`INSERT INTO schema_versions (version, dirty) VALUES ($1, TRUE)
		 ON CONFLICT (version) DO UPDATE SET dirty = TRUE`,
		version)
	if err != nil {
		return fmt.Errorf("postgres: mark dirty for version %d: %w", version, err)
	}

	// Execute the migration body.
	if _, err := txn.ExecContext(ctx, sql); err != nil {
		return fmt.Errorf("postgres: apply up migration %d: %w", version, err)
	}

	// Clear the dirty flag now that the DDL succeeded.
	_, err = txn.ExecContext(ctx,
		`UPDATE schema_versions SET dirty = FALSE WHERE version = $1`,
		version)
	if err != nil {
		return fmt.Errorf("postgres: clear dirty for version %d: %w", version, err)
	}

	if err := txn.Commit(); err != nil {
		return fmt.Errorf("postgres: commit migration %d: %w", version, err)
	}
	return nil
}

// migrateDown reads all *.down.sql files from migrations/postgres/ and rolls
// back migrations from the current version down to the first.
func (d *driver) migrateDown(ctx context.Context) error {
	if err := d.ensureSchemaVersionsTable(ctx); err != nil {
		return err
	}

	current, _ := d.CurrentVersion(ctx)
	if current == 0 {
		return nil
	}

	files, err := collectMigrationFiles("down")
	if err != nil {
		return fmt.Errorf("postgres: collect down migrations: %w", err)
	}

	// Apply down migrations in reverse (highest version first).
	for i := len(files) - 1; i >= 0; i-- {
		mf := files[i]
		if mf.version > current {
			continue
		}

		data, err := store.MigrationFS.ReadFile(mf.path)
		if err != nil {
			return fmt.Errorf("postgres: read down migration %d (%s): %w", mf.version, mf.path, err)
		}

		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("postgres: apply down migration %d (%s): %w", mf.version, mf.path, err)
		}

		_, err = d.db.ExecContext(ctx,
			`DELETE FROM schema_versions WHERE version = $1`, mf.version)
		if err != nil {
			return fmt.Errorf("postgres: remove schema version %d: %w", mf.version, err)
		}
	}

	return nil
}

func (d *driver) CurrentVersion(ctx context.Context) (int, error) {
	var version int
	err := d.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM schema_versions`).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("postgres: current version: %w", err)
	}
	return version, nil
}

func (d *driver) Begin(ctx context.Context, opts store.TxOptions) (store.Tx, error) {
	sqlTx, err := d.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: opts.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("postgres: begin tx: %w", err)
	}
	return &tx{sqlTx: sqlTx, notify: d.notify}, nil
}

func (d *driver) Notify() <-chan store.ChangeEvent {
	return d.notify
}

func (d *driver) Health(ctx context.Context) store.DriverHealth {
	if d.db == nil {
		return store.DriverHealth{
			OK:   false,
			Mode: store.ModeDegraded,
			Details: map[string]string{
				"error": "postgres: driver not open",
			},
		}
	}
	var inRecovery bool
	err := d.db.QueryRowContext(ctx, `SELECT pg_is_in_recovery()`).Scan(&inRecovery)
	if err != nil {
		return store.DriverHealth{
			OK:   false,
			Mode: store.ModeDegraded,
			Details: map[string]string{
				"error": err.Error(),
			},
		}
	}
	mode := store.ModePrimary
	if inRecovery {
		mode = store.ModeReplica
	}
	return store.DriverHealth{OK: true, Mode: mode}
}

// ---------------------------------------------------------------------------
// Migration file helpers
// ---------------------------------------------------------------------------

type migrationFile struct {
	version int
	path    string
}

// collectMigrationFiles returns migration files for the given direction
// ("up" or "down") sorted by version ascending.
func collectMigrationFiles(direction string) ([]migrationFile, error) {
	suffix := "." + direction + ".sql"
	var files []migrationFile

	err := fs.WalkDir(store.MigrationFS, "migrations/postgres", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, suffix) {
			return nil
		}

		var version int
		// Filename format: 000001_name.up.sql — parse the leading digits.
		name := d.Name()
		_, err = fmt.Sscanf(name, "%d_", &version)
		if err != nil {
			// Skip files that don't match the expected naming pattern.
			return nil
		}

		files = append(files, migrationFile{version: version, path: path})
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].version < files[j].version
	})

	return files, nil
}
