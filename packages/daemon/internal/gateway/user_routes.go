package gateway

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterUserRoutes registers user management CRUD endpoints on the
// mux. Both the legacy `/api/v1/users` and the tenant-scoped
// `/api/v1/t/{tenant}/users` paths are exposed; storage filters by
// tenant via context so the handlers don't change.
func RegisterUserRoutes(mux *http.ServeMux, st store.Driver, sm *auth.SessionManager, cfg *config.Config) {
	listH := RequirePermission("users:read")(rerr.H(handleListUsers(st)))
	createH := RequirePermission("users:create")(rerr.H(handleCreateUser(st, cfg)))
	getH := RequirePermission("users:read")(rerr.H(handleGetUser(st)))
	updateH := RequirePermission("users:manage")(rerr.H(handleUpdateUser(st)))
	suspendH := RequirePermission("users:manage")(rerr.H(handleSuspendUser(st, sm)))
	activateH := RequirePermission("users:manage")(rerr.H(handleActivateUser(st)))
	lockH := RequirePermission("users:manage")(rerr.H(handleLockUser(st, sm)))
	unlockH := RequirePermission("users:manage")(rerr.H(handleUnlockUser(st)))
	resetPwH := RequirePermission("users:manage")(rerr.H(handleResetPassword(st, cfg)))
	sessionsH := RequirePermission("sessions:read")(rerr.H(handleListUserSessions(st)))
	deleteH := RequirePermission("users:manage")(rerr.H(handleDeleteUser(st, sm)))

	for _, base := range []string{"/api/v1/users", "/api/v1/t/{tenant}/users"} {
		mux.Handle("GET "+base, listH)
		mux.Handle("POST "+base, createH)
		mux.Handle("GET "+base+"/{id}", getH)
		mux.Handle("PATCH "+base+"/{id}", updateH)
		mux.Handle("PUT "+base+"/{id}", updateH)
		mux.Handle("POST "+base+"/{id}/suspend", suspendH)
		mux.Handle("POST "+base+"/{id}/disable", suspendH) // alias per spec
		mux.Handle("POST "+base+"/{id}/activate", activateH)
		mux.Handle("POST "+base+"/{id}/enable", activateH) // alias per spec
		mux.Handle("POST "+base+"/{id}/lock", lockH)
		mux.Handle("POST "+base+"/{id}/unlock", unlockH)
		mux.Handle("POST "+base+"/{id}/reset-password", resetPwH)
		mux.Handle("GET "+base+"/{id}/sessions", sessionsH)
		mux.Handle("DELETE "+base+"/{id}", deleteH)

		optionsutil.Register(mux, base, []string{"GET", "POST"})
		optionsutil.Register(mux, base+"/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})
		for _, action := range []string{"suspend", "disable", "activate", "enable", "lock", "unlock", "reset-password"} {
			optionsutil.Register(mux, base+"/{id}/"+action, []string{"POST"})
		}
		optionsutil.Register(mux, base+"/{id}/sessions", []string{"GET"})
	}
}

// ---------------------------------------------------------------------------
// List sessions for a user (admin endpoint)
// ---------------------------------------------------------------------------

func handleListUserSessions(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		userID := r.PathValue("id")
		if userID == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		sessions, err := tx.ListSessionsByUser(ctx, userID)
		if err != nil {
			return rerr.Wrap(err, "list sessions")
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

		return rerr.JSON(w, result)
	}
}

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

type userResponse struct {
	ID                  string   `json:"id"`
	Username            string   `json:"username"`
	DisplayName         *string  `json:"displayName"`
	Email               *string  `json:"email"`
	Roles               []string `json:"roles"`
	Permissions         []string `json:"permissions"`
	TOTPEnabled         bool     `json:"totpEnabled"`
	ForcePasswordChange bool     `json:"forcePasswordChange"`
	Status              string   `json:"status"`
	LastLogin           *string  `json:"lastLogin"`
	CreatedAt           string   `json:"createdAt"`
}

func toUserResponse(user *store.User, roles, permissions []string) userResponse {
	if roles == nil {
		roles = []string{}
	}
	if permissions == nil {
		permissions = []string{}
	}

	var lastLogin *string
	if user.LastLogin != nil {
		s := user.LastLogin.Format(time.RFC3339)
		lastLogin = &s
	}

	return userResponse{
		ID:                  user.ID,
		Username:            user.Username,
		DisplayName:         user.DisplayName,
		Email:               user.Email,
		Roles:               roles,
		Permissions:         permissions,
		TOTPEnabled:         user.TOTPEnabled,
		ForcePasswordChange: user.ForcePasswordChange,
		Status:              user.Status,
		LastLogin:           lastLogin,
		CreatedAt:           user.CreatedAt.Format(time.RFC3339),
	}
}

// ---------------------------------------------------------------------------
// List users
// ---------------------------------------------------------------------------

func handleListUsers(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		users, err := tx.ListUsers(ctx)
		if err != nil {
			return rerr.Wrap(err, "list users")
		}

		result := make([]userResponse, 0, len(users))
		for _, u := range users {
			roles, permissions, _ := auth.LoadUserScopes(ctx, st, u.ID)
			result = append(result, toUserResponse(u, roles, permissions))
		}

		// OpenAPI: ListUsers200 = `{users: [...], nextPageToken: ""}`.
		// Returning a bare array made the SPA's `useUserList` resolve
		// `data.data.users → undefined → []`, breaking the Users page
		// across every tenant.
		return rerr.JSON(w, map[string]any{
			"users":         result,
			"nextPageToken": "",
		})
	}
}

