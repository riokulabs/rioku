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
	"github.com/riokulabs/rioku/internal/store"
)

const inviteTokenTTL = 7 * 24 * time.Hour // 7 days

// RegisterInviteRoutes wires the invite-create and invite-accept endpoints.
func RegisterInviteRoutes(mux *http.ServeMux, st store.Driver, sm *auth.SessionManager, mailer auth.Mailer, cfg *config.Config) {
	baseURL := cfg.Auth.PublicURL
	if baseURL == "" {
		baseURL = "http://localhost:7778"
	}

	mux.Handle("POST /api/v1/t/{tenant}/users/invite",
		RequirePermission("user:invite")(http.HandlerFunc(handleCreateInvite(st, mailer, baseURL))))

	mux.HandleFunc("POST /api/v1/auth/invite/accept", handleInviteAccept(st, sm, cfg))

	optionsutil.Register(mux, "/api/v1/t/{tenant}/users/invite", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/auth/invite/accept", []string{"POST"})
}

// ─── POST /t/{tenant}/users/invite ──────────────────────────────────────────

type createInviteRequest struct {
	Email   string   `json:"email"`
	RoleIDs []string `json:"roleIds"`
}

func handleCreateInvite(st store.Driver, mailer auth.Mailer, baseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		var req createInviteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		if req.Email == "" {
			writeBadRequest(w, r, "email is required")
			return
		}

		// Generate invite token.
		rawToken, err := auth.GenerateInviteToken()
		if err != nil {
			writeInternalError(w, r, "generate invite token")
			return
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
			writeInternalError(w, r, "begin tx")
			return
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
				writeProblem(w, http.StatusConflict, errTypeConflict,
					"Invite already exists",
					"A membership for this placeholder already exists", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create membership")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
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

		writeJSON(w, http.StatusCreated, map[string]string{
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

func handleInviteAccept(st store.Driver, sm *auth.SessionManager, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req inviteAcceptRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON with 'token', 'name', and 'password' fields", r.URL.Path, nil)
			return
		}

		var errs []ValidationError
		if req.Token == "" {
			errs = append(errs, ValidationError{Field: "token", Reason: "must not be empty"})
		}
		if req.Name == "" {
			errs = append(errs, ValidationError{Field: "name", Reason: "must not be empty"})
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

		tokenHash := auth.HashToken(req.Token)

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		// Look up membership by invite token.
		m, err := tx.GetMembershipByInviteToken(ctx, tokenHash)
		if err != nil {
			if errors.Is(err, store.ErrMembershipNotFound) {
				writeProblem(w, http.StatusGone, "https://rioku.dev/errors/token-invalid",
					"Invite invalid", "The invite token is invalid or has already been used.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get membership by token")
			return
		}

		// Only pending memberships can be accepted.
		if m.State != "pending" {
			writeProblem(w, http.StatusGone, "https://rioku.dev/errors/token-consumed",
				"Invite already accepted", "This invite has already been accepted.", r.URL.Path, nil)
			return
		}

		// Hash password.
		passwordHash, err := auth.HashPassword(req.Password)
		if err != nil {
			writeInternalError(w, r, "hash password")
			return
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
			writeInternalError(w, r, "create user")
			return
		}

		// Activate the membership for the real user.
		if err := tx.AcceptInvite(ctx, m.ID, user.ID); err != nil {
			writeInternalError(w, r, "accept invite")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		// Create a session so the user is immediately logged in.
		session, err := sm.CreateSession(ctx, user.ID, r)
		if err != nil {
			// Non-fatal: user created, just can't auto-login.
			writeJSON(w, http.StatusCreated, map[string]string{
				"userId": user.ID,
				"status": "created",
			})
			return
		}
		sm.SetCookie(w, session.ID, auth.CookieOptions{})

		writeJSON(w, http.StatusCreated, map[string]string{
			"userId":    user.ID,
			"sessionId": session.ID,
			"status":    "created",
		})
	}
}
