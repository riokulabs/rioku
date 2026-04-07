package cli

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

func newRouteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "route",
		Short: "Manage proxy routes",
	}
	cmd.AddCommand(
		newRouteListCmd(),
		newRouteGetCmd(),
		newRouteCreateCmd(),
		newRouteDeleteCmd(),
		newRouteEnableCmd(),
		newRouteDisableCmd(),
	)
	return cmd
}

func newRouteListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all routes",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := client.Get(ctx, "/api/v1/config")
			if err != nil {
				return err
			}

			var snap struct {
				Routes []json.RawMessage `json:"routes"`
			}
			if err := json.Unmarshal(data, &snap); err != nil {
				return fmt.Errorf("parse response: %w", err)
			}

			type routeSummary struct {
				ID      string `json:"id"`
				Name    string `json:"name"`
				Enabled bool   `json:"enabled"`
			}

			var routes []routeSummary
			for _, raw := range snap.Routes {
				var r routeSummary
				json.Unmarshal(raw, &r)
				routes = append(routes, r)
			}

			headers := []string{"ID", "NAME", "ENABLED"}
			var rows [][]string
			for _, r := range routes {
				rows = append(rows, []string{r.ID, r.Name, fmt.Sprintf("%v", r.Enabled)})
			}
			return printRows(headers, rows, snap.Routes)
		},
	}
}

func newRouteGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get <id>",
		Short: "Get route details",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			data, err := client.Get(ctx, "/api/v1/config")
			if err != nil {
				return err
			}

			var snap struct {
				Routes []json.RawMessage `json:"routes"`
			}
			json.Unmarshal(data, &snap)

			for _, raw := range snap.Routes {
				var r struct {
					ID string `json:"id"`
				}
				json.Unmarshal(raw, &r)
				if r.ID == args[0] {
					return printOutput(json.RawMessage(raw))
				}
			}
			return fmt.Errorf("route %q not found", args[0])
		},
	}
}

func newRouteCreateCmd() *cobra.Command {
	var (
		name        string
		matchHost   []string
		matchPath   string
		matchMethod []string
		serviceID   string
		upstream    string
	)

	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new route",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			// Build matchers.
			matcher := map[string]any{}
			if len(matchHost) > 0 {
				matcher["hosts"] = matchHost
			}
			if matchPath != "" {
				matcher["paths"] = []map[string]any{
					{"type": "TYPE_PREFIX", "value": matchPath},
				}
			}
			if len(matchMethod) > 0 {
				matcher["methods"] = matchMethod
			}

			route := map[string]any{
				"name":    name,
				"enabled": true,
			}
			if len(matcher) > 0 {
				route["matchers"] = []any{matcher}
			}
			if serviceID != "" {
				route["serviceId"] = serviceID
			} else if upstream != "" {
				route["upstream"] = map[string]any{"address": upstream}
			}

			change := map[string]any{
				"route": map[string]any{
					"action": "UPSERT",
					"route":  route,
				},
			}

			data, err := client.Post(ctx, "/api/v1/config", change)
			if err != nil {
				return err
			}
			return printOutput(json.RawMessage(data))
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "route name (required)")
	cmd.Flags().StringSliceVar(&matchHost, "match-host", nil, "match hosts")
	cmd.Flags().StringVar(&matchPath, "match-path", "", "match path prefix")
	cmd.Flags().StringSliceVar(&matchMethod, "match-method", nil, "match HTTP methods")
	cmd.Flags().StringVar(&serviceID, "service", "", "target service ID")
	cmd.Flags().StringVar(&upstream, "upstream", "", "direct upstream address (alternative to --service)")
	cmd.MarkFlagRequired("name")

	return cmd
}

func newRouteDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a route",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			change := map[string]any{
				"route": map[string]any{
					"action": "DELETE",
					"id":     args[0],
				},
			}

			_, err := client.Post(ctx, "/api/v1/config", change)
			if err != nil {
				return err
			}
			fmt.Printf("Route %s deleted.\n", args[0])
			return nil
		},
	}
}

func newRouteEnableCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "enable <id>",
		Short: "Enable a route",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return setRouteEnabled(args[0], true)
		},
	}
}

func newRouteDisableCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "disable <id>",
		Short: "Disable a route",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return setRouteEnabled(args[0], false)
		},
	}
}

func setRouteEnabled(id string, enabled bool) error {
	client := newAPIClient()
	ctx := context.Background()

	change := map[string]any{
		"route": map[string]any{
			"action": "UPSERT",
			"route": map[string]any{
				"id":      id,
				"enabled": enabled,
			},
		},
	}

	_, err := client.Post(ctx, "/api/v1/config", change)
	if err != nil {
		return err
	}
	state := "enabled"
	if !enabled {
		state = "disabled"
	}
	fmt.Printf("Route %s %s.\n", id, state)
	return nil
}
