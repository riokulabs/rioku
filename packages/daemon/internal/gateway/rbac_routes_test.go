package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riokulabs/rioku/internal/store"
)

// loginAsRoot logs into the test server as the root user and returns an
// authenticated HTTP client with a cookie jar.
func loginAsRoot(t *testing.T, serverURL, rootPassword string) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	resp := doJSON(t, client, http.MethodPost, serverURL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("root login: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}
	return client
}

// superadminRoleID returns the ID of the superadmin role from the store.
func superadminRoleID(t *testing.T, drv store.Driver) string {
	t.Helper()
	ctx := context.Background()
	tx, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	roles, err := tx.ListRoles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range roles {
		if r.Name == "superadmin" {
			return r.ID
		}
	}
	t.Fatal("superadmin role not found")
	return ""
}

// createTestUserDirect creates a test user directly in the store (bypassing
// the HTTP API) and returns the user ID.
func createTestUserDirect(t *testing.T, drv store.Driver, username, password string) string {
	t.Helper()
	ctx := context.Background()
	hash := cachedHashPassword(t, password)
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	user, err := tx.CreateUser(ctx, &store.User{
		Username:            username,
		PasswordHash:        hash,
		Status:              "active",
		ForcePasswordChange: false,
		PasswordChangedAt:   time.Now().UTC(),
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return user.ID
}

// ---------------------------------------------------------------------------
// handleGetRole
// ---------------------------------------------------------------------------

func TestRBACRoutes_GetRole(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	saID := superadminRoleID(t, drv)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/roles/"+saID, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var role roleResponse
	if err := json.NewDecoder(resp.Body).Decode(&role); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if role.ID != saID {
		t.Errorf("id = %q, want %q", role.ID, saID)
	}
	if role.Name != "superadmin" {
		t.Errorf("name = %q, want %q", role.Name, "superadmin")
	}
	if !role.IsBuiltin {
		t.Error("expected isBuiltin to be true for superadmin")
	}
	if len(role.Permissions) == 0 {
		t.Error("expected superadmin to have permissions")
	}
}

func TestGetRole_WithUserCount(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	// Get the superadmin role ID from the store.
	saRoleID := superadminRoleID(t, drv)

	// Get the role via API.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/roles/"+saRoleID, nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get role: status %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode role: %v", err)
	}

	// The root user has the superadmin role, so userCount should be >= 1.
	userCount, ok := body["userCount"].(float64)
	if !ok {
		t.Fatal("userCount field missing or not a number")
	}
	if int(userCount) < 1 {
		t.Errorf("userCount = %d, want >= 1", int(userCount))
	}
	name, ok2 := body["name"].(string)
	if !ok2 {
		t.Fatal("name field missing or not a string")
	}
	if name != "superadmin" {
		t.Errorf("role name = %q, want %q", name, "superadmin")
	}
}

func TestGetRole_ZeroUsers(t *testing.T) {
	server, _, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	// Create a fresh custom role (no users assigned).
	createResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/roles", map[string]any{
		"name":        "test-empty-role",
		"description": "role with no users",
		"permissions": []string{"users:read"},
	})
	defer func() { _ = createResp.Body.Close() }()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create role: expected 201, got %d", createResp.StatusCode)
	}

	var created map[string]any
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatalf("decode created role: %v", err)
	}
	roleID, ok := created["id"].(string)
	if !ok || roleID == "" {
		t.Fatal("created role missing id")
	}

	// Fetch the role via the detail endpoint.
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/roles/"+roleID, nil)
	defer func() { _ = getResp.Body.Close() }()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get role: expected 200, got %d", getResp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(getResp.Body).Decode(&body); err != nil {
		t.Fatalf("decode role: %v", err)
	}

	// userCount must be present and equal to 0 (pointer is non-nil, so it
	// serialises even when zero).
	userCount, ok := body["userCount"].(float64)
	if !ok {
		t.Fatal("userCount field missing or not a number; pointer serialisation may be broken")
	}
	if int(userCount) != 0 {
		t.Errorf("userCount = %d, want 0", int(userCount))
	}
}

