package grpc

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// aiGatewayService implements riokuv1.AIGatewayServiceServer for the
// Sprint 5 admin REST surface: virtual keys (#167) + MCP teams /
// permissions / routes (#181). The storage + Tx layer for each
// landed earlier; this file is the thin protocol-translation
// shell on top of them.
type aiGatewayService struct {
	riokuv1.UnimplementedAIGatewayServiceServer
	store store.Driver
}

func newAIGatewayService(st store.Driver) *aiGatewayService {
	return &aiGatewayService{store: st}
}

// ============================================================
// Virtual keys (#167)
// ============================================================

func (s *aiGatewayService) CreateVirtualKey(ctx context.Context, req *riokuv1.CreateVirtualKeyRequest) (*riokuv1.VirtualKey, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	id := req.GetId()
	if id == "" {
		id = "vk_" + uuid.NewString()
	}
	bw := store.BudgetWindow(req.GetBudgetWindow())
	if bw == "" {
		bw = store.BudgetWindowMonth
	}
	vk, err := tx.CreateVirtualKey(ctx, store.CreateVirtualKeyParams{
		ID:            id,
		TenantID:      store.TenantIDFromContext(ctx),
		Name:          req.GetName(),
		ProviderID:    req.GetProviderId(),
		CredentialRef: req.GetCredentialRef(),
		AllowedModels: req.GetAllowedModels(),
		RPMLimit:      req.GetRpmLimit(),
		TPMLimit:      req.GetTpmLimit(),
		BudgetUSD:     req.GetBudgetUsd(),
		BudgetWindow:  bw,
	})
	if err != nil {
		return nil, mapVirtualKeyError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return virtualKeyToProto(vk), nil
}

func (s *aiGatewayService) GetVirtualKey(ctx context.Context, req *riokuv1.GetVirtualKeyRequest) (*riokuv1.VirtualKey, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	vk, err := tx.GetVirtualKey(ctx, req.GetId())
	if err != nil {
		return nil, mapVirtualKeyError(err)
	}
	return virtualKeyToProto(vk), nil
}

func (s *aiGatewayService) ListVirtualKeys(ctx context.Context, _ *riokuv1.ListVirtualKeysRequest) (*riokuv1.ListVirtualKeysResponse, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	vks, err := tx.ListVirtualKeys(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list virtual keys: %v", err)
	}
	out := make([]*riokuv1.VirtualKey, len(vks))
	for i, vk := range vks {
		out[i] = virtualKeyToProto(vk)
	}
	return &riokuv1.ListVirtualKeysResponse{VirtualKeys: out}, nil
}

func (s *aiGatewayService) UpdateVirtualKey(ctx context.Context, req *riokuv1.UpdateVirtualKeyRequest) (*riokuv1.VirtualKey, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	params := store.UpdateVirtualKeyParams{
		Name:          stringPtrOrNil(req.Name),
		ProviderID:    stringPtrOrNil(req.ProviderId),
		CredentialRef: stringPtrOrNil(req.CredentialRef),
		RPMLimit:      int32PtrOrNil(req.RpmLimit),
		TPMLimit:      int32PtrOrNil(req.TpmLimit),
		BudgetUSD:     float64PtrOrNil(req.BudgetUsd),
	}
	if req.BudgetWindow != nil {
		bw := store.BudgetWindow(*req.BudgetWindow)
		params.BudgetWindow = &bw
	}
	if req.GetReplaceAllowedModels() {
		am := req.GetAllowedModels()
		if am == nil {
			am = []string{}
		}
		params.AllowedModels = &am
	}
	vk, err := tx.UpdateVirtualKey(ctx, req.GetId(), params)
	if err != nil {
		return nil, mapVirtualKeyError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return virtualKeyToProto(vk), nil
}

func (s *aiGatewayService) RotateVirtualKey(ctx context.Context, req *riokuv1.RotateVirtualKeyRequest) (*riokuv1.VirtualKey, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	vk, err := tx.RotateVirtualKey(ctx, req.GetId(), req.GetNewCredentialRef())
	if err != nil {
		return nil, mapVirtualKeyError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return virtualKeyToProto(vk), nil
}

func (s *aiGatewayService) RevokeVirtualKey(ctx context.Context, req *riokuv1.RevokeVirtualKeyRequest) (*riokuv1.MutationMeta, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := tx.RevokeVirtualKey(ctx, req.GetId()); err != nil {
		return nil, mapVirtualKeyError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return &riokuv1.MutationMeta{}, nil
}

func (s *aiGatewayService) DeleteVirtualKey(ctx context.Context, req *riokuv1.DeleteVirtualKeyRequest) (*riokuv1.MutationMeta, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := tx.DeleteVirtualKey(ctx, req.GetId()); err != nil {
		return nil, mapVirtualKeyError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return &riokuv1.MutationMeta{}, nil
}

// ============================================================
// MCP teams (#181)
// ============================================================

func (s *aiGatewayService) CreateMCPTeam(ctx context.Context, req *riokuv1.CreateMCPTeamRequest) (*riokuv1.MCPTeam, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	id := req.GetId()
	if id == "" {
		id = "team_" + uuid.NewString()
	}
	team, err := tx.CreateMCPTeam(ctx, store.CreateMCPTeamParams{
		ID:          id,
		TenantID:    store.TenantIDFromContext(ctx),
		Name:        req.GetName(),
		Description: req.GetDescription(),
		Status:      store.MCPTeamStatus(req.GetStatus()),
	})
	if err != nil {
		return nil, mapMCPTeamError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return mcpTeamToProto(team), nil
}

func (s *aiGatewayService) GetMCPTeam(ctx context.Context, req *riokuv1.GetMCPTeamRequest) (*riokuv1.MCPTeam, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	team, err := tx.GetMCPTeam(ctx, req.GetId())
	if err != nil {
		return nil, mapMCPTeamError(err)
	}
	return mcpTeamToProto(team), nil
}

func (s *aiGatewayService) ListMCPTeams(ctx context.Context, _ *riokuv1.ListMCPTeamsRequest) (*riokuv1.ListMCPTeamsResponse, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	teams, err := tx.ListMCPTeams(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list mcp teams: %v", err)
	}
	out := make([]*riokuv1.MCPTeam, len(teams))
	for i, t := range teams {
		out[i] = mcpTeamToProto(t)
	}
	return &riokuv1.ListMCPTeamsResponse{Teams: out}, nil
}

func (s *aiGatewayService) UpdateMCPTeam(ctx context.Context, req *riokuv1.UpdateMCPTeamRequest) (*riokuv1.MCPTeam, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	params := store.UpdateMCPTeamParams{
		Name:        stringPtrOrNil(req.Name),
		Description: stringPtrOrNil(req.Description),
	}
	if req.Status != nil {
		st := store.MCPTeamStatus(*req.Status)
		params.Status = &st
	}
	team, err := tx.UpdateMCPTeam(ctx, req.GetId(), params)
	if err != nil {
		return nil, mapMCPTeamError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return mcpTeamToProto(team), nil
}

func (s *aiGatewayService) DeleteMCPTeam(ctx context.Context, req *riokuv1.DeleteMCPTeamRequest) (*riokuv1.MutationMeta, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := tx.DeleteMCPTeam(ctx, req.GetId()); err != nil {
		return nil, mapMCPTeamError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return &riokuv1.MutationMeta{}, nil
}

// ============================================================
// MCP team permissions (#181)
// ============================================================

func (s *aiGatewayService) AddMCPTeamPermission(ctx context.Context, req *riokuv1.AddMCPTeamPermissionRequest) (*riokuv1.MCPTeamPermission, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	id := req.GetId()
	if id == "" {
		id = "perm_" + uuid.NewString()
	}
	perm, err := tx.AddMCPTeamPermission(ctx, &store.MCPTeamPermission{
		ID:          id,
		TenantID:    store.TenantIDFromContext(ctx),
		TeamID:      req.GetTeamId(),
		MCPServerID: req.GetMcpServerId(),
		ToolName:    req.GetToolName(),
	})
	if err != nil {
		return nil, mapMCPTeamError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return mcpPermissionToProto(perm), nil
}

func (s *aiGatewayService) ListMCPTeamPermissions(ctx context.Context, req *riokuv1.ListMCPTeamPermissionsRequest) (*riokuv1.ListMCPTeamPermissionsResponse, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	perms, err := tx.ListMCPTeamPermissions(ctx, req.GetTeamId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list mcp team permissions: %v", err)
	}
	out := make([]*riokuv1.MCPTeamPermission, len(perms))
	for i, p := range perms {
		out[i] = mcpPermissionToProto(p)
	}
	return &riokuv1.ListMCPTeamPermissionsResponse{Permissions: out}, nil
}

func (s *aiGatewayService) RemoveMCPTeamPermission(ctx context.Context, req *riokuv1.RemoveMCPTeamPermissionRequest) (*riokuv1.MutationMeta, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := tx.RemoveMCPTeamPermission(ctx, req.GetId()); err != nil {
		return nil, mapMCPTeamError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return &riokuv1.MutationMeta{}, nil
}

// ============================================================
// MCP routes (#181)
// ============================================================

func (s *aiGatewayService) CreateMCPRoute(ctx context.Context, req *riokuv1.CreateMCPRouteRequest) (*riokuv1.MCPRoute, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	id := req.GetId()
	if id == "" {
		id = "mcpr_" + uuid.NewString()
	}
	route, err := tx.CreateMCPRoute(ctx, store.CreateMCPRouteParams{
		ID:              id,
		TenantID:        store.TenantIDFromContext(ctx),
		Name:            req.GetName(),
		Hostname:        req.GetHostname(),
		PathPrefix:      req.GetPathPrefix(),
		MCPServerID:     req.GetMcpServerId(),
		AuthPassthrough: store.MCPAuthPassthrough(req.GetAuthPassthrough()),
		Enabled:         req.GetEnabled(),
	})
	if err != nil {
		return nil, mapMCPRouteError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return mcpRouteToProto(route), nil
}

func (s *aiGatewayService) GetMCPRoute(ctx context.Context, req *riokuv1.GetMCPRouteRequest) (*riokuv1.MCPRoute, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	route, err := tx.GetMCPRoute(ctx, req.GetId())
	if err != nil {
		return nil, mapMCPRouteError(err)
	}
	return mcpRouteToProto(route), nil
}

func (s *aiGatewayService) ListMCPRoutes(ctx context.Context, _ *riokuv1.ListMCPRoutesRequest) (*riokuv1.ListMCPRoutesResponse, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	routes, err := tx.ListMCPRoutes(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list mcp routes: %v", err)
	}
	out := make([]*riokuv1.MCPRoute, len(routes))
	for i, r := range routes {
		out[i] = mcpRouteToProto(r)
	}
	return &riokuv1.ListMCPRoutesResponse{Routes: out}, nil
}

func (s *aiGatewayService) UpdateMCPRoute(ctx context.Context, req *riokuv1.UpdateMCPRouteRequest) (*riokuv1.MCPRoute, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	params := store.UpdateMCPRouteParams{
		Name:        stringPtrOrNil(req.Name),
		Hostname:    stringPtrOrNil(req.Hostname),
		PathPrefix:  stringPtrOrNil(req.PathPrefix),
		MCPServerID: stringPtrOrNil(req.McpServerId),
		Enabled:     boolPtrOrNil(req.Enabled),
	}
	if req.AuthPassthrough != nil {
		ap := store.MCPAuthPassthrough(*req.AuthPassthrough)
		params.AuthPassthrough = &ap
	}
	route, err := tx.UpdateMCPRoute(ctx, req.GetId(), params)
	if err != nil {
		return nil, mapMCPRouteError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return mcpRouteToProto(route), nil
}

func (s *aiGatewayService) DeleteMCPRoute(ctx context.Context, req *riokuv1.DeleteMCPRouteRequest) (*riokuv1.MutationMeta, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := tx.DeleteMCPRoute(ctx, req.GetId()); err != nil {
		return nil, mapMCPRouteError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return &riokuv1.MutationMeta{}, nil
}

// ============================================================
// proto <-> store conversions
// ============================================================

func virtualKeyToProto(vk *store.VirtualKey) *riokuv1.VirtualKey {
	out := &riokuv1.VirtualKey{
		Id:            vk.ID,
		TenantId:      vk.TenantID,
		Name:          vk.Name,
		ProviderId:    vk.ProviderID,
		CredentialRef: vk.CredentialRef,
		AllowedModels: vk.AllowedModels,
		RpmLimit:      vk.RPMLimit,
		TpmLimit:      vk.TPMLimit,
		BudgetUsd:     vk.BudgetUSD,
		BudgetWindow:  string(vk.BudgetWindow),
		CreatedAt:     timestamppb.New(vk.CreatedAt),
		UpdatedAt:     timestamppb.New(vk.UpdatedAt),
	}
	if vk.RevokedAt != nil {
		out.RevokedAt = timestamppb.New(*vk.RevokedAt)
	}
	if vk.CreatedBy != nil {
		out.CreatedBy = *vk.CreatedBy
	}
	return out
}

func mcpTeamToProto(t *store.MCPTeam) *riokuv1.MCPTeam {
	return &riokuv1.MCPTeam{
		Id:          t.ID,
		TenantId:    t.TenantID,
		Name:        t.Name,
		Description: t.Description,
		Status:      string(t.Status),
		CreatedAt:   timestamppb.New(t.CreatedAt),
		UpdatedAt:   timestamppb.New(t.UpdatedAt),
	}
}

func mcpPermissionToProto(p *store.MCPTeamPermission) *riokuv1.MCPTeamPermission {
	return &riokuv1.MCPTeamPermission{
		Id:          p.ID,
		TenantId:    p.TenantID,
		TeamId:      p.TeamID,
		McpServerId: p.MCPServerID,
		ToolName:    p.ToolName,
		CreatedAt:   timestamppb.New(p.CreatedAt),
	}
}

func mcpRouteToProto(r *store.MCPRoute) *riokuv1.MCPRoute {
	return &riokuv1.MCPRoute{
		Id:              r.ID,
		TenantId:        r.TenantID,
		Name:            r.Name,
		Hostname:        r.Hostname,
		PathPrefix:      r.PathPrefix,
		McpServerId:     r.MCPServerID,
		AuthPassthrough: string(r.AuthPassthrough),
		Enabled:         r.Enabled,
		CreatedAt:       timestamppb.New(r.CreatedAt),
		UpdatedAt:       timestamppb.New(r.UpdatedAt),
	}
}

// ============================================================
// helpers + error mapping
// ============================================================

func stringPtrOrNil(s *string) *string {
	if s == nil {
		return nil
	}
	v := *s
	return &v
}

func int32PtrOrNil(p *int32) *int32 {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

func float64PtrOrNil(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

func boolPtrOrNil(p *bool) *bool {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

func mapVirtualKeyError(err error) error {
	switch {
	case errors.Is(err, store.ErrVirtualKeyNotFound):
		return status.Errorf(codes.NotFound, "virtual key not found")
	case errors.Is(err, store.ErrVirtualKeyNameTaken):
		return status.Errorf(codes.AlreadyExists, "virtual key name already exists")
	}
	return status.Errorf(codes.Internal, "%v", err)
}

func mapMCPTeamError(err error) error {
	switch {
	case errors.Is(err, store.ErrMCPTeamNotFound):
		return status.Errorf(codes.NotFound, "mcp team not found")
	case errors.Is(err, store.ErrMCPTeamNameTaken):
		return status.Errorf(codes.AlreadyExists, "mcp team name already exists")
	case errors.Is(err, store.ErrMCPTeamPermissionDup):
		return status.Errorf(codes.AlreadyExists, "permission already granted")
	}
	return status.Errorf(codes.Internal, "%v", err)
}

func mapMCPRouteError(err error) error {
	switch {
	case errors.Is(err, store.ErrMCPRouteNotFound):
		return status.Errorf(codes.NotFound, "mcp route not found")
	case errors.Is(err, store.ErrMCPRouteHostPathTaken):
		return status.Errorf(codes.AlreadyExists, "mcp route hostname+path already exists")
	}
	return status.Errorf(codes.Internal, "%v", err)
}
