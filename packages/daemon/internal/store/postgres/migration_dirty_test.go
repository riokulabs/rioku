package postgres

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// TestMigrateUp_DirtyFlagOnFailure verifies that a migration that fails
// mid-execution leaves a row with dirty=TRUE in schema_versions, making the
// broken state detectable on the next run rather than silently skipped.
//
// With the two-transaction pattern, Tx 1 commits dirty=TRUE before the
// migration body runs, so a DDL failure in Tx 2 leaves the dirty row on disk.
//
// This test requires a real PostgreSQL instance. Set POSTGRES_TEST_DSN to a
// connection string (e.g. "postgres://user:pass@localhost/testdb") to enable
// it.
func TestMigrateUp_DirtyFlagOnFailure(t *testing.T) {
	dsn := os.Getenv("POSTGRES_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_TEST_DSN not set; skipping live Postgres test")
	}

	ctx := context.Background()

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	// Create a fresh schema_versions table for this test run.
	_, err = db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_versions (
			version    INTEGER PRIMARY KEY,
			dirty      BOOLEAN NOT NULL DEFAULT FALSE,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`)
	if err != nil {
		t.Fatalf("create schema_versions: %v", err)
	}
	// Clean up after ourselves so repeated runs are idempotent.
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM schema_versions WHERE version = $1`, 9999)
	})

	d := &driver{db: db}

	// Use version 9999 (well beyond any real migration) to avoid collisions.
	const testVersion = 9999

	// Apply a deliberately broken migration — PostgreSQL will reject this SQL.
	invalidSQL := `SELECT FROM nothing_that_exists_zzzzzz`

	err = d.applyMigration(ctx, testVersion, invalidSQL)
	if err == nil {
		t.Fatal("expected applyMigration to return an error for invalid SQL, got nil")
	}

	// With the two-transaction pattern, Tx 1 (dirty=TRUE marker) committed
	// before Tx 2 (the DDL) ran. Tx 2 rolled back, but Tx 1 is durable.
	// The dirty row MUST be present on disk.
	var count int
	var dirty bool
	err = db.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(bool_or(dirty), FALSE)
		 FROM schema_versions WHERE version = $1`, testVersion).Scan(&count, &dirty)
	if err != nil {
		t.Fatalf("query dirty row: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 dirty row after failed migration, got %d", count)
	}
	if !dirty {
		t.Errorf("version %d row exists but dirty=FALSE — dirty marker was incorrectly cleared", testVersion)
	}

	// CurrentVersion must not return the dirty version.
	ver, err := d.CurrentVersion(ctx)
	if err != nil {
		t.Fatalf("CurrentVersion: %v", err)
	}
	if ver == testVersion {
		t.Errorf("CurrentVersion returned dirty version %d — WHERE dirty=FALSE filter missing", testVersion)
	}

	// migrateUp must abort with a "manual intervention required" error when a
	// dirty row exists, rather than silently skipping or re-attempting it.
	//
	// Re-use d (same DB connection); migrateUp checks for dirty rows before
	// iterating files so it will abort immediately.
	migrateErr := d.migrateUp(ctx)
	if migrateErr == nil {
		t.Fatal("expected migrateUp to return an error for dirty schema, got nil")
	}
	wantSubstr := "manual intervention required"
	if !strings.Contains(migrateErr.Error(), wantSubstr) {
		t.Errorf("migrateUp error = %q; want it to contain %q", migrateErr.Error(), wantSubstr)
	}
}

// TestMigrateUp_DirtyFlagClearedOnSuccess verifies that a successful migration
// leaves dirty=FALSE in schema_versions. Requires POSTGRES_TEST_DSN.
func TestMigrateUp_DirtyFlagClearedOnSuccess(t *testing.T) {
	dsn := os.Getenv("POSTGRES_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_TEST_DSN not set; skipping live Postgres test")
	}

	ctx := context.Background()

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	_, err = db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_versions (
			version    INTEGER PRIMARY KEY,
			dirty      BOOLEAN NOT NULL DEFAULT FALSE,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`)
	if err != nil {
		t.Fatalf("create schema_versions: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM schema_versions WHERE version = $1`, 9998)
	})

	d := &driver{db: db}

	// A valid no-op migration.
	validSQL := `SELECT 1`

	if err := d.applyMigration(ctx, 9998, validSQL); err != nil {
		t.Fatalf("applyMigration: %v", err)
	}

	var dirty bool
	err = db.QueryRowContext(ctx,
		`SELECT dirty FROM schema_versions WHERE version = $1`, 9998).Scan(&dirty)
	if err != nil {
		t.Fatalf("query schema_versions: %v", err)
	}
	if dirty {
		t.Errorf("version 9998: dirty=TRUE after successful migration, expected FALSE")
	}

	// CurrentVersion must return the successfully-applied version.
	ver, err := d.CurrentVersion(ctx)
	if err != nil {
		t.Fatalf("CurrentVersion: %v", err)
	}
	if ver < 9998 {
		t.Errorf("CurrentVersion = %d after applying 9998, want >= 9998", ver)
	}
}
