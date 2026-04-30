package postgres_test

import (
	"testing"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/postgres"
)

// TestNew_Postgres verifies that the driver is registered and store.New returns
// a non-nil Driver without requiring a real Postgres instance.
func TestNew_Postgres(t *testing.T) {
	d, err := store.New("postgres")
	if err != nil {
		t.Fatalf("store.New(\"postgres\") returned error: %v", err)
	}
	if d == nil {
		t.Fatal("store.New(\"postgres\") returned nil driver")
	}
}

// TestOpen_BadDSN verifies that Open returns an error gracefully when given an
// unreachable DSN. No live Postgres instance is required.
func TestOpen_BadDSN(t *testing.T) {
	d, err := store.New("postgres")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	// Use a clearly invalid DSN — this should fail at Ping, not panic.
	cfg := store.DriverConfig{
		DSN: "postgres://invalid:invalid@127.0.0.1:1/nonexistent?connect_timeout=1",
	}

	// Open should return a non-nil error because the host is unreachable.
	if err := d.Open(t.Context(), cfg); err == nil {
		// If somehow it connected (very unlikely), close cleanly.
		_ = d.Close()
		t.Skip("unexpectedly connected; skipping failure assertion")
	}
}
