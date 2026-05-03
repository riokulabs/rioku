package postgres

import (
	"context"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *tx) CreateMCPTeam(_ context.Context, _ store.CreateMCPTeamParams) (*store.MCPTeam, error) {
	return nil, fmt.Errorf("postgres: CreateMCPTeam not implemented")
}
func (t *tx) GetMCPTeam(_ context.Context, _ string) (*store.MCPTeam, error) {
	return nil, fmt.Errorf("postgres: GetMCPTeam not implemented")
}
func (t *tx) ListMCPTeams(_ context.Context) ([]*store.MCPTeam, error) {
	return nil, fmt.Errorf("postgres: ListMCPTeams not implemented")
}
func (t *tx) UpdateMCPTeam(_ context.Context, _ string, _ store.UpdateMCPTeamParams) (*store.MCPTeam, error) {
	return nil, fmt.Errorf("postgres: UpdateMCPTeam not implemented")
}
func (t *tx) DeleteMCPTeam(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeleteMCPTeam not implemented")
}
func (t *tx) AddMCPTeamPermission(_ context.Context, _ *store.MCPTeamPermission) (*store.MCPTeamPermission, error) {
	return nil, fmt.Errorf("postgres: AddMCPTeamPermission not implemented")
}
func (t *tx) ListMCPTeamPermissions(_ context.Context, _ string) ([]*store.MCPTeamPermission, error) {
	return nil, fmt.Errorf("postgres: ListMCPTeamPermissions not implemented")
}
func (t *tx) RemoveMCPTeamPermission(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: RemoveMCPTeamPermission not implemented")
}
func (t *tx) CreateMCPRoute(_ context.Context, _ store.CreateMCPRouteParams) (*store.MCPRoute, error) {
	return nil, fmt.Errorf("postgres: CreateMCPRoute not implemented")
}
func (t *tx) GetMCPRoute(_ context.Context, _ string) (*store.MCPRoute, error) {
	return nil, fmt.Errorf("postgres: GetMCPRoute not implemented")
}
func (t *tx) ListMCPRoutes(_ context.Context) ([]*store.MCPRoute, error) {
	return nil, fmt.Errorf("postgres: ListMCPRoutes not implemented")
}
func (t *tx) UpdateMCPRoute(_ context.Context, _ string, _ store.UpdateMCPRouteParams) (*store.MCPRoute, error) {
	return nil, fmt.Errorf("postgres: UpdateMCPRoute not implemented")
}
func (t *tx) DeleteMCPRoute(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeleteMCPRoute not implemented")
}
