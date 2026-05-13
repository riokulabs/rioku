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
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterBootstrapRoutes wires the bootstrap status and setup endpoints.
func RegisterBootstrapRoutes(mux *http.ServeMux, st store.Driver, sm *auth.SessionManager, cfg *config.Config) {
	mux.Handle("GET /api/v1/auth/bootstrap-status", rerr.H(handleBootstrapStatus(st)))
	mux.Handle("POST /api/v1/auth/bootstrap", rerr.H(handleBootstrap(st, sm, cfg)))

	optionsutil.Register(mux, "/api/v1/auth/bootstrap-status", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/auth/bootstrap", []string{"POST"})
}

// ─── GET /auth/bootstrap-status ─────────────────────────────────────────────

func handleBootstrapStatus(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		count, err := tx.CountUsers(ctx)
		if err != nil {
			return rerr.Wrap(err, "count users")
		}
		_ = tx.Commit()

		return rerr.JSON(w, map[string]bool{"required": count == 0})
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

func handleBootstrap(st store.Driver, _ *auth.SessionManager, cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req bootstrapRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "request body must be valid JSON"})
		}

		// Normalise
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		req.TenantSlug = strings.TrimSpace(req.TenantSlug)
		req.TenantName = strings.TrimSpace(req.TenantName)

		// Validate
		fieldErrs := map[string]string{}
		if req.Email == "" {
			fieldErrs["email"] = "must not be empty"
		}
		if req.Password == "" {
			fieldErrs["password"] = "must not be empty"
		}
		if req.TenantSlug == "" {
			fieldErrs["tenantSlug"] = "must not be empty"
		}
		if req.TenantName == "" {
			fieldErrs["tenantName"] = "must not be empty"
		}
		if len(fieldErrs) > 0 {
			return rerr.Validation(fieldErrs)
		}

		// Validate password policy.
		if err := auth.ValidatePasswordPolicy(req.Password, cfg.Auth.PasswordPolicy); err != nil {
			return rerr.Validation(map[string]string{"password": err.Error()})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		// Idempotency check — if any user already exists, bootstrap is done.
		count, err := tx.CountUsers(ctx)
		if err != nil {
			return rerr.Wrap(err, "count users")
		}
		if count > 0 {
			return rerr.Conflict("a root user already exists; the system has already been bootstrapped", nil)
		}

		// Hash password.
		passwordHash, err := auth.HashPassword(req.Password)
		if err != nil {
			return rerr.Wrap(err, "hash password")
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
				return rerr.Conflict("a tenant with that slug already exists", err)
			}
			return rerr.Wrap(err, "create tenant")
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
			return rerr.Wrap(err, "create user")
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
			return rerr.Wrap(err, "create membership")
		}

		// 4. Assign superadmin role.
		roles, err := tx.ListRoles(ctx)
		if err != nil {
			return rerr.Wrap(err, "list roles")
		}
		for _, role := range roles {
			if role.Name == "superadmin" {
				if err := tx.AssignRole(ctx, user.ID, role.ID, ""); err != nil {
					return rerr.Wrap(err, "assign role")
				}
				break
			}
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSONStatus(w, http.StatusCreated, bootstrapResponse{
			TenantID: tenant.ID,
			UserID:   user.ID,
		})
	}
}
