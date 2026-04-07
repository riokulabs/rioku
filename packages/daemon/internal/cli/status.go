package cli

import (
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
		Long:  `Shows whether the daemon is running, its PID, uptime, and subsystem health.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runStatus()
		},
	}
}

func runStatus() error {
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

	// Read PID file modification time as approximate start time.
	info, _ := os.Stat(pidFile)
	var uptime time.Duration
	if info != nil {
		uptime = time.Since(info.ModTime())
	}

	fmt.Printf("Daemon: running (pid %d)\n", pid)
	fmt.Printf("  Uptime: %s\n", uptime.Truncate(time.Second))

	if cfg != nil {
		fmt.Printf("  Store:  %s\n", cfg.Store.Driver)
		fmt.Printf("  gRPC:   %s\n", cfg.Listen.GRPC)
		fmt.Printf("  REST:   %s\n", cfg.Listen.REST)
		fmt.Printf("  Caddy:  %s\n", cfg.Caddy.AdminAddr)
	}

	return nil
}
