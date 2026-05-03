// Package mysql implements the store.Driver interface using MySQL/MariaDB.
// Supports MySQL 8.4 LTS, MariaDB 11.4 LTS (Galera), and MariaDB 11.8.
//
// MySQL uses ? placeholders natively — no placeholder rewriting is required.
// For Galera clusters, Health() queries wsrep status variables to distinguish
// Synced (ModePrimary), Donor/Desynced (ModeDonor), and Desynced (ModeDesync)
// node states. Non-Galera MySQL deployments fall back to a simple connection
// check and always report ModePrimary when healthy.
package mysql

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

	_ "github.com/go-sql-driver/mysql"

	"github.com/riokulabs/rioku/internal/store"
)

func init() {
	store.Register("mysql", func() store.Driver {
		return &driver{}
	})
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

type driver struct {
	db        *sql.DB   // primary (Synced) node connection
	fallbacks []*sql.DB // remaining node connections (Phase 3e: failover)
	notify    chan store.ChangeEvent
	mu        sync.RWMutex
	closed    bool
}

func (d *driver) Open(_ context.Context, cfg store.DriverConfig) error {
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

	pingCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// openNode opens a single database connection pool and verifies it is reachable.
	openNode := func(dsn string) (*sql.DB, error) {
		// MySQL 5.7+/8.0+/MariaDB 10.x default to STRICT_TRANS_TABLES
		// which rejects DEFAULT clauses on TEXT/BLOB/JSON columns.
		// Several legacy migrations rely on those defaults; force a
		// permissive sql_mode at connection time when the DSN doesn't
		// already specify one. Operators with stricter requirements
		// can override by setting sql_mode= explicitly in their DSN.
		if !strings.Contains(dsn, "sql_mode=") {
			sep := "?"
			if strings.Contains(dsn, "?") {
				sep = "&"
			}
			dsn = dsn + sep + "sql_mode='NO_ENGINE_SUBSTITUTION'"
		}
		db, err := sql.Open("mysql", dsn)
		if err != nil {
			return nil, fmt.Errorf("mysql: open: %w", err)
		}
		db.SetMaxOpenConns(maxOpen)
		db.SetMaxIdleConns(maxIdle)
		db.SetConnMaxLifetime(lifetime)
		if err := db.PingContext(pingCtx); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("mysql: ping: %w", err)
		}
		return db, nil
	}

	// wsrepState queries wsrep_local_state_comment on db, returning the value
	// ("Synced", "Donor/Desynced", etc.) or an empty string for non-Galera MySQL.
	wsrepState := func(db *sql.DB) string {
		var name, value string
		err := db.QueryRowContext(pingCtx, `SHOW STATUS LIKE 'wsrep_local_state_comment'`).Scan(&name, &value)
		if err != nil {
			return ""
		}
		return value
	}

	if len(cfg.Nodes) > 0 {
		// Multi-node (Galera) path: open every node, pick the first Synced one
		// as the primary db handle. All others are kept as fallbacks for future
		// failover routing (Phase 3e). If no node reports "Synced", return an
		// error — this prevents the daemon from starting against a split-brained
		// or fully-desynced cluster.
		//
		// TODO(phase-3e): implement automatic primary re-election when the
		// current primary becomes unavailable.
		var pools []*sql.DB
		for i, node := range cfg.Nodes {
			if node.DSN == "" {
				return fmt.Errorf("mysql: node %d has empty DSN", i)
			}
			db, err := openNode(node.DSN)
			if err != nil {
				// Close any already-opened pools before returning.
				for _, p := range pools {
					_ = p.Close()
				}
				return fmt.Errorf("mysql: open node %d (%s): %w", i, node.DSN, err)
			}
			pools = append(pools, db)
		}

		// Find the first Synced node (or the first node if none report Synced,
		// which handles plain MySQL with no wsrep variables).
		primaryIdx := -1
		for i, db := range pools {
			state := wsrepState(db)
			if state == "Synced" || state == "" {
				// "Synced" → confirmed Galera primary member.
				// ""       → non-Galera MySQL; treat first responding node as primary.
				primaryIdx = i
				break
			}
		}
		if primaryIdx == -1 {
			for _, p := range pools {
				_ = p.Close()
			}
			return fmt.Errorf("mysql: no Synced node found in Galera cluster — manual intervention required")
		}

		d.db = pools[primaryIdx]
		for i, p := range pools {
			if i != primaryIdx {
				d.fallbacks = append(d.fallbacks, p)
			}
		}
		d.notify = make(chan store.ChangeEvent, 256)
		return nil
	}

	// Single-node path (cfg.Nodes is empty).
	dsn := cfg.DSN
	if dsn == "" {
		return fmt.Errorf("mysql: DSN is required (set cfg.DSN or cfg.Nodes)")
	}

	db, err := openNode(dsn)
	if err != nil {
		return err
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
	// Close fallback node pools first; they are non-primary so failures here
	// are collected but do not prevent the primary from closing.
	var firstErr error
	for _, fb := range d.fallbacks {
		if err := fb.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	d.fallbacks = nil
	if d.db != nil {
		if err := d.db.Close(); err != nil {
			return err
		}
	}
	return firstErr
}

func (d *driver) Ping(ctx context.Context) error {
	if d.db == nil {
		return errors.New("mysql: driver not open")
	}
	return d.db.PingContext(ctx)
}

func (d *driver) Migrate(ctx context.Context, direction store.MigrateDirection) error {
	if d.db == nil {
		return errors.New("mysql: driver not open")
	}
	switch direction {
	case store.MigrateUp:
		return d.migrateUp(ctx)
	case store.MigrateDown:
		return d.migrateDown(ctx)
	default:
		return fmt.Errorf("mysql: unknown migration direction %d", direction)
	}
}

// ensureSchemaVersionsTable creates the schema_versions table if it does not
// exist. ENGINE=InnoDB is specified explicitly for Galera consistency.
// utf8mb4 supports full Unicode (including emoji) and is required for
// multi-byte characters in identifiers.
func (d *driver) ensureSchemaVersionsTable(ctx context.Context) error {
	_, err := d.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_versions (
			version    INT PRIMARY KEY,
			dirty      TINYINT(1) NOT NULL DEFAULT 0,
			applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	if err != nil {
		return fmt.Errorf("mysql: ensure schema_versions: %w", err)
	}
	return nil
}

// migrateUp reads all *.up.sql files from migrations/mysql/ and applies
// any with a version number higher than the currently recorded version.
//
// Each migration file is executed using the two-transaction pattern: a short
// Tx 1 commits dirty=1 before the migration body runs, so a crash or error
// during the DDL leaves a detectable dirty row on disk. A successful Tx 2 is
// followed by a plain UPDATE to clear the dirty flag. See applyMigration for
// the full protocol.
//
// NOTE: MySQL DDL statements (CREATE TABLE, ALTER TABLE, etc.) implicitly
// commit any open transaction. The two-transaction dirty-flag pattern still
// provides durability for the dirty marker even though MySQL cannot truly
// roll back DDL. A failed DDL in Tx 2 leaves the dirty=1 row from Tx 1 on
// disk, giving the operator a clear signal that manual inspection is required.
//
// Before iterating migration files, migrateUp checks for any dirty rows from a
// previous failed run and aborts with a descriptive error. The operator must
// investigate the failed migration and either resolve the schema manually or
// delete the dirty row before the daemon will start again.
func (d *driver) migrateUp(ctx context.Context) error {
	if err := d.ensureSchemaVersionsTable(ctx); err != nil {
		return err
	}

	// Abort if any dirty row exists from a previous failed run.
	var dirtyVersion int
	err := d.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM schema_versions WHERE dirty = 1`).Scan(&dirtyVersion)
	if err != nil {
		return fmt.Errorf("mysql: check dirty migrations: %w", err)
	}
	if dirtyVersion != 0 {
		return fmt.Errorf("mysql: schema has dirty migration at version %d — manual intervention required", dirtyVersion)
	}

	current, _ := d.CurrentVersion(ctx)

	files, err := collectMigrationFiles("up")
	if err != nil {
		return fmt.Errorf("mysql: collect up migrations: %w", err)
	}

	for _, mf := range files {
		if mf.version <= current {
			continue
		}

		data, err := store.MigrationFS.ReadFile(mf.path)
		if err != nil {
			return fmt.Errorf("mysql: read up migration %d (%s): %w", mf.version, mf.path, err)
		}

		if err := d.applyMigration(ctx, mf.version, string(data)); err != nil {
			return err
		}
	}

	return nil
}

// applyMigration executes a single migration using the two-transaction pattern
// so that a failed migration always leaves a detectable dirty row on disk:
//
//  1. Tx 1 (short): INSERT dirty=1 and commit immediately via ON DUPLICATE KEY
//     UPDATE. If this fails the migration is not attempted and no row is left.
//  2. Tx 2 (the migration): run the SQL body. On failure the transaction is
//     rolled back (or implicitly committed for DDL), but the dirty=1 row from
//     Tx 1 stays on disk. On success, commit Tx 2, then clear the dirty flag
//     with a plain UPDATE outside any transaction.
//
// MySQL note: DDL statements auto-commit implicitly, so Tx 2 cannot truly
// roll back DDL. The dirty-flag pattern still provides the durability
// guarantee for the marker itself.
func (d *driver) applyMigration(ctx context.Context, version int, sqlBody string) error {
	// ---- Tx 1: commit the dirty marker before touching the schema ----
	tx1, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("mysql: begin dirty-marker tx for version %d: %w", version, err)
	}
	defer func() { _ = tx1.Rollback() }()

	_, err = tx1.ExecContext(ctx,
		`INSERT INTO schema_versions (version, dirty) VALUES (?, 1)
		 ON DUPLICATE KEY UPDATE dirty = 1`,
		version)
	if err != nil {
		return fmt.Errorf("mysql: mark dirty for version %d: %w", version, err)
	}

	if err := tx1.Commit(); err != nil {
		return fmt.Errorf("mysql: commit dirty-marker for version %d: %w", version, err)
	}

	// ---- Tx 2: run the migration body ----
	tx2, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("mysql: begin migration tx for version %d: %w", version, err)
	}
	defer func() { _ = tx2.Rollback() }()

	if _, err := tx2.ExecContext(ctx, sqlBody); err != nil {
		// Rollback tx2 (or implicit DDL auto-commit); the dirty row from Tx 1
		// remains on disk and signals that manual intervention is required.
		return fmt.Errorf("mysql: apply up migration %d: %w", version, err)
	}

	if err := tx2.Commit(); err != nil {
		return fmt.Errorf("mysql: commit migration %d: %w", version, err)
	}

	// ---- Clear dirty flag outside any transaction ----
	// Both transactions have committed; the migration succeeded.
	_, err = d.db.ExecContext(ctx,
		`UPDATE schema_versions SET dirty = 0 WHERE version = ?`,
		version)
	if err != nil {
		return fmt.Errorf("mysql: clear dirty for version %d: %w", version, err)
	}

	return nil
}

// migrateDown reads all *.down.sql files from migrations/mysql/ and rolls
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
		return fmt.Errorf("mysql: collect down migrations: %w", err)
	}

	// Apply down migrations in reverse (highest version first).
	for i := len(files) - 1; i >= 0; i-- {
		mf := files[i]
		if mf.version > current {
			continue
		}

		data, err := store.MigrationFS.ReadFile(mf.path)
		if err != nil {
			return fmt.Errorf("mysql: read down migration %d (%s): %w", mf.version, mf.path, err)
		}

		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("mysql: apply down migration %d (%s): %w", mf.version, mf.path, err)
		}

		_, err = d.db.ExecContext(ctx,
			`DELETE FROM schema_versions WHERE version = ?`, mf.version)
		if err != nil {
			return fmt.Errorf("mysql: remove schema version %d: %w", mf.version, err)
		}
	}

	return nil
}

func (d *driver) CurrentVersion(ctx context.Context) (int, error) {
	var version int
	err := d.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM schema_versions WHERE dirty = 0`).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("mysql: current version: %w", err)
	}
	return version, nil
}

func (d *driver) Begin(ctx context.Context, opts store.TxOptions) (store.Tx, error) {
	sqlTx, err := d.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: opts.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("mysql: begin tx: %w", err)
	}
	return &tx{sqlTx: sqlTx, notify: d.notify}, nil
}

