package gateway

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterTOTPRoutes registers the TOTP setup, verification, disable, and
// admin reset endpoints on the mux. The encryptor is used to protect TOTP
// secrets at rest in the database.
func RegisterTOTPRoutes(mux *http.ServeMux, st store.Driver, a *auth.Auth, sm *auth.SessionManager, enc *auth.Encryptor) {
	mux.HandleFunc("POST /api/v1/auth/totp/setup", handleTOTPSetup(st, enc))
	mux.HandleFunc("POST /api/v1/auth/totp/verify", handleTOTPVerify(st, sm, enc))
	mux.HandleFunc("POST /api/v1/auth/totp/disable", handleTOTPDisable(st, sm, enc))

	// Admin-only: reset another user's TOTP.
	mux.Handle("POST /api/v1/users/{id}/totp/reset",
		RequirePermission("users:manage")(http.HandlerFunc(handleTOTPReset(st))))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

type totpSetupResponse struct {
	Secret string `json:"secret"`
	QRURI  string `json:"qr_uri"`
}

func handleTOTPSetup(st store.Driver, enc *auth.Encryptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		userID, username, ok := resolveAuthenticatedUser(w, r)
		if !ok {
			return
		}

		// Generate a new TOTP secret.
		secret, err := auth.GenerateTOTPSecret()
		if err != nil {
			writeInternalError(w, r, "generate TOTP secret")
			return
		}

		// Encrypt the secret for storage.
		encrypted, err := enc.Encrypt(secret)
		if err != nil {
			writeInternalError(w, r, "encrypt TOTP secret")
			return
		}

		// Store the encrypted secret on the user but do NOT enable yet.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer tx.Rollback()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"The authenticated user no longer exists", r.URL.Path, nil)
			return
		}

		user.TOTPSecret = &encrypted
		// Keep TOTPEnabled = false until verification succeeds.

		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "update user TOTP secret")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		// Use the stored username if we didn't get one from session claims.
		if username == "" {
			username = user.Username
		}

		qrURI := auth.BuildTOTPQRURI("Rioku", username, secret)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(totpSetupResponse{
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
	BackupCodes []string `json:"backup_codes"`
}

func handleTOTPVerify(st store.Driver, sm *auth.SessionManager, enc *auth.Encryptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		userID, _, ok := resolveAuthenticatedUser(w, r)
		if !ok {
			return
		}

		var req totpVerifyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON with a 'code' field", r.URL.Path, nil)
			return
		}

		if req.Code == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"TOTP code is required", r.URL.Path, []ValidationError{
					{Field: "code", Reason: "must not be empty"},
				})
			return
		}

		// Load user and decrypt stored secret.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer tx.Rollback()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"The authenticated user no longer exists", r.URL.Path, nil)
			return
		}

		if user.TOTPSecret == nil || *user.TOTPSecret == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "TOTP not set up",
				"Call POST /api/v1/auth/totp/setup first", r.URL.Path, nil)
			return
		}

		plainSecret, err := enc.Decrypt(*user.TOTPSecret)
		if err != nil {
			writeInternalError(w, r, "decrypt TOTP secret")
			return
		}

		// Validate the code.
		if !auth.ValidateTOTPCode(plainSecret, req.Code, time.Now()) {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Invalid TOTP code",
				"The provided code is incorrect or has expired", r.URL.Path, nil)
			return
		}

		// Enable TOTP.
		user.TOTPEnabled = true
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "enable TOTP")
			return
		}

		// Generate backup codes.
		plainCodes, err := auth.GenerateBackupCodes()
		if err != nil {
			writeInternalError(w, r, "generate backup codes")
			return
		}

		// Hash each code and store them.
		hashes := make([]string, len(plainCodes))
		for i, code := range plainCodes {
			h, err := auth.HashPassword(code)
			if err != nil {
				writeInternalError(w, r, "hash backup code")
				return
			}
			hashes[i] = h
		}

		if err := tx.CreateTOTPBackupCodes(ctx, userID, hashes); err != nil {
			writeInternalError(w, r, "store backup codes")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(totpVerifyResponse{
			BackupCodes: plainCodes,
		})
	}
}

// ---------------------------------------------------------------------------
// Disable
// ---------------------------------------------------------------------------

type totpDisableRequest struct {
	CurrentPassword string `json:"current_password"`
}

func handleTOTPDisable(st store.Driver, sm *auth.SessionManager, enc *auth.Encryptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		userID, _, ok := resolveAuthenticatedUser(w, r)
		if !ok {
			return
		}

		var req totpDisableRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON with 'current_password'", r.URL.Path, nil)
			return
		}

		if req.CurrentPassword == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Current password is required to disable TOTP", r.URL.Path, []ValidationError{
					{Field: "current_password", Reason: "must not be empty"},
				})
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer tx.Rollback()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"The authenticated user no longer exists", r.URL.Path, nil)
			return
		}

		// Verify current password.
		match, err := auth.VerifyPassword(req.CurrentPassword, user.PasswordHash)
		if err != nil || !match {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication failed",
				"Current password is incorrect", r.URL.Path, nil)
			return
		}

		// Clear TOTP fields.
		user.TOTPSecret = nil
		user.TOTPEnabled = false
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "disable TOTP")
			return
		}

		// Delete all backup codes.
		if err := tx.DeleteTOTPBackupCodes(ctx, userID); err != nil {
			writeInternalError(w, r, "delete backup codes")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Admin reset
// ---------------------------------------------------------------------------

func handleTOTPReset(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		targetUserID := r.PathValue("id")
		if targetUserID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"User ID is required", r.URL.Path, nil)
			return
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer tx.Rollback()

		user, err := tx.GetUser(ctx, targetUserID)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"No user exists with the given ID", r.URL.Path, nil)
			return
		}

		// Clear TOTP.
		user.TOTPSecret = nil
		user.TOTPEnabled = false
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeInternalError(w, r, "reset TOTP")
			return
		}

		// Delete backup codes.
		if err := tx.DeleteTOTPBackupCodes(ctx, targetUserID); err != nil {
			writeInternalError(w, r, "delete backup codes")
			return
		}

		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// resolveAuthenticatedUser extracts the authenticated user's ID and username
// from the request context. If no authentication is present, it writes a 401
// and returns ok=false.
func resolveAuthenticatedUser(w http.ResponseWriter, r *http.Request) (userID, username string, ok bool) {
	if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil {
		return sc.UserID, sc.Username, true
	}
	if c := auth.ClaimsFromContext(r.Context()); c != nil {
		return c.Subject, "", true
	}
	writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required",
		"No valid session or bearer token found", r.URL.Path, nil)
	return "", "", false
}
