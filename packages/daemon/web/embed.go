//go:build !noadmin

// Package web embeds the admin panel SPA into the daemon binary.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:build
var buildFS embed.FS

// SPA returns a filesystem rooted at the admin panel build directory.
func SPA() (fs.FS, error) {
	return fs.Sub(buildFS, "build")
}
