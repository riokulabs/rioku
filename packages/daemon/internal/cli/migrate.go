package cli

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	raftstore "github.com/riokulabs/rioku/internal/store/raft"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"github.com/spf13/cobra"
)

// latestMigrationVersion is the highest schema version defined in the
// migration files. Update this when new migrations are added.
const latestMigrationVersion = 4

func newMigrateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Migrate between store backends",
	}
	cmd.AddCommand(
		newMigrateVerifyCmd(),
		newMigrateRunCmd(),
		newMigrateStatusCmd(),
	)
	return cmd
}

func newMigrateVerifyCmd() *cobra.Command {
	var (
		to  string
		dsn string
	)

	cmd := &cobra.Command{
		Use:   "verify",
		Short: "Verify target store connectivity (dry run)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireLocalNode("migrate verify"); err != nil {
				return err
			}

			fmt.Printf("Verifying connectivity to %s...\n", to)

			drv, err := store.New(to)
			if err != nil {
				return fmt.Errorf("unknown store backend %q: %w", to, err)
			}

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			driverCfg := store.DriverConfig{Driver: to, DSN: dsn}
			if err := drv.Open(ctx, driverCfg); err != nil {
				return fmt.Errorf("cannot open %s store: %w", to, err)
			}
			defer func() { _ = drv.Close() }()

			if err := drv.Ping(ctx); err != nil {
				return fmt.Errorf("cannot reach %s store: %w", to, err)
			}

			version, err := drv.CurrentVersion(ctx)
			if err != nil {
				fmt.Printf("  Connected: OK\n")
				fmt.Printf("  Schema:    cannot read version (%v)\n", err)
			} else {
				fmt.Printf("  Connected: OK\n")
				fmt.Printf("  Schema:    version %d (latest: %d)\n", version, latestMigrationVersion)
			}
			return nil
		},
	}

	cmd.Flags().StringVar(&to, "to", "", "target store backend (required)")
	cmd.Flags().StringVar(&dsn, "dsn", "", "target connection string")
	_ = cmd.MarkFlagRequired("to")

	return cmd
}

