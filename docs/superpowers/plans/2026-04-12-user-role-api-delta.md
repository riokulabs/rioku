# User & Role API Delta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining gaps in the user/role REST API: soft-delete user, admin session listing for other users, and role user count.

**Architecture:** Three small additions to existing gateway handlers. Soft-delete uses status update (not hard delete) plus session revocation. Admin session listing reuses the existing `sessionResponse` shape. Role user count extends the existing `roleResponse` with a single field. A login guard for "deleted" status is also added to prevent soft-deleted users from authenticating.

**Tech Stack:** Go 1.24, net/http, SQLite store

**Working directory:** `packages/daemon`

**Spec:** `docs/superpowers/specs/2026-04-12-rest-api-endpoints.md` (section #79)

**Key conventions:**
- Go standard library preferred, no external test libraries
- Table-driven tests, real databases for integration tests
- Handle every error explicitly, `-race` flag on all tests
- Conventional Commits required, no AI references in commits
- TDD: write test first, verify it fails, then implement

**Test patterns used in this codebase:**
- `setupUserTestServer(t)` returns `(*httptest.Server, store.Driver, string, *http.Client)` — server, driver, root password, authenticated client
- `setupRBACTestServer(t)` returns `(*httptest.Server, store.Driver, string)` — server, driver, root password
- `doJSON(t, client, method, url, body)` returns `*http.Response` — defined in `rbac_integration_test.go`
- `createTestUser(t, client, serverURL, username, password)` returns user ID string
- `loginAsRoot(t, serverURL, rootPassword)` returns `*http.Client` with session cookie

---

## Task 1: Soft-delete user endpoint (DELETE /api/v1/users/{id})

**Files:**
- Modify: `packages/daemon/internal/gateway/user_routes.go`
- Modify: `packages/daemon/internal/gateway/user_routes_test.go`
- Modify: `packages/daemon/internal/gateway/auth_routes.go`

- [ ] **Step 1: Write failing tests for soft-delete**

Add to `packages/daemon/internal/gateway/user_routes_test.go`:

```go
func TestDeleteUser_SoftDelete(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	// Create a user to delete.
	userID := createTestUser(t, client, server.URL, "deleteme", "TestPassword1234!")

	// Soft-delete the user.
	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete user: status %d, want 204", resp.StatusCode)
	}

	// User should still be readable with status "deleted".
	resp2 := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("get deleted user: status %d, want 200", resp2.StatusCode)
	}
	var got userResponse
	if err := json.NewDecoder(resp2.Body).Decode(&got); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if got.Status != "deleted" {
		t.Errorf("user status = %q, want %q", got.Status, "deleted")
	}
}

func TestDeleteUser_NotFound(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/users/nonexistent-id", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("delete nonexistent user: status %d, want 404", resp.StatusCode)
	}
}

func TestDeleteUser_CannotLogin(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	password := "TestPassword1234!"
	userID := createTestUser(t, client, server.URL, "logintest", password)

	// Soft-delete.
	resp := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/users/"+userID, nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete user: status %d, want 204", resp.StatusCode)
	}

	// Try to login as the deleted user with a fresh (unauthenticated) client.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	freshClient := &http.Client{Jar: jar}

	resp2 := doJSON(t, freshClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "logintest",
		"password": password,
	})
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusForbidden {
		t.Fatalf("login after delete: status %d, want 403", resp2.StatusCode)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestDeleteUser"
```

Expected: FAIL — route not registered, returns 405 Method Not Allowed.

- [ ] **Step 3: Implement handleDeleteUser**

In `packages/daemon/internal/gateway/user_routes.go`, add the handler function:

```go
func handleDeleteUser(st store.Driver, sm *auth.SessionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"User ID is required", r.URL.Path, nil)
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"No user exists with the given ID", r.URL.Path, nil)
			return
		}

		user.Status = "deleted"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "update user status")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit tx")
			return
		}

		// Revoke all sessions outside the store transaction.
		_ = sm.RevokeAllSessionsForUser(ctx, id)

		w.WriteHeader(http.StatusNoContent)
	}
}
```

- [ ] **Step 4: Register the route in RegisterUserRoutes**

In `packages/daemon/internal/gateway/user_routes.go`, in `RegisterUserRoutes`, add after the existing route registrations (after the `reset-password` route):

```go
	mux.Handle("DELETE /api/v1/users/{id}", RequirePermission("users:manage")(http.HandlerFunc(handleDeleteUser(st, sm))))
```

- [ ] **Step 5: Add "deleted" status check to handleLogin**

In `packages/daemon/internal/gateway/auth_routes.go`, in `handleLogin`, after the suspended status check block (after the `return` following "This account has been suspended. Contact an administrator."), add:

```go
		// Check deleted status (soft-deleted users cannot authenticate).
		if user.Status == "deleted" {
			writeProblem(w, http.StatusForbidden, errTypeForbidden, "Account deleted",
				"This account has been deleted. Contact an administrator.", r.URL.Path, nil)
			return
		}
```

- [ ] **Step 6: Run soft-delete tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestDeleteUser"
```

Expected: All 3 tests PASS.

- [ ] **Step 7: Run full gateway test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/gateway/
```

Expected: All tests pass, no regressions.

- [ ] **Step 8: Commit**

```
feat(gateway): add soft-delete user endpoint and login guard for deleted status
```

---

## Task 2: Admin session listing (GET /api/v1/users/{id}/sessions)

**Files:**
- Modify: `packages/daemon/internal/gateway/user_routes.go`
- Modify: `packages/daemon/internal/gateway/user_routes_test.go`

- [ ] **Step 1: Write failing tests**

Add to `packages/daemon/internal/gateway/user_routes_test.go`:

```go
func TestListUserSessions_Admin(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	password := "TestPassword1234!"
	userID := createTestUser(t, client, server.URL, "sessionuser", password)

	// Log in as the new user to create a session for them.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	userClient := &http.Client{Jar: jar}
	resp := doJSON(t, userClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "sessionuser",
		"password": password,
	})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login as sessionuser: status %d", resp.StatusCode)
	}

	// As admin (client), list sessions for that user.
	resp2 := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/"+userID+"/sessions", nil)
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("list user sessions: status %d, want 200", resp2.StatusCode)
	}

	var sessions []sessionResponse
	if err := json.NewDecoder(resp2.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}

	if len(sessions) == 0 {
		t.Error("expected at least 1 session for user")
	}
	for _, s := range sessions {
		if s.ID == "" {
			t.Error("session ID should not be empty")
		}
		if s.CreatedAt == "" {
			t.Error("session CreatedAt should not be empty")
		}
	}
}

func TestListUserSessions_Empty(t *testing.T) {
	server, _, _, client := setupUserTestServer(t)

	// List sessions for a nonexistent user — should return empty array, not 404.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/users/nonexistent-id/sessions", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list sessions for nonexistent user: status %d, want 200", resp.StatusCode)
	}

	var sessions []sessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}

	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestListUserSessions"
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement handleListUserSessions**

In `packages/daemon/internal/gateway/user_routes.go`, add:

```go
func handleListUserSessions(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID := r.PathValue("id")
		if userID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"User ID is required", r.URL.Path, nil)
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		sessions, err := tx.ListSessionsByUser(ctx, userID)
		if err != nil {
			writeInternalError(w, r, "list sessions")
			return
		}

		result := make([]sessionResponse, 0, len(sessions))
		for _, s := range sessions {
			sr := sessionResponse{
				ID:         s.ID,
				CreatedAt:  s.CreatedAt.Format(time.RFC3339),
				LastActive: s.LastActive.Format(time.RFC3339),
				ExpiresAt:  s.ExpiresAt.Format(time.RFC3339),
			}
			if s.IPAddress != nil {
				sr.IPAddress = *s.IPAddress
			}
			if s.UserAgent != nil {
				sr.UserAgent = *s.UserAgent
			}
			result = append(result, sr)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}
}
```

**Note:** `sessionResponse` is defined in `auth_routes.go` and is accessible since both files are in the `gateway` package. Ensure `time` is imported in `user_routes.go`.

- [ ] **Step 4: Register the route**

In `packages/daemon/internal/gateway/user_routes.go`, in `RegisterUserRoutes`, add:

```go
	mux.Handle("GET /api/v1/users/{id}/sessions", RequirePermission("sessions:read")(http.HandlerFunc(handleListUserSessions(st))))