func TestRBACRoutes_GetRole_NotFound(t *testing.T) {
	server, _, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/roles/nonexistent-id-000", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}

	var pd ProblemDetail
	if err := json.NewDecoder(resp.Body).Decode(&pd); err != nil {
		t.Fatalf("decode problem: %v", err)
	}
	if pd.Type != errTypeNotFound {
		t.Errorf("type = %q, want %q", pd.Type, errTypeNotFound)
	}
}

// ---------------------------------------------------------------------------
// handleCreateRole
// ---------------------------------------------------------------------------

func TestRBACRoutes_CreateRole(t *testing.T) {
	server, _, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
		Name:        "custom-reader",
		Description: "Read-only access to roles",
		Permissions: []string{"roles:read"},
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var role roleResponse
	if err := json.NewDecoder(resp.Body).Decode(&role); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if role.Name != "custom-reader" {
		t.Errorf("name = %q, want %q", role.Name, "custom-reader")
	}
	if role.Description != "Read-only access to roles" {
		t.Errorf("description = %q, want %q", role.Description, "Read-only access to roles")
	}
	if role.ID == "" {
		t.Error("expected non-empty ID")
	}
	if role.IsBuiltin {
		t.Error("expected isBuiltin=false for custom role")
	}
}

func TestRBACRoutes_CreateRole_MissingName(t *testing.T) {
	server, _, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
		Description: "no name",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// handleUpdateRole
// ---------------------------------------------------------------------------

func TestRBACRoutes_UpdateRole(t *testing.T) {
	server, _, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	// Create a role to update.
	createResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
		Name:        "updatable",
		Description: "Will be updated",
		Permissions: []string{"roles:read"},
	})
	defer func() { _ = createResp.Body.Close() }()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d", createResp.StatusCode)
	}
	var created roleResponse
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}

	// Update description and permissions.
	newDesc := "Updated description"
	resp := doJSON(t, client, http.MethodPatch, server.URL+"/api/v1/roles/"+created.ID, updateRoleRequest{
		Description: &newDesc,
		AddPerms:    []string{"users:read"},
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var updated roleResponse
	if err := json.NewDecoder(resp.Body).Decode(&updated); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if updated.Description != newDesc {
		t.Errorf("description = %q, want %q", updated.Description, newDesc)
	}
	if updated.Name != "updatable" {
		t.Errorf("name should remain %q, got %q", "updatable", updated.Name)
	}
}

func TestRBACRoutes_UpdateRole_NotFound(t *testing.T) {
	server, _, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	desc := "won't work"
	resp := doJSON(t, client, http.MethodPatch, server.URL+"/api/v1/roles/nonexistent-id-999", updateRoleRequest{
		Description: &desc,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestRBACRoutes_UpdateRole_ImmutableSuperadmin(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)
	saID := superadminRoleID(t, drv)

	desc := "try to modify superadmin"
	resp := doJSON(t, client, http.MethodPatch, server.URL+"/api/v1/roles/"+saID, updateRoleRequest{
		Description: &desc,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// handleDeleteRole
// ---------------------------------------------------------------------------

func TestRBACRoutes_DeleteRole(t *testing.T) {
	server, _, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	// Create a role to delete.
	createResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
		Name:        "deletable",
		Description: "Will be deleted",
	})
	defer func() { _ = createResp.Body.Close() }()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d", createResp.StatusCode)
	}
	var created roleResponse
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}

	// Delete it.
	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/roles/"+created.ID, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.StatusCode)
	}

	// Verify it's gone.
	getResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/roles/"+created.ID, nil)
	defer func() { _ = getResp.Body.Close() }()

	if getResp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", getResp.StatusCode)
	}
}

