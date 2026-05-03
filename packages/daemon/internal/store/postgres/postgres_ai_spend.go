package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// AI spend stubs — postgres ports follow once SQLite v1 soaks.

func (t *tx) AppendAISpendLog(_ context.Context, _ *store.AISpendLog) error {
	return fmt.Errorf("postgres: AppendAISpendLog not implemented")
}
func (t *tx) GetAISpendLog(_ context.Context, _ string) (*store.AISpendLog, error) {
	return nil, fmt.Errorf("postgres: GetAISpendLog not implemented")
}
func (t *tx) QueryAISpendLogs(_ context.Context, _ store.AISpendQuery) ([]*store.AISpendLog, error) {
	return nil, fmt.Errorf("postgres: QueryAISpendLogs not implemented")
}
func (t *tx) PruneAISpendLogs(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("postgres: PruneAISpendLogs not implemented")
}
func (t *tx) AggregateAISpendDay(_ context.Context, _ time.Time) (int64, error) {
	return 0, fmt.Errorf("postgres: AggregateAISpendDay not implemented")
}
func (t *tx) QueryAISpendRollups(_ context.Context, _ store.AISpendRollupQuery) ([]*store.AISpendRollup, error) {
	return nil, fmt.Errorf("postgres: QueryAISpendRollups not implemented")
}