// ---------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------

type createUserRequest struct {
	Username            string  `json:"username"`
	Password            string  `json:"password"`
	DisplayName         *string `json:"displayName"`
	Email               *string `json:"email"`
	ForcePasswordChange *bool   `json:"forcePasswordChange"`
}

func handleCreateUser(st store.Driver, cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req createUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "Request body must be valid JSON"})
		}

		fields := map[string]string{}
		if req.Username == "" {
			fields["username"] = "must not be empty"
		}
		if req.Password == "" {
			fields["password"] = "must not be empty"
		}
		if len(fields) > 0 {
			return rerr.Validation(fields)
		}

		// Validate password policy.
		if err := auth.ValidatePasswordPolicy(req.Password, cfg.Auth.PasswordPolicy); err != nil {
			return rerr.Validation(map[string]string{"password": err.Error()})
		}

		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			return rerr.Wrap(err, "hash password")
		}

		forceChange := true
		if req.ForcePasswordChange != nil {
			forceChange = *req.ForcePasswordChange
		}

		now := time.Now().UTC()
		user := &store.User{
			ID:                  uuid.New().String(),
			Username:            req.Username,
			DisplayName:         req.DisplayName,
			Email:               req.Email,
			PasswordHash:        hash,
			Status:              "active",
			ForcePasswordChange: forceChange,
			PasswordChangedAt:   now,
			CreatedAt:           now,
			UpdatedAt:           now,
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		created, err := tx.CreateUser(ctx, user)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint") || strings.Contains(err.Error(), "duplicate key") {
				return rerr.Conflict(fmt.Sprintf("Username %q is already taken", req.Username), err)
			}
			slog.Error("create user failed", "component", "gateway", "error", err, "username", req.Username)
			return rerr.Wrap(err, "create user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSONStatus(w, http.StatusCreated, toUserResponse(created, []string{}, []string{}))
	}
}

// ---------------------------------------------------------------------------
// Get user
// ---------------------------------------------------------------------------

func handleGetUser(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			return rerr.NotFound("user", id)
		}

		roles, permissions, _ := auth.LoadUserScopes(ctx, st, user.ID)
		return rerr.JSON(w, toUserResponse(user, roles, permissions))
	}
}

// ---------------------------------------------------------------------------
// Update user
// ---------------------------------------------------------------------------

type updateUserRequest struct {
	DisplayName *string `json:"displayName"`
	Email       *string `json:"email"`
}

func handleUpdateUser(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		var req updateUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "Request body must be valid JSON"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			return rerr.NotFound("user", id)
		}

		if req.DisplayName != nil {
			user.DisplayName = req.DisplayName
		}
		if req.Email != nil {
			user.Email = req.Email
		}

		updated, err := tx.UpdateUser(ctx, user)
		if err != nil {
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		roles, permissions, _ := auth.LoadUserScopes(ctx, st, updated.ID)
		return rerr.JSON(w, toUserResponse(updated, roles, permissions))
	}
}

// ---------------------------------------------------------------------------
// Delete user (soft-delete)
// ---------------------------------------------------------------------------

func handleDeleteUser(st store.Driver, sm *auth.SessionManager) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			return rerr.NotFound("user", id)
		}

		user.Status = "deleted"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Revoke all sessions for the deleted user.
		_ = sm.RevokeAllSessionsForUser(ctx, id)

		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ---------------------------------------------------------------------------
// Suspend user
// ---------------------------------------------------------------------------

func handleSuspendUser(st store.Driver, sm *auth.SessionManager) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			return rerr.NotFound("user", id)
		}

		user.Status = "suspended"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Revoke all sessions for the suspended user.
		_ = sm.RevokeAllSessionsForUser(ctx, id)

		return rerr.JSON(w, map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Activate user
// ---------------------------------------------------------------------------

func handleActivateUser(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			return rerr.NotFound("user", id)
		}

		user.Status = "active"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSON(w, map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Lock user
// ---------------------------------------------------------------------------

func handleLockUser(st store.Driver, sm *auth.SessionManager) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			return rerr.NotFound("user", id)
		}

		user.Status = "locked"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Revoke all sessions for the locked user (non-fatal).
		_ = sm.RevokeAllSessionsForUser(ctx, id)

		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ---------------------------------------------------------------------------
// Unlock user
// ---------------------------------------------------------------------------

func handleUnlockUser(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.ResetFailedAttempts(ctx, id); err != nil {
			return rerr.Wrap(err, "reset failed attempts")
		}

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			return rerr.NotFound("user", id)
		}

		user.Status = "active"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSON(w, map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

func handleResetPassword(st store.Driver, cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "User ID is required"})
		}

		// Generate random 24-char password (same pattern as createRootUser in init.go).
		const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
		const pwLen = 24

		buf := make([]byte, pwLen)
		for i := range buf {
			b := make([]byte, 1)
			for {
				if _, err := rand.Read(b); err != nil {
					return rerr.Wrap(err, "generate password")
				}
				if int(b[0]) < len(charset)*(256/len(charset)) {
					buf[i] = charset[int(b[0])%len(charset)]
					break
				}
			}
		}
		plaintext := string(buf)

		hash, err := auth.HashPassword(plaintext)
		if err != nil {
			return rerr.Wrap(err, "hash password")
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			return rerr.NotFound("user", id)
		}

		user.PasswordHash = hash
		user.ForcePasswordChange = true
		user.PasswordChangedAt = time.Now().UTC()

		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// cfg is available for future policy checks.
		_ = cfg

		return rerr.JSON(w, map[string]string{"temporary_password": plaintext})
	}
}
