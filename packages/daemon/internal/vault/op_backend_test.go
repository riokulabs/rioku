package vault

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// writeFakeOp creates a stub `op` binary in a temp dir that mimics
// `op read op://<resource>` semantics by inspecting argv[1]+argv[2]
// and printing back the resource segment verbatim. Returns the path
// to the binary.
//
// The stub is a tiny shell script; on platforms without /bin/sh the
// caller should skip.
func writeFakeOp(t *testing.T, body string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake op stub uses /bin/sh; not supported on windows")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "op")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	return path
}

func TestOnePasswordBackend_Metadata(t *testing.T) {
	b := NewOnePasswordBackend()
	if b.Name() != "op" {
		t.Fatalf("Name() = %q, want %q", b.Name(), "op")
	}
	if b.Sync() {
		t.Fatal("Sync() = true, want false (CLI shells out)")
	}
}

func TestOnePasswordBackend_ResolveSuccess(t *testing.T) {
	stub := writeFakeOp(t, "#!/bin/sh\necho \"$2-resolved\"\n")
	b := &OnePasswordBackend{Binary: stub}
	got, err := b.Resolve(context.Background(), "Vault/Item/field")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !strings.HasSuffix(got, "-resolved") {
		t.Fatalf("got %q, want suffix '-resolved'", got)
	}
	if !strings.HasPrefix(got, "op://") {
		t.Fatalf("got %q, want stub to receive op://-prefixed URI", got)
	}
}

func TestOnePasswordBackend_StripsTrailingNewline(t *testing.T) {
	stub := writeFakeOp(t, "#!/bin/sh\nprintf 'sk-secret-value\\n'\n")
	b := &OnePasswordBackend{Binary: stub}
	got, err := b.Resolve(context.Background(), "x")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "sk-secret-value" {
		t.Fatalf("got %q, want sk-secret-value", got)
	}
}

func TestOnePasswordBackend_NonZeroExitFails(t *testing.T) {
	stub := writeFakeOp(t, "#!/bin/sh\necho 'op: not signed in' 1>&2\nexit 6\n")
	b := &OnePasswordBackend{Binary: stub}
	_, err := b.Resolve(context.Background(), "x")
	if !errors.Is(err, ErrResolveFailed) {
		t.Fatalf("err = %v, want wrap ErrResolveFailed", err)
	}
	if strings.Contains(err.Error(), "not signed in") {
		t.Fatalf("error leaked stderr verbatim: %v", err)
	}
}

func TestOnePasswordBackend_EmptyOutputIsFailure(t *testing.T) {
	stub := writeFakeOp(t, "#!/bin/sh\nexit 0\n")
	b := &OnePasswordBackend{Binary: stub}
	_, err := b.Resolve(context.Background(), "x")
	if !errors.Is(err, ErrResolveFailed) {
		t.Fatalf("err = %v, want wrap ErrResolveFailed for empty stdout", err)
	}
}

func TestOnePasswordBackend_EmptyResourceFails(t *testing.T) {
	b := NewOnePasswordBackend()
	_, err := b.Resolve(context.Background(), "")
	if !errors.Is(err, ErrResolveFailed) {
		t.Fatalf("err = %v, want wrap ErrResolveFailed", err)
	}
}
