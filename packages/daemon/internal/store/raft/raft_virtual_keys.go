package raft

import (
	"context"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *raftTx) CreateVirtualKey(_ context.Context, _ store.CreateVirtualKeyParams) (*store.VirtualKey, error) {
	return nil, fmt.Errorf("raft: CreateVirtualKey not implemented")
}
func (t *raftTx) GetVirtualKey(_ context.Context, _ string) (*store.VirtualKey, error) {
	return nil, fmt.Errorf("raft: GetVirtualKey not implemented")
}
func (t *raftTx) ListVirtualKeys(_ context.Context) ([]*store.VirtualKey, error) {
	return nil, fmt.Errorf("raft: ListVirtualKeys not implemented")
}
func (t *raftTx) UpdateVirtualKey(_ context.Context, _ string, _ store.UpdateVirtualKeyParams) (*store.VirtualKey, error) {
	return nil, fmt.Errorf("raft: UpdateVirtualKey not implemented")
}
func (t *raftTx) RotateVirtualKey(_ context.Context, _, _ string) (*store.VirtualKey, error) {
	return nil, fmt.Errorf("raft: RotateVirtualKey not implemented")
}
func (t *raftTx) RevokeVirtualKey(_ context.Context, _ string) error {
	return fmt.Errorf("raft: RevokeVirtualKey not implemented")
}
func (t *raftTx) DeleteVirtualKey(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteVirtualKey not implemented")
}
