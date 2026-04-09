package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

func newServiceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "service",
		Short: "Manage upstream services",
	}
	cmd.AddCommand(
		newServiceListCmd(),
		newServiceGetCmd(),
		newServiceCreateCmd(),
		newServiceDeleteCmd(),
	)
	return cmd
}

func newServiceListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all services",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := client.Get(ctx, "/api/v1/config")
			if err != nil {
				return err
			}

			var snap struct {
				Services []json.RawMessage `json:"services"`
			}
			_ = json.Unmarshal(data, &snap)

			type svcSummary struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				LBPolicy string `json:"lbPolicy"`
			}

			var services []svcSummary
			for _, raw := range snap.Services {
				var s svcSummary
				_ = json.Unmarshal(raw, &s)
				services = append(services, s)
			}

			headers := []string{"ID", "NAME", "LB POLICY"}
			var rows [][]string
			for _, s := range services {
				rows = append(rows, []string{s.ID, s.Name, s.LBPolicy})
			}
			return printRows(headers, rows, snap.Services)
		},
	}
}

func newServiceGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get <id>",
		Short: "Get service details",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := client.Get(ctx, "/api/v1/config")
			if err != nil {
				return err
			}

			var snap struct {
				Services []json.RawMessage `json:"services"`
			}
			_ = json.Unmarshal(data, &snap)

			for _, raw := range snap.Services {
				var s struct {
					ID string `json:"id"`
				}
				_ = json.Unmarshal(raw, &s)
				if s.ID == args[0] {
					return printOutput(json.RawMessage(raw))
				}
			}
			return fmt.Errorf("service %q not found", args[0])
		},
	}
}

func newServiceCreateCmd() *cobra.Command {
	var (
		name      string
		upstreams []string
		lbPolicy  string
	)

	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new service",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			var ups []map[string]any
			for _, u := range upstreams {
				ups = append(ups, map[string]any{"address": u})
			}

			policy := "LB_POLICY_ROUND_ROBIN"
			switch strings.ToLower(lbPolicy) {
			case "round-robin", "roundrobin":
				policy = "LB_POLICY_ROUND_ROBIN"
			case "random":
				policy = "LB_POLICY_RANDOM"
			case "least-conn", "leastconn":
				policy = "LB_POLICY_LEAST_CONN"
			case "ip-hash", "iphash":
				policy = "LB_POLICY_IP_HASH"
			}

			change := map[string]any{
				"service": map[string]any{
					"action": "UPSERT",
					"service": map[string]any{
						"name":      name,
						"upstreams": ups,
						"lbPolicy":  policy,
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

	cmd.Flags().StringVar(&name, "name", "", "service name (required)")
	cmd.Flags().StringSliceVar(&upstreams, "upstream", nil, "upstream address (repeatable)")
	cmd.Flags().StringVar(&lbPolicy, "lb", "round-robin", "load balancing policy")
	_ = cmd.MarkFlagRequired("name")
	_ = cmd.MarkFlagRequired("upstream")

	return cmd
}

func newServiceDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a service",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			change := map[string]any{
				"service": map[string]any{
					"action": "DELETE",
					"id":     args[0],
				},
			}

			_, err := client.Post(ctx, "/api/v1/config", change)
			if err != nil {
				return err
			}
			fmt.Printf("Service %s deleted.\n", args[0])
			return nil
		},
	}
}
