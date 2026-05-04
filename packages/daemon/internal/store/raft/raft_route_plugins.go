package raft

import (
	"context"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *raftTx) GetRouteOASConfig(_ context.Context, _ string) (*store.RouteOASConfig, error) {
	return nil, fmt.Errorf("raft: GetRouteOASConfig not implemented")
}
func (t *raftTx) UpsertRouteOASConfig(_ context.Context, _ *store.RouteOASConfig) (*store.RouteOASConfig, error) {
	return nil, fmt.Errorf("raft: UpsertRouteOASConfig not implemented")
}
func (t *raftTx) DeleteRouteOASConfig(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteRouteOASConfig not implemented")
}
func (t *raftTx) GetRouteWAFConfig(_ context.Context, _ string) (*store.RouteWAFConfig, error) {
	return nil, fmt.Errorf("raft: GetRouteWAFConfig not implemented")
}
func (t *raftTx) UpsertRouteWAFConfig(_ context.Context, _ *store.RouteWAFConfig) (*store.RouteWAFConfig, error) {
	return nil, fmt.Errorf("raft: UpsertRouteWAFConfig not implemented")
}
func (t *raftTx) DeleteRouteWAFConfig(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteRouteWAFConfig not implemented")
}
func (t *raftTx) AppendWAFDenial(_ context.Context, _ *store.WAFDenial) error {
	return fmt.Errorf("raft: AppendWAFDenial not implemented")
}
func (t *raftTx) QueryWAFDenials(_ context.Context, _ store.WAFDenialQuery) ([]*store.WAFDenial, error) {
	return nil, fmt.Errorf("raft: QueryWAFDenials not implemented")
}
func (t *raftTx) PruneWAFDenials(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("raft: PruneWAFDenials not implemented")
}
