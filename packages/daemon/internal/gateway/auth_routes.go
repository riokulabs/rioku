package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterAuthRoutes registers the token exchange and session-based auth
// endpoints on the mux.
func RegisterAuthRoutes(mux *http.ServeMux, a *auth.Auth, sm *auth.SessionManager, st store.Driver, cfg *config.Config) {
	// Token exchange endpoints (bearer/API-key path).
	mux.HandleFunc("POST /api/v1/auth/token", handleTokenExchange(a))
	mux.HandleFunc("POST /api/v1/auth/refresh", handleTokenRefresh(a))

	// Session-based endpoints.
	mux.HandleFunc("POST /api/v1/auth/login", handleLogin(a, sm, st, cfg))
	mux.HandleFunc("POST /api/v1/auth/logout", handleLogout(sm))
	mux.HandleFunc("GET /api/v1/auth/me", handleMe(st))
	mux.HandleFunc("POST /api/v1/auth/password", handlePasswordChange(sm, st, cfg))
	mux.HandleFunc("PATCH /api/v1/auth/me", handleUpdateProfile(sm, st))
}

type tokenExchangeRequest struct {
	Token string `json:"token"` // bootstrap token or API key
}

const maxAuthBodySize = 4096 // 4KB is plenty for token exchange

func handleTokenExchange(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req tokenExchangeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Invalid request body",
				Status:   400,
				Detail:   "Request body must be valid JSON with a 'token' field",
				Instance: r.URL.Path,
			})
			return
		}

		if req.Token == "" {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Validation failed",
				Status:   400,
				Detail:   "Token is required",
				Instance: r.URL.Path,
				Errors: []ValidationError{
					{Field: "token", Reason: "must not be empty"},
				},
			})
			return
		}

		// Try as bootstrap token first, then as API key.
		var pair *auth.TokenPair
		var err error

		pair, err = a.ExchangeBootstrapToken(r.Context(), req.Token)
		if err != nil {
			pair, err = a.ValidateAPIKey(r.Context(), req.Token)
		}
		if err != nil {
			w.Header().Set("WWW-Authenticate", "Bearer")
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeUnauth,
				Title:    "Authentication failed",
				Status:   401,
				Detail:   "The provided token is invalid, expired, or revoked",
				Instance: r.URL.Path,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(pair)
	}
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func handleTokenRefresh(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req refreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Invalid request body",
				Status:   400,
				Detail:   "Request body must be valid JSON with a 'refresh_token' field",
				Instance: r.URL.Path,
			})
			return
		}

		if req.RefreshToken == "" {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Validation failed",
				Status:   400,
				Detail:   "Refresh token is required",
				Instance: r.URL.Path,
				Errors: []ValidationError{
					{Field: "refresh_token", Reason: "must not be empty"},
				},
			})
			return
		}

		pair, err := a.RefreshTokens(r.Context(), req.RefreshToken)
		if err != nil {
			w.Header().Set("WWW-Authenticate", "Bearer")
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeUnauth,
				Title:    "Refresh failed",
				Status:   401,
				Detail:   "The refresh token is invalid, expired, or has already been used",
				Instance: r.URL.Path,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(pair)
	}
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	User    loginUserInfo    `json:"user"`
	Session loginSessionInfo `json:"session"`
}

type loginUserInfo struct {
	ID                  string `json:"id"`
	Username            string `json:"username"`
	DisplayName         string `json:"display_name,omitempty"`
	ForcePasswordChange bool   `json:"force_password_change"`
}

type loginSessionInfo struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expires_at"`
}

