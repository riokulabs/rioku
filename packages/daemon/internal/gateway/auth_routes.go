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
	"github.com/riokulabs/rioku/internal/rerr"
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
	mux.Handle("POST /api/v1/auth/token", rerr.H(handleTokenExchange(a)))
	mux.Handle("POST /api/v1/auth/refresh", rerr.H(handleTokenRefresh(a)))

	// Session-based endpoints.
	mux.Handle("POST /api/v1/auth/login", rerr.H(handleLogin(a, sm, st, cfg, enc)))
	mux.Handle("POST /api/v1/auth/logout", rerr.H(handleLogout(sm)))
	mux.Handle("GET /api/v1/auth/me", rerr.H(handleMe(st)))
	mux.Handle("POST /api/v1/auth/password", rerr.H(handlePasswordChange(sm, st, cfg)))
	mux.Handle("PATCH /api/v1/auth/me", rerr.H(handleUpdateProfile(sm, st)))

	// Session management endpoints. Tenant-scoped aliases let the
	// admin panel render the per-tenant sessions list at the
	// canonical path while keeping `/auth/sessions` working for
	// session-cookie auth flows.
	mux.Handle("GET /api/v1/auth/sessions", rerr.H(handleListSessions(st)))
	mux.Handle("DELETE /api/v1/auth/sessions/{id}", rerr.H(handleRevokeSessionByID(sm, st)))
	mux.Handle("POST /api/v1/auth/sessions/revoke-others", rerr.H(handleRevokeOtherSessions(sm)))

	mux.Handle("GET /api/v1/t/{tenant}/sessions", rerr.H(handleListSessions(st)))
	mux.Handle("DELETE /api/v1/t/{tenant}/sessions/{id}", rerr.H(handleRevokeSessionByID(sm, st)))
	mux.Handle("POST /api/v1/t/{tenant}/sessions/revoke-others", rerr.H(handleRevokeOtherSessions(sm)))

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

func handleTokenExchange(a *auth.Auth) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req tokenExchangeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "request body must be valid JSON with a 'token' field"})
		}
		if req.Token == "" {
			return rerr.Validation(map[string]string{"token": "must not be empty"})
		}

		// Try as bootstrap token first, then as API key.
		var pair *auth.TokenPair
		var err error

		pair, err = a.ExchangeBootstrapToken(r.Context(), req.Token)
		if err != nil {
			pair, err = a.ValidateAPIKey(r.Context(), req.Token)
		}
		if err != nil {
			return rerr.Unauthenticated()
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(pair)
		return nil
	}
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

func handleTokenRefresh(a *auth.Auth) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req refreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "request body must be valid JSON with a 'refresh_token' field"})
		}
		if req.RefreshToken == "" {
			return rerr.Validation(map[string]string{"refresh_token": "must not be empty"})
		}

		pair, err := a.RefreshTokens(r.Context(), req.RefreshToken)
		if err != nil {
			return rerr.Unauthenticated()
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(pair)
		return nil
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

func handleLogin(a *auth.Auth, sm *auth.SessionManager, st store.Driver, cfg *config.Config, enc *auth.Encryptor) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)

		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "request body must be valid JSON with 'username' and 'password' fields"})
		}

		fields := map[string]string{}
		if req.Username == "" {
			fields["username"] = "must not be empty"
		}
		if req.Password == "" {
			fields["password"] = "must not be empty"
		}
		if len(fields) > 0 {
			return rerr.Validation(fields)
		}

		ctx := r.Context()

		// Begin transaction.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
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
			return rerr.Unauthenticated()
		}

		now := time.Now().UTC()

		// Check locked status — either time-based (from failed attempts) or permanent (admin action).
		if user.Status == "locked" {
			if user.LockedUntil != nil && now.Before(*user.LockedUntil) {
				retryAfter := int(time.Until(*user.LockedUntil).Seconds()) + 1
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				return rerr.Locked(
					fmt.Sprintf("account is temporarily locked; try again in %d seconds", retryAfter),
					retryAfter,
				)
			}
			return rerr.Locked("account is locked; contact an administrator", 0)
		}

		// Check suspended status.
		if user.Status == "suspended" {
			return rerr.Forbidden("account suspended; contact an administrator")
		}

		// Check deleted status.
		if user.Status == "deleted" {
			return rerr.Forbidden("account deleted; contact an administrator")
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

			return rerr.Unauthenticated()
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
				return nil
			}

			// Decrypt the stored TOTP secret.
			plainSecret, decErr := enc.Decrypt(*user.TOTPSecret)
			if decErr != nil {
				return rerr.Wrap(decErr, "decrypt totp secret")
			}

			totpValid := auth.ValidateTOTPCode(plainSecret, *req.TotpCode, now)

			// If TOTP code is invalid, try backup codes.
			if !totpValid {
				totpValid = tryBackupCode(ctx, tx, user.ID, *req.TotpCode)
			}

			if !totpValid {
				return rerr.Unauthenticated()
			}
		}

		// Successful authentication — reset failed attempts and update
		// last login in the existing transaction, then commit it before
		// creating the session. SessionManager.CreateSession opens its own
		// transaction and SQLite cannot nest concurrent write transactions
		// on the same goroutine.
		if err := tx.ResetFailedAttempts(ctx, user.ID); err != nil {
			return rerr.Wrap(err, "reset failed attempts")
		}
		if err := tx.UpdateLastLogin(ctx, user.ID); err != nil {
			// Non-fatal — best effort.
			_ = err
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Create session (opens its own transaction internally).
		session, err := sm.CreateSession(ctx, user.ID, r)
		if err != nil {
			return rerr.Wrap(err, "create session")
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
		return nil
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

func handleLogout(sm *auth.SessionManager) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		cookie, err := r.Cookie(auth.SessionCookieName)
		if err != nil {
			// No cookie — idempotent success.
			return rerr.JSON(w, map[string]bool{"ok": true})
		}

		// Revoke the session (ignore errors — idempotent).
		_ = sm.RevokeSession(r.Context(), cookie.Value)
		sm.ClearCookie(w, auth.CookieOptions{})

		return rerr.JSON(w, map[string]bool{"ok": true})
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

func handleMe(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
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
				return rerr.Unauthenticated()
			}
			userID = bc.Subject
		}

		// Load user from store.
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			return rerr.NotFound("user", userID)
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

		return rerr.JSON(w, resp)
	}
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

type passwordChangeRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func handlePasswordChange(sm *auth.SessionManager, st store.Driver, cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req passwordChangeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "request body must be valid JSON with 'current_password' and 'new_password' fields"})
		}

		fields := map[string]string{}
		if req.CurrentPassword == "" {
			fields["current_password"] = "must not be empty"
		}
		if req.NewPassword == "" {
			fields["new_password"] = "must not be empty"
		}
		if len(fields) > 0 {
			return rerr.Validation(fields)
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
				return rerr.Unauthenticated()
			}
			userID = bc.Subject
		}

		// Load user.
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

		// Validate new password against policy.
		if err := auth.ValidatePasswordPolicy(req.NewPassword, cfg.Auth.PasswordPolicy); err != nil {
			return rerr.Validation(map[string]string{"new_password": err.Error()})
		}

		// Hash new password and update user.
		newHash, err := auth.HashPassword(req.NewPassword)
		if err != nil {
			return rerr.Wrap(err, "hash password")
		}

		user.PasswordHash = newHash
		user.PasswordChangedAt = time.Now().UTC()
		user.ForcePasswordChange = false

		if _, err := tx.UpdateUser(ctx, user); err != nil {
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Revoke other sessions for this user (keep current session).
		if sc != nil && sessionID != "" {
			_ = sm.RevokeOtherSessions(ctx, userID, sessionID)
		}

		return rerr.JSON(w, map[string]bool{"ok": true})
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

func handleUpdateProfile(sm *auth.SessionManager, st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req updateProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "request body must be valid JSON"})
		}

		// Identify caller.
		var userID string
		sc := auth.SessionClaimsFromContext(ctx)
		if sc != nil {
			userID = sc.UserID
		} else {
			bc := auth.ClaimsFromContext(ctx)
			if bc == nil {
				return rerr.Unauthenticated()
			}
			userID = bc.Subject
		}

		// Load user.
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		user, err := tx.GetUser(ctx, userID)
		if err != nil {
			return rerr.NotFound("user", userID)
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
			return rerr.Wrap(err, "update user")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
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

		// sm is unused in this handler path but kept in the signature for
		// potential future session-refresh-on-profile-change behavior.
		_ = sm

		return rerr.JSON(w, resp)
	}
}

// ---------------------------------------------------------------------------
// Helpers — retained for tenant_middleware.go callers.
// ---------------------------------------------------------------------------

// writeProblem writes a ProblemDetail response.
// Retained: tenant_middleware.go still uses this directly.
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

func handleListSessions(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		// Identify caller.
		var userID string
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			userID = sc.UserID
		} else if c := auth.ClaimsFromContext(ctx); c != nil {
			userID = c.Subject
		}
		if userID == "" {
			return rerr.Unauthenticated()
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		sessions, err := tx.ListSessionsByUser(ctx, userID)
		if err != nil {
			return rerr.Wrap(err, "list sessions")
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

		// OpenAPI: ListSessions200 = `{sessions: [...]}`. The SPA's
		// `useSessionList` reads `data.data.sessions`; emitting a bare
		// array gave `undefined → []` and rendered the Sessions page
		// empty for every user.
		return rerr.JSON(w, map[string]any{
			"sessions": result,
		})
	}
}

func handleRevokeSessionByID(sm *auth.SessionManager, st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		sessionID := r.PathValue("id")
		if sessionID == "" {
			return rerr.Validation(map[string]string{"id": "session ID is required"})
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
			return rerr.Unauthenticated()
		}

		// Load the target session to check ownership.
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		targetSession, err := tx.GetSession(ctx, sessionID)
		if err != nil {
			return rerr.NotFound("session", sessionID)
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
			return rerr.Forbidden("sessions:manage")
		}

		if err := sm.RevokeSession(ctx, sessionID); err != nil {
			return rerr.Wrap(err, "revoke session")
		}

		return rerr.JSON(w, map[string]bool{"ok": true})
	}
}

// handleRevokeOtherSessions revokes every session for the
// authenticated user except the caller's current one. The current
// session id is sourced from the SessionClaims attached by
// AuthMiddleware; bearer-token callers don't have a current
// session and get a 422.
func handleRevokeOtherSessions(sm *auth.SessionManager) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		sc := auth.SessionClaimsFromContext(ctx)
		if sc == nil {
			return rerr.Validation(map[string]string{"auth": "revoke-others requires session-cookie auth (not bearer-token)"})
		}
		if err := sm.RevokeOtherSessions(ctx, sc.UserID, sc.SessionID); err != nil {
			return rerr.Wrap(err, "revoke other sessions")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}
