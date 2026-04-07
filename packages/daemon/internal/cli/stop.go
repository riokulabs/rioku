package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/daemon"
	"github.com/spf13/cobra"
)

func newStopCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the Rioku daemon",
		Long:  `Sends SIGTERM to the running daemon and waits for graceful shutdown.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runStop()
		},
	}
}

func runStop() error {
	if err := requireLocalNode("stop"); err != nil {
		return err
	}

	cfg, dataDir := resolveDataDir()
	_ = cfg

	pidFile := filepath.Join(dataDir, "rioku.pid")
	pid, err := daemon.ReadPIDFile(pidFile)
	if err != nil {
		return fmt.Errorf("daemon is not running (no pid file at %s)", pidFile)
	}

	if !daemon.IsProcessRunning(pid) {
		// Stale PID file.
		daemon.RemovePIDFile(pidFile)
		return fmt.Errorf("daemon is not running (stale pid file, cleaned up)")
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("find process %d: %w", pid, err)
	}

	fmt.Printf("Stopping daemon (pid %d)...\n", pid)
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return fmt.Errorf("send SIGTERM: %w", err)
	}

	// Wait for process to exit.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if !daemon.IsProcessRunning(pid) {
			fmt.Println("Daemon stopped.")
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}

	// Force kill.
	fmt.Println("Daemon did not stop gracefully, sending SIGKILL...")
	proc.Signal(syscall.SIGKILL)
	return nil
}

func resolveDataDir() (*config.Config, string) {
	cfgPath := flagConfigFile
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		return nil, config.DefaultDataDir
	}
	return cfg, cfg.DataDir
}
