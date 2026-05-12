package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/daemon"
	"github.com/spf13/cobra"
)

var (
	flagSubdomainCert string
	flagSubdomainKey  string
)

func newStartCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start the Rioku daemon (foreground)",
		Long:  `Starts the daemon in the foreground. Use Ctrl+C or 'rku stop' to shut down.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runStart()
		},
	}
	cmd.Flags().StringVar(&flagSubdomainCert, "subdomain-cert", "",
		"path to wildcard TLS certificate for tenant subdomains (e.g. *.example.com); overrides caddy.subdomain_cert_file")
	cmd.Flags().StringVar(&flagSubdomainKey, "subdomain-key", "",
		"path to private key for --subdomain-cert; overrides caddy.subdomain_key_file")
	return cmd
}

func runStart() error {
	if err := requireLocalNode("start"); err != nil {
		return err
	}

	cfgPath := flagConfigFile
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	// --subdomain-cert / --subdomain-key flags override the YAML
	// caddy.subdomain_cert_file / subdomain_key_file fields.
	if flagSubdomainCert != "" {
		cfg.Caddy.SubdomainCertFile = flagSubdomainCert
	}
	if flagSubdomainKey != "" {
		cfg.Caddy.SubdomainKeyFile = flagSubdomainKey
	}

	d := daemon.New(cfg, cfgPath)

	// Set up signal handling.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		slog.Info("received signal", "signal", sig.String())
		cancel()
	}()

	slog.Info("daemon starting")
	if err := d.Start(ctx); err != nil {
		return fmt.Errorf("daemon: %w", err)
	}

	return nil
}
