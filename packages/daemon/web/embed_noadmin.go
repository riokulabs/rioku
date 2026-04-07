//go:build noadmin

// Lean build without the admin panel. The daemon runs normally
// but serves no web UI — only the REST API and gRPC endpoints.
// Build with: go build -tags noadmin
package web

import "io/fs"

// SPA returns nil for lean builds — no admin panel embedded.
func SPA() (fs.FS, error) {
	return nil, nil
}
