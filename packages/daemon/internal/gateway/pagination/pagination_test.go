package pagination

import (
	"net/url"
	"testing"
	"time"
)

func TestParse_Defaults(t *testing.T) {
	p, err := Parse(url.Values{})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if p.PageSize != DefaultPageSize {
		t.Errorf("PageSize = %d, want %d", p.PageSize, DefaultPageSize)
	}
	if p.HasCursor() {
		t.Error("first page should not carry a cursor")
	}
}

func TestParse_PageSizeClamped(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"0", 1},
		{"-5", 1},
		{"1", 1},
		{"50", 50},
		{"1000", 1000},
		{"99999", MaxPageSize},
		{"not-a-number", DefaultPageSize}, // silently fall back
		{"", DefaultPageSize},
	}
	for _, c := range cases {
		q := url.Values{}
		if c.in != "" {
			q.Set("page_size", c.in)
		}
		p, err := Parse(q)
		if err != nil {
			t.Fatalf("Parse(%q): %v", c.in, err)
		}
		if p.PageSize != c.want {
			t.Errorf("Parse(page_size=%q): PageSize = %d, want %d", c.in, p.PageSize, c.want)
		}
	}
}

func TestEncodeDecodeCursor_RoundTrip(t *testing.T) {
	now := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	c := Cursor{Version: 1, AfterID: "abc", AfterCreatedAt: now}
	tok, err := EncodeCursor(c)
	if err != nil {
		t.Fatalf("EncodeCursor: %v", err)
	}
	got, err := DecodeCursor(tok)
	if err != nil {
		t.Fatalf("DecodeCursor: %v", err)
	}
	if got.AfterID != c.AfterID || !got.AfterCreatedAt.Equal(c.AfterCreatedAt) {
		t.Errorf("round-trip mismatch: got %+v", got)
	}
}

func TestParse_PageToken(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Microsecond)
	tok, err := EncodeCursor(Cursor{AfterID: "row1", AfterCreatedAt: now})
	if err != nil {
		t.Fatalf("EncodeCursor: %v", err)
	}

	q := url.Values{}
	q.Set("page_token", tok)
	q.Set("page_size", "25")

	p, err := Parse(q)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if p.PageSize != 25 {
		t.Errorf("PageSize = %d, want 25", p.PageSize)
	}
	if !p.HasCursor() {
		t.Fatal("expected HasCursor true after parsing page_token")
	}
	if p.Cursor.AfterID != "row1" {
		t.Errorf("AfterID = %q, want row1", p.Cursor.AfterID)
	}
	if !p.Cursor.AfterCreatedAt.Equal(now) {
		t.Errorf("AfterCreatedAt mismatch: got %v want %v", p.Cursor.AfterCreatedAt, now)
	}
}

func TestParse_BadPageToken_Errors(t *testing.T) {
	q := url.Values{}
	q.Set("page_token", "not-base64-!!!")
	if _, err := Parse(q); err == nil {
		t.Fatal("expected error for malformed page_token, got nil")
	}
}

func TestNextToken_EmptyOnTerminalRow(t *testing.T) {
	tok, err := NextToken("", time.Time{})
	if err != nil {
		t.Fatalf("NextToken: %v", err)
	}
	if tok != "" {
		t.Errorf("NextToken('', zero) = %q, want empty", tok)
	}
}

func TestNextToken_RoundTripsThroughDecode(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Microsecond)
	tok, err := NextToken("row42", now)
	if err != nil {
		t.Fatalf("NextToken: %v", err)
	}
	c, err := DecodeCursor(tok)
	if err != nil {
		t.Fatalf("DecodeCursor: %v", err)
	}
	if c.AfterID != "row42" || !c.AfterCreatedAt.Equal(now) {
		t.Errorf("round-trip mismatch: %+v", c)
	}
}

func TestDecodeCursor_RejectsUnknownVersion(t *testing.T) {
	tok, err := EncodeCursor(Cursor{Version: 99, AfterID: "x"})
	if err != nil {
		t.Fatalf("EncodeCursor: %v", err)
	}
	if _, err := DecodeCursor(tok); err == nil {
		t.Fatal("expected error for unknown version, got nil")
	}
}
