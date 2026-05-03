package postgres

import (
	"context"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *tx) CreateVirtualKey(_ context.Context, _ store.CreateVirtualKeyParams) (*store.VirtualKey, error) {
	return nil, fmt.Errorf("postgres: CreateVirtualKey not implemented")
}
func (t *tx) GetVirtualKey(_ context.Context, _ string) (*store.VirtualKey, error) {
	return nil, fmt.Errorf("postgres: GetVirtualKey not implemented")
}
func (t *tx) ListVirtualKeys(_ context.Context) ([]*store.VirtualKey, error) {
	return nil, fmt.Errorf("postgres: ListVirtualKeys not implemented")
}
func (t *tx) UpdateVirtualKey(_ context.Context, _ string, _ store.UpdateVirtualKeyParams) (*store.VirtualKey, error) {
	return nil, fmt.Errorf("postgres: UpdateVirtualKey not implemented")
}
func (t *tx) RotateVirtualKey(_ context.Context, _, _ string) (*store.VirtualKey, error) {
	return nil, fmt.Errorf("postgres: RotateVirtualKey not implemented")
}
func (t *tx) RevokeVirtualKey(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: RevokeVirtualKey not implemented")
}
func (t *tx) DeleteVirtualKey(_ context.Context, _ string) error {
	return fmt.Errorf("postgres: DeleteVirtualKey not implemented")
}
