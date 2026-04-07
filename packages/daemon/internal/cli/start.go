package cli

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/daemon"
	"github.com/spf13/cobra"
)

func newStartCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "start",
		Short: "Start the Rioku daemon (foreground)",
		Long:  `Starts the daemon in the foreground. Use Ctrl+C or 'rku stop' to shut down.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runStart()
		},
	}
}

func runStart() error {
	cfgPath := flagConfigFile
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	d := daemon.New(cfg, cfgPath)

	// Set up signal handling.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		log.Printf("received signal: %s", sig)
		cancel()
	}()

	log.Println("daemon: starting...")
	if err := d.Start(ctx); err != nil {
		return fmt.Errorf("daemon: %w", err)
	}

	return nil
}
