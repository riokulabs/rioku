// Package gateway — bootstrap endpoints.
//
// GET  /api/v1/auth/bootstrap-status  — returns {"required":true} when no users exist.
// POST /api/v1/auth/bootstrap          — creates the first root user + tenant atomically.
//
// Both routes are unauthenticated because they must be reachable before
// any credentials have been provisioned.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterBootstrapRoutes wires the bootstrap status and setup endpoints.
func RegisterBootstrapRoutes(mux *http.ServeMux, st store.Driver, sm *auth.SessionManager, cfg *config.Config) {
	mux.HandleFunc("GET /api/v1/auth/bootstrap-status", handleBootstrapStatus(st))
	mux.HandleFunc("POST /api/v1/auth/bootstrap", handleBootstrap(st, sm, cfg))

	optionsutil.Register(mux, "/api/v1/auth/bootstrap-status", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/auth/bootstrap", []string{"POST"})
}

// ─── GET /auth/bootstrap-status ─────────────────────────────────────────────

func handleBootstrapStatus(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		count, err := tx.CountUsers(ctx)
		if err != nil {
			writeInternalError(w, r, "count users")
			return
		}
		_ = tx.Commit()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"required": count == 0})
	}
}

// ─── POST /auth/bootstrap ────────────────────────────────────────────────────

type bootstrapRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	TenantSlug string `json:"tenantSlug"`
	TenantName string `json:"tenantName"`
}

type bootstrapResponse struct {
	TenantID string `json:"tenantId"`
	UserID   string `json:"userId"`
}

func handleBootstrap(st store.Driver, sm *auth.SessionManager, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req bootstrapRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON", r.URL.Path, nil)
			return
		}

		// Normalise
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		req.TenantSlug = strings.TrimSpace(req.TenantSlug)
		req.TenantName = strings.TrimSpace(req.TenantName)

		// Validate
		var errs []ValidationError
		if req.Email == "" {
			errs = append(errs, ValidationError{Field: "email", Reason: "must not be empty"})
		}
		if req.Password == "" {
			errs = append(errs, ValidationError{Field: "password", Reason: "must not be empty"})
		}
		if req.TenantSlug == "" {
			errs = append(errs, ValidationError{Field: "tenantSlug", Reason: "must not be empty"})
		}
		if req.TenantName == "" {
			errs = append(errs, ValidationError{Field: "tenantName", Reason: "must not be empty"})
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

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		// Idempotency check — if any user already exists, bootstrap is done.
		count, err := tx.CountUsers(ctx)
		if err != nil {
			writeInternalError(w, r, "count users")
			return
		}
		if count > 0 {
			writeProblem(w, http.StatusConflict, "https://rioku.dev/errors/bootstrap-already-completed",
				"Bootstrap already completed",
				"A root user already exists. The system has already been bootstrapped.",
				r.URL.Path, nil)
			return
		}

		// Hash password.
		passwordHash, err := auth.HashPassword(req.Password)
		if err != nil {
			writeInternalError(w, r, "hash password")
			return
		}

		// 1. Create tenant.
		now := time.Now().UTC()
		tenant, err := tx.CreateTenant(ctx, &store.Tenant{
			Slug:      req.TenantSlug,
			Name:      req.TenantName,
			Plan:      "community",
			URLMode:   "path",
			CreatedAt: now,
			UpdatedAt: now,
		})
		if err != nil {
			if errors.Is(err, store.ErrTenantSlugTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Tenant slug taken",
					"A tenant with that slug already exists.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create tenant")
			return
		}

		// 2. Create root user (username derived from email local-part).
		localPart := req.Email
		if idx := strings.Index(req.Email, "@"); idx >= 0 {
			localPart = req.Email[:idx]
		}
		emailCopy := req.Email
		user, err := tx.CreateUser(ctx, &store.User{
			Username:          localPart,
			Email:             &emailCopy,
			PasswordHash:      passwordHash,
			Status:            "active",
			PasswordChangedAt: now,
		})
		if err != nil {
			writeInternalError(w, r, "create user")
			return
		}

		// 3. Create membership (user → tenant, state=active).
		joinedAt := now
		_, err = tx.CreateMembership(ctx, &store.Membership{
			TenantID: tenant.ID,
			UserID:   user.ID,
			State:    "active",
			JoinedAt: &joinedAt,
		})
		if err != nil {
			writeInternalError(w, r, "create membership")
			return
		}

		// 4. Assign superadmin role.
		roles, err := tx.ListRoles(ctx)
		if err != nil {
			writeInternalError(w, r, "list roles")
			return
		}
		for _, role := range roles {
			if role.Name == "superadmin" {
				if err := tx.AssignRole(ctx, user.ID, role.ID, ""); err != nil {
					writeInternalError(w, r, "assign role")
					return
				}
				break
			}
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		writeJSON(w, http.StatusCreated, bootstrapResponse{
			TenantID: tenant.ID,
			UserID:   user.ID,
		})
	}
}
