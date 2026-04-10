package caddy

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// restoreHTTPClient restores the package-level httpClient after a test.
func restoreHTTPClient(orig *http.Client) func() {
	return func() { httpClient = orig }
}

// ---------------------------------------------------------------------------
// NewManager / IsRunning
// ---------------------------------------------------------------------------

func TestNewManager(t *testing.T) {
	m := NewManager(ManagerConfig{
		Binary:    "/usr/bin/caddy",
		AdminAddr: "127.0.0.1:2019",
		DataDir:   t.TempDir(),
	})
	if m == nil {
		t.Fatal("NewManager returned nil")
	}
	if m.IsRunning() {
		t.Error("newly created Manager should not be running")
	}
}

func TestIsRunning_AfterSetTrue(t *testing.T) {
	m := NewManager(ManagerConfig{AdminAddr: "127.0.0.1:2019", DataDir: t.TempDir()})
	if m.IsRunning() {
		t.Fatal("expected false before setting running")
	}
	m.mu.Lock()
	m.running = true
	m.mu.Unlock()
	if !m.IsRunning() {
		t.Error("expected true after setting running=true")
	}
}

// ---------------------------------------------------------------------------
// PushConfig
// ---------------------------------------------------------------------------

func TestPushConfig_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/config/apps" {
			t.Errorf("expected /config/apps, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Replace httpClient with one that talks to the test server.
	orig := httpClient
	httpClient = srv.Client()
	defer restoreHTTPClient(orig)()

	m := NewManager(ManagerConfig{AdminAddr: srv.Listener.Addr().String(), DataDir: t.TempDir()})
	configJSON := []byte(`{"apps":{"http":{"servers":{}}}}`)

	if err := m.PushConfig(context.Background(), configJSON); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPushConfig_NoAppsSection(t *testing.T) {
	m := NewManager(ManagerConfig{AdminAddr: "127.0.0.1:2019", DataDir: t.TempDir()})
	configJSON := []byte(`{"logging":{}}`)

	err := m.PushConfig(context.Background(), configJSON)
	if err == nil {
		t.Fatal("expected error for missing apps section, got nil")
	}
}

func TestPushConfig_InvalidJSON(t *testing.T) {
	m := NewManager(ManagerConfig{AdminAddr: "127.0.0.1:2019", DataDir: t.TempDir()})
	configJSON := []byte(`not valid json`)

	err := m.PushConfig(context.Background(), configJSON)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestPushConfig_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer srv.Close()

	orig := httpClient
	httpClient = srv.Client()
	defer restoreHTTPClient(orig)()

	m := NewManager(ManagerConfig{AdminAddr: srv.Listener.Addr().String(), DataDir: t.TempDir()})
	configJSON := []byte(`{"apps":{"http":{}}}`)

	err := m.PushConfig(context.Background(), configJSON)
	if err == nil {
		t.Fatal("expected error for 500 response, got nil")
	}
}

func TestPushConfig_ConnectionRefused(t *testing.T) {
	// Use a port that nothing is listening on.
	m := NewManager(ManagerConfig{AdminAddr: "127.0.0.1:19999", DataDir: t.TempDir()})

	orig := httpClient
	httpClient = &http.Client{Timeout: 500 * time.Millisecond}
	defer restoreHTTPClient(orig)()

	configJSON := []byte(`{"apps":{}}`)
	err := m.PushConfig(context.Background(), configJSON)
	if err == nil {
		t.Fatal("expected error when server is unreachable, got nil")
	}
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

func TestHealth_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/config/" {
			t.Errorf("expected /config/, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	orig := httpClient
	httpClient = srv.Client()
	defer restoreHTTPClient(orig)()

	m := NewManager(ManagerConfig{AdminAddr: srv.Listener.Addr().String(), DataDir: t.TempDir()})
	if err := m.Health(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestHealth_ServerDown(t *testing.T) {
	orig := httpClient
	httpClient = &http.Client{Timeout: 500 * time.Millisecond}
	defer restoreHTTPClient(orig)()

	m := NewManager(ManagerConfig{AdminAddr: "127.0.0.1:19998", DataDir: t.TempDir()})
	if err := m.Health(context.Background()); err == nil {
		t.Fatal("expected error when server is down, got nil")
	}
}

// ---------------------------------------------------------------------------
// waitReady
// ---------------------------------------------------------------------------

func TestWaitReady_ImmediateSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	orig := httpClient
	httpClient = srv.Client()
	defer restoreHTTPClient(orig)()

	m := NewManager(ManagerConfig{AdminAddr: srv.Listener.Addr().String(), DataDir: t.TempDir()})
	if err := m.waitReady(2 * time.Second); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestWaitReady_Timeout(t *testing.T) {
	orig := httpClient
	httpClient = &http.Client{Timeout: 100 * time.Millisecond}
	defer restoreHTTPClient(orig)()

	m := NewManager(ManagerConfig{AdminAddr: "127.0.0.1:19997", DataDir: t.TempDir()})
	err := m.waitReady(300 * time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
}

// ---------------------------------------------------------------------------
// FindBinary
// ---------------------------------------------------------------------------

func TestFindBinary_InDataDir(t *testing.T) {
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	if err := os.MkdirAll(binDir, 0750); err != nil {
		t.Fatal(err)
	}
	fakeCaddy := filepath.Join(binDir, "caddy")
	if err := os.WriteFile(fakeCaddy, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatal(err)
	}

	// Override LookPath so PATH search fails, forcing dataDir lookup.
	origLookPath := LookPath
	LookPath = func(name string) (string, error) {
		return "", fmt.Errorf("not in PATH")
	}
	defer func() { LookPath = origLookPath }()

	got := FindBinary(dir)
	if got != fakeCaddy {
		t.Errorf("expected %q, got %q", fakeCaddy, got)
	}
}

func TestFindBinary_NotFound(t *testing.T) {
	dir := t.TempDir() // empty — no bin/caddy

	origLookPath := LookPath
	LookPath = func(name string) (string, error) {
		return "", fmt.Errorf("not in PATH")
	}
	defer func() { LookPath = origLookPath }()

	got := FindBinary(dir)
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestFindBinary_InPath(t *testing.T) {
	dir := t.TempDir() // no local binary

	fakePath := "/usr/bin/caddy"
	origLookPath := LookPath
	LookPath = func(name string) (string, error) {
		if name == "caddy" {
			return fakePath, nil
		}
		return "", fmt.Errorf("not found")
	}
	defer func() { LookPath = origLookPath }()

	got := FindBinary(dir)
	if got != fakePath {
		t.Errorf("expected %q, got %q", fakePath, got)
	}
}

func TestFindBinary_DataDirTakesPrecedenceOverPath(t *testing.T) {
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	if err := os.MkdirAll(binDir, 0750); err != nil {
		t.Fatal(err)
	}
	localCaddy := filepath.Join(binDir, "caddy")
	if err := os.WriteFile(localCaddy, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatal(err)
	}

	origLookPath := LookPath
	LookPath = func(name string) (string, error) {
		return "/usr/bin/caddy", nil // PATH also has it
	}
	defer func() { LookPath = origLookPath }()

	// data dir binary should be preferred over PATH.
	got := FindBinary(dir)
	if got != localCaddy {
		t.Errorf("expected local %q, got %q", localCaddy, got)
	}
}
