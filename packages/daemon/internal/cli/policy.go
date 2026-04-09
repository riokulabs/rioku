package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

func newPolicyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "policy",
		Short: "Manage policies",
	}
	cmd.AddCommand(
		newPolicyListCmd(),
		newPolicyGetCmd(),
		newPolicyCreateCmd(),
		newPolicyDeleteCmd(),
	)
	return cmd
}

func newPolicyListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all policies",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := client.Get(ctx, "/api/v1/config")
			if err != nil {
				return err
			}

			var snap struct {
				Policies []json.RawMessage `json:"policies"`
			}
			_ = json.Unmarshal(data, &snap)

			type polSummary struct {
				ID   string `json:"id"`
				Name string `json:"name"`
				Type string `json:"type"`
			}

			var policies []polSummary
			for _, raw := range snap.Policies {
				var p polSummary
				_ = json.Unmarshal(raw, &p)
				policies = append(policies, p)
			}

			headers := []string{"ID", "NAME", "TYPE"}
			var rows [][]string
			for _, p := range policies {
				rows = append(rows, []string{p.ID, p.Name, p.Type})
			}
			return printRows(headers, rows, snap.Policies)
		},
	}
}

func newPolicyGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get <id>",
		Short: "Get policy details",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := client.Get(ctx, "/api/v1/config")
			if err != nil {
				return err
			}

			var snap struct {
				Policies []json.RawMessage `json:"policies"`
			}
			_ = json.Unmarshal(data, &snap)

			for _, raw := range snap.Policies {
				var p struct {
					ID string `json:"id"`
				}
				_ = json.Unmarshal(raw, &p)
				if p.ID == args[0] {
					return printOutput(json.RawMessage(raw))
				}
			}
			return fmt.Errorf("policy %q not found", args[0])
		},
	}
}

func newPolicyCreateCmd() *cobra.Command {
	var (
		name       string
		policyType string
		configStr  string
	)

	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new policy",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			// Parse config: inline JSON or @filepath.
			var config json.RawMessage
			if strings.HasPrefix(configStr, "@") {
				data, err := os.ReadFile(configStr[1:])
				if err != nil {
					return fmt.Errorf("read config file: %w", err)
				}
				config = data
			} else if configStr != "" {
				config = json.RawMessage(configStr)
			} else {
				config = json.RawMessage("{}")
			}

			// Map policy type string to proto enum.
			typeMap := map[string]string{
				"rate-limit":   "POLICY_TYPE_RATE_LIMIT",
				"auth-api-key": "POLICY_TYPE_AUTH_API_KEY",
				"auth-jwt":     "POLICY_TYPE_AUTH_JWT",
				"transform":    "POLICY_TYPE_TRANSFORM",
				"allow-list":   "POLICY_TYPE_ALLOW_LIST",
				"block-list":   "POLICY_TYPE_BLOCK_LIST",
			}
			protoType, ok := typeMap[strings.ToLower(policyType)]
			if !ok {
				return fmt.Errorf("unknown policy type %q (valid: %s)",
					policyType, strings.Join(mapKeys(typeMap), ", "))
			}

			change := map[string]any{
				"policy": map[string]any{
					"action": "UPSERT",
					"policy": map[string]any{
						"name":   name,
						"type":   protoType,
						"config": config,
					},
				},
			}

			data, err := client.Post(ctx, "/api/v1/config", change)
			if err != nil {
				return err
			}
			return printOutput(json.RawMessage(data))
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "policy name (required)")
	cmd.Flags().StringVar(&policyType, "type", "", "policy type (required)")
	cmd.Flags().StringVar(&configStr, "config", "{}", "policy config JSON or @file")
	_ = cmd.MarkFlagRequired("name")
	_ = cmd.MarkFlagRequired("type")

	return cmd
}

func newPolicyDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a policy",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			change := map[string]any{
				"policy": map[string]any{
					"action": "DELETE",
					"id":     args[0],
				},
			}

			_, err := client.Post(ctx, "/api/v1/config", change)
			if err != nil {
				return err
			}
			fmt.Printf("Policy %s deleted.\n", args[0])
			return nil
		},
	}
}

func mapKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
