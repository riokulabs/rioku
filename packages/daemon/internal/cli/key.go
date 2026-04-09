package cli

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
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
			client := newAPIClient()
			ctx := context.Background()

			body := map[string]any{
				"name":   name,
				"scopes": scopes,
			}
			if expires != "" {
				body["expires"] = expires
			}

			data, err := client.Post(ctx, "/api/v1/keys", body)
			if err != nil {
				return err
			}

			var result struct {
				ID  string `json:"id"`
				Key string `json:"key"`
			}
			_ = json.Unmarshal(data, &result)

			fmt.Printf("API key created:\n")
			fmt.Printf("  ID:  %s\n", result.ID)
			fmt.Printf("  Key: %s\n", result.Key)
			fmt.Println("\n  Save this key — it will not be shown again.")
			return nil
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "key name (required)")
	cmd.Flags().StringVar(&scopes, "scopes", "admin", "comma-separated scopes")
	cmd.Flags().StringVar(&expires, "expires", "", "expiration duration (e.g. 30d, 8760h)")
	_ = cmd.MarkFlagRequired("name")

	return cmd
}

func newKeyListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List API keys",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := client.Get(ctx, "/api/v1/keys")
			if err != nil {
				return err
			}

			var keys []struct {
				ID        string   `json:"id"`
				Name      string   `json:"name"`
				Scopes    []string `json:"scopes"`
				CreatedAt string   `json:"created_at"`
			}
			_ = json.Unmarshal(data, &keys)

			headers := []string{"ID", "NAME", "SCOPES", "CREATED"}
			var rows [][]string
			for _, k := range keys {
				rows = append(rows, []string{
					k.ID, k.Name, fmt.Sprintf("%v", k.Scopes), k.CreatedAt,
				})
			}
			return printRows(headers, rows, keys)
		},
	}
}

func newKeyRevokeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "revoke <id>",
		Short: "Revoke an API key",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			if err := client.Delete(ctx, "/api/v1/keys/"+args[0]); err != nil {
				return err
			}
			fmt.Printf("API key %s revoked.\n", args[0])
			return nil
		},
	}
}
