// Package pagination implements cursor-based list pagination.
//
// All collection endpoints accept `?page_size=` and `?page_token=`.
// `page_token` is a base64url-encoded JSON cursor of the form:
//
//	{ "after_id": "...", "after_created_at": "2026-04-30T10:00:00Z" }
//
// Storage queries select `WHERE (created_at, id) > (?, ?) ORDER BY
// created_at, id LIMIT ?+1` so cursor stability is preserved across
// new inserts (a tie-breaker on id handles equal timestamps).
//
// `page_size` defaults to 50 and is capped at 1000. Out-of-range
// values are silently clamped — we don't 400 the caller because
// pagination should be forgiving; callers can set whatever they like.
//
// Encoding is opaque: callers must NOT parse the token. The format is
// versioned via a leading `"v": 1` field so we can extend it without
// breaking outstanding cursors.
package pagination

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

const (
	// DefaultPageSize is the default value of `page_size` when the
	// query string omits it.
	DefaultPageSize = 50
	// MaxPageSize is the upper bound on `page_size`.
	MaxPageSize = 1000
)

// Cursor is the structured form of a `page_token`.
type Cursor struct {
	Version        int       `json:"v"`
	AfterID        string    `json:"after_id,omitempty"`
	AfterCreatedAt time.Time `json:"after_created_at,omitempty"`
}

// Params is the parsed pagination state for a request.
type Params struct {
	// PageSize is the bounded page size requested by the caller.
	PageSize int
	// Cursor is the decoded page-token; zero-valued when the request
	// has no token (first page).
	Cursor Cursor
}

// HasCursor reports whether the params carry a non-empty cursor.
func (p Params) HasCursor() bool {
	return !p.Cursor.AfterCreatedAt.IsZero() || p.Cursor.AfterID != ""
}

// Parse extracts pagination params from the request's query string.
// Errors only on malformed `page_token` values — invalid `page_size`
// is silently clamped.
func Parse(q url.Values) (Params, error) {
	p := Params{PageSize: DefaultPageSize}

	if raw := q.Get("page_size"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err == nil {
			p.PageSize = clamp(n, 1, MaxPageSize)
		}
	}

	if tok := q.Get("page_token"); tok != "" {
		c, err := DecodeCursor(tok)
		if err != nil {
			return Params{}, fmt.Errorf("page_token: %w", err)
		}
		p.Cursor = c
	}

	return p, nil
}

// DecodeCursor decodes a base64url page-token into a structured
// Cursor. Returns an error for malformed encodings or unknown versions.
func DecodeCursor(token string) (Cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return Cursor{}, fmt.Errorf("base64 decode: %w", err)
	}
	var c Cursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return Cursor{}, fmt.Errorf("json decode: %w", err)
	}
	if c.Version == 0 {
		c.Version = 1
	}
	if c.Version != 1 {
		return Cursor{}, fmt.Errorf("unsupported page_token version %d", c.Version)
	}
	return c, nil
}

// EncodeCursor produces a base64url page-token from a Cursor.
func EncodeCursor(c Cursor) (string, error) {
	if c.Version == 0 {
		c.Version = 1
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// NextToken builds the page-token for the row after `lastID` /
// `lastCreatedAt`. Returns "" when there is no next page (caller
// signals end-of-stream by passing zero values).
func NextToken(lastID string, lastCreatedAt time.Time) (string, error) {
	if lastID == "" || lastCreatedAt.IsZero() {
		return "", nil
	}
	return EncodeCursor(Cursor{
		Version:        1,
		AfterID:        lastID,
		AfterCreatedAt: lastCreatedAt.UTC(),
	})
}

func clamp(n, lo, hi int) int {
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}
