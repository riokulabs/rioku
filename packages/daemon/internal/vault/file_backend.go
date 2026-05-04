package vault

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// FileBackend resolves references by reading from filesystem paths.
// Reference syntax: {vault://file/<absolute-path>}. The reference's
// resource is interpreted as an absolute path; relative paths are
// rejected. Trailing whitespace and a single trailing newline are
// stripped from the file's contents (matching how kubectl, docker
// secrets, and most secret-mount conventions write keys).
//
// FileBackend is intentionally tolerant of files that change at
// runtime — Resolve re-reads on every call. The vault Resolver layers
// caching on top of this so the per-call open/read cost lands only
// when the cache misses or the rotation timer fires.
//
// FileBackend optionally pins resolution to a single root directory.
// When Root is non-empty, the resolved absolute path must lie inside
// Root after symlink evaluation. This is the recommended deployment
// pattern (e.g. mount secret files under /etc/rioku/secrets/) and
// prevents a misconfigured reference from reading arbitrary files
// like /etc/shadow.
type FileBackend struct {
	// Root, when non-empty, is the directory tree that file
	// references must live inside. The check is performed on the
	// EvalSymlinks-resolved absolute path so symlink escapes are
	// caught.
	Root string
}

// NewFileBackend constructs a new file-backed Backend rooted at
// root. Pass an empty string to allow any absolute path (operator
// trust mode).
func NewFileBackend(root string) *FileBackend {
	return &FileBackend{Root: root}
}

// Name returns "file".
func (*FileBackend) Name() string { return "file" }

// Sync returns true — Resolve performs a synchronous file read but
// does no network IO. Treat as suitable for the startup compile path
// when secret files are on local disk.
func (*FileBackend) Sync() bool { return true }

// Resolve reads the file at resource and returns its contents (with
// trailing whitespace + a single trailing newline stripped). Returns
// ErrResolveFailed for non-absolute paths, paths that escape Root,
// missing files, and unreadable files.
func (b *FileBackend) Resolve(_ context.Context, resource string) (string, error) {
	if !filepath.IsAbs(resource) {
		return "", fmt.Errorf("%w: file path must be absolute, got %q", ErrResolveFailed, resource)
	}

	path := filepath.Clean(resource)

	if b.Root != "" {
		root, err := filepath.EvalSymlinks(b.Root)
		if err != nil {
			return "", fmt.Errorf("%w: resolve root %q: %v", ErrResolveFailed, b.Root, err)
		}
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			return "", fmt.Errorf("%w: resolve path %q: %v", ErrResolveFailed, path, err)
		}
		if !strings.HasPrefix(resolved+string(filepath.Separator), root+string(filepath.Separator)) && resolved != root {
			return "", fmt.Errorf("%w: path %q escapes root %q", ErrResolveFailed, path, b.Root)
		}
		path = resolved
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("%w: read %q: %v", ErrResolveFailed, path, err)
	}
	return trimSecret(string(raw)), nil
}

// trimSecret strips trailing whitespace and a single trailing
// newline from a secret read off disk. The pattern matches `cat`-style
// expectations: an editor-saved secret file usually ends in "\n".
// We don't trim leading whitespace — that may be meaningful in some
// formats (e.g., a JWT header).
func trimSecret(s string) string {
	// Trim a single trailing CRLF or LF.
	switch {
	case strings.HasSuffix(s, "\r\n"):
		s = s[:len(s)-2]
	case strings.HasSuffix(s, "\n"):
		s = s[:len(s)-1]
	}
	return s
}
