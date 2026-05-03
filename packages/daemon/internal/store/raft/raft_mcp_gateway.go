package raft

import (
	"context"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *raftTx) CreateMCPTeam(_ context.Context, _ store.CreateMCPTeamParams) (*store.MCPTeam, error) {
	return nil, fmt.Errorf("raft: CreateMCPTeam not implemented")
}
func (t *raftTx) GetMCPTeam(_ context.Context, _ string) (*store.MCPTeam, error) {
	return nil, fmt.Errorf("raft: GetMCPTeam not implemented")
}
func (t *raftTx) ListMCPTeams(_ context.Context) ([]*store.MCPTeam, error) {
	return nil, fmt.Errorf("raft: ListMCPTeams not implemented")
}
func (t *raftTx) UpdateMCPTeam(_ context.Context, _ string, _ store.UpdateMCPTeamParams) (*store.MCPTeam, error) {
	return nil, fmt.Errorf("raft: UpdateMCPTeam not implemented")
}
func (t *raftTx) DeleteMCPTeam(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteMCPTeam not implemented")
}
func (t *raftTx) AddMCPTeamPermission(_ context.Context, _ *store.MCPTeamPermission) (*store.MCPTeamPermission, error) {
	return nil, fmt.Errorf("raft: AddMCPTeamPermission not implemented")
}
func (t *raftTx) ListMCPTeamPermissions(_ context.Context, _ string) ([]*store.MCPTeamPermission, error) {
	return nil, fmt.Errorf("raft: ListMCPTeamPermissions not implemented")
}
func (t *raftTx) RemoveMCPTeamPermission(_ context.Context, _ string) error {
	return fmt.Errorf("raft: RemoveMCPTeamPermission not implemented")
}
func (t *raftTx) CreateMCPRoute(_ context.Context, _ store.CreateMCPRouteParams) (*store.MCPRoute, error) {
	return nil, fmt.Errorf("raft: CreateMCPRoute not implemented")
}
func (t *raftTx) GetMCPRoute(_ context.Context, _ string) (*store.MCPRoute, error) {
	return nil, fmt.Errorf("raft: GetMCPRoute not implemented")
}
func (t *raftTx) ListMCPRoutes(_ context.Context) ([]*store.MCPRoute, error) {
	return nil, fmt.Errorf("raft: ListMCPRoutes not implemented")
}
func (t *raftTx) UpdateMCPRoute(_ context.Context, _ string, _ store.UpdateMCPRouteParams) (*store.MCPRoute, error) {
	return nil, fmt.Errorf("raft: UpdateMCPRoute not implemented")
}
func (t *raftTx) DeleteMCPRoute(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteMCPRoute not implemented")
}
