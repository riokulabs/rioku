package vault

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFileBackend_ResolveBasic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := os.WriteFile(path, []byte("plaintext-value\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	b := NewFileBackend("")
	if b.Name() != "file" {
		t.Fatalf("Name() = %q, want %q", b.Name(), "file")
	}
	if !b.Sync() {
		t.Fatal("Sync() = false, want true")
	}

	got, err := b.Resolve(context.Background(), path)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "plaintext-value" {
		t.Fatalf("got %q, want %q", got, "plaintext-value")
	}
}

func TestFileBackend_TrimsTrailingNewline(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		body string
		want string
	}{
		{"abc", "abc"},
		{"abc\n", "abc"},
		{"abc\r\n", "abc"},
		{"abc\n\n", "abc\n"}, // only one trailing newline trimmed
		{"  abc", "  abc"},   // leading whitespace preserved
	}
	for i, tc := range cases {
		path := filepath.Join(dir, "case-"+itoa(i))
		if err := os.WriteFile(path, []byte(tc.body), 0o600); err != nil {
			t.Fatalf("write: %v", err)
		}
		b := NewFileBackend("")
		got, err := b.Resolve(context.Background(), path)
		if err != nil {
			t.Fatalf("case %d Resolve: %v", i, err)
		}
		if got != tc.want {
			t.Errorf("case %d: got %q, want %q", i, got, tc.want)
		}
	}
}

func TestFileBackend_RejectsRelativePath(t *testing.T) {
	b := NewFileBackend("")
	_, err := b.Resolve(context.Background(), "etc/rioku/secret")
	if !errors.Is(err, ErrResolveFailed) {
		t.Fatalf("err = %v, want wrap ErrResolveFailed", err)
	}
}

func TestFileBackend_MissingFile(t *testing.T) {
	dir := t.TempDir()
	b := NewFileBackend("")
	_, err := b.Resolve(context.Background(), filepath.Join(dir, "does-not-exist"))
	if !errors.Is(err, ErrResolveFailed) {
		t.Fatalf("err = %v, want wrap ErrResolveFailed", err)
	}
}

func TestFileBackend_RootJailEnforced(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	insidePath := filepath.Join(root, "ok")
	outsidePath := filepath.Join(outside, "leak")
	if err := os.WriteFile(insidePath, []byte("ok"), 0o600); err != nil {
		t.Fatalf("write inside: %v", err)
	}
	if err := os.WriteFile(outsidePath, []byte("leaked"), 0o600); err != nil {
		t.Fatalf("write outside: %v", err)
	}

	b := NewFileBackend(root)
	got, err := b.Resolve(context.Background(), insidePath)
	if err != nil {
		t.Fatalf("inside Resolve: %v", err)
	}
	if got != "ok" {
		t.Fatalf("inside got %q, want %q", got, "ok")
	}
	_, err = b.Resolve(context.Background(), outsidePath)
	if !errors.Is(err, ErrResolveFailed) {
		t.Fatalf("outside err = %v, want wrap ErrResolveFailed", err)
	}
}

func TestFileBackend_RootJailRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	target := filepath.Join(outside, "actual-secret")
	link := filepath.Join(root, "link")
	if err := os.WriteFile(target, []byte("escaped"), 0o600); err != nil {
		t.Fatalf("write target: %v", err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink not supported in test env: %v", err)
	}

	b := NewFileBackend(root)
	_, err := b.Resolve(context.Background(), link)
	if !errors.Is(err, ErrResolveFailed) {
		t.Fatalf("err = %v, want wrap ErrResolveFailed (symlink escape must fail)", err)
	}
}

// itoa is a tiny helper to avoid pulling strconv in for table indices.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	const digits = "0123456789"
	var buf [10]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = digits[i%10]
		i /= 10
	}
	return string(buf[pos:])
}