```

- [ ] **Step 5: Run tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestListUserSessions"
```

Expected: PASS

- [ ] **Step 6: Run full gateway test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/gateway/
```

Expected: All pass.

- [ ] **Step 7: Commit**

```
feat(gateway): add admin session listing endpoint for users
```

---

## Task 3: Role with user count (GET /api/v1/roles/{id} enhancement)

**Files:**
- Modify: `packages/daemon/internal/gateway/rbac_routes.go`
- Modify: `packages/daemon/internal/gateway/rbac_routes_test.go` (or `rbac_integration_test.go`)

- [ ] **Step 1: Write failing test**

Add to the RBAC test file (whichever file contains `TestRBACIntegration` or `TestGetRole` tests):

```go
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
	if body["name"].(string) != "superadmin" {
		t.Errorf("role name = %q, want %q", body["name"], "superadmin")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestGetRole_WithUserCount"
```

Expected: FAIL — `userCount` field is 0 or missing.

- [ ] **Step 3: Add UserCount to roleResponse**

In `packages/daemon/internal/gateway/rbac_routes.go`, modify the `roleResponse` struct from:

```go
type roleResponse struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsBuiltin   bool     `json:"isBuiltin"`
	Permissions []string `json:"permissions"`
}
```

to:

```go
type roleResponse struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsBuiltin   bool     `json:"isBuiltin"`
	Permissions []string `json:"permissions"`
	UserCount   int      `json:"userCount"`
}
```

- [ ] **Step 4: Update handleGetRole to populate UserCount**

In `packages/daemon/internal/gateway/rbac_routes.go`, in `handleGetRole`, replace the response encoding block (the lines with `w.Header().Set("Content-Type", ...)` and `json.NewEncoder(w).Encode(toRoleResponse(role))`) with:

```go
		userIDs, err := tx.ListUsersWithRole(ctx, id)
		if err != nil {
			writeInternalError(w, r, "list users with role")
			return
		}

		resp := toRoleResponse(role)
		resp.UserCount = len(userIDs)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
