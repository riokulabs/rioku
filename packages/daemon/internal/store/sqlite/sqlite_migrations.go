package sqlite

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/riokulabs/rioku/internal/store"
)

// migrationFile is a single migration's resolved metadata. The
// version drives ordering; the path is the embed.FS-relative
// location used to read the SQL body.
type migrationFile struct {
	version int
	path    string
}

// collectMigrationFiles enumerates every embedded migration for the
// given direction ("up" or "down"), parses the leading version digits
// from each filename, and returns the list sorted ascending by
// version. New migrations are auto-discovered when added under
// internal/store/migrations/sqlite/ — no Go-side registration step
// is required (#148).
func collectMigrationFiles(direction string) ([]migrationFile, error) {
	suffix := "." + direction + ".sql"
	var files []migrationFile

	err := fs.WalkDir(store.MigrationFS, "migrations/sqlite", func(path string, d fs.DirEntry, err error) error {
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
		// Filename format: 000001_name.up.sql — parse the leading
		// digits. Files that don't conform are skipped silently so
		// stray `.sql` files in the directory never block startup.
		if _, scanErr := fmt.Sscanf(d.Name(), "%d_", &version); scanErr != nil {
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
	// Reject duplicate version numbers — `0001_a.up.sql` and
	// `00001_b.up.sql` would both parse to version 1, applying both
	// SQL bodies under one schema_versions row in non-deterministic
	// order. Better to fail-fast at startup than silently apply the
	// wrong migration.
	for i := 1; i < len(files); i++ {
		if files[i].version == files[i-1].version {
			return nil, fmt.Errorf("sqlite: duplicate migration version %d in %s and %s",
				files[i].version, files[i-1].path, files[i].path)
		}
	}
	return files, nil
}

// migrateUp applies every embedded up-migration whose version is
// greater than the recorded schema version. The schema_versions row
// is upserted via INSERT OR IGNORE so reapplying a migration after a
// dirty-row recovery is a no-op rather than a constraint violation.
func (d *driver) migrateUp(ctx context.Context) error {
	current, _ := d.CurrentVersion(ctx)

	files, err := collectMigrationFiles("up")
	if err != nil {
		return fmt.Errorf("sqlite: collect up migrations: %w", err)
	}

	for _, mf := range files {
		if mf.version <= current {
			continue
		}
		data, err := store.MigrationFS.ReadFile(mf.path)
		if err != nil {
			return fmt.Errorf("sqlite: read up migration %d (%s): %w", mf.version, mf.path, err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration %d: %w", mf.version, err)
		}
		if _, err := d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (?, 0)`, mf.version); err != nil {
			return fmt.Errorf("sqlite: record schema version %d: %w", mf.version, err)
		}
	}

	return nil
}

// migrateDown applies down-migrations in reverse-version order. Each
// down SQL file is responsible for its own schema_versions row
// cleanup (migration 1's down also drops the schema_versions table
// itself), so we don't issue a DELETE here.
func (d *driver) migrateDown(ctx context.Context) error {
	current, _ := d.CurrentVersion(ctx)

	files, err := collectMigrationFiles("down")
	if err != nil {
		return fmt.Errorf("sqlite: collect down migrations: %w", err)
	}

	// Reverse-order traversal so the highest version applied gets
	// rolled back first.
	for i := len(files) - 1; i >= 0; i-- {
		mf := files[i]
		if current < mf.version {
			continue
		}
		data, err := store.MigrationFS.ReadFile(mf.path)
		if err != nil {
			return fmt.Errorf("sqlite: read down migration %d (%s): %w", mf.version, mf.path, err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration %d: %w", mf.version, err)
		}
	}

	return nil
}
