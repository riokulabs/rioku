package cli

import (
	"bufio"
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

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
		storeDriver           string
		dataDir               string
		listenAddr            string
		nonInteractive        bool
		force                 bool
		rootPassword          string
		noForcePasswordChange bool
	)

	cmd := &cobra.Command{
		Use:   "init",
		Short: "Bootstrap a new Rioku instance",
		Long:  `Generates rioku.yaml, initializes the config store, downloads Caddy, and prints the bootstrap token.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runInit(cmd, storeDriver, dataDir, listenAddr, nonInteractive, force, rootPassword, noForcePasswordChange)
		},
	}

	cmd.Flags().StringVar(&storeDriver, "store", "", "store backend (raft, sqlite, postgres, mysql)")
	cmd.Flags().StringVar(&dataDir, "data-dir", "", "data directory")
	cmd.Flags().StringVar(&listenAddr, "listen", "", "listen address for REST API")
	cmd.Flags().BoolVar(&nonInteractive, "non-interactive", false, "suppress prompts, exit 2 on missing flags")
	cmd.Flags().BoolVar(&force, "force", false, "overwrite existing config")
	cmd.Flags().StringVar(&rootPassword, "root-password", "", "set root user password (default: auto-generated)")
	cmd.Flags().BoolVar(&noForcePasswordChange, "no-force-password-change", false, "don't require password change on first login")

	return cmd
}

func runInit(cmd *cobra.Command, storeDriver, dataDir, listenAddr string, nonInteractive, force bool, rootPassword string, noForcePasswordChange bool) error {
	if err := requireLocalNode("init"); err != nil {
		return err
	}

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
		result, err := caddypkg.DownloadBinary(binDir, "", nil)
		if err != nil {
			fmt.Printf("failed: %v\n", err)
			fmt.Println("  (you can install Caddy manually later)")
		} else {
			cfg.Caddy.Binary = result.Path
			fmt.Printf("done (%s)\n", result.Path)
			fmt.Printf("  SHA256: %s\n", result.SHA256)
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
		_ = drv.Close()
		return fmt.Errorf("migrate store: %w", err)
	}
	fmt.Printf("  Store initialized (%s)\n", cfg.Store.Driver)

	// 5. Generate bootstrap token and store its hash.
	token, err := auth.GenerateBootstrapToken()
	if err != nil {
		_ = drv.Close()
		return fmt.Errorf("generate token: %w", err)
	}

	// Wait for raft leader election if using raft store.
	if cfg.Store.Driver == "raft" {
		fmt.Print("  Waiting for store leader election... ")
		for i := 0; i < 50; i++ {
			h := drv.Health(ctx)
			if h.OK && h.Mode == store.ModePrimary {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		fmt.Println("done")
	}

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		_ = drv.Close()
		return fmt.Errorf("begin tx for bootstrap token: %w", err)
	}
	hash := auth.HashToken(token)
	if _, err := tx.CreateAPIKey(ctx, "bootstrap", hash, []string{"admin"}, nil); err != nil {
		_ = tx.Rollback()
		_ = drv.Close()
		return fmt.Errorf("store bootstrap token: %w", err)
	}
	if err := tx.Commit(); err != nil {
		_ = drv.Close()
		return fmt.Errorf("commit bootstrap token: %w", err)
	}

	// Create root user.
	forceChange := !noForcePasswordChange
	generatedPw, err := createRootUser(ctx, drv, rootPassword, forceChange)
	if err != nil {
		_ = drv.Close()
		return fmt.Errorf("create root user: %w", err)
	}

	_ = drv.Close()

	fmt.Printf("\n  Bootstrap token: %s\n", token)
	fmt.Println("  Save this — it will not be shown again.")
	fmt.Println()
	fmt.Println("  Root account created:")
	fmt.Printf("    Username: root\n")
	fmt.Printf("    Password: %s\n", generatedPw)
	fmt.Println()
	fmt.Println("  Save this — it will not be shown again.")
	if forceChange {
		fmt.Println("  You will be required to change this password on first login.")
	}
	fmt.Println()
	fmt.Println("Run 'rku start' to launch the daemon.")
	return nil
}

// createRootUser creates the root account. If password is empty, a random
// password is generated. Returns the plaintext password.
func createRootUser(ctx context.Context, drv store.Driver, password string, forcePasswordChange bool) (string, error) {
	plaintext := password
	if plaintext == "" {
		const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
		const pwLen = 24

		buf := make([]byte, pwLen)
		for i := range buf {
			b := make([]byte, 1)
			for {
				if _, err := rand.Read(b); err != nil {
					return "", fmt.Errorf("generate root password: %w", err)
				}
				if int(b[0]) < len(charset)*(256/len(charset)) {
					buf[i] = charset[int(b[0])%len(charset)]
					break
				}
			}
		}
		plaintext = string(buf)
	}

	hash, err := auth.HashPassword(plaintext)
	if err != nil {
		return "", fmt.Errorf("hash root password: %w", err)
	}

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		return "", err
	}

	now := time.Now().UTC()
	user, err := tx.CreateUser(ctx, &store.User{
		Username:            "root",
		PasswordHash:        hash,
		Status:              "active",
		ForcePasswordChange: forcePasswordChange,
		PasswordChangedAt:   now,
		CreatedAt:           now,
		UpdatedAt:           now,
	})
	if err != nil {
		_ = tx.Rollback()
		return "", fmt.Errorf("create root user: %w", err)
	}

	// Assign superadmin role to root user.
	if err := tx.AssignRole(ctx, user.ID, "role_superadmin", user.ID); err != nil {
		_ = tx.Rollback()
		return "", fmt.Errorf("assign superadmin role to root: %w", err)
	}

	return plaintext, tx.Commit()
}