```

- [ ] **Step 5: Run tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/gateway/ -run "TestGetRole_WithUserCount"
```

Expected: PASS

- [ ] **Step 6: Run full gateway test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./internal/gateway/
```

Expected: All pass.

- [ ] **Step 7: Commit**

```
feat(gateway): add userCount to role detail endpoint
```

---

## Task 4: Full verification

- [ ] **Step 1: Run complete daemon test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./...
```

Expected: All pass.

- [ ] **Step 2: Verify build**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && make build-daemon
```

Expected: Binary builds cleanly.

- [ ] **Step 3: Commit (if any fixups needed)**

Only if Step 1 or 2 revealed issues that needed fixing.

---

## Summary of all files modified

### Modified:
- `packages/daemon/internal/gateway/user_routes.go` — `handleDeleteUser`, `handleListUserSessions`, 2 new route registrations
- `packages/daemon/internal/gateway/user_routes_test.go` — 5 new test functions
- `packages/daemon/internal/gateway/auth_routes.go` — "deleted" status check in `handleLogin`
- `packages/daemon/internal/gateway/rbac_routes.go` — `UserCount` field on `roleResponse`, `ListUsersWithRole` call in `handleGetRole`
- RBAC test file — 1 new test function

### Commits (3-4 total):
1. `feat(gateway): add soft-delete user endpoint and login guard for deleted status`
2. `feat(gateway): add admin session listing endpoint for users`
3. `feat(gateway): add userCount to role detail endpoint`
4. (optional) fixup from full verification
