package cli

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/spf13/cobra"

	_ "github.com/riokulabs/rioku/internal/store/raft"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func newKeyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "key",
		Short: "Manage API keys",
	}

	cmd.AddCommand(
		newKeyCreateCmd(),
		newKeyListCmd(),
		newKeyRevokeCmd(),
	)

	return cmd
}

func newKeyCreateCmd() *cobra.Command {
	var (
		name    string
		scopes  string
		expires string
	)

	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new API key",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runKeyCreate(name, scopes, expires)
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "key name (required)")
	cmd.Flags().StringVar(&scopes, "scopes", "admin", "comma-separated scopes")
	cmd.Flags().StringVar(&expires, "expires", "", "expiration duration (e.g. 30d, 8760h)")
	cmd.MarkFlagRequired("name")

	return cmd
}

func newKeyListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List API keys",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runKeyList()
		},
	}
}

func newKeyRevokeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "revoke <id>",
		Short: "Revoke an API key",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runKeyRevoke(args[0])
		},
	}
}

func runKeyCreate(name, scopesStr, expiresStr string) error {
	st, cleanup, err := openStoreForCLI()
	if err != nil {
		return err
	}
	defer cleanup()

	ctx := context.Background()

	// Generate the raw key.
	rawKey, err := auth.GenerateBootstrapToken()
	if err != nil {
		return fmt.Errorf("generate key: %w", err)
	}
	hash := auth.HashToken(rawKey)

	scopes := strings.Split(scopesStr, ",")

	var expiresAt *time.Time
	if expiresStr != "" {
		d, err := time.ParseDuration(expiresStr)
		if err != nil {
			return fmt.Errorf("invalid expires duration %q: %w", expiresStr, err)
		}
		t := time.Now().Add(d)
		expiresAt = &t
	}

	tx, err := st.Begin(ctx, store.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	id, err := tx.CreateAPIKey(ctx, name, hash, scopes, expiresAt)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("create key: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	fmt.Printf("API key created:\n")
	fmt.Printf("  ID:     %s\n", id)
	fmt.Printf("  Name:   %s\n", name)
	fmt.Printf("  Key:    %s\n", rawKey)
	fmt.Printf("  Scopes: %s\n", scopesStr)
	if expiresAt != nil {
		fmt.Printf("  Expires: %s\n", expiresAt.Format(time.RFC3339))
	}
	fmt.Println("\n  Save this key — it will not be shown again.")

	return nil
}

func runKeyList() error {
	st, cleanup, err := openStoreForCLI()
	if err != nil {
		return err
	}
	defer cleanup()

	ctx := context.Background()
	tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	keys, err := tx.ListAPIKeys(ctx)
	if err != nil {
		return fmt.Errorf("list keys: %w", err)
	}

	if len(keys) == 0 {
		fmt.Println("No API keys found.")
		return nil
	}

	fmt.Printf("%-36s  %-20s  %-20s  %-20s\n", "ID", "NAME", "SCOPES", "CREATED")
	for _, k := range keys {
		// Skip refresh tokens in listing.
		if strings.HasPrefix(k.Name, "refresh:") {
			continue
		}
		fmt.Printf("%-36s  %-20s  %-20s  %-20s\n",
			k.ID, k.Name,
			strings.Join(k.Scopes, ","),
			k.CreatedAt.Format("2006-01-02 15:04"),
		)
	}

	return nil
}

func runKeyRevoke(id string) error {
	st, cleanup, err := openStoreForCLI()
	if err != nil {
		return err
	}
	defer cleanup()

	ctx := context.Background()
	tx, err := st.Begin(ctx, store.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	if err := tx.RevokeAPIKey(ctx, id); err != nil {
		tx.Rollback()
		return fmt.Errorf("revoke key: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	fmt.Printf("API key %s revoked.\n", id)
	return nil
}

// openStoreForCLI opens the store directly for CLI commands that
// don't go through the daemon's gRPC API.
func openStoreForCLI() (store.Driver, func(), error) {
	cfgPath := flagConfigFile
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(ExitGeneralError)
	}

	drv, err := store.New(cfg.Store.Driver)
	if err != nil {
		return nil, nil, fmt.Errorf("create store: %w", err)
	}

	ctx := context.Background()
	driverCfg := store.DriverConfig{
		Driver: cfg.Store.Driver,
		Path:   cfg.Store.SQLite.Path,
	}
	if err := drv.Open(ctx, driverCfg); err != nil {
		return nil, nil, fmt.Errorf("open store: %w", err)
	}

	return drv, func() { drv.Close() }, nil
}
