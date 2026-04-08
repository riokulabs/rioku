package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/riokulabs/rioku/internal/store"
)

// Session lifecycle constants.
const (
	SessionCookieName  = "rioku_sid"
	SessionAbsoluteTTL = 7 * 24 * time.Hour
	SessionSlidingTTL  = 24 * time.Hour
	sessionCacheSize   = 10_000
	sessionCacheTTL    = 60 * time.Second
	debounceWindow     = time.Minute
)

// ---------------------------------------------------------------------------
// SessionClaims
// ---------------------------------------------------------------------------

// SessionClaims is injected into the request context on successful session
// validation.
type SessionClaims struct {
	SessionID string
	UserID    string
	Username  string
	Roles     []string
	Scopes    []string
}

// HasPermission checks if the user has the given permission, either directly
// or via a wildcard scope.
func (c *SessionClaims) HasPermission(perm string) bool {
	for _, s := range c.Scopes {
		if s == perm || s == "*" {
			return true
		}
		// Check wildcard: "config:*" matches "config:read", "config:write".
		if len(s) > 1 && s[len(s)-1] == '*' {
			prefix := s[:len(s)-1]
			if len(perm) >= len(prefix) && perm[:len(prefix)] == prefix {
				return true
			}
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

type sessionClaimsKey struct{}

// WithSessionClaims attaches SessionClaims to a context.
func WithSessionClaims(ctx context.Context, c *SessionClaims) context.Context {
	return context.WithValue(ctx, sessionClaimsKey{}, c)
}

// SessionClaimsFromContext retrieves SessionClaims from a context.
func SessionClaimsFromContext(ctx context.Context) *SessionClaims {
	c, _ := ctx.Value(sessionClaimsKey{}).(*SessionClaims)
	return c
}

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

// sessionCacheEntry is what we store in the LRU.
type sessionCacheEntry struct {
	session             *store.Session
	claims              *SessionClaims
	lastActiveUpdatedAt time.Time
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

// SessionManager manages the full session lifecycle: creation, validation,
// revocation, fingerprinting, and cookie helpers.
type SessionManager struct {
	store   store.Driver
	cache   *LRU[*sessionCacheEntry]
	devMode bool

	debounceMu sync.Mutex
	debounce   map[string]time.Time
}

// NewSessionManager creates a SessionManager with an LRU cache.
func NewSessionManager(st store.Driver, devMode bool) *SessionManager {
	return &SessionManager{
		store:    st,
		cache:    NewLRU[*sessionCacheEntry](sessionCacheSize, sessionCacheTTL),
		devMode:  devMode,
		debounce: make(map[string]time.Time),
	}
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

// ComputeFingerprint returns a hex-encoded SHA-256 hash of the concatenated
// User-Agent and Accept-Language header values. This provides a lightweight
// session-binding signal without storing raw headers.
func ComputeFingerprint(userAgent, acceptLanguage string) string {
	h := sha256.Sum256([]byte(userAgent + acceptLanguage))
	return hex.EncodeToString(h[:])
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

// CreateSession creates a new server-side session for the given user.
// The session ID is a UUID, the fingerprint is derived from request headers,
// and the expiry is set to now + SessionAbsoluteTTL (7 days).
func (sm *SessionManager) CreateSession(ctx context.Context, userID string, r *http.Request) (*store.Session, error) {
	now := time.Now().UTC()

	ua := r.Header.Get("User-Agent")
	al := r.Header.Get("Accept-Language")
	fp := ComputeFingerprint(ua, al)

	ip := r.RemoteAddr
	sess := &store.Session{
		ID:          uuid.New().String(),
		UserID:      userID,
		Fingerprint: fp,
		ExpiresAt:   now.Add(SessionAbsoluteTTL),
		LastActive:  now,
		IPAddress:   &ip,
		UserAgent:   &ua,
	}

	tx, err := sm.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("session: begin tx: %w", err)
	}

	created, err := tx.CreateSession(ctx, sess)
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("session: create: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("session: commit: %w", err)
	}

	// Populate the LRU cache with resolved RBAC scopes so the first
	// ValidateSession call is a cache hit.
	roles, scopes, _ := LoadUserScopes(ctx, sm.store, userID)
	if roles == nil {
		roles = []string{}
	}
	if scopes == nil {
		scopes = []string{}
	}

	// Look up the username for the claims. If the user was just
	// authenticated we trust the session; a failure here is non-fatal.
	username := ""
	if rtx, err := sm.store.Begin(ctx, store.TxOptions{ReadOnly: true}); err == nil {
		if u, err := rtx.GetUser(ctx, userID); err == nil {
			username = u.Username
		}
		rtx.Rollback()
	}

	claims := &SessionClaims{
		SessionID: created.ID,
		UserID:    userID,
		Username:  username,
		Roles:     roles,
		Scopes:    scopes,
	}
	entry := &sessionCacheEntry{
		session:             created,
		claims:              claims,
		lastActiveUpdatedAt: now,
	}
	sm.cache.Set(created.ID, entry)

	return created, nil
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

// ValidateSession validates a session by ID, checking expiry, fingerprint,
// and user status. It uses the LRU cache for performance and debounces
// last_active updates to reduce database writes.
func (sm *SessionManager) ValidateSession(ctx context.Context, sessionID string, r *http.Request) (*SessionClaims, error) {
	now := time.Now().UTC()

	ua := r.Header.Get("User-Agent")
	al := r.Header.Get("Accept-Language")
	fp := ComputeFingerprint(ua, al)

	// Check cache first.
	if entry, ok := sm.cache.Get(sessionID); ok {
		sess := entry.session

		// Verify absolute expiry.
		if now.After(sess.ExpiresAt) {
			sm.cache.Delete(sessionID)
			return nil, fmt.Errorf("session: expired")
		}

		// Verify sliding window expiry.
		if now.After(sess.LastActive.Add(SessionSlidingTTL)) {
			sm.cache.Delete(sessionID)
			return nil, fmt.Errorf("session: inactive too long")
		}

		// Verify fingerprint.
		if sess.Fingerprint != fp {
			sm.cache.Delete(sessionID)
			return nil, fmt.Errorf("session: fingerprint mismatch")
		}

		// Debounce last_active update.
		sm.maybeUpdateLastActive(ctx, sessionID, now)

		return entry.claims, nil
	}

	// Cache miss — load from DB.
	tx, err := sm.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("session: begin tx: %w", err)
	}
	defer tx.Rollback()

	sess, err := tx.GetSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("session: not found")
	}

	// Load the user to check status.
	user, err := tx.GetUser(ctx, sess.UserID)
	if err != nil {
		return nil, fmt.Errorf("session: user not found")
	}

	if user.Status == "suspended" || user.Status == "locked" {
		return nil, fmt.Errorf("session: user account %s", user.Status)
	}

	// Verify absolute expiry.
	if now.After(sess.ExpiresAt) {
		return nil, fmt.Errorf("session: expired")
	}

	// Verify sliding window expiry.
	if now.After(sess.LastActive.Add(SessionSlidingTTL)) {
		return nil, fmt.Errorf("session: inactive too long")
	}

	// Verify fingerprint.
	if sess.Fingerprint != fp {
		return nil, fmt.Errorf("session: fingerprint mismatch")
	}

	// Resolve RBAC roles and scopes for the session.
	roles, scopes, _ := LoadUserScopes(ctx, sm.store, user.ID)
	if roles == nil {
		roles = []string{}
	}
	if scopes == nil {
		scopes = []string{}
	}

	claims := &SessionClaims{
		SessionID: sess.ID,
		UserID:    user.ID,
		Username:  user.Username,
		Roles:     roles,
		Scopes:    scopes,
	}

	// Store in cache.
	entry := &sessionCacheEntry{
		session:             sess,
		claims:              claims,
		lastActiveUpdatedAt: now,
	}
	sm.cache.Set(sessionID, entry)

	// Debounce last_active update.
	sm.maybeUpdateLastActive(ctx, sessionID, now)

	return claims, nil
}

// maybeUpdateLastActive updates the session's last_active timestamp in the
// database, but only if we haven't done so within the debounce window.
func (sm *SessionManager) maybeUpdateLastActive(ctx context.Context, sessionID string, now time.Time) {
	sm.debounceMu.Lock()
	lastUpdate, exists := sm.debounce[sessionID]
	if exists && now.Sub(lastUpdate) < debounceWindow {
		sm.debounceMu.Unlock()
		return
	}
	sm.debounce[sessionID] = now
	sm.debounceMu.Unlock()

	// Fire-and-forget the DB update; validation should not fail because
	// of a last_active write error.
	tx, err := sm.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return
	}
	if err := tx.UpdateSessionLastActive(ctx, sessionID, now); err != nil {
		tx.Rollback()
		return
	}
	tx.Commit()
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

// RevokeSession deletes a single session from the database and evicts it
// from the cache.
func (sm *SessionManager) RevokeSession(ctx context.Context, sessionID string) error {
	tx, err := sm.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return fmt.Errorf("session: begin tx: %w", err)
	}

	if err := tx.DeleteSession(ctx, sessionID); err != nil {
		tx.Rollback()
		return fmt.Errorf("session: delete: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("session: commit: %w", err)
	}

	sm.cache.Delete(sessionID)
	return nil
}

// RevokeAllSessionsForUser deletes all sessions for the given user and
// evicts them from the LRU cache.
func (sm *SessionManager) RevokeAllSessionsForUser(ctx context.Context, userID string) error {
	tx, err := sm.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return fmt.Errorf("session: begin tx: %w", err)
	}

	// List sessions before deleting so we can evict cache entries.
	sessions, err := tx.ListSessionsByUser(ctx, userID)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("session: list by user: %w", err)
	}

	if err := tx.DeleteSessionsByUser(ctx, userID); err != nil {
		tx.Rollback()
		return fmt.Errorf("session: delete by user: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	for _, s := range sessions {
		sm.cache.Delete(s.ID)
	}
	return nil
}

// RevokeOtherSessions deletes all sessions for the given user except the
// specified session ID and evicts the deleted sessions from the cache.
func (sm *SessionManager) RevokeOtherSessions(ctx context.Context, userID, exceptSessionID string) error {
	tx, err := sm.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return fmt.Errorf("session: begin tx: %w", err)
	}

	// List sessions before deleting so we can evict cache entries.
	sessions, err := tx.ListSessionsByUser(ctx, userID)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("session: list by user: %w", err)
	}

	if err := tx.DeleteSessionsByUserExcept(ctx, userID, exceptSessionID); err != nil {
		tx.Rollback()
		return fmt.Errorf("session: delete except: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	for _, s := range sessions {
		if s.ID != exceptSessionID {
			sm.cache.Delete(s.ID)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

// SetCookie writes the session cookie to the response.
func (sm *SessionManager) SetCookie(w http.ResponseWriter, sessionID string) {
	sameSite := http.SameSiteStrictMode
	if sm.devMode {
		sameSite = http.SameSiteLaxMode
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    sessionID,
		HttpOnly: true,
		Secure:   !sm.devMode,
		SameSite: sameSite,
		Path:     "/",
		MaxAge:   86400,
	})
}

// ClearCookie removes the session cookie from the client.
func (sm *SessionManager) ClearCookie(w http.ResponseWriter) {
	sameSite := http.SameSiteStrictMode
	if sm.devMode {
		sameSite = http.SameSiteLaxMode
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		HttpOnly: true,
		Secure:   !sm.devMode,
		SameSite: sameSite,
		Path:     "/",
		MaxAge:   -1,
	})
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// CleanupExpired delegates to the store's DeleteExpiredSessions to remove
// sessions that have passed their absolute TTL or have been inactive beyond
// the sliding window.
func (sm *SessionManager) CleanupExpired(ctx context.Context) (int64, error) {
	tx, err := sm.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("session: begin tx: %w", err)
	}

	n, err := tx.DeleteExpiredSessions(ctx)
	if err != nil {
		tx.Rollback()
		return 0, fmt.Errorf("session: cleanup expired: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("session: commit: %w", err)
	}

	return n, nil
}

// StartCleanupWorker starts a background goroutine that calls CleanupExpired every hour.
// Cancel the context to stop it.
func (sm *SessionManager) StartCleanupWorker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := sm.CleanupExpired(ctx)
				if err != nil {
					// log, don't panic — cleanup failure is non-fatal
					_ = err
				}
				_ = n
			}
		}
	}()
}
