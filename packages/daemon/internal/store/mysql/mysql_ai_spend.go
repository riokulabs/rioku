package mysql

import (
	"context"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *tx) AppendAISpendLog(_ context.Context, _ *store.AISpendLog) error {
	return fmt.Errorf("mysql: AppendAISpendLog not implemented")
}
func (t *tx) GetAISpendLog(_ context.Context, _ string) (*store.AISpendLog, error) {
	return nil, fmt.Errorf("mysql: GetAISpendLog not implemented")
}
func (t *tx) QueryAISpendLogs(_ context.Context, _ store.AISpendQuery) ([]*store.AISpendLog, error) {
	return nil, fmt.Errorf("mysql: QueryAISpendLogs not implemented")
}
func (t *tx) PruneAISpendLogs(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("mysql: PruneAISpendLogs not implemented")
}
func (t *tx) AggregateAISpendDay(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("mysql: AggregateAISpendDay not implemented")
}
func (t *tx) QueryAISpendRollups(_ context.Context, _ store.AISpendRollupQuery) ([]*store.AISpendRollup, error) {
	return nil, fmt.Errorf("mysql: QueryAISpendRollups not implemented")
}
