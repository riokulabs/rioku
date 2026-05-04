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
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterUserRoutes registers user management CRUD endpoints on the
// mux. Both the legacy `/api/v1/users` and the tenant-scoped
// `/api/v1/t/{tenant}/users` paths are exposed; storage filters by
// tenant via context so the handlers don't change.
func RegisterUserRoutes(mux *http.ServeMux, st store.Driver, sm *auth.SessionManager, cfg *config.Config) {
	listH := RequirePermission("users:read")(http.HandlerFunc(handleListUsers(st)))
	createH := RequirePermission("users:create")(http.HandlerFunc(handleCreateUser(st, cfg)))
	getH := RequirePermission("users:read")(http.HandlerFunc(handleGetUser(st)))
	updateH := RequirePermission("users:manage")(http.HandlerFunc(handleUpdateUser(st)))
	suspendH := RequirePermission("users:manage")(http.HandlerFunc(handleSuspendUser(st, sm)))
	activateH := RequirePermission("users:manage")(http.HandlerFunc(handleActivateUser(st)))
	lockH := RequirePermission("users:manage")(http.HandlerFunc(handleLockUser(st, sm)))
	unlockH := RequirePermission("users:manage")(http.HandlerFunc(handleUnlockUser(st)))
	resetPwH := RequirePermission("users:manage")(http.HandlerFunc(handleResetPassword(st, cfg)))
	sessionsH := RequirePermission("sessions:read")(http.HandlerFunc(handleListUserSessions(st)))
	deleteH := RequirePermission("users:manage")(http.HandlerFunc(handleDeleteUser(st, sm)))

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

func handleListUsers(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		users, err := tx.ListUsers(ctx)
		if err != nil {
			writeInternalError(w, r, "list users")
			return
		}

		result := make([]userResponse, 0, len(users))
		for _, u := range users {
			roles, permissions, _ := auth.LoadUserScopes(ctx, st, u.ID)
			result = append(result, toUserResponse(u, roles, permissions))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
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

func handleCreateUser(st store.Driver, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req createUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON", r.URL.Path, nil)
			return
		}

		var errs []ValidationError
		if req.Username == "" {
			errs = append(errs, ValidationError{Field: "username", Reason: "must not be empty"})
		}
		if req.Password == "" {
			errs = append(errs, ValidationError{Field: "password", Reason: "must not be empty"})
		}
		if len(errs) > 0 {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Missing required fields", r.URL.Path, errs)
			return
		}

		// Validate password policy.
		if err := auth.ValidatePasswordPolicy(req.Password, cfg.Auth.PasswordPolicy); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Password policy violation",
				err.Error(), r.URL.Path, nil)
			return
		}

		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			writeInternalError(w, r, "hash password")
			return
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
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		created, err := tx.CreateUser(ctx, user)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint") || strings.Contains(err.Error(), "duplicate key") {
				writeProblem(w, http.StatusConflict, errTypeConflict, "User already exists",
					fmt.Sprintf("Username %q is already taken", req.Username), r.URL.Path, nil)
				return
			}
			slog.Error("create user failed", "component", "gateway", "error", err, "username", req.Username)
			writeInternalError(w, r, "create user")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toUserResponse(created, []string{}, []string{}))
	}
}

// ---------------------------------------------------------------------------
// Get user
// ---------------------------------------------------------------------------

func handleGetUser(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
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

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"No user exists with the given ID", r.URL.Path, nil)
			return
		}

		roles, permissions, _ := auth.LoadUserScopes(ctx, st, user.ID)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toUserResponse(user, roles, permissions))
	}
}

// ---------------------------------------------------------------------------
// Update user
// ---------------------------------------------------------------------------

type updateUserRequest struct {
	DisplayName *string `json:"displayName"`
	Email       *string `json:"email"`
}

func handleUpdateUser(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"User ID is required", r.URL.Path, nil)
			return
		}

		var req updateUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON", r.URL.Path, nil)
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

		if req.DisplayName != nil {
			user.DisplayName = req.DisplayName
		}
		if req.Email != nil {
			user.Email = req.Email
		}

		updated, err := tx.UpdateUser(ctx, user)
		if err != nil {
			writeInternalError(w, r, "update user")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		roles, permissions, _ := auth.LoadUserScopes(ctx, st, updated.ID)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toUserResponse(updated, roles, permissions))
	}
}

// ---------------------------------------------------------------------------
// Delete user (soft-delete)
// ---------------------------------------------------------------------------

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
			writeInternalError(w, r, "update user")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		// Revoke all sessions for the deleted user.
		_ = sm.RevokeAllSessionsForUser(ctx, id)

		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Suspend user
// ---------------------------------------------------------------------------

func handleSuspendUser(st store.Driver, sm *auth.SessionManager) http.HandlerFunc {
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

		user.Status = "suspended"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "update user")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		// Revoke all sessions for the suspended user.
		_ = sm.RevokeAllSessionsForUser(ctx, id)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Activate user
// ---------------------------------------------------------------------------

func handleActivateUser(st store.Driver) http.HandlerFunc {
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

		user.Status = "active"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "update user")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Lock user
// ---------------------------------------------------------------------------

func handleLockUser(st store.Driver, sm *auth.SessionManager) http.HandlerFunc {
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

		user.Status = "locked"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "update user")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		// Revoke all sessions for the locked user (non-fatal).
		_ = sm.RevokeAllSessionsForUser(ctx, id)

		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Unlock user
// ---------------------------------------------------------------------------

func handleUnlockUser(st store.Driver) http.HandlerFunc {
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

		if err := tx.ResetFailedAttempts(ctx, id); err != nil {
			writeInternalError(w, r, "reset failed attempts")
			return
		}

		user, err := tx.GetUser(ctx, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"No user exists with the given ID", r.URL.Path, nil)
			return
		}

		user.Status = "active"
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "update user")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

func handleResetPassword(st store.Driver, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"User ID is required", r.URL.Path, nil)
			return
		}

		// Generate random 24-char password (same pattern as createRootUser in init.go).
		const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
		const pwLen = 24

		buf := make([]byte, pwLen)
		for i := range buf {
			b := make([]byte, 1)
			for {
				if _, err := rand.Read(b); err != nil {
					writeInternalError(w, r, "generate password")
					return
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
			writeInternalError(w, r, "hash password")
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

		user.PasswordHash = hash
		user.ForcePasswordChange = true
		user.PasswordChangedAt = time.Now().UTC()

		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "update user")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"temporary_password": plaintext})
	}
}
