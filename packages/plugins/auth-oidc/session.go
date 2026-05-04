package authoidc

import (
	"sync"
	"time"
)

// session is the in-memory record stored after a successful OIDC
// callback exchange. Claims are the verified ID-token claims; the
// caller pulls the principal + ForwardClaims values out of this map.
type session struct {
	claims    map[string]any
	createdAt time.Time
	ttl       time.Duration
}

// expired reports whether the session has outlived its TTL.
func (s *session) expired(now time.Time) bool {
	if s.ttl <= 0 {
		return false
	}
	return now.Sub(s.createdAt) >= s.ttl
}

// sessionStore is the in-memory map keyed on opaque session ID. The
// store is process-local — restarts wipe all sessions, which is
// acceptable for v1 (users will be redirected back to the IdP and
// will most likely have a live SSO cookie there). A persistent
// session store is a follow-up; see the package doc.
type sessionStore struct {
	mu       sync.Mutex
	sessions map[string]*session
}

func newSessionStore() *sessionStore {
	return &sessionStore{sessions: make(map[string]*session)}
}

// put records a freshly-issued session under the given ID.
func (s *sessionStore) put(id string, claims map[string]any, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[id] = &session{
		claims:    claims,
		createdAt: time.Now(),
		ttl:       ttl,
	}
}

// get returns the claims map for a live session, or (nil, false) if
// the session is missing or expired. Lazy expiry: an expired entry is
// evicted on first read.
func (s *sessionStore) get(id string) (map[string]any, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok {
		return nil, false
	}
	if sess.expired(time.Now()) {
		delete(s.sessions, id)
		return nil, false
	}
	return sess.claims, true
}

// delete removes a session by ID. Used on explicit logout (future
// surface) and tested for completeness.
func (s *sessionStore) delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
}

// size reports the current entry count. Test-only; production code
// should not branch on this. Unused entries are evicted lazily on read.
func (s *sessionStore) size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sessions)
}
