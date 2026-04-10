// Package daemon contains tests for the daemon package. Using an internal
// test file (package daemon) so that unexported helpers (derefFloat64,
// derefInt, loadOrCreateSigningKey) are directly accessible without
// indirection.
package daemon

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/riokulabs/rioku/internal/config"
)

// ---------------------------------------------------------------------------
// pidfile.go tests
// ---------------------------------------------------------------------------

func TestWritePIDFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "rioku.pid")

	if err := WritePIDFile(path); err != nil {
		t.Fatalf("WritePIDFile: unexpected error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile after WritePIDFile: %v", err)
	}
	got, err := strconv.Atoi(string(data))
	if err != nil {
		t.Fatalf("parse written PID: %v", err)
	}
	if want := os.Getpid(); got != want {
		t.Errorf("WritePIDFile wrote PID %d, want %d", got, want)
	}
}

func TestReadPIDFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "rioku.pid")

	want := 12345
	if err := os.WriteFile(path, []byte(strconv.Itoa(want)), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	got, err := ReadPIDFile(path)
	if err != nil {
		t.Fatalf("ReadPIDFile: unexpected error: %v", err)
	}
	if got != want {
		t.Errorf("ReadPIDFile = %d, want %d", got, want)
	}
}

func TestReadPIDFile_Missing(t *testing.T) {
	t.Parallel()
	_, err := ReadPIDFile("/tmp/rioku_test_nonexistent_pidfile_xyz.pid")
	if err == nil {
		t.Error("ReadPIDFile on missing file: expected error, got nil")
	}
}

func TestReadPIDFile_InvalidContent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "rioku.pid")

	if err := os.WriteFile(path, []byte("abc"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	_, err := ReadPIDFile(path)
	if err == nil {
		t.Error("ReadPIDFile with invalid content: expected parse error, got nil")
	}
}

func TestRemovePIDFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "rioku.pid")

	if err := os.WriteFile(path, []byte("1"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if err := RemovePIDFile(path); err != nil {
		t.Fatalf("RemovePIDFile: unexpected error: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("RemovePIDFile: file still exists after removal")
	}
}

func TestRemovePIDFile_Missing(t *testing.T) {
	t.Parallel()
	err := RemovePIDFile("/tmp/rioku_test_nonexistent_pidfile_xyz.pid")
	if err == nil {
		t.Error("RemovePIDFile on missing file: expected error, got nil")
	}
}

func TestIsProcessRunning_Self(t *testing.T) {
	t.Parallel()
	if !IsProcessRunning(os.Getpid()) {
		t.Error("IsProcessRunning(os.Getpid()) = false, want true")
	}
}

func TestIsProcessRunning_Invalid(t *testing.T) {
	t.Parallel()
	// PID 99999999 is astronomically unlikely to exist on any real system.
	if IsProcessRunning(99999999) {
		t.Error("IsProcessRunning(99999999) = true, want false")
	}
}

// ---------------------------------------------------------------------------
// daemon.go — exported functions
// ---------------------------------------------------------------------------

func TestNew(t *testing.T) {
	t.Parallel()
	cfg := config.Default()
	d := New(cfg, "/etc/rioku/config.yaml")
	if d == nil {
		t.Fatal("New returned nil")
	}
	want := filepath.Join(cfg.DataDir, "rioku.pid")
	if got := d.PIDFile(); got != want {
		t.Errorf("PIDFile() = %q, want %q", got, want)
	}
}

func TestPIDFile_ReflectsCfgDataDir(t *testing.T) {
	t.Parallel()
	cfg := config.Default()
	cfg.DataDir = "/custom/data"
	d := New(cfg, "")
	want := "/custom/data/rioku.pid"
	if got := d.PIDFile(); got != want {
		t.Errorf("PIDFile() = %q, want %q", got, want)
	}
}

// ---------------------------------------------------------------------------
// daemon.go — unexported helpers (accessible because package daemon)
// ---------------------------------------------------------------------------

func TestDerefFloat64_Nil(t *testing.T) {
	t.Parallel()
	if got := derefFloat64(nil, 3.14); got != 3.14 {
		t.Errorf("derefFloat64(nil, 3.14) = %v, want 3.14", got)
	}
}

func TestDerefFloat64_Value(t *testing.T) {
	t.Parallel()
	v := 2.71
	if got := derefFloat64(&v, 0); got != 2.71 {
		t.Errorf("derefFloat64(&2.71, 0) = %v, want 2.71", got)
	}
}

func TestDerefInt_Nil(t *testing.T) {
	t.Parallel()
	if got := derefInt(nil, 42); got != 42 {
		t.Errorf("derefInt(nil, 42) = %v, want 42", got)
	}
}

func TestDerefInt_Value(t *testing.T) {
	t.Parallel()
	v := 7
	if got := derefInt(&v, 0); got != 7 {
		t.Errorf("derefInt(&7, 0) = %v, want 7", got)
	}
}

// ---------------------------------------------------------------------------
// loadOrCreateSigningKey tests
// ---------------------------------------------------------------------------

func TestLoadOrCreateSigningKey_New(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "signing.key")

	key, err := loadOrCreateSigningKey(path)
	if err != nil {
		t.Fatalf("loadOrCreateSigningKey (new): %v", err)
	}
	if len(key) != 32 {
		t.Errorf("key length = %d, want 32", len(key))
	}

	// File must have been written.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile after key generation: %v", err)
	}
	if string(data) != string(key) {
		t.Error("written key does not match returned key")
	}
}

func TestLoadOrCreateSigningKey_Existing(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "signing.key")

	// Write a known 32-byte key.
	want := make([]byte, 32)
	for i := range want {
		want[i] = byte(i)
	}
	if err := os.WriteFile(path, want, 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	got, err := loadOrCreateSigningKey(path)
	if err != nil {
		t.Fatalf("loadOrCreateSigningKey (existing): %v", err)
	}
	if string(got) != string(want) {
		t.Error("loaded key does not match the key that was written")
	}
}

func TestLoadOrCreateSigningKey_InvalidDir(t *testing.T) {
	t.Parallel()
	// Path inside a non-existent directory that we can't create because a
	// regular file sits in the way of MkdirAll.
	dir := t.TempDir()
	blockingFile := filepath.Join(dir, "notadir")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	// Key path whose parent ("notadir/sub") cannot be created.
	path := filepath.Join(blockingFile, "sub", "signing.key")

	_, err := loadOrCreateSigningKey(path)
	if err == nil {
		t.Error("loadOrCreateSigningKey with invalid dir: expected error, got nil")
	}
}
