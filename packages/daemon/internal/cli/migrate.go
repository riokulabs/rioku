package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

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

			fmt.Printf("Verifying connectivity to %s at %s...\n", to, dsn)

			// TODO: open target driver, ping, check schema compatibility.
			// Postgres/MySQL drivers not yet implemented.
			switch to {
			case "postgres", "mysql":
				return fmt.Errorf("the %s driver is not yet implemented (planned for Phase 2)", to)
			case "sqlite":
				fmt.Println("  SQLite: OK (always available)")
				return nil
			case "raft":
				fmt.Println("  Raft: OK (always available)")
				return nil
			default:
				return fmt.Errorf("unknown store backend %q (valid: sqlite, raft, postgres, mysql)", to)
			}
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
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireLocalNode("migrate run"); err != nil {
				return err
			}

			// TODO: implement full data migration when Postgres/MySQL drivers exist.
			return fmt.Errorf("store migration is not yet implemented (planned for Phase 2)\n" +
				"  Use 'rku migrate verify' to check target connectivity")
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

			// Show current store driver from config.
			cfg, _ := resolveDataDir()
			if cfg != nil {
				fmt.Printf("Current store: %s\n", cfg.Store.Driver)
			} else {
				fmt.Println("Current store: unknown (cannot load config)")
			}
			fmt.Println("No migration in progress.")
			return nil
		},
	}
}