func handleLogin(a *auth.Auth, sm *auth.SessionManager, st store.Driver, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)

		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON with 'username' and 'password' fields", r.URL.Path, nil)
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

		ctx := r.Context()

		// Begin transaction.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process login request", r.URL.Path, nil)
			return
		}
		defer tx.Rollback()

		// Look up user (case-insensitive handled by store).
		user, err := tx.GetUserByUsername(ctx, req.Username)
		if err != nil {
			// Generic 401 to avoid username enumeration.
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication failed",
				"Invalid username or password", r.URL.Path, nil)
			return
		}

		now := time.Now().UTC()

		// Check locked status.
		if user.Status == "locked" && user.LockedUntil != nil && now.Before(*user.LockedUntil) {
			retryAfter := int(time.Until(*user.LockedUntil).Seconds()) + 1
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			writeProblem(w, http.StatusLocked, errTypeLocked, "Account locked",
				fmt.Sprintf("Account is temporarily locked. Try again in %d seconds", retryAfter), r.URL.Path, nil)
			return
		}

		// Check suspended status.
		if user.Status == "suspended" {
			writeProblem(w, http.StatusForbidden, errTypeForbidden, "Account suspended",
				"This account has been suspended. Contact an administrator.", r.URL.Path, nil)
			return
		}

		// Verify password.
		match, err := auth.VerifyPassword(req.Password, user.PasswordHash)
		if err != nil || !match {
			// Increment failed attempts and potentially lock account.
			var lockUntil *time.Time
			if cfg.Auth.Lockout.MaxAttempts > 0 && user.FailedAttempts+1 >= cfg.Auth.Lockout.MaxAttempts {
				t := now.Add(cfg.Auth.Lockout.LockoutDuration)
				lockUntil = &t
			}
			_ = tx.IncrementFailedAttempts(ctx, user.ID, lockUntil)
			_ = tx.Commit()

			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication failed",
				"Invalid username or password", r.URL.Path, nil)
			return
		}

		// Successful authentication — reset failed attempts.
		if err := tx.ResetFailedAttempts(ctx, user.ID); err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process login request", r.URL.Path, nil)
			return
		}

		// Create session.
		session, err := sm.CreateSession(ctx, user.ID, r)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to create session", r.URL.Path, nil)
			return
		}

		// Set session cookie.
		sm.SetCookie(w, session.ID)

		// Update last login timestamp.
		if err := tx.UpdateLastLogin(ctx, user.ID); err != nil {
			// Non-fatal — log but continue.
			_ = err
		}

		// Commit transaction.
		if err := tx.Commit(); err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process login request", r.URL.Path, nil)
			return
		}

		// Build display name.
		displayName := ""
		if user.DisplayName != nil {
			displayName = *user.DisplayName
		}

		resp := loginResponse{
			User: loginUserInfo{
				ID:                  user.ID,
				Username:            user.Username,
				DisplayName:         displayName,
				ForcePasswordChange: user.ForcePasswordChange,
			},
			Session: loginSessionInfo{
				ID:        session.ID,
				ExpiresAt: session.ExpiresAt,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	}
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

func handleLogout(sm *auth.SessionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(auth.SessionCookieName)
		if err != nil {
			// No cookie — idempotent success.
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]bool{"ok": true})
			return
		}

		// Revoke the session (ignore errors — idempotent).
		_ = sm.RevokeSession(r.Context(), cookie.Value)
		sm.ClearCookie(w)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Me (GET)
// ---------------------------------------------------------------------------

type meResponse struct {
	ID                  string         `json:"id"`
	Username            string         `json:"username"`
	DisplayName         string         `json:"display_name,omitempty"`
	Email               string         `json:"email,omitempty"`
	ForcePasswordChange bool           `json:"force_password_change"`
	TOTPEnabled         bool           `json:"totp_enabled"`
	Session             *meSessionInfo `json:"session,omitempty"`
}

type meSessionInfo struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expires_at,omitempty"`
}

func handleMe(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Identify the caller — prefer session claims, fall back to bearer claims.
		var userID string
		var sessionInfo *meSessionInfo

		sc := auth.SessionClaimsFromContext(ctx)
		if sc != nil {
			userID = sc.UserID
			sessionInfo = &meSessionInfo{ID: sc.SessionID}
		} else {
			bc := auth.ClaimsFromContext(ctx)
			if bc == nil {
				writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required",
					"No valid session or bearer token found", r.URL.Path, nil)
				return
			}
			userID = bc.Subject
		}

		// Load user from store.
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to load user", r.URL.Path, nil)
			return
		}
		defer tx.Rollback()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"The authenticated user no longer exists", r.URL.Path, nil)
			return
		}

		// If we have a session, enrich with expiry from the DB.
		if sessionInfo != nil {
			sess, err := tx.GetSession(ctx, sessionInfo.ID)
			if err == nil {
				sessionInfo.ExpiresAt = sess.ExpiresAt
			}
		}

		displayName := ""
		if user.DisplayName != nil {
			displayName = *user.DisplayName
		}
		email := ""
		if user.Email != nil {
			email = *user.Email
		}

		resp := meResponse{
			ID:                  user.ID,
			Username:            user.Username,
			DisplayName:         displayName,
			Email:               email,
			ForcePasswordChange: user.ForcePasswordChange,
			TOTPEnabled:         user.TOTPEnabled,
			Session:             sessionInfo,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	}
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

type passwordChangeRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func handlePasswordChange(sm *auth.SessionManager, st store.Driver, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req passwordChangeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON with 'current_password' and 'new_password' fields", r.URL.Path, nil)
			return
		}

		var errs []ValidationError
		if req.CurrentPassword == "" {
			errs = append(errs, ValidationError{Field: "current_password", Reason: "must not be empty"})
		}
		if req.NewPassword == "" {
			errs = append(errs, ValidationError{Field: "new_password", Reason: "must not be empty"})
		}
		if len(errs) > 0 {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Missing required fields", r.URL.Path, errs)
			return
		}

		// Identify caller.
		var userID string
		var sessionID string
		sc := auth.SessionClaimsFromContext(ctx)
		if sc != nil {
			userID = sc.UserID
			sessionID = sc.SessionID
		} else {
			bc := auth.ClaimsFromContext(ctx)
			if bc == nil {
				writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required",
					"No valid session or bearer token found", r.URL.Path, nil)
				return
			}
			userID = bc.Subject
		}

		// Load user.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process password change", r.URL.Path, nil)
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

		// Validate new password against policy.
		if err := auth.ValidatePasswordPolicy(req.NewPassword, cfg.Auth.PasswordPolicy); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Password policy violation",
				err.Error(), r.URL.Path, nil)
			return
		}

		// Hash new password and update user.
		newHash, err := auth.HashPassword(req.NewPassword)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process password change", r.URL.Path, nil)
			return
		}

		user.PasswordHash = newHash
		user.PasswordChangedAt = time.Now().UTC()
		user.ForcePasswordChange = false

		if _, err := tx.UpdateUser(ctx, user); err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to update password", r.URL.Path, nil)
			return
		}

		if err := tx.Commit(); err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process password change", r.URL.Path, nil)
			return
		}

		// Revoke other sessions for this user (keep current session).
		if sc != nil && sessionID != "" {
			_ = sm.RevokeOtherSessions(ctx, userID, sessionID)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Profile update (PATCH /me)
// ---------------------------------------------------------------------------

type updateProfileRequest struct {
	DisplayName *string `json:"display_name"`
	Email       *string `json:"email"`
}

type updateProfileResponse struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name,omitempty"`
	Email       string `json:"email,omitempty"`
}

func handleUpdateProfile(sm *auth.SessionManager, st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req updateProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid request body",
				"Request body must be valid JSON", r.URL.Path, nil)
			return
		}

		// Identify caller.
		var userID string
		sc := auth.SessionClaimsFromContext(ctx)
		if sc != nil {
			userID = sc.UserID
		} else {
			bc := auth.ClaimsFromContext(ctx)
			if bc == nil {
				writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required",
					"No valid session or bearer token found", r.URL.Path, nil)
				return
			}
			userID = bc.Subject
		}

		// Load user.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process profile update", r.URL.Path, nil)
			return
		}
		defer tx.Rollback()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"The authenticated user no longer exists", r.URL.Path, nil)
			return
		}

		// Apply non-nil fields.
		if req.DisplayName != nil {
			user.DisplayName = req.DisplayName
		}
		if req.Email != nil {
			user.Email = req.Email
		}

		updated, err := tx.UpdateUser(ctx, user)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to update profile", r.URL.Path, nil)
			return
		}

		if err := tx.Commit(); err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process profile update", r.URL.Path, nil)
			return
		}

		displayName := ""
		if updated.DisplayName != nil {
			displayName = *updated.DisplayName
		}
		email := ""
		if updated.Email != nil {
			email = *updated.Email
		}

		resp := updateProfileResponse{
			ID:          updated.ID,
			Username:    updated.Username,
			DisplayName: displayName,
			Email:       email,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// writeProblem writes a ProblemDetail response.
func writeProblem(w http.ResponseWriter, status int, errType, title, detail, instance string, errs []ValidationError) {
	w.Header().Set("Content-Type", "application/problem+json")
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ProblemDetail{
		Type:     errType,
		Title:    title,
		Status:   status,
		Detail:   detail,
		Instance: instance,
		Errors:   errs,
	})
}
