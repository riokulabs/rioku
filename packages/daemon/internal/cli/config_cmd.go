package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage configuration",
	}
	cmd.AddCommand(
		newConfigExportCmd(),
		newConfigImportCmd(),
		newConfigVersionsCmd(),
	)
	return cmd
}

func newConfigExportCmd() *cobra.Command {
	var outputFile string

	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export current configuration",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := client.Get(ctx, "/api/v1/config")
			if err != nil {
				return err
			}

			// Pretty-print the JSON.
			var pretty json.RawMessage
			if err := json.Unmarshal(data, &pretty); err != nil {
				return err
			}
			formatted, _ := json.MarshalIndent(pretty, "", "  ")

			if outputFile != "" {
				if err := os.WriteFile(outputFile, formatted, 0640); err != nil {
					return fmt.Errorf("write file: %w", err)
				}
				fmt.Printf("Config exported to %s\n", outputFile)
				return nil
			}

			fmt.Println(string(formatted))
			return nil
		},
	}

	cmd.Flags().StringVar(&outputFile, "output-file", "", "write to file instead of stdout")

	return cmd
}

func newConfigImportCmd() *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:   "import",
		Short: "Import configuration from file",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := os.ReadFile(file)
			if err != nil {
				return fmt.Errorf("read file: %w", err)
			}

			// The import endpoint expects ConfigChunk streaming.
			// For REST, we send the full snapshot in one POST.
			resp, err := client.Post(ctx, "/api/v1/config/import", json.RawMessage(data))
			if err != nil {
				return err
			}
			return printOutput(json.RawMessage(resp))
		},
	}

	cmd.Flags().StringVar(&file, "file", "", "config file to import (required)")
	_ = cmd.MarkFlagRequired("file")

	return cmd
}

func newConfigVersionsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "versions",
		Short: "List config snapshot versions",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			// Get current config — the version is in the snapshot.
			data, err := client.Get(ctx, "/api/v1/config")
			if err != nil {
				return err
			}

			var snap struct {
				Version    int64  `json:"version"`
				SnapshotAt string `json:"snapshotAt"`
			}
			_ = json.Unmarshal(data, &snap)

			fmt.Printf("Current version: %d (at %s)\n", snap.Version, snap.SnapshotAt)
			return nil
		},
	}
}
