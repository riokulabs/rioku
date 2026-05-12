package gateway

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterTOTPRoutes registers the TOTP setup, verification, disable, and
// admin reset endpoints on the mux. The encryptor is used to protect TOTP
// secrets at rest in the database.
func RegisterTOTPRoutes(mux *http.ServeMux, st store.Driver, a *auth.Auth, sm *auth.SessionManager, enc *auth.Encryptor) {
	mux.Handle("POST /api/v1/auth/totp/setup", rerr.H(handleTOTPSetup(st, enc)))
	mux.Handle("POST /api/v1/auth/totp/verify", rerr.H(handleTOTPVerify(st, sm, enc)))
	mux.Handle("POST /api/v1/auth/totp/disable", rerr.H(handleTOTPDisable(st, sm, enc)))

	// Admin-only: reset another user's TOTP.
	mux.Handle("POST /api/v1/users/{id}/totp/reset",
		RequirePermission("users:manage")(rerr.H(handleTOTPReset(st))))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

type totpSetupResponse struct {
	Secret string `json:"secret"`
	QRURI  string `json:"qrUri"`
}

func handleTOTPSetup(st store.Driver, enc *auth.Encryptor) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		userID, username, err := resolveAuthenticatedUser(r)
		if err != nil {
			return err
		}

		// Generate a new TOTP secret.
		secret, err := auth.GenerateTOTPSecret()
		if err != nil {
			return rerr.Wrap(err, "generate TOTP secret")
		}

		// Encrypt the secret for storage.
		encrypted, err := enc.Encrypt(secret)
		if err != nil {
			return rerr.Wrap(err, "encrypt TOTP secret")
		}

		// Store the encrypted secret on the user but do NOT enable yet.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			return rerr.NotFound("user", userID)
		}

		user.TOTPSecret = &encrypted
		// Keep TOTPEnabled = false until verification succeeds.

		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "update user TOTP secret")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Use the stored username if we didn't get one from session claims.
		if username == "" {
			username = user.Username
		}

		qrURI := auth.BuildTOTPQRURI("Rioku", username, secret)

		return rerr.JSON(w, totpSetupResponse{
			Secret: secret,
			QRURI:  qrURI,
		})
	}
}

// ---------------------------------------------------------------------------
// Verify (finalize setup)
// ---------------------------------------------------------------------------

type totpVerifyRequest struct {
	Code string `json:"code"`
}

type totpVerifyResponse struct {
	BackupCodes []string `json:"backupCodes"`
}

func handleTOTPVerify(st store.Driver, sm *auth.SessionManager, enc *auth.Encryptor) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		userID, _, err := resolveAuthenticatedUser(r)
		if err != nil {
			return err
		}

		var req totpVerifyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		if req.Code == "" {
			return rerr.Validation(map[string]string{"code": "must not be empty"})
		}

		// Load user and decrypt stored secret.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			return rerr.NotFound("user", userID)
		}

		if user.TOTPSecret == nil || *user.TOTPSecret == "" {
			return rerr.Validation(map[string]string{"totp": "Call POST /api/v1/auth/totp/setup first"})
		}

		plainSecret, err := enc.Decrypt(*user.TOTPSecret)
		if err != nil {
			return rerr.Wrap(err, "decrypt TOTP secret")
		}

		// Validate the code.
		if !auth.ValidateTOTPCode(plainSecret, req.Code, time.Now()) {
			return rerr.Unauthenticated()
		}

		// Enable TOTP.
		user.TOTPEnabled = true
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "enable TOTP")
		}

		// Generate backup codes.
		plainCodes, err := auth.GenerateBackupCodes()
		if err != nil {
			return rerr.Wrap(err, "generate backup codes")
		}

		// Hash each code and store them.
		hashes := make([]string, len(plainCodes))
		for i, code := range plainCodes {
			h, err := auth.HashPassword(code)
			if err != nil {
				return rerr.Wrap(err, "hash backup code")
			}
			hashes[i] = h
		}

		if err := tx.CreateTOTPBackupCodes(ctx, userID, hashes); err != nil {
			return rerr.Wrap(err, "store backup codes")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSON(w, totpVerifyResponse{
			BackupCodes: plainCodes,
		})
	}
}

// ---------------------------------------------------------------------------
// Disable
// ---------------------------------------------------------------------------

type totpDisableRequest struct {
	CurrentPassword string `json:"currentPassword"`
}

func handleTOTPDisable(st store.Driver, sm *auth.SessionManager, enc *auth.Encryptor) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		userID, _, err := resolveAuthenticatedUser(r)
		if err != nil {
			return err
		}

		var req totpDisableRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		if req.CurrentPassword == "" {
			return rerr.Validation(map[string]string{"currentPassword": "must not be empty"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			return rerr.NotFound("user", userID)
		}

		// Verify current password.
		match, err := auth.VerifyPassword(req.CurrentPassword, user.PasswordHash)
		if err != nil || !match {
			return rerr.Unauthenticated()
		}

		// Clear TOTP fields.
		user.TOTPSecret = nil
		user.TOTPEnabled = false
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "disable TOTP")
		}

		// Delete all backup codes.
		if err := tx.DeleteTOTPBackupCodes(ctx, userID); err != nil {
			return rerr.Wrap(err, "delete backup codes")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSON(w, map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Admin reset
// ---------------------------------------------------------------------------

func handleTOTPReset(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		targetUserID := r.PathValue("id")
		if targetUserID == "" {
			return rerr.Validation(map[string]string{"id": "user ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, targetUserID)
		if err != nil {
			return rerr.NotFound("user", targetUserID)
		}

		// Clear TOTP.
		user.TOTPSecret = nil
		user.TOTPEnabled = false
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "reset TOTP")
		}

		// Delete backup codes.
		if err := tx.DeleteTOTPBackupCodes(ctx, targetUserID); err != nil {
			return rerr.Wrap(err, "delete backup codes")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSON(w, map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// resolveAuthenticatedUser extracts the authenticated user's ID and username
// from the request context. Returns a rerr error if no authentication is present.
func resolveAuthenticatedUser(r *http.Request) (userID, username string, err error) {
	if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil {
		return sc.UserID, sc.Username, nil
	}
	if c := auth.ClaimsFromContext(r.Context()); c != nil {
		return c.Subject, "", nil
	}
	return "", "", rerr.Unauthenticated()
}
