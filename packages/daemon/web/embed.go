//go:build !noadmin

// Package web is a placeholder for the embedded admin panel SPA.
//
// The admin panel is being rebuilt from scratch (see tmp/admin-reset-reference/
// for the previous iteration). Until the new panel ships, SPA() returns nil
// and the gateway serves no web UI.
//
// When the new admin panel is ready, restore the //go:embed directive and
// repopulate build/ via the Makefile's web-embed target.
package web

import "io/fs"

// SPA returns nil while the admin panel is being rebuilt.
func SPA() (fs.FS, error) {
	return nil, nil
}
