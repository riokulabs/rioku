package mysql

import (
	"context"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *tx) GetRouteOASConfig(_ context.Context, _ string) (*store.RouteOASConfig, error) {
	return nil, fmt.Errorf("mysql: GetRouteOASConfig not implemented")
}
func (t *tx) UpsertRouteOASConfig(_ context.Context, _ *store.RouteOASConfig) (*store.RouteOASConfig, error) {
	return nil, fmt.Errorf("mysql: UpsertRouteOASConfig not implemented")
}
func (t *tx) DeleteRouteOASConfig(_ context.Context, _ string) error {
	return fmt.Errorf("mysql: DeleteRouteOASConfig not implemented")
}
func (t *tx) GetRouteWAFConfig(_ context.Context, _ string) (*store.RouteWAFConfig, error) {
	return nil, fmt.Errorf("mysql: GetRouteWAFConfig not implemented")
}
func (t *tx) UpsertRouteWAFConfig(_ context.Context, _ *store.RouteWAFConfig) (*store.RouteWAFConfig, error) {
	return nil, fmt.Errorf("mysql: UpsertRouteWAFConfig not implemented")
}
func (t *tx) DeleteRouteWAFConfig(_ context.Context, _ string) error {
	return fmt.Errorf("mysql: DeleteRouteWAFConfig not implemented")
}
func (t *tx) AppendWAFDenial(_ context.Context, _ *store.WAFDenial) error {
	return fmt.Errorf("mysql: AppendWAFDenial not implemented")
}
func (t *tx) QueryWAFDenials(_ context.Context, _ store.WAFDenialQuery) ([]*store.WAFDenial, error) {
	return nil, fmt.Errorf("mysql: QueryWAFDenials not implemented")
}
func (t *tx) PruneWAFDenials(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("mysql: PruneWAFDenials not implemented")
}
