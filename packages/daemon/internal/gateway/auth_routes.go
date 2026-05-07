package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/store"
)

// dummyPasswordHash is a pre-computed argon2id hash used to normalise the
// timing of login attempts for non-existent usernames. Without this, an
// attacker could distinguish "user not found" from "wrong password" by
// measuring response latency. Computed lazily so test params take effect.
var (
	dummyPasswordHash string
	dummyHashOnce     sync.Once
)

func getDummyPasswordHash() string {
	dummyHashOnce.Do(func() {
		h, err := auth.HashPassword("timing-normalization-dummy")
		if err != nil {
			panic("auth: failed to compute dummy hash: " + err.Error())
		}
		dummyPasswordHash = h
	})
	return dummyPasswordHash
}

// RegisterAuthRoutes registers the token exchange and session-based auth
// endpoints on the mux. The encryptor is used to decrypt TOTP secrets
// during login when two-factor authentication is enabled.
func RegisterAuthRoutes(mux *http.ServeMux, a *auth.Auth, sm *auth.SessionManager, st store.Driver, cfg *config.Config, enc *auth.Encryptor) {
	// Token exchange endpoints (bearer/API-key path).
	mux.HandleFunc("POST /api/v1/auth/token", handleTokenExchange(a))
	mux.HandleFunc("POST /api/v1/auth/refresh", handleTokenRefresh(a))

	// Session-based endpoints.
	mux.HandleFunc("POST /api/v1/auth/login", handleLogin(a, sm, st, cfg, enc))
	mux.HandleFunc("POST /api/v1/auth/logout", handleLogout(sm))
	mux.HandleFunc("GET /api/v1/auth/me", handleMe(st))
	mux.HandleFunc("POST /api/v1/auth/password", handlePasswordChange(sm, st, cfg))
	mux.HandleFunc("PATCH /api/v1/auth/me", handleUpdateProfile(sm, st))

	// Session management endpoints. Tenant-scoped aliases let the
	// admin panel render the per-tenant sessions list at the
	// canonical path while keeping `/auth/sessions` working for
	// session-cookie auth flows.
	mux.HandleFunc("GET /api/v1/auth/sessions", handleListSessions(st))
	mux.HandleFunc("DELETE /api/v1/auth/sessions/{id}", handleRevokeSessionByID(sm, st))
	mux.HandleFunc("POST /api/v1/auth/sessions/revoke-others", handleRevokeOtherSessions(sm))

	mux.HandleFunc("GET /api/v1/t/{tenant}/sessions", handleListSessions(st))
	mux.HandleFunc("DELETE /api/v1/t/{tenant}/sessions/{id}", handleRevokeSessionByID(sm, st))
	mux.HandleFunc("POST /api/v1/t/{tenant}/sessions/revoke-others", handleRevokeOtherSessions(sm))

	for _, base := range []string{"/api/v1/auth", "/api/v1/t/{tenant}"} {
		optionsutil.Register(mux, base+"/sessions", []string{"GET"})
		optionsutil.Register(mux, base+"/sessions/{id}", []string{"DELETE"})
		optionsutil.Register(mux, base+"/sessions/revoke-others", []string{"POST"})
	}
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
			_ = json.NewEncoder(w).Encode(ProblemDetail{
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
			_ = json.NewEncoder(w).Encode(ProblemDetail{
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
			_ = json.NewEncoder(w).Encode(ProblemDetail{
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
		_ = json.NewEncoder(w).Encode(pair)
	}
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

func handleTokenRefresh(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req refreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(ProblemDetail{
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
			_ = json.NewEncoder(w).Encode(ProblemDetail{
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
			_ = json.NewEncoder(w).Encode(ProblemDetail{
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
		_ = json.NewEncoder(w).Encode(pair)
	}
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

type loginRequest struct {
	Username string  `json:"username"`
	Password string  `json:"password"`
	TotpCode *string `json:"totpCode"`
}

type loginResponse struct {
	User    loginUserInfo    `json:"user"`
	Session loginSessionInfo `json:"session"`
}

type loginUserInfo struct {
	ID                  string `json:"id"`
	Username            string `json:"username"`
	DisplayName         string `json:"displayName,omitempty"`
	ForcePasswordChange bool   `json:"forcePasswordChange"`
}

type loginSessionInfo struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// totpRequiredResponse is returned when the user has TOTP enabled but did
// not provide a totp_code in the login request.
type totpRequiredResponse struct {
	RequiresTOTP bool   `json:"requiresTotp"`
	UserID       string `json:"userId"`
}

func handleLogin(a *auth.Auth, sm *auth.SessionManager, st store.Driver, cfg *config.Config, enc *auth.Encryptor) http.HandlerFunc {
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
		defer func() { _ = tx.Rollback() }()

		// Look up user (case-insensitive handled by store).
		user, err := tx.GetUserByUsername(ctx, req.Username)
		if err != nil {
			// Hash the supplied password against the dummy hash so that the
			// response time is indistinguishable from a real password check.
			// This closes the timing side-channel for username enumeration.
			_, _ = auth.VerifyPassword(req.Password, getDummyPasswordHash())

			// Generic 401 to avoid username enumeration.
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication failed",
				"Invalid username or password", r.URL.Path, nil)
			return
		}

		now := time.Now().UTC()

		// Check locked status — either time-based (from failed attempts) or permanent (admin action).
		if user.Status == "locked" {
			if user.LockedUntil != nil && now.Before(*user.LockedUntil) {
				retryAfter := int(time.Until(*user.LockedUntil).Seconds()) + 1
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				writeProblem(w, http.StatusLocked, errTypeLocked, "Account locked",
					fmt.Sprintf("Account is temporarily locked. Try again in %d seconds", retryAfter), r.URL.Path, nil)
			} else {
				writeProblem(w, http.StatusLocked, errTypeLocked, "Account locked",
					"Account is locked. Contact an administrator.", r.URL.Path, nil)
			}
			return
		}

		// Check suspended status.
		if user.Status == "suspended" {
			writeProblem(w, http.StatusForbidden, errTypeForbidden, "Account suspended",
				"This account has been suspended. Contact an administrator.", r.URL.Path, nil)
			return
		}

		// Check deleted status.
		if user.Status == "deleted" {
			writeProblem(w, http.StatusForbidden, errTypeForbidden, "Account deleted",
				"This account has been deleted. Contact an administrator.", r.URL.Path, nil)
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

		// ---------------------------------------------------------------
		// TOTP verification (if enabled for this user).
		// ---------------------------------------------------------------
		if user.TOTPEnabled && user.TOTPSecret != nil {
			if req.TotpCode == nil || *req.TotpCode == "" {
				// Password is correct but TOTP is required. Signal the
				// client to re-submit with a totp_code. No session is
				// created yet.
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(totpRequiredResponse{
					RequiresTOTP: true,
					UserID:       user.ID,
				})
				return
			}

			// Decrypt the stored TOTP secret.
			plainSecret, decErr := enc.Decrypt(*user.TOTPSecret)
			if decErr != nil {
				writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
					"Failed to process login request", r.URL.Path, nil)
				return
			}

			totpValid := auth.ValidateTOTPCode(plainSecret, *req.TotpCode, now)

			// If TOTP code is invalid, try backup codes.
			if !totpValid {
				totpValid = tryBackupCode(ctx, tx, user.ID, *req.TotpCode)
			}

			if !totpValid {
				writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication failed",
					"Invalid TOTP code or backup code", r.URL.Path, nil)
				return
			}
		}

		// Successful authentication — reset failed attempts and update
		// last login in the existing transaction, then commit it before
		// creating the session. SessionManager.CreateSession opens its own
		// transaction and SQLite cannot nest concurrent write transactions
		// on the same goroutine.
		if err := tx.ResetFailedAttempts(ctx, user.ID); err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process login request", r.URL.Path, nil)
			return
		}
		if err := tx.UpdateLastLogin(ctx, user.ID); err != nil {
			// Non-fatal — best effort.
			_ = err
		}
		if err := tx.Commit(); err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to process login request", r.URL.Path, nil)
			return
		}

		// Create session (opens its own transaction internally).
		session, err := sm.CreateSession(ctx, user.ID, r)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, errTypeInternal, "Internal error",
				"Failed to create session", r.URL.Path, nil)
			return
		}

		// Set session cookie. No tenant context at the global login endpoint;
		// callers using tenant-scoped login (subdomain mode) pass opts via the
		// tenant-scoped login handler when one exists. Use zero options here.
		sm.SetCookie(w, session.ID, auth.CookieOptions{})

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
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// tryBackupCode iterates unused backup codes for the user and checks the
// provided code against each hash. If a match is found, the code is marked
// as used and the function returns true. This runs within the caller's
// transaction.
func tryBackupCode(ctx context.Context, tx store.Tx, userID, code string) bool {
	codes, err := tx.ListUnusedTOTPBackupCodes(ctx, userID)
	if err != nil || len(codes) == 0 {
		return false
	}
	for _, bc := range codes {
		match, err := auth.VerifyPassword(code, bc.CodeHash)
		if err == nil && match {
			_ = tx.MarkTOTPBackupCodeUsed(ctx, bc.ID)
			return true
		}
	}
	return false
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
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
			return
		}

		// Revoke the session (ignore errors — idempotent).
		_ = sm.RevokeSession(r.Context(), cookie.Value)
		sm.ClearCookie(w, auth.CookieOptions{})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Me (GET)
// ---------------------------------------------------------------------------

type meResponse struct {
	User    meUserInfo    `json:"user"`
	Session meSessionInfo `json:"session"`
}

type meUserInfo struct {
	ID                  string   `json:"id"`
	Username            string   `json:"username"`
	DisplayName         string   `json:"displayName,omitempty"`
	Email               string   `json:"email,omitempty"`
	Roles               []string `json:"roles"`
	Permissions         []string `json:"permissions"`
	Status              string   `json:"status"`
	LastLogin           *string  `json:"lastLogin,omitempty"`
	CreatedAt           string   `json:"createdAt"`
	ForcePasswordChange bool     `json:"forcePasswordChange"`
	TOTPEnabled         bool     `json:"totpEnabled"`
}

type meSessionInfo struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expiresAt,omitempty"`
}

func handleMe(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Identify the caller — prefer session claims, fall back to bearer claims.
		var userID string
		var sessionInfo meSessionInfo

		sc := auth.SessionClaimsFromContext(ctx)
		if sc != nil {
			userID = sc.UserID
			sessionInfo.ID = sc.SessionID
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
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "User not found",
				"The authenticated user no longer exists", r.URL.Path, nil)
			return
		}

		// If we have a session, enrich with expiry from the DB.
		if sessionInfo.ID != "" {
			sess, err := tx.GetSession(ctx, sessionInfo.ID)
			if err == nil {
				sessionInfo.ExpiresAt = sess.ExpiresAt
			}
		}

		// Load roles and permissions for the user.
		roles, permissions, _ := auth.LoadUserScopes(ctx, st, user.ID)
		if roles == nil {
			roles = []string{}
		}
		if permissions == nil {
			permissions = []string{}
		}

		displayName := ""
		if user.DisplayName != nil {
			displayName = *user.DisplayName
		}
		email := ""
		if user.Email != nil {
			email = *user.Email
		}

		var lastLogin *string
		if user.LastLogin != nil {
			s := user.LastLogin.Format(time.RFC3339)
			lastLogin = &s
		}

		resp := meResponse{
			User: meUserInfo{
				ID:                  user.ID,
				Username:            user.Username,
				DisplayName:         displayName,
				Email:               email,
				Roles:               roles,
				Permissions:         permissions,
				Status:              user.Status,
				LastLogin:           lastLogin,
				CreatedAt:           user.CreatedAt.Format(time.RFC3339),
				ForcePasswordChange: user.ForcePasswordChange,
				TOTPEnabled:         user.TOTPEnabled,
			},
			Session: sessionInfo,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

type passwordChangeRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
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
		defer func() { _ = tx.Rollback() }()

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
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// Profile update (PATCH /me)
// ---------------------------------------------------------------------------

type updateProfileRequest struct {
	DisplayName *string `json:"displayName"`
	Email       *string `json:"email"`
}

type updateProfileResponse struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName,omitempty"`
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
		defer func() { _ = tx.Rollback() }()

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
		_ = json.NewEncoder(w).Encode(resp)
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
	_ = json.NewEncoder(w).Encode(ProblemDetail{
		Type:     errType,
		Title:    title,
		Status:   status,
		Detail:   detail,
		Instance: instance,
		Errors:   errs,
	})
}

// ---------------------------------------------------------------------------
// Session listing and revocation
// ---------------------------------------------------------------------------

type sessionResponse struct {
	ID         string `json:"id"`
	CreatedAt  string `json:"createdAt"`
	LastActive string `json:"lastActive"`
	ExpiresAt  string `json:"expiresAt"`
	IPAddress  string `json:"ipAddress"`
	UserAgent  string `json:"userAgent,omitempty"`
}

func handleListSessions(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Identify caller.
		var userID string
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			userID = sc.UserID
		} else if c := auth.ClaimsFromContext(ctx); c != nil {
			userID = c.Subject
		}
		if userID == "" {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required",
				"No valid session or bearer token found", r.URL.Path, nil)
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

func handleRevokeSessionByID(sm *auth.SessionManager, st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		sessionID := r.PathValue("id")
		if sessionID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Validation failed",
				"Session ID is required", r.URL.Path, nil)
			return
		}

		// Identify caller.
		var callerUserID string
		var callerScopes *auth.SessionClaims
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			callerUserID = sc.UserID
			callerScopes = sc
		} else if c := auth.ClaimsFromContext(ctx); c != nil {
			callerUserID = c.Subject
		}
		if callerUserID == "" {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required",
				"No valid session or bearer token found", r.URL.Path, nil)
			return
		}

		// Load the target session to check ownership.
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		targetSession, err := tx.GetSession(ctx, sessionID)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Session not found",
				"No session exists with the given ID", r.URL.Path, nil)
			return
		}

		// Allow if caller owns the session or has sessions:manage permission.
		ownsSession := targetSession.UserID == callerUserID
		hasManagePerm := false
		if callerScopes != nil {
			hasManagePerm = callerScopes.HasPermission("sessions:manage")
		} else if c := auth.ClaimsFromContext(ctx); c != nil {
			// Bearer tokens with "admin" role have all permissions.
			for _, role := range c.Roles {
				if role == "admin" {
					hasManagePerm = true
					break
				}
			}
		}

		if !ownsSession && !hasManagePerm {
			writeProblem(w, http.StatusForbidden, errTypeForbidden, "Forbidden",
				"You can only revoke your own sessions unless you have sessions:manage permission", r.URL.Path, nil)
			return
		}

		if err := sm.RevokeSession(ctx, sessionID); err != nil {
			writeInternalError(w, r, "revoke session")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// handleRevokeOtherSessions revokes every session for the
// authenticated user except the caller's current one. The current
// session id is sourced from the SessionClaims attached by
// AuthMiddleware; bearer-token callers don't have a current
// session and get a 400.
func handleRevokeOtherSessions(sm *auth.SessionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		sc := auth.SessionClaimsFromContext(ctx)
		if sc == nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation,
				"Validation failed",
				"revoke-others requires session-cookie auth (not bearer-token)",
				r.URL.Path, nil)
			return
		}
		if err := sm.RevokeOtherSessions(ctx, sc.UserID, sc.SessionID); err != nil {
			writeInternalError(w, r, "revoke other sessions")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