func TestRBACRoutes_DeleteRole_NotFound(t *testing.T) {
	server, _, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/roles/nonexistent-id-888", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestRBACRoutes_DeleteRole_ImmutableSuperadmin(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)
	saID := superadminRoleID(t, drv)

	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/roles/"+saID, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// handleListUserRoles
// ---------------------------------------------------------------------------

func TestRBACRoutes_ListUserRoles(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	// Create a user and assign a role.
	userID := createTestUserDirect(t, drv, "list-roles-user", "Pass1234!!")

	// Create a custom role and assign it.
	createResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
		Name:        "lister",
		Description: "for listing test",
		Permissions: []string{"roles:read"},
	})
	defer func() { _ = createResp.Body.Close() }()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create role: expected 201, got %d", createResp.StatusCode)
	}
	var role roleResponse
	if err := json.NewDecoder(createResp.Body).Decode(&role); err != nil {
		t.Fatal(err)
	}

	// Assign.
	assignResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/roles", assignRoleRequest{
		RoleID: role.ID,
	})
	defer func() { _ = assignResp.Body.Close() }()
	if assignResp.StatusCode != http.StatusCreated {
		t.Fatalf("assign: expected 201, got %d", assignResp.StatusCode)
	}

	// List user roles.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID+"/roles", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var roles []userRoleResponse
	if err := json.NewDecoder(resp.Body).Decode(&roles); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(roles) != 1 {
		t.Fatalf("expected 1 role, got %d", len(roles))
	}
	if roles[0].RoleID != role.ID {
		t.Errorf("roleId = %q, want %q", roles[0].RoleID, role.ID)
	}
	if roles[0].RoleName != "lister" {
		t.Errorf("roleName = %q, want %q", roles[0].RoleName, "lister")
	}
	if roles[0].GrantedAt == "" {
		t.Error("expected non-empty grantedAt")
	}
}

// ---------------------------------------------------------------------------
// handleAssignRole
// ---------------------------------------------------------------------------

func TestRBACRoutes_AssignRole(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)
	saID := superadminRoleID(t, drv)

	userID := createTestUserDirect(t, drv, "assign-user", "Pass5678!!")

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/roles", assignRoleRequest{
		RoleID: saID,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, pd.Detail)
	}

	var body map[string]bool
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body["ok"] {
		t.Error("expected ok=true")
	}
}

func TestRBACRoutes_AssignRole_MissingRoleID(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	userID := createTestUserDirect(t, drv, "assign-norole", "Pass9012!!")

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/roles", assignRoleRequest{
		RoleID: "",
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// handleRevokeRole
// ---------------------------------------------------------------------------

// loginAsLimited logs in as the given username/password and returns
// a session-cookie-bearing client. Used to simulate non-superadmin
// callers in escalation tests.
func loginAsLimited(t *testing.T, serverURL, username, password string) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	resp := doJSON(t, client, http.MethodPost, serverURL+"/api/v1/auth/login", map[string]string{
		"username": username,
		"password": password,
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("limited login: expected 200, got %d: %s", resp.StatusCode, pd.Detail)
	}
	return client
}

// seedLimitedUser creates a custom role with the supplied permission
// set, assigns it to a fresh user, and returns the username/password.
func seedLimitedUser(t *testing.T, drv store.Driver, perms []string) (string, string) {
	t.Helper()
	ctx := context.Background()

	username := "limited-" + uuidShort()
	password := "PassABCD!!"
	createTestUserDirect(t, drv, username, password)

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	role, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID:          "role_" + uuidShort(),
		Name:        "limited-" + uuidShort(),
		Description: "test escalation harness",
		Permissions: perms,
	})
	if err != nil {
		t.Fatal(err)
	}
	user, err := tx.GetUserByUsername(ctx, username)
	if err != nil {
		t.Fatalf("seedLimitedUser: GetUserByUsername(%q): %v", username, err)
	}
	if err := tx.AssignRole(ctx, user.ID, role.ID, ""); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return username, password
}

