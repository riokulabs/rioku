// Package gateway — invite endpoints.
//
// POST /api/v1/t/{tenant}/users/invite  — admin creates invite (needs user:invite permission).
// POST /api/v1/auth/invite/accept       — invitee accepts, creates account + activates membership.
package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterInviteRoutes wires the invite-create and invite-accept endpoints.
func RegisterInviteRoutes(mux *http.ServeMux, st store.Driver, sm *auth.SessionManager, mailer auth.Mailer, cfg *config.Config) {
	baseURL := cfg.Auth.PublicURL
	if baseURL == "" {
		baseURL = "http://localhost:7778"
	}

	mux.Handle("POST /api/v1/t/{tenant}/users/invite",
		RequirePermission("user:invite")(rerr.H(handleCreateInvite(st, mailer, baseURL))))

	mux.Handle("POST /api/v1/auth/invite/accept", rerr.H(handleInviteAccept(st, sm, cfg)))

	optionsutil.Register(mux, "/api/v1/t/{tenant}/users/invite", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/auth/invite/accept", []string{"POST"})
}

// ─── POST /t/{tenant}/users/invite ──────────────────────────────────────────

type createInviteRequest struct {
	Email   string   `json:"email"`
	RoleIDs []string `json:"roleIds"`
}

func handleCreateInvite(st store.Driver, mailer auth.Mailer, baseURL string) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		ctx := r.Context()

		var req createInviteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		if req.Email == "" {
			return rerr.Validation(map[string]string{"email": "email is required"})
		}

		// Generate invite token.
		rawToken, err := auth.GenerateInviteToken()
		if err != nil {
			return rerr.Wrap(err, "generate invite token")
		}
		tokenHash := auth.HashToken(rawToken)

		// Caller identity (for invitedBy).
		var inviterID string
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			inviterID = sc.UserID
		} else if bc := auth.ClaimsFromContext(ctx); bc != nil {
			inviterID = bc.Subject
		}

		invitedAt := time.Now().UTC()

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		// Create pending membership with token hash.
		// UserID is left empty — filled in when the invite is accepted.
		var inviterIDPtr *string
		if inviterID != "" {
			inviterIDPtr = &inviterID
		}
		m, err := tx.CreateMembership(ctx, &store.Membership{
			TenantID:        tenant.ID,
			State:           "pending",
			InvitedBy:       inviterIDPtr,
			InvitedAt:       &invitedAt,
			InviteTokenHash: &tokenHash,
		})
		if err != nil {
			if errors.Is(err, store.ErrMembershipExists) {
				return rerr.Conflict("a membership for this placeholder already exists", err)
			}
			return rerr.Wrap(err, "create membership")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Send invite email (best effort).
		acceptURL := fmt.Sprintf("%s/invite/accept?token=%s", strings.TrimRight(baseURL, "/"), rawToken)
		_ = mailer.Send(ctx, auth.MailMessage{
			To:      req.Email,
			Subject: fmt.Sprintf("You've been invited to join %s on Rioku", tenant.Name),
			Body: fmt.Sprintf(
				"You have been invited to join the %s workspace on Rioku.\n\n"+
					"Click the link below to accept your invitation (valid for 7 days):\n\n%s\n\n"+
					"If you did not expect this invitation, you can safely ignore this email.\n",
				tenant.Name, acceptURL,
			),
		})

		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, map[string]string{
			"membershipId": m.ID,
			"status":       "pending",
		})
	}
}

// ─── POST /auth/invite/accept ────────────────────────────────────────────────

type inviteAcceptRequest struct {
	Token    string `json:"token"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func handleInviteAccept(st store.Driver, sm *auth.SessionManager, cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req inviteAcceptRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "request body must be valid JSON with 'token', 'name', and 'password' fields"})
		}

		fieldErrs := map[string]string{}
		if req.Token == "" {
			fieldErrs["token"] = "must not be empty"
		}
		if req.Name == "" {
			fieldErrs["name"] = "must not be empty"
		}
		if req.Password == "" {
			fieldErrs["password"] = "must not be empty"
		}
		if len(fieldErrs) > 0 {
			return rerr.Validation(fieldErrs)
		}

		// Validate password policy.
		if err := auth.ValidatePasswordPolicy(req.Password, cfg.Auth.PasswordPolicy); err != nil {
			return rerr.Validation(map[string]string{"password": err.Error()})
		}

		tokenHash := auth.HashToken(req.Token)

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		// Look up membership by invite token.
		m, err := tx.GetMembershipByInviteToken(ctx, tokenHash)
		if err != nil {
			if errors.Is(err, store.ErrMembershipNotFound) {
				return rerr.Gone("the invite token is invalid or has already been used")
			}
			return rerr.Wrap(err, "get membership by token")
		}

		// Only pending memberships can be accepted.
		if m.State != "pending" {
			return rerr.Gone("this invite has already been accepted")
		}

		// Hash password.
		passwordHash, err := auth.HashPassword(req.Password)
		if err != nil {
			return rerr.Wrap(err, "hash password")
		}

		// Derive username from display name (lower, spaces→dashes).
		username := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(req.Name), " ", "-"))
		if username == "" {
			username = "user"
		}
		displayName := req.Name
		now := time.Now().UTC()

		// Create the user.
		user, err := tx.CreateUser(ctx, &store.User{
			Username:          username,
			DisplayName:       &displayName,
			PasswordHash:      passwordHash,
			Status:            "active",
			PasswordChangedAt: now,
		})
		if err != nil {
			return rerr.Wrap(err, "create user")
		}

		// Activate the membership for the real user.
		if err := tx.AcceptInvite(ctx, m.ID, user.ID); err != nil {
			return rerr.Wrap(err, "accept invite")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Create a session so the user is immediately logged in.
		session, err := sm.CreateSession(ctx, user.ID, r)
		if err != nil {
			// Non-fatal: user created, just can't auto-login.
			w.WriteHeader(http.StatusCreated)
			return rerr.JSON(w, map[string]string{
				"userId": user.ID,
				"status": "created",
			})
		}
		sm.SetCookie(w, session.ID, auth.CookieOptions{})

		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, map[string]string{
			"userId":    user.ID,
			"sessionId": session.ID,
			"status":    "created",
		})
	}
}