func newMigrateRunCmd() *cobra.Command {
	var (
		to  string
		dsn string
	)

	cmd := &cobra.Command{
		Use:   "run",
		Short: "Run store migration",
		Long: `Migrate data from the current store backend to a target backend.

This command reads all configuration data (services, routes, policies, users,
API keys, audit log) from the source store and writes it to the target. The
source store is not modified.

The target store must be reachable and empty. Use 'rku migrate verify' first
to check connectivity.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireLocalNode("migrate run"); err != nil {
				return err
			}

			cfg, _ := resolveDataDir()
			if cfg == nil {
				return fmt.Errorf("cannot load config — run 'rku init' first")
			}
			sourceDriver := cfg.Store.Driver
			if sourceDriver == "" {
				sourceDriver = "raft"
			}

			if to == sourceDriver {
				return fmt.Errorf("target driver %q is the same as the current driver", to)
			}

			// Open target store and verify connectivity.
			targetDrv, err := store.New(to)
			if err != nil {
				return fmt.Errorf("unknown target backend %q: %w", to, err)
			}

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			targetCfg := store.DriverConfig{Driver: to, DSN: dsn}
			if err := targetDrv.Open(ctx, targetCfg); err != nil {
				return fmt.Errorf("cannot open target %s store: %w", to, err)
			}
			defer func() { _ = targetDrv.Close() }()

			if err := targetDrv.Ping(ctx); err != nil {
				return fmt.Errorf("cannot reach target %s store: %w", to, err)
			}

			// Run schema migrations on target.
			fmt.Printf("Applying schema migrations on target %s store...\n", to)
			if err := targetDrv.Migrate(ctx, store.MigrateUp); err != nil {
				return fmt.Errorf("target schema migration failed: %w", err)
			}

			// Open source store.
			fmt.Printf("Opening source %s store...\n", sourceDriver)
			sourceDrv, err := openSourceFromConfig(cfg)
			if err != nil {
				return err
			}
			defer func() { _ = sourceDrv.Close() }()

			// Transfer data.
			fmt.Println("Transferring data from source to target...")
			if err := transferData(ctx, sourceDrv, targetDrv); err != nil {
				return fmt.Errorf("data transfer failed: %w", err)
			}

			fmt.Println("Migration complete.")
			fmt.Printf("Update your config to use driver=%q and restart the daemon.\n", to)
			return nil
		},
	}

	cmd.Flags().StringVar(&to, "to", "", "target store backend (required)")
	cmd.Flags().StringVar(&dsn, "dsn", "", "target connection string")
	_ = cmd.MarkFlagRequired("to")

	return cmd
}

func newMigrateStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show current store migration status",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireLocalNode("migrate status"); err != nil {
				return err
			}

			cfg, _ := resolveDataDir()
			if cfg == nil {
				return fmt.Errorf("cannot load config — run 'rku init' first")
			}

			driverName := cfg.Store.Driver
			if driverName == "" {
				driverName = "raft"
			}

			fmt.Printf("Store driver:     %s\n", driverName)

			drv, err := openSourceFromConfig(cfg)
			if err != nil {
				fmt.Printf("Schema version:   unknown (%v)\n", err)
				return nil
			}
			defer func() { _ = drv.Close() }()

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			version, err := drv.CurrentVersion(ctx)
			if err != nil {
				fmt.Printf("Schema version:   unknown (%v)\n", err)
			} else {
				fmt.Printf("Schema version:   %d\n", version)
				fmt.Printf("Latest version:   %d\n", latestMigrationVersion)
				if version >= latestMigrationVersion {
					fmt.Println("Status:           up to date")
				} else {
					fmt.Printf("Status:           %d migration(s) pending\n", latestMigrationVersion-version)
				}
			}

			return nil
		},
	}
}

// openSourceFromConfig opens the store driver using the loaded config.
func openSourceFromConfig(cfg *config.Config) (store.Driver, error) {
	driverName := cfg.Store.Driver
	if driverName == "" {
		driverName = "raft"
	}

	drv, err := store.New(driverName)
	if err != nil {
		return nil, fmt.Errorf("create store driver: %w", err)
	}

	if driverName == "raft" {
		if rd, ok := drv.(*raftstore.Driver); ok {
			nodeID := cfg.Store.Raft.NodeID
			if nodeID == "" {
				nodeID = "node-0"
			}
			bindAddr := cfg.Store.Raft.BindAddr
			if bindAddr == "" {
				bindAddr = "127.0.0.1:7779"
			}
			dataDir := cfg.Store.Raft.DataDir
			if dataDir == "" {
				dataDir = filepath.Join(cfg.DataDir, "raft")
			}
			rd.SetRaftConfig(raftstore.RaftConfig{
				NodeID:        nodeID,
				DataDir:       dataDir,
				BindAddr:      bindAddr,
				AdvertiseAddr: bindAddr,
				Bootstrap:     cfg.Store.Raft.Bootstrap,
			})
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	driverCfg := store.DriverConfig{
		Driver: driverName,
		Path:   cfg.Store.SQLite.Path,
		DSN:    cfg.Store.Postgres.DSN,
	}
	if err := drv.Open(ctx, driverCfg); err != nil {
		return nil, fmt.Errorf("open store: %w", err)
	}

	return drv, nil
}

// transferData copies all configuration data from source to target store.
// CreateService/CreateRoute generate new IDs, so we build a mapping from
// old IDs to new IDs and rewrite foreign key references in routes.
func transferData(ctx context.Context, source, target store.Driver) error {
	srcTx, err := source.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return fmt.Errorf("begin source transaction: %w", err)
	}
	defer func() { _ = srcTx.Rollback() }()

	services, err := srcTx.ListServices(ctx)
	if err != nil {
		return fmt.Errorf("list services: %w", err)
	}

	routes, err := srcTx.ListRoutes(ctx)
	if err != nil {
		return fmt.Errorf("list routes: %w", err)
	}

	policies, err := srcTx.ListPolicies(ctx)
	if err != nil {
		return fmt.Errorf("list policies: %w", err)
	}

	apiKeys, err := srcTx.ListAPIKeys(ctx)
	if err != nil {
		return fmt.Errorf("list API keys: %w", err)
	}

	users, err := srcTx.ListUsers(ctx)
	if err != nil {
		return fmt.Errorf("list users: %w", err)
	}

	// Write to target.
	dstTx, err := target.Begin(ctx, store.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin target transaction: %w", err)
	}

	// Services first — build old→new ID mapping for route references.
	svcIDMap := make(map[string]string, len(services))
	for _, svc := range services {
		oldID := svc.GetId()
		created, err := dstTx.CreateService(ctx, svc)
		if err != nil {
			_ = dstTx.Rollback()
			return fmt.Errorf("write service %q: %w", svc.GetName(), err)
		}
		svcIDMap[oldID] = created.GetId()
	}
	fmt.Printf("  Services:  %d transferred\n", len(services))

	// Policies — build old→new ID mapping for policy bindings.
	polIDMap := make(map[string]string, len(policies))
	for _, pol := range policies {
		oldID := pol.GetId()
		created, err := dstTx.CreatePolicy(ctx, pol)
		if err != nil {
			_ = dstTx.Rollback()
			return fmt.Errorf("write policy %q: %w", pol.GetName(), err)
		}
		polIDMap[oldID] = created.GetId()
	}
	fmt.Printf("  Policies:  %d transferred\n", len(policies))

	// Routes — rewrite service_id references using the ID map.
	for _, rt := range routes {
		if t, ok := rt.GetTarget().(*riokuv1.Route_ServiceId); ok {
			if newID, mapped := svcIDMap[t.ServiceId]; mapped {
				t.ServiceId = newID
			}
		}
		// Rewrite policy_ids.
		for i, pid := range rt.GetPolicyIds() {
			if newID, mapped := polIDMap[pid]; mapped {
				rt.PolicyIds[i] = newID
			}
		}
		if _, err := dstTx.CreateRoute(ctx, rt); err != nil {
			_ = dstTx.Rollback()
			return fmt.Errorf("write route %q: %w", rt.GetName(), err)
		}
	}
	fmt.Printf("  Routes:    %d transferred\n", len(routes))

	for _, key := range apiKeys {
		if _, err := dstTx.CreateAPIKey(ctx, key.Name, key.KeyHash, key.Scopes, key.ExpiresAt, key.OwnerID); err != nil {
			_ = dstTx.Rollback()
			return fmt.Errorf("write API key %q: %w", key.Name, err)
		}
	}
	fmt.Printf("  API keys:  %d transferred\n", len(apiKeys))

	for _, u := range users {
		if _, err := dstTx.CreateUser(ctx, u); err != nil {
			_ = dstTx.Rollback()
			return fmt.Errorf("write user %q: %w", u.Username, err)
		}
	}
	fmt.Printf("  Users:     %d transferred\n", len(users))

	if err := dstTx.Commit(); err != nil {
		return fmt.Errorf("commit target transaction: %w", err)
	}

	return nil
}
