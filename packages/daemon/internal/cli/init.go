package cli

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/riokulabs/rioku/internal/auth"
	caddypkg "github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	raftstore "github.com/riokulabs/rioku/internal/store/raft"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func newInitCmd() *cobra.Command {
	var (
		storeDriver    string
		dataDir        string
		listenAddr     string
		nonInteractive bool
		force          bool
	)

	cmd := &cobra.Command{
		Use:   "init",
		Short: "Bootstrap a new Rioku instance",
		Long:  `Generates rioku.yaml, initializes the config store, downloads Caddy, and prints the bootstrap token.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runInit(cmd, storeDriver, dataDir, listenAddr, nonInteractive, force)
		},
	}

	cmd.Flags().StringVar(&storeDriver, "store", "", "store backend (raft, sqlite, postgres, mysql)")
	cmd.Flags().StringVar(&dataDir, "data-dir", "", "data directory")
	cmd.Flags().StringVar(&listenAddr, "listen", "", "listen address for REST API")
	cmd.Flags().BoolVar(&nonInteractive, "non-interactive", false, "suppress prompts, exit 2 on missing flags")
	cmd.Flags().BoolVar(&force, "force", false, "overwrite existing config")

	return cmd
}

func runInit(cmd *cobra.Command, storeDriver, dataDir, listenAddr string, nonInteractive, force bool) error {
	cfgPath := flagConfigFile
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath
	}

	// Check if config already exists.
	if _, err := os.Stat(cfgPath); err == nil && !force {
		return fmt.Errorf("config file %s already exists (use --force to overwrite)", cfgPath)
	}

	cfg := config.Default()

	// Interactive prompts.
	if !nonInteractive {
		reader := bufio.NewReader(os.Stdin)

		if storeDriver == "" {
			fmt.Print("  Store backend [raft]: ")
			input, _ := reader.ReadString('\n')
			input = strings.TrimSpace(input)
			if input != "" {
				storeDriver = input
			}
		}
		if dataDir == "" {
			fmt.Printf("  Data directory [%s]: ", config.DefaultDataDir)
			input, _ := reader.ReadString('\n')
			input = strings.TrimSpace(input)
			if input != "" {
				dataDir = input
			}
		}
		if listenAddr == "" {
			fmt.Printf("  REST listen address [%s]: ", cfg.Listen.REST)
			input, _ := reader.ReadString('\n')
			input = strings.TrimSpace(input)
			if input != "" {
				listenAddr = input
			}
		}
	}

	// Apply overrides.
	if storeDriver != "" {
		cfg.Store.Driver = storeDriver
	}
	if dataDir != "" {
		cfg.DataDir = dataDir
	}
	if listenAddr != "" {
		cfg.Listen.REST = listenAddr
	}

	// Apply derived defaults based on final data_dir.
	if cfg.Store.Driver == "sqlite" {
		cfg.Store.SQLite.Path = filepath.Join(cfg.DataDir, "rioku.db")
	}
	if cfg.Store.Driver == "raft" {
		cfg.Store.Raft.DataDir = filepath.Join(cfg.DataDir, "raft")
		cfg.Store.Raft.Bootstrap = true
	}
	cfg.Caddy.DataDir = filepath.Join(cfg.DataDir, "caddy")
	cfg.PKI.Dir = filepath.Join(cfg.DataDir, "pki")
	cfg.Traces.Path = filepath.Join(cfg.DataDir, "traces")

	fmt.Println("Initializing Rioku...")

	// 1. Create data directory.
	if err := os.MkdirAll(cfg.DataDir, 0750); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}

	// 2. Download Caddy if not found.
	if caddypkg.FindBinary(cfg.DataDir) == "" {
		fmt.Print("  Downloading Caddy binary... ")
		binDir := filepath.Join(cfg.DataDir, "bin")
		path, err := caddypkg.DownloadBinary(binDir, nil)
		if err != nil {
			fmt.Printf("failed: %v\n", err)
			fmt.Println("  (you can install Caddy manually later)")
		} else {
			cfg.Caddy.Binary = path
			fmt.Printf("done (%s)\n", path)
		}
	} else {
		cfg.Caddy.Binary = caddypkg.FindBinary(cfg.DataDir)
		fmt.Printf("  Caddy binary found: %s\n", cfg.Caddy.Binary)
	}

	// 3. Write config file.
	if err := os.MkdirAll(filepath.Dir(cfgPath), 0750); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	cfgData, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(cfgPath, cfgData, 0640); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	fmt.Printf("  Config written to %s\n", cfgPath)

	// 4. Initialize store.
	ctx := context.Background()
	drv, err := store.New(cfg.Store.Driver)
	if err != nil {
		return fmt.Errorf("create store driver: %w", err)
	}

	if cfg.Store.Driver == "raft" {
		if rd, ok := drv.(*raftstore.Driver); ok {
			rd.SetRaftConfig(raftstore.RaftConfig{
				NodeID:        cfg.Store.Raft.NodeID,
				DataDir:       cfg.Store.Raft.DataDir,
				BindAddr:      cfg.Store.Raft.BindAddr,
				AdvertiseAddr: cfg.Store.Raft.BindAddr,
				Bootstrap:     true,
			})
		}
	}

	driverCfg := store.DriverConfig{
		Driver: cfg.Store.Driver,
		Path:   cfg.Store.SQLite.Path,
	}
	if err := drv.Open(ctx, driverCfg); err != nil {
		return fmt.Errorf("open store: %w", err)
	}

	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		drv.Close()
		return fmt.Errorf("migrate store: %w", err)
	}
	drv.Close()
	fmt.Printf("  Store initialized (%s)\n", cfg.Store.Driver)

	// 5. Generate bootstrap token.
	token, err := auth.GenerateBootstrapToken()
	if err != nil {
		return fmt.Errorf("generate token: %w", err)
	}
	fmt.Printf("\n  Bootstrap token: %s\n", token)
	fmt.Println("  Save this — it will not be shown again.")

	fmt.Println("\nRun 'rku start' to launch the daemon.")
	return nil
}
