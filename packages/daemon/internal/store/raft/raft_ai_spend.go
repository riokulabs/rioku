package raft

import (
	"context"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *raftTx) AppendAISpendLog(_ context.Context, _ *store.AISpendLog) error {
	return fmt.Errorf("raft: AppendAISpendLog not implemented")
}
func (t *raftTx) GetAISpendLog(_ context.Context, _ string) (*store.AISpendLog, error) {
	return nil, fmt.Errorf("raft: GetAISpendLog not implemented")
}
func (t *raftTx) QueryAISpendLogs(_ context.Context, _ store.AISpendQuery) ([]*store.AISpendLog, error) {
	return nil, fmt.Errorf("raft: QueryAISpendLogs not implemented")
}
func (t *raftTx) PruneAISpendLogs(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("raft: PruneAISpendLogs not implemented")
}
func (t *raftTx) AggregateAISpendDay(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("raft: AggregateAISpendDay not implemented")
}
func (t *raftTx) QueryAISpendRollups(_ context.Context, _ store.AISpendRollupQuery) ([]*store.AISpendRollup, error) {
	return nil, fmt.Errorf("raft: QueryAISpendRollups not implemented")
}
