package mysql

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "github.com/go-sql-driver/mysql"
)

// TestMigrateUp_DirtyFlagOnFailure verifies that a migration that fails
// mid-execution leaves a row with dirty=1 in schema_versions, making the
// broken state detectable on the next run rather than silently skipped.
//
// With the two-transaction pattern, Tx 1 commits dirty=1 before the
// migration body runs, so a DDL failure in Tx 2 leaves the dirty row on disk.
//
// This test requires a real MySQL/MariaDB instance. Set MYSQL_TEST_DSN to a
// connection string (e.g. "user:pass@tcp(localhost:3306)/testdb") to enable
// it.
func TestMigrateUp_DirtyFlagOnFailure(t *testing.T) {
	dsn := os.Getenv("MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("MYSQL_TEST_DSN not set; skipping live MySQL test")
	}

	ctx := context.Background()

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	// Cleanup ordering matters here: t.Cleanup is LIFO and runs AFTER
	// function-level defers. If we used `defer db.Close()` the DELETE
	// below would execute against a closed connection (silently — the
	// errors are dropped — leaving the dirty 9999 row behind to poison
	// every subsequent test in the shared CI database). Register Close
	// FIRST so the DELETE registered later runs FIRST under LIFO and
	// has a live connection.
	t.Cleanup(func() { _ = db.Close() })

	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	// Create a fresh schema_versions table for this test run.
	_, err = db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_versions (
			version    INT PRIMARY KEY,
			dirty      TINYINT(1) NOT NULL DEFAULT 0,
			applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	if err != nil {
		t.Fatalf("create schema_versions: %v", err)
	}
	// Clean up after ourselves so repeated runs are idempotent.
	// Surface DELETE errors via t.Logf so a future regression is
	// visible in CI even when other tests still pass.
	t.Cleanup(func() {
		if _, derr := db.ExecContext(ctx, `DELETE FROM schema_versions WHERE version = ?`, 9999); derr != nil {
			t.Logf("dirty-row cleanup DELETE 9999 failed: %v", derr)
		}
	})

	d := &driver{db: db}

	// Use version 9999 (well beyond any real migration) to avoid collisions.
	const testVersion = 9999

	// Apply a deliberately broken migration — MySQL will reject this SQL.
	invalidSQL := `SELECT FROM nothing_that_exists_zzzzzz`

	err = d.applyMigration(ctx, testVersion, invalidSQL)
	if err == nil {
		t.Fatal("expected applyMigration to return an error for invalid SQL, got nil")
	}

	// With the two-transaction pattern, Tx 1 (dirty=1 marker) committed before
	// Tx 2 (the DDL) ran. Tx 2 rolled back, but Tx 1 is durable.
	// The dirty row MUST be present on disk.
	var count int
	var dirty int
	err = db.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(MAX(dirty), 0)
		 FROM schema_versions WHERE version = ?`, testVersion).Scan(&count, &dirty)
	if err != nil {
		t.Fatalf("query dirty row: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 dirty row after failed migration, got %d", count)
	}
	if dirty != 1 {
		t.Errorf("version %d row exists but dirty=0 — dirty marker was incorrectly cleared", testVersion)
	}

	// CurrentVersion must not return the dirty version.
	ver, err := d.CurrentVersion(ctx)
	if err != nil {
		t.Fatalf("CurrentVersion: %v", err)
	}
	if ver == testVersion {
		t.Errorf("CurrentVersion returned dirty version %d — WHERE dirty=0 filter missing", testVersion)
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
// leaves dirty=0 in schema_versions. Requires MYSQL_TEST_DSN.
func TestMigrateUp_DirtyFlagClearedOnSuccess(t *testing.T) {
	dsn := os.Getenv("MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("MYSQL_TEST_DSN not set; skipping live MySQL test")
	}

	ctx := context.Background()

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	// See TestMigrateUp_DirtyFlagOnFailure for the LIFO ordering rationale.
	t.Cleanup(func() { _ = db.Close() })

	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	_, err = db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_versions (
			version    INT PRIMARY KEY,
			dirty      TINYINT(1) NOT NULL DEFAULT 0,
			applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	if err != nil {
		t.Fatalf("create schema_versions: %v", err)
	}
	t.Cleanup(func() {
		if _, derr := db.ExecContext(ctx, `DELETE FROM schema_versions WHERE version = ?`, 9998); derr != nil {
			t.Logf("test fixture cleanup DELETE 9998 failed: %v", derr)
		}
	})

	d := &driver{db: db}

	// A valid no-op migration.
	validSQL := `SELECT 1`

	if err := d.applyMigration(ctx, 9998, validSQL); err != nil {
		t.Fatalf("applyMigration: %v", err)
	}

	var dirty int
	err = db.QueryRowContext(ctx,
		`SELECT dirty FROM schema_versions WHERE version = ?`, 9998).Scan(&dirty)
	if err != nil {
		t.Fatalf("query schema_versions: %v", err)
	}
	if dirty != 0 {
		t.Errorf("version 9998: dirty=1 after successful migration, expected 0")
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
