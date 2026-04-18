// Package cli implements the rioku CLI using cobra.
// The binary name is "rioku" with "rku" as a shell alias.
package cli

import (
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
)

// Exit codes per CLI design spec.
const (
	ExitSuccess           = 0
	ExitGeneralError      = 1
	ExitUsageError        = 2
	ExitDaemonUnreachable = 3
	ExitAuthFailure       = 4
	ExitNotFound          = 5
)

// Global flag values.
var (
	flagProfile    string
	flagDaemonAddr string
	flagToken      string
	flagOutput     string
	flagNoColor    bool
	flagConfigFile string
	flagTimeout    time.Duration
)

var rootCmd = &cobra.Command{
	Use:           "rioku",
	Short:         "Rioku — open-source API + AI gateway",
	Long:          `Rioku is an open-source, AI-native API gateway platform built on Caddy.`,
	SilenceUsage:  true,
	SilenceErrors: true,
}

func init() {
	pf := rootCmd.PersistentFlags()
	pf.StringVar(&flagProfile, "profile", "", "use named profile from config file")
	pf.StringVar(&flagDaemonAddr, "daemon-addr", "", "daemon address (gRPC)")
	pf.StringVar(&flagToken, "token", "", "auth token")
	pf.StringVar(&flagOutput, "output", "table", "output format: table|json|yaml|text")
	pf.BoolVar(&flagNoColor, "no-color", false, "disable ANSI color output")
	pf.StringVar(&flagConfigFile, "config-file", "", "config file path override")
	pf.DurationVar(&flagTimeout, "timeout", 30*time.Second, "request timeout")

	rootCmd.AddCommand(
		newInitCmd(),
		newStartCmd(),
		newStopCmd(),
		newStatusCmd(),
		newVersionCmd(),
		newKeyCmd(),
		newRouteCmd(),
		newServiceCmd(),
		newPolicyCmd(),
		newConfigCmd(),
		newAuditCmd(),
		newMigrateCmd(),
		newSeedCmd(),
	)
}

// Execute runs the root cobra command.
func Execute() error {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return err
	}
	return nil
}
