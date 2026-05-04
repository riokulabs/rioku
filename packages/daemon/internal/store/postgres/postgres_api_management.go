package postgres

import (
	"context"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

// API-management Tx methods are stubbed for postgres until the
// SQLite v1 implementation soaks. Migrations 30-33 land across
// all three dialects so the schema is ready; the Go-side queries
// follow as their own commit.

func (t *tx) CreatePlan(_ context.Context, _ store.CreatePlanParams) (*store.Plan, error) {
	return nil, fmt.Errorf("postgres: CreatePlan not implemented")
}
func (t *tx) GetPlan(_ context.Context, _ string) (*store.Plan, error) {
	return nil, fmt.Errorf("postgres: GetPlan not implemented")
}
func (t *tx) ListPlans(_ context.Context) ([]*store.Plan, error) {
	return nil, fmt.Errorf("postgres: ListPlans not implemented")
}
func (t *tx) ListPlansByAPI(_ context.Context, _ string) ([]*store.Plan, error) {
	return nil, fmt.Errorf("postgres: ListPlansByAPI not implemented")
}
func (t *tx) UpdatePlan(_ context.Context, _ string, _ store.UpdatePlanParams) (*store.Plan, error) {
	return nil, fmt.Errorf("postgres: UpdatePlan not implemented")
}
func (t *tx) TransitionPlan(_ context.Context, _ string, _ store.PlanStatus) (*store.Plan, error) {
	return nil, fmt.Errorf("postgres: TransitionPlan not implemented")
}
func (t *tx) DeletePlan(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeletePlan not implemented")
}

func (t *tx) CreateApplication(_ context.Context, _ store.CreateApplicationParams) (*store.Application, error) {
	return nil, fmt.Errorf("postgres: CreateApplication not implemented")
}
func (t *tx) GetApplication(_ context.Context, _ string) (*store.Application, error) {
	return nil, fmt.Errorf("postgres: GetApplication not implemented")
}
func (t *tx) ListApplications(_ context.Context) ([]*store.Application, error) {
	return nil, fmt.Errorf("postgres: ListApplications not implemented")
}
func (t *tx) UpdateApplication(_ context.Context, _ string, _ store.UpdateApplicationParams) (*store.Application, error) {
	return nil, fmt.Errorf("postgres: UpdateApplication not implemented")
}
func (t *tx) TransitionApplication(_ context.Context, _ string, _ store.ApplicationStatus) (*store.Application, error) {
	return nil, fmt.Errorf("postgres: TransitionApplication not implemented")
}
func (t *tx) DeleteApplication(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeleteApplication not implemented")
}

func (t *tx) CreateSubscription(_ context.Context, _ store.CreateSubscriptionParams) (*store.Subscription, error) {
	return nil, fmt.Errorf("postgres: CreateSubscription not implemented")
}
func (t *tx) GetSubscription(_ context.Context, _ string) (*store.Subscription, error) {
	return nil, fmt.Errorf("postgres: GetSubscription not implemented")
}
func (t *tx) ListSubscriptions(_ context.Context) ([]*store.Subscription, error) {
	return nil, fmt.Errorf("postgres: ListSubscriptions not implemented")
}
func (t *tx) ListSubscriptionsByApplication(_ context.Context, _ string) ([]*store.Subscription, error) {
	return nil, fmt.Errorf("postgres: ListSubscriptionsByApplication not implemented")
}
func (t *tx) ListSubscriptionsByPlan(_ context.Context, _ string) ([]*store.Subscription, error) {
	return nil, fmt.Errorf("postgres: ListSubscriptionsByPlan not implemented")
}
func (t *tx) UpdateSubscription(_ context.Context, _ string, _ store.UpdateSubscriptionParams) (*store.Subscription, error) {
	return nil, fmt.Errorf("postgres: UpdateSubscription not implemented")
}
func (t *tx) TransitionSubscription(_ context.Context, _ string, _ store.SubscriptionStatus, _ string) (*store.Subscription, error) {
	return nil, fmt.Errorf("postgres: TransitionSubscription not implemented")
}
