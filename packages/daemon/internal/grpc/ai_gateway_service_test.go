package grpc

import (
	"context"
	"path/filepath"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

func setupAIGatewayTest(t *testing.T) (riokuv1.AIGatewayServiceServer, store.Driver, context.Context) {
	t.Helper()
	ctx := context.Background()
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}
	svc := newAIGatewayService(d)
	tenantCtx := store.WithTenantID(ctx, "tenant_default")
	return svc, d, tenantCtx
}

// ---- Virtual keys ----------------------------------------------------------

func TestAIGateway_VirtualKey_CreateGetListUpdateRotateRevokeDelete(t *testing.T) {
	svc, _, ctx := setupAIGatewayTest(t)

	created, err := svc.CreateVirtualKey(ctx, &riokuv1.CreateVirtualKeyRequest{
		Name:          "primary",
		ProviderId:    "openai",
		CredentialRef: "vault://kv/openai",
		AllowedModels: []string{"gpt-4o"},
		BudgetUsd:     50,
		BudgetWindow:  "month",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.GetId() == "" || created.GetName() != "primary" {
		t.Errorf("create response = %+v", created)
	}

	got, err := svc.GetVirtualKey(ctx, &riokuv1.GetVirtualKeyRequest{Id: created.GetId()})
	if err != nil {
		t.Fatal(err)
	}
	if got.GetCredentialRef() != "vault://kv/openai" {
		t.Errorf("CredentialRef = %q", got.GetCredentialRef())
	}

	list, err := svc.ListVirtualKeys(ctx, &riokuv1.ListVirtualKeysRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(list.GetVirtualKeys()) != 1 {
		t.Errorf("List len = %d", len(list.GetVirtualKeys()))
	}

	rotated, err := svc.RotateVirtualKey(ctx, &riokuv1.RotateVirtualKeyRequest{
		Id:               created.GetId(),
		NewCredentialRef: "vault://kv/openai-v2",
	})
	if err != nil {
		t.Fatal(err)
	}
	if rotated.GetCredentialRef() != "vault://kv/openai-v2" {
		t.Errorf("rotated CredentialRef = %q", rotated.GetCredentialRef())
	}

	newName := "renamed"
	newAllow := []string{"gpt-4o", "gpt-4o-mini"}
	upd, err := svc.UpdateVirtualKey(ctx, &riokuv1.UpdateVirtualKeyRequest{
		Id:                   created.GetId(),
		Name:                 &newName,
		AllowedModels:        newAllow,
		ReplaceAllowedModels: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if upd.GetName() != "renamed" || len(upd.GetAllowedModels()) != 2 {
		t.Errorf("update lost: %+v", upd)
	}

	if _, err := svc.RevokeVirtualKey(ctx, &riokuv1.RevokeVirtualKeyRequest{Id: created.GetId()}); err != nil {
		t.Fatal(err)
	}
	revoked, _ := svc.GetVirtualKey(ctx, &riokuv1.GetVirtualKeyRequest{Id: created.GetId()})
	if revoked.GetRevokedAt() == nil {
		t.Error("RevokedAt nil after Revoke")
	}

	if _, err := svc.DeleteVirtualKey(ctx, &riokuv1.DeleteVirtualKeyRequest{Id: created.GetId()}); err != nil {
		t.Fatal(err)
	}
	_, err = svc.GetVirtualKey(ctx, &riokuv1.GetVirtualKeyRequest{Id: created.GetId()})
	if status.Code(err) != codes.NotFound {
		t.Errorf("after Delete: code = %s", status.Code(err))
	}
}

func TestAIGateway_VirtualKey_NameUniqueness(t *testing.T) {
	svc, _, ctx := setupAIGatewayTest(t)
	if _, err := svc.CreateVirtualKey(ctx, &riokuv1.CreateVirtualKeyRequest{Name: "dup", ProviderId: "openai"}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.CreateVirtualKey(ctx, &riokuv1.CreateVirtualKeyRequest{Name: "dup", ProviderId: "openai"})
	if status.Code(err) != codes.AlreadyExists {
		t.Errorf("dup-name code = %s, want AlreadyExists", status.Code(err))
	}
}

// ---- MCP teams + permissions ----------------------------------------------

func TestAIGateway_MCPTeam_CRUD(t *testing.T) {
	svc, _, ctx := setupAIGatewayTest(t)
	team, err := svc.CreateMCPTeam(ctx, &riokuv1.CreateMCPTeamRequest{
		Name:        "platform",
		Description: "platform tools",
	})
	if err != nil {
		t.Fatal(err)
	}
	if team.GetStatus() != "active" {
		t.Errorf("default Status = %q", team.GetStatus())
	}
	got, _ := svc.GetMCPTeam(ctx, &riokuv1.GetMCPTeamRequest{Id: team.GetId()})
	if got.GetName() != "platform" {
		t.Errorf("Name = %q", got.GetName())
	}
	paused := "paused"
	upd, _ := svc.UpdateMCPTeam(ctx, &riokuv1.UpdateMCPTeamRequest{Id: team.GetId(), Status: &paused})
	if upd.GetStatus() != "paused" {
		t.Errorf("Status = %q", upd.GetStatus())
	}
	if _, err := svc.DeleteMCPTeam(ctx, &riokuv1.DeleteMCPTeamRequest{Id: team.GetId()}); err != nil {
		t.Fatal(err)
	}
	_, err = svc.GetMCPTeam(ctx, &riokuv1.GetMCPTeamRequest{Id: team.GetId()})
	if status.Code(err) != codes.NotFound {
		t.Errorf("after Delete: code = %s", status.Code(err))
	}
}

func TestAIGateway_MCPTeamPermission_AddListRemove(t *testing.T) {
	svc, d, ctx := setupAIGatewayTest(t)

	// Need an MCP server FK target; use the storage layer directly.
	tx, _ := d.Begin(ctx, store.TxOptions{})
	srv, err := tx.CreateMCPServer(ctx, &store.AIMCPServer{
		ID: "mcp_srv_1", TenantID: "tenant_default", Name: "tools",
		URL: "https://x", AuthKind: "none", Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()

	team, _ := svc.CreateMCPTeam(ctx, &riokuv1.CreateMCPTeamRequest{Name: "perm-team"})

	perm, err := svc.AddMCPTeamPermission(ctx, &riokuv1.AddMCPTeamPermissionRequest{
		TeamId: team.GetId(), McpServerId: srv.ID, ToolName: "read",
	})
	if err != nil {
		t.Fatal(err)
	}
	dup, err := svc.AddMCPTeamPermission(ctx, &riokuv1.AddMCPTeamPermissionRequest{
		TeamId: team.GetId(), McpServerId: srv.ID, ToolName: "read",
	})
	if status.Code(err) != codes.AlreadyExists {
		t.Errorf("dup code = %s, want AlreadyExists (got perm = %+v)", status.Code(err), dup)
	}

	list, _ := svc.ListMCPTeamPermissions(ctx, &riokuv1.ListMCPTeamPermissionsRequest{TeamId: team.GetId()})
	if len(list.GetPermissions()) != 1 {
		t.Errorf("len = %d", len(list.GetPermissions()))
	}

	if _, err := svc.RemoveMCPTeamPermission(ctx, &riokuv1.RemoveMCPTeamPermissionRequest{Id: perm.GetId()}); err != nil {
		t.Fatal(err)
	}
}

// ---- MCP routes ------------------------------------------------------------

func TestAIGateway_MCPRoute_CRUD(t *testing.T) {
	svc, d, ctx := setupAIGatewayTest(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	srv, _ := tx.CreateMCPServer(ctx, &store.AIMCPServer{
		ID: "mcp_srv_2", TenantID: "tenant_default", Name: "tools2",
		URL: "https://y", AuthKind: "none", Enabled: true,
	})
	_ = tx.Commit()

	r, err := svc.CreateMCPRoute(ctx, &riokuv1.CreateMCPRouteRequest{
		Name:        "primary",
		Hostname:    "tools.example.com",
		PathPrefix:  "/mcp",
		McpServerId: srv.ID,
		Enabled:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.GetAuthPassthrough() != "forward" {
		t.Errorf("default AuthPassthrough = %q", r.GetAuthPassthrough())
	}

	_, err = svc.CreateMCPRoute(ctx, &riokuv1.CreateMCPRouteRequest{
		Name: "dup", Hostname: "tools.example.com", PathPrefix: "/mcp",
		McpServerId: srv.ID, Enabled: true,
	})
	if status.Code(err) != codes.AlreadyExists {
		t.Errorf("dup hostname+path code = %s", status.Code(err))
	}

	pa := "replace"
	upd, _ := svc.UpdateMCPRoute(ctx, &riokuv1.UpdateMCPRouteRequest{
		Id: r.GetId(), AuthPassthrough: &pa,
	})
	if upd.GetAuthPassthrough() != "replace" {
		t.Errorf("AuthPassthrough = %q", upd.GetAuthPassthrough())
	}

	if _, err := svc.DeleteMCPRoute(ctx, &riokuv1.DeleteMCPRouteRequest{Id: r.GetId()}); err != nil {
		t.Fatal(err)
	}
	_, err = svc.GetMCPRoute(ctx, &riokuv1.GetMCPRouteRequest{Id: r.GetId()})
	if status.Code(err) != codes.NotFound {
		t.Errorf("after Delete: code = %s", status.Code(err))
	}
}
