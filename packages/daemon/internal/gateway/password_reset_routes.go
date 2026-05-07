// Package gateway — password reset endpoints.
//
// POST /api/v1/auth/password-reset/request   — generate token, send email (anti-enum: always 202).
// GET  /api/v1/auth/password-reset/validate  — check token not expired + not consumed.
// POST /api/v1/auth/password-reset/apply     — swap password, mark token consumed, emit audit.
//
// All three routes are unauthenticated (added to skipAuthPaths in auth_middleware.go).
package gateway

import (
	"database/sql"
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

const passwordResetTokenTTL = 1 * time.Hour

// RegisterPasswordResetRoutes wires the three password-reset endpoints.
func RegisterPasswordResetRoutes(mux *http.ServeMux, st store.Driver, mailer auth.Mailer, cfg *config.Config, baseURL string) {
	mux.HandleFunc("POST /api/v1/auth/password-reset/request", handlePasswordResetRequest(st, mailer, baseURL))
	mux.HandleFunc("GET /api/v1/auth/password-reset/validate", handlePasswordResetValidate(st))
	mux.HandleFunc("POST /api/v1/auth/password-reset/apply", handlePasswordResetApply(st, cfg))

	optionsutil.Register(mux, "/api/v1/auth/password-reset/request", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/auth/password-reset/validate", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/auth/password-reset/apply", []string{"POST"})
}

// ─── POST /auth/password-reset/request ──────────────────────────────────────

func handlePasswordResetRequest(st store.Driver, mailer auth.Mailer, baseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			// Anti-enum: always 202
			w.WriteHeader(http.StatusAccepted)
			return
		}
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))

		// Always respond 202 (anti-enumeration).
		defer func() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		}()

		if req.Email == "" {
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return
		}
		user, err := tx.GetUserByEmail(ctx, req.Email)
		_ = tx.Rollback()
		if err != nil {
			// Unknown email — return 202 silently (anti-enum).
			return
		}

		// Generate token.
		rawToken, err := auth.GeneratePasswordResetToken()
		if err != nil {
			return
		}
		tokenHash := auth.HashToken(rawToken)
		expiresAt := time.Now().UTC().Add(passwordResetTokenTTL)

		tx2, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return
		}
		if err := tx2.CreatePasswordResetToken(ctx, tokenHash, user.ID, expiresAt); err != nil {
			_ = tx2.Rollback()
			return
		}
		if err := tx2.Commit(); err != nil {
			return
		}

		// Send email (best effort — failure does not expose info).
		resetURL := fmt.Sprintf("%s/auth/reset?token=%s", strings.TrimRight(baseURL, "/"), rawToken)
		_ = mailer.Send(ctx, auth.MailMessage{
			To:      req.Email,
			Subject: "Reset your Rioku password",
			Body: fmt.Sprintf(
				"You requested a password reset for your Rioku account.\n\n"+
					"Click the link below to reset your password (valid for 1 hour):\n\n%s\n\n"+
					"If you did not request this, you can safely ignore this email.\n",
				resetURL,
			),
		})
	}
}

// ─── GET /auth/password-reset/validate ──────────────────────────────────────

func handlePasswordResetValidate(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rawToken := r.URL.Query().Get("token")
		if rawToken == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Missing token",
				"?token= query parameter is required", r.URL.Path, nil)
			return
		}

		ctx := r.Context()
		tokenHash := auth.HashToken(rawToken)

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		tok, err := tx.GetPasswordResetToken(ctx, tokenHash)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeProblem(w, http.StatusGone, "https://rioku.dev/errors/token-invalid",
					"Token invalid", "The reset token is invalid or does not exist.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get token")
			return
		}

		if tok.ConsumedAt != nil {
			writeProblem(w, http.StatusGone, "https://rioku.dev/errors/token-consumed",
				"Token already used", "This reset token has already been used.", r.URL.Path, nil)
			return
		}
		if time.Now().UTC().After(tok.ExpiresAt) {
			writeProblem(w, http.StatusGone, "https://rioku.dev/errors/token-expired",
				"Token expired", "The reset token has expired. Please request a new one.", r.URL.Path, nil)
			return
		}

		writeJSON(w, http.StatusOK, map[string]bool{"valid": true})
	}
}

// ─── POST /auth/password-reset/apply ────────────────────────────────────────

func handlePasswordResetApply(st store.Driver, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req struct {
			Token    string `json:"token"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON with 'token' and 'password' fields", r.URL.Path, nil)
			return
		}

		var errs []ValidationError
		if req.Token == "" {
			errs = append(errs, ValidationError{Field: "token", Reason: "must not be empty"})
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

		tok, err := tx.GetPasswordResetToken(ctx, tokenHash)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeProblem(w, http.StatusGone, "https://rioku.dev/errors/token-invalid",
					"Token invalid", "The reset token is invalid.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get token")
			return
		}

		if tok.ConsumedAt != nil {
			writeProblem(w, http.StatusGone, "https://rioku.dev/errors/token-consumed",
				"Token already used", "This reset token has already been used.", r.URL.Path, nil)
			return
		}
		if time.Now().UTC().After(tok.ExpiresAt) {
			writeProblem(w, http.StatusGone, "https://rioku.dev/errors/token-expired",
				"Token expired", "The reset token has expired.", r.URL.Path, nil)
			return
		}

		// Hash the new password.
		newHash, err := auth.HashPassword(req.Password)
		if err != nil {
			writeInternalError(w, r, "hash password")
			return
		}

		// Load the user and update password.
		user, err := tx.GetUser(ctx, tok.UserID)
		if err != nil {
			writeInternalError(w, r, "get user")
			return
		}
		user.PasswordHash = newHash
		user.PasswordChangedAt = time.Now().UTC()
		user.ForcePasswordChange = false
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "update user")
			return
		}

		// Consume the token.
		if err := tx.ConsumePasswordResetToken(ctx, tokenHash); err != nil {
			writeInternalError(w, r, "consume token")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}