func uuidShort() string {
	return uuid.NewString()[:8]
}

func TestRBACRoutes_CreateRole_EscalationRejected(t *testing.T) {
	server, drv, _ := setupRBACTestServer(t)
	username, password := seedLimitedUser(t, drv, []string{"roles:manage", "roles:read"})
	client := loginAsLimited(t, server.URL, username, password)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
		Name:        "would-escalate",
		Description: "should be denied",
		Permissions: []string{"roles:read", "users:manage"}, // users:manage not held
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 403, got %d: %s", resp.StatusCode, pd.Detail)
	}

	// Confirm an audit row was committed.
	ctx := context.Background()
	tx, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	entries, err := tx.QueryAuditLog(ctx, store.AuditQuery{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if e.GetPayloadSchema() == "auth.role_escalation_rejected.v1" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected at least one auth.role_escalation_rejected.v1 audit entry")
	}
}

func TestRBACRoutes_UpdateRole_EscalationRejected(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)

	// Root creates a baseline role (with one of the permissions a limited
	// user holds) so the limited user can attempt to escalate it.
	rootClient := loginAsRoot(t, server.URL, rootPassword)
	createResp := doJSON(t, rootClient, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
		Name:        "baseline-" + uuidShort(),
		Description: "baseline",
		Permissions: []string{"roles:read"},
	})
	defer func() { _ = createResp.Body.Close() }()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("baseline create: %d", createResp.StatusCode)
	}
	var baseline roleResponse
	if err := json.NewDecoder(createResp.Body).Decode(&baseline); err != nil {
		t.Fatal(err)
	}

	// Switch to a limited user and try to add a permission the actor
	// doesn't have.
	username, password := seedLimitedUser(t, drv, []string{"roles:manage", "roles:read"})
	client := loginAsLimited(t, server.URL, username, password)

	resp := doJSON(t, client, http.MethodPatch, server.URL+"/api/v1/roles/"+baseline.ID, updateRoleRequest{
		AddPerms: []string{"users:manage"},
	})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		var pd ProblemDetail
		_ = json.NewDecoder(resp.Body).Decode(&pd)
		t.Fatalf("expected 403, got %d: %s", resp.StatusCode, pd.Detail)
	}
}

func TestRBACRoutes_RevokeRole(t *testing.T) {
	server, drv, rootPassword := setupRBACTestServer(t)
	client := loginAsRoot(t, server.URL, rootPassword)

	userID := createTestUserDirect(t, drv, "revoke-user", "PassABCD!!")

	// Create and assign a role.
	createResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/roles", createRoleRequest{
		Name:        "revocable",
		Description: "will be revoked",
		Permissions: []string{"roles:read"},
	})
	defer func() { _ = createResp.Body.Close() }()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d", createResp.StatusCode)
	}
	var role roleResponse
	if err := json.NewDecoder(createResp.Body).Decode(&role); err != nil {
		t.Fatal(err)
	}

	assignResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/users/"+userID+"/roles", assignRoleRequest{
		RoleID: role.ID,
	})
	defer func() { _ = assignResp.Body.Close() }()
	if assignResp.StatusCode != http.StatusCreated {
		t.Fatalf("assign: expected 201, got %d", assignResp.StatusCode)
	}

	// Revoke.
	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/users/"+userID+"/roles/"+role.ID, nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.StatusCode)
	}

	// Verify it's revoked: list should be empty.
	listResp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID+"/roles", nil)
	defer func() { _ = listResp.Body.Close() }()

	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", listResp.StatusCode)
	}
	var roles []userRoleResponse
	if err := json.NewDecoder(listResp.Body).Decode(&roles); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(roles) != 0 {
		t.Errorf("expected 0 roles after revoke, got %d", len(roles))
	}
}
