package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/spf13/cobra"
)

func newAuditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "audit",
		Short: "View audit log",
	}
	cmd.AddCommand(newAuditListCmd())
	return cmd
}

func newAuditListCmd() *cobra.Command {
	var (
		limit    int
		since    string
		actor    string
		resource string
	)

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List audit log entries",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := newAPIClient()
			ctx := context.Background()

			params := url.Values{}
			if actor != "" {
				params.Set("actor", actor)
			}
			if resource != "" {
				params.Set("entityType", resource)
			}
			if since != "" {
				params.Set("since", since)
			}
			if limit > 0 {
				params.Set("page.pageSize", fmt.Sprintf("%d", limit))
			}

			path := "/api/v1/audit"
			if len(params) > 0 {
				path += "?" + params.Encode()
			}

			data, err := client.Get(ctx, path)
			if err != nil {
				return err
			}

			// The audit endpoint returns a streaming response.
			// grpc-gateway wraps it as {"result": {...}} per entry.
			var entries []json.RawMessage

			// Try parsing as array first (in case gateway returns array).
			if err := json.Unmarshal(data, &entries); err != nil {
				// Try as newline-delimited JSON (streaming response).
				var single json.RawMessage
				if json.Unmarshal(data, &single) == nil {
					entries = []json.RawMessage{single}
				}
			}

			type auditRow struct {
				ID        string `json:"id"`
				Actor     string `json:"actor"`
				Entity    string `json:"entityType"`
				EntityID  string `json:"entityId"`
				Operation string `json:"operation"`
				Version   int64  `json:"configVersion"`
				At        string `json:"occurredAt"`
			}

			var rows [][]string
			var parsed []auditRow
			for _, raw := range entries {
				// Handle grpc-gateway streaming wrapper.
				var wrapper struct {
					Result json.RawMessage `json:"result"`
				}
				entry := raw
				if json.Unmarshal(raw, &wrapper) == nil && wrapper.Result != nil {
					entry = wrapper.Result
				}

				var r auditRow
				_ = json.Unmarshal(entry, &r)
				parsed = append(parsed, r)
				rows = append(rows, []string{
					truncate(r.ID, 12),
					r.Actor,
					r.Entity,
					truncate(r.EntityID, 12),
					r.Operation,
					fmt.Sprintf("%d", r.Version),
					r.At,
				})
			}

			headers := []string{"ID", "ACTOR", "ENTITY", "ENTITY_ID", "OP", "VERSION", "AT"}
			return printRows(headers, rows, parsed)
		},
	}

	cmd.Flags().IntVar(&limit, "limit", 20, "max entries to show")
	cmd.Flags().StringVar(&since, "since", "", "show entries since (RFC3339)")
	cmd.Flags().StringVar(&actor, "actor", "", "filter by actor")
	cmd.Flags().StringVar(&resource, "resource", "", "filter by resource type")

	return cmd
}
