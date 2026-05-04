package mysql_test

import (
	"testing"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/mysql"
)

// TestNew_MySQL verifies that the driver is registered and store.New returns
// a non-nil Driver without requiring a real MySQL instance.
func TestNew_MySQL(t *testing.T) {
	d, err := store.New("mysql")
	if err != nil {
		t.Fatalf("store.New(\"mysql\") returned error: %v", err)
	}
	if d == nil {
		t.Fatal("store.New(\"mysql\") returned nil driver")
	}
}

// TestOpen_BadDSN verifies that Open returns an error gracefully when given an
// unreachable DSN. No live MySQL instance is required.
func TestOpen_BadDSN(t *testing.T) {
	d, err := store.New("mysql")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	// Use a clearly invalid DSN — this should fail at Ping, not panic.
	cfg := store.DriverConfig{
		DSN: "invalid:invalid@tcp(127.0.0.1:1)/nonexistent?timeout=1s",
	}

	// Open should return a non-nil error because the host is unreachable.
	if err := d.Open(t.Context(), cfg); err == nil {
		// If somehow it connected (very unlikely), close cleanly.
		_ = d.Close()
		t.Skip("unexpectedly connected; skipping failure assertion")
	}
}
