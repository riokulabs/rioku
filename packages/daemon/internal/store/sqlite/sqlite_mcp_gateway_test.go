package sqlite_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// createTestMCPServer ensures the FK target exists for permission /
// route tests. The MCP server CRUD is part of an earlier surface
// (AIMCPServer); these tests only need a valid id to reference.
func createTestMCPServer(t *testing.T, d store.Driver, ctx context.Context) string {
	t.Helper()
	tx, _ := d.Begin(ctx, store.TxOptions{})
	srv, err := tx.CreateMCPServer(ctx, &store.AIMCPServer{
		ID:       "mcp_" + uuid.NewString(),
		TenantID: "tenant_default",
		Name:     "test-server-" + uuid.NewString()[:6],
		URL:      "https://mcp.example.com",
		AuthKind: "none",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return srv.ID
}

func TestMCPTeam_CreateGetUpdateDelete(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	team, err := tx.CreateMCPTeam(ctx, store.CreateMCPTeamParams{
		ID:          "team_" + uuid.NewString(),
		TenantID:    "tenant_default",
		Name:        "platform-tools",
		Description: "internal tooling team",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if team.Status != store.MCPTeamStatusActive {
		t.Errorf("Status default = %q, want active", team.Status)
	}

	got, err := tx.GetMCPTeam(ctx, team.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "platform-tools" {
		t.Errorf("Name = %q", got.Name)
	}

	newDesc := "renamed desc"
	paused := store.MCPTeamStatusPaused
	upd, err := tx.UpdateMCPTeam(ctx, team.ID, store.UpdateMCPTeamParams{
		Description: &newDesc,
		Status:      &paused,
	})
	if err != nil {
		t.Fatal(err)
	}
	if upd.Description != newDesc || upd.Status != store.MCPTeamStatusPaused {
		t.Errorf("update lost: %+v", upd)
	}

	if err := tx.DeleteMCPTeam(ctx, team.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.GetMCPTeam(ctx, team.ID); !errors.Is(err, store.ErrMCPTeamNotFound) {
		t.Errorf("after delete: err = %v, want ErrMCPTeamNotFound", err)
	}
}

func TestMCPTeam_NameUniquenessPerTenant(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	mk := func() store.CreateMCPTeamParams {
		return store.CreateMCPTeamParams{
			ID:       "team_" + uuid.NewString(),
			TenantID: "tenant_default",
			Name:     "duplicate",
		}
	}
	if _, err := tx.CreateMCPTeam(ctx, mk()); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.CreateMCPTeam(ctx, mk()); !errors.Is(err, store.ErrMCPTeamNameTaken) {
		t.Errorf("err = %v, want ErrMCPTeamNameTaken", err)
	}
}

func TestMCPTeamPermissions_AddListRemove(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	srvID := createTestMCPServer(t, d, ctx)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	team, _ := tx.CreateMCPTeam(ctx, store.CreateMCPTeamParams{
		ID: "team_" + uuid.NewString(), TenantID: "tenant_default", Name: "perms-team",
	})

	for _, tool := range []string{"read_doc", "write_doc"} {
		if _, err := tx.AddMCPTeamPermission(ctx, &store.MCPTeamPermission{
			ID: "perm_" + uuid.NewString(), TenantID: "tenant_default",
			TeamID: team.ID, MCPServerID: srvID, ToolName: tool,
		}); err != nil {
			t.Fatalf("Add(%s): %v", tool, err)
		}
	}

	// Duplicate (team, server, tool) rejected.
	_, err := tx.AddMCPTeamPermission(ctx, &store.MCPTeamPermission{
		ID: "perm_" + uuid.NewString(), TenantID: "tenant_default",
		TeamID: team.ID, MCPServerID: srvID, ToolName: "read_doc",
	})
	if !errors.Is(err, store.ErrMCPTeamPermissionDup) {
		t.Errorf("dup err = %v, want ErrMCPTeamPermissionDup", err)
	}

	perms, err := tx.ListMCPTeamPermissions(ctx, team.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(perms) != 2 {
		t.Errorf("len = %d, want 2", len(perms))
	}
	if !store.AllowsTool(perms, srvID, "read_doc") {
		t.Error("AllowsTool(read_doc) = false")
	}
	if store.AllowsTool(perms, srvID, "delete_doc") {
		t.Error("AllowsTool(delete_doc) = true (not granted)")
	}

	if err := tx.RemoveMCPTeamPermission(ctx, perms[0].ID); err != nil {
		t.Fatal(err)
	}
	left, _ := tx.ListMCPTeamPermissions(ctx, team.ID)
	if len(left) != 1 {
		t.Errorf("after remove: len = %d, want 1", len(left))
	}
}

func TestMCPTeamPermissions_WildcardAllowsAll(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	srvID := createTestMCPServer(t, d, ctx)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck
	team, _ := tx.CreateMCPTeam(ctx, store.CreateMCPTeamParams{
		ID: "team_" + uuid.NewString(), TenantID: "tenant_default", Name: "wild-team",
	})
	_, _ = tx.AddMCPTeamPermission(ctx, &store.MCPTeamPermission{
		ID: "perm_" + uuid.NewString(), TenantID: "tenant_default",
		TeamID: team.ID, MCPServerID: srvID, ToolName: "*",
	})
	perms, _ := tx.ListMCPTeamPermissions(ctx, team.ID)
	if !store.AllowsTool(perms, srvID, "anything") {
		t.Error("wildcard should allow any tool name")
	}
	if store.AllowsTool(perms, "other-server", "anything") {
		t.Error("wildcard scoped to its server should not match other servers")
	}
}

func TestMCPRoute_CRUD(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	srvID := createTestMCPServer(t, d, ctx)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	r, err := tx.CreateMCPRoute(ctx, store.CreateMCPRouteParams{
		ID: "mcpr_" + uuid.NewString(), TenantID: "tenant_default",
		Name: "primary-mcp", Hostname: "tools.example.com", PathPrefix: "/mcp",
		MCPServerID: srvID, Enabled: true,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if r.AuthPassthrough != store.MCPAuthPassthroughForward {
		t.Errorf("AuthPassthrough default = %q, want forward", r.AuthPassthrough)
	}

	// Hostname+path uniqueness within tenant.
	_, err = tx.CreateMCPRoute(ctx, store.CreateMCPRouteParams{
		ID: "mcpr_" + uuid.NewString(), TenantID: "tenant_default",
		Name: "dup", Hostname: "tools.example.com", PathPrefix: "/mcp",
		MCPServerID: srvID, Enabled: true,
	})
	if !errors.Is(err, store.ErrMCPRouteHostPathTaken) {
		t.Errorf("dup err = %v, want ErrMCPRouteHostPathTaken", err)
	}

	replace := store.MCPAuthPassthroughReplace
	upd, err := tx.UpdateMCPRoute(ctx, r.ID, store.UpdateMCPRouteParams{
		AuthPassthrough: &replace,
	})
	if err != nil {
		t.Fatal(err)
	}
	if upd.AuthPassthrough != store.MCPAuthPassthroughReplace {
		t.Errorf("update lost: %+v", upd)
	}

	if err := tx.DeleteMCPRoute(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.GetMCPRoute(ctx, r.ID); !errors.Is(err, store.ErrMCPRouteNotFound) {
		t.Errorf("after delete: err = %v", err)
	}
}
