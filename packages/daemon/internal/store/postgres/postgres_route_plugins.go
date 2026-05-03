package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// Per-route plugin configs are stubbed for postgres until the
// SQLite v1 implementation soaks. Migrations 41-42 land across
// all three dialects so the schema is ready; the Go-side queries
// follow as their own commit.

func (t *tx) GetRouteOASConfig(_ context.Context, _ string) (*store.RouteOASConfig, error) {
	return nil, fmt.Errorf("postgres: GetRouteOASConfig not implemented")
}
func (t *tx) UpsertRouteOASConfig(_ context.Context, _ *store.RouteOASConfig) (*store.RouteOASConfig, error) {
	return nil, fmt.Errorf("postgres: UpsertRouteOASConfig not implemented")
}
func (t *tx) DeleteRouteOASConfig(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeleteRouteOASConfig not implemented")
}
func (t *tx) GetRouteWAFConfig(_ context.Context, _ string) (*store.RouteWAFConfig, error) {
	return nil, fmt.Errorf("postgres: GetRouteWAFConfig not implemented")
}
func (t *tx) UpsertRouteWAFConfig(_ context.Context, _ *store.RouteWAFConfig) (*store.RouteWAFConfig, error) {
	return nil, fmt.Errorf("postgres: UpsertRouteWAFConfig not implemented")
}
func (t *tx) DeleteRouteWAFConfig(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeleteRouteWAFConfig not implemented")
}
func (t *tx) AppendWAFDenial(_ context.Context, _ *store.WAFDenial) error {
	return fmt.Errorf("postgres: AppendWAFDenial not implemented")
}
func (t *tx) QueryWAFDenials(_ context.Context, _ store.WAFDenialQuery) ([]*store.WAFDenial, error) {
	return nil, fmt.Errorf("postgres: QueryWAFDenials not implemented")
}
func (t *tx) PruneWAFDenials(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("postgres: PruneWAFDenials not implemented")
}
