package gateway

import (
	"io/fs"
	"net/http"
	"strings"
)

// spaHandler serves an embedded SPA filesystem. For any path that
// doesn't match a real file, it serves index.html (SPA client-side
// routing fallback). API routes are NOT handled here — they must be
// registered on the mux before the SPA catch-all.
type spaHandler struct {
	fs     http.Handler
	rootFS fs.FS
}

func newSPAHandler(root fs.FS) *spaHandler {
	return &spaHandler{
		fs:     http.FileServerFS(root),
		rootFS: root,
	}
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Don't serve the SPA for API routes — they should 404 normally.
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}

	// Try to serve the exact file (JS, CSS, images, fonts).
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}

	// Check if the file exists in the embedded FS.
	if _, err := fs.Stat(h.rootFS, path); err == nil {
		h.fs.ServeHTTP(w, r)
		return
	}

	// File doesn't exist — serve index.html for SPA client-side routing.
	r.URL.Path = "/"
	h.fs.ServeHTTP(w, r)
}
