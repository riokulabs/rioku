package caddy

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// httpClient is used for all Caddy admin API calls with a sensible timeout.
var httpClient = &http.Client{Timeout: 10 * time.Second}

// ManagerConfig holds settings for the Caddy process manager.
// Mirrors config.CaddyConfig to avoid import cycles.
type ManagerConfig struct {
	Binary    string
	AdminAddr string
	DataDir   string
}

// Manager manages the Caddy child process lifecycle.
type Manager struct {
	mu      sync.Mutex
	cfg     ManagerConfig
	cmd     *exec.Cmd
	running bool
	done    chan struct{} // closed when child process exits
}

// NewManager creates a new Caddy process manager.
func NewManager(cfg ManagerConfig) *Manager {
	return &Manager{cfg: cfg}
}

// Start launches the Caddy child process.
func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	binary := m.cfg.Binary
	if binary == "" {
		binary = "caddy"
	}

	// Check if binary exists.
	path, err := exec.LookPath(binary)
	if err != nil {
		// Also check data_dir/bin/caddy.
		altPath := m.cfg.DataDir + "/../bin/caddy"
		if _, statErr := os.Stat(altPath); statErr == nil {
			path = altPath
		} else {
			return fmt.Errorf("caddy binary not found: %w", err)
		}
	}

	cmd := exec.CommandContext(ctx, path, "run", "--config", "-", "--adapter", "")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Provide minimal Caddy config via stdin.
	minimalConfig := fmt.Sprintf(`{"admin":{"listen":"%s"}}`, m.cfg.AdminAddr)
	cmd.Stdin = bytes.NewReader([]byte(minimalConfig))

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start caddy: %w", err)
	}

	m.cmd = cmd
	m.running = true
	m.done = make(chan struct{})

	// Monitor child process in background.
	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		m.running = false
		m.mu.Unlock()
		if err != nil {
			log.Printf("caddy: process exited: %v", err)
		}
		close(m.done)
	}()

	// Wait for admin API to be ready.
	if err := m.waitReady(5 * time.Second); err != nil {
		log.Printf("caddy: admin API not ready: %v", err)
	}

	return nil
}

// Stop gracefully stops the Caddy process.
func (m *Manager) Stop(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cmd == nil || m.cmd.Process == nil || !m.running {
		return nil
	}

	// Send SIGTERM.
	if err := m.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		return fmt.Errorf("signal caddy: %w", err)
	}

	// Wait for the monitoring goroutine to signal process exit.
	select {
	case <-m.done:
		m.running = false
		return nil
	case <-time.After(10 * time.Second):
		m.cmd.Process.Kill()
		<-m.done // wait for monitor goroutine to finish
		m.running = false
		return fmt.Errorf("caddy: force killed after timeout")
	case <-ctx.Done():
		m.cmd.Process.Kill()
		<-m.done
		m.running = false
		return ctx.Err()
	}
}

// IsRunning returns whether the Caddy process is alive.
func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

// PushConfig sends a full config to Caddy's admin API.
func (m *Manager) PushConfig(ctx context.Context, configJSON []byte) error {
	url := fmt.Sprintf("http://%s/config/", m.cfg.AdminAddr)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(configJSON))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("push config: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("caddy admin API returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// Health checks if Caddy's admin API is reachable.
func (m *Manager) Health(ctx context.Context) error {
	url := fmt.Sprintf("http://%s/config/", m.cfg.AdminAddr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// waitReady polls the admin API until it responds or timeout.
func (m *Manager) waitReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		url := fmt.Sprintf("http://%s/config/", m.cfg.AdminAddr)
		resp, err := httpClient.Get(url)
		if err == nil {
			resp.Body.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("caddy admin API not ready after %v", timeout)
}