func (d *driver) Notify() <-chan store.ChangeEvent {
	return d.notify
}

// Health returns the current health of the MySQL/MariaDB backend.
//
// For Galera clusters, it queries SHOW STATUS LIKE 'wsrep_local_state_comment'
// and maps the result to the appropriate DriverMode:
//
//   - "Synced"          → ModePrimary  (full member, safe for reads and writes)
//   - "Donor/Desynced"  → ModeDonor    (SST donor, avoid for writes)
//   - "Desynced"        → ModeDesync   (manually desynced, avoid entirely)
//   - anything else     → ModeDegraded (unknown Galera state)
//
// For non-Galera MySQL, the SHOW STATUS query returns no rows (or an empty
// value). In that case the method falls back to a simple connection check and
// reports ModePrimary when healthy.
func (d *driver) Health(ctx context.Context) store.DriverHealth {
	if d.db == nil {
		return store.DriverHealth{
			OK:   false,
			Mode: store.ModeDegraded,
			Details: map[string]string{
				"error": "mysql: driver not open",
			},
		}
	}

	if err := d.db.PingContext(ctx); err != nil {
		return store.DriverHealth{
			OK:   false,
			Mode: store.ModeDegraded,
			Details: map[string]string{
				"error": err.Error(),
			},
		}
	}

	// Try Galera state — fall back to non-Galera if no wsrep variables.
	var name, value string
	err := d.db.QueryRowContext(ctx, `SHOW STATUS LIKE 'wsrep_local_state_comment'`).Scan(&name, &value)
	if err == sql.ErrNoRows || value == "" {
		// Non-Galera MySQL: connection is healthy, report primary.
		return store.DriverHealth{
			OK:   true,
			Mode: store.ModePrimary,
			Details: map[string]string{
				"galera": "off",
			},
		}
	}
	if err != nil {
		return store.DriverHealth{
			OK:   false,
			Mode: store.ModeDegraded,
			Details: map[string]string{
				"error": err.Error(),
			},
		}
	}

	var mode store.DriverMode
	switch value {
	case "Synced":
		mode = store.ModePrimary
	case "Donor/Desynced":
		mode = store.ModeDonor
	case "Desynced":
		mode = store.ModeDesync
	default:
		mode = store.ModeDegraded
	}

	return store.DriverHealth{
		OK:   mode != store.ModeDegraded,
		Mode: mode,
		Details: map[string]string{
			"wsrep_local_state_comment": value,
		},
	}
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

	err := fs.WalkDir(store.MigrationFS, "migrations/mysql", func(path string, d fs.DirEntry, err error) error {
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
