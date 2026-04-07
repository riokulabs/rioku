//go:build !noadmin

// Package web embeds the admin panel SPA built from packages/web/.
// The build/ directory is copied here by the Makefile before go build.
//
// Build with -tags noadmin for a lean binary without the admin panel
// (useful for cluster members that only need API/gRPC).
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:build
var buildFS embed.FS

// SPA returns a filesystem rooted at the build directory.
func SPA() (fs.FS, error) {
	return fs.Sub(buildFS, "build")
}
