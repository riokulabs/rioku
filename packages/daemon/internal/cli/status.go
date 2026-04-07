package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/riokulabs/rioku/internal/daemon"
	"github.com/spf13/cobra"
)

func newStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show daemon status",
		Long:  `Shows whether the daemon is running, its health, and subsystem status.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runStatus()
		},
	}
}

func runStatus() error {
	// Try REST health endpoint first (works locally and remotely).
	client := newAPIClient()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	data, err := client.Get(ctx, "/api/v1/health")
	if err == nil {
		return printHealthFromREST(data)
	}

	// REST failed — fall back to PID file check (local only).
	cfg, dataDir := resolveDataDir()
	pidFile := filepath.Join(dataDir, "rioku.pid")
	pid, err := daemon.ReadPIDFile(pidFile)
	if err != nil {
		fmt.Println("Daemon: not running")
		os.Exit(ExitDaemonUnreachable)
		return nil
	}

	if !daemon.IsProcessRunning(pid) {
		daemon.RemovePIDFile(pidFile)
		fmt.Println("Daemon: not running (stale pid file cleaned)")
		os.Exit(ExitDaemonUnreachable)
		return nil
	}

	// PID exists but REST is unreachable — daemon is starting up or REST not ready.
	fmt.Printf("Daemon: running (pid %d) but REST API not reachable\n", pid)
	if cfg != nil {
		fmt.Printf("  Store:  %s\n", cfg.Store.Driver)
		fmt.Printf("  REST:   %s\n", cfg.Listen.REST)
	}
	return nil
}

func printHealthFromREST(data []byte) error {
	var health struct {
		Overall string `json:"overall"`
		Store   struct {
			State  string            `json:"state"`
			Detail map[string]string `json:"detail"`
		} `json:"store"`
		Caddy struct {
			State   string `json:"state"`
			Message string `json:"message"`
		} `json:"caddy"`
		Version       string `json:"version"`
		UptimeSeconds string `json:"uptimeSeconds"`
	}
	if err := json.Unmarshal(data, &health); err != nil {
		return printOutput(json.RawMessage(data))
	}

	if flagOutput == "json" || flagOutput == "yaml" {
		return printOutput(json.RawMessage(data))
	}

	stateIcon := map[string]string{
		"HEALTH_STATE_OK":        "OK",
		"HEALTH_STATE_DEGRADED":  "DEGRADED",
		"HEALTH_STATE_UNHEALTHY": "UNHEALTHY",
	}

	fmt.Printf("Daemon: %s (v%s)\n", stateIcon[health.Overall], health.Version)
	fmt.Printf("  Store:  %s", stateIcon[health.Store.State])
	if health.Store.Detail["state"] != "" {
		fmt.Printf(" (%s)", health.Store.Detail["state"])
	}
	fmt.Println()
	fmt.Printf("  Caddy:  %s", stateIcon[health.Caddy.State])
	if health.Caddy.Message != "" {
		fmt.Printf(" (%s)", health.Caddy.Message)
	}
	fmt.Println()

	return nil
}
