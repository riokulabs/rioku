package raft

import (
	"context"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

// API-management Tx methods are stubbed for the raft driver.
// Plans / Applications / Subscriptions are admin-config entities;
// they're a natural fit for raft (small writes, replicated reads)
// once the v1 SQLite implementation soaks. Migrations 30-33 do
// not apply to the raft driver — its schema is bbolt buckets.

func (t *raftTx) CreatePlan(_ context.Context, _ store.CreatePlanParams) (*store.Plan, error) {
	return nil, fmt.Errorf("raft: CreatePlan not implemented")
}
func (t *raftTx) GetPlan(_ context.Context, _ string) (*store.Plan, error) {
	return nil, fmt.Errorf("raft: GetPlan not implemented")
}
func (t *raftTx) ListPlans(_ context.Context) ([]*store.Plan, error) {
	return nil, fmt.Errorf("raft: ListPlans not implemented")
}
func (t *raftTx) ListPlansByAPI(_ context.Context, _ string) ([]*store.Plan, error) {
	return nil, fmt.Errorf("raft: ListPlansByAPI not implemented")
}
func (t *raftTx) UpdatePlan(_ context.Context, _ string, _ store.UpdatePlanParams) (*store.Plan, error) {
	return nil, fmt.Errorf("raft: UpdatePlan not implemented")
}
func (t *raftTx) TransitionPlan(_ context.Context, _ string, _ store.PlanStatus) (*store.Plan, error) {
	return nil, fmt.Errorf("raft: TransitionPlan not implemented")
}
func (t *raftTx) DeletePlan(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeletePlan not implemented")
}

func (t *raftTx) CreateApplication(_ context.Context, _ store.CreateApplicationParams) (*store.Application, error) {
	return nil, fmt.Errorf("raft: CreateApplication not implemented")
}
func (t *raftTx) GetApplication(_ context.Context, _ string) (*store.Application, error) {
	return nil, fmt.Errorf("raft: GetApplication not implemented")
}
func (t *raftTx) ListApplications(_ context.Context) ([]*store.Application, error) {
	return nil, fmt.Errorf("raft: ListApplications not implemented")
}
func (t *raftTx) UpdateApplication(_ context.Context, _ string, _ store.UpdateApplicationParams) (*store.Application, error) {
	return nil, fmt.Errorf("raft: UpdateApplication not implemented")
}
func (t *raftTx) TransitionApplication(_ context.Context, _ string, _ store.ApplicationStatus) (*store.Application, error) {
	return nil, fmt.Errorf("raft: TransitionApplication not implemented")
}
func (t *raftTx) DeleteApplication(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteApplication not implemented")
}

func (t *raftTx) CreateSubscription(_ context.Context, _ store.CreateSubscriptionParams) (*store.Subscription, error) {
	return nil, fmt.Errorf("raft: CreateSubscription not implemented")
}
func (t *raftTx) GetSubscription(_ context.Context, _ string) (*store.Subscription, error) {
	return nil, fmt.Errorf("raft: GetSubscription not implemented")
}
func (t *raftTx) ListSubscriptions(_ context.Context) ([]*store.Subscription, error) {
	return nil, fmt.Errorf("raft: ListSubscriptions not implemented")
}
func (t *raftTx) ListSubscriptionsByApplication(_ context.Context, _ string) ([]*store.Subscription, error) {
	return nil, fmt.Errorf("raft: ListSubscriptionsByApplication not implemented")
}
func (t *raftTx) ListSubscriptionsByPlan(_ context.Context, _ string) ([]*store.Subscription, error) {
	return nil, fmt.Errorf("raft: ListSubscriptionsByPlan not implemented")
}
func (t *raftTx) UpdateSubscription(_ context.Context, _ string, _ store.UpdateSubscriptionParams) (*store.Subscription, error) {
	return nil, fmt.Errorf("raft: UpdateSubscription not implemented")
}
func (t *raftTx) TransitionSubscription(_ context.Context, _ string, _ store.SubscriptionStatus, _ string) (*store.Subscription, error) {
	return nil, fmt.Errorf("raft: TransitionSubscription not implemented")
}
