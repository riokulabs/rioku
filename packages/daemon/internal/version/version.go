// Package version holds build-time version information injected via ldflags.
package version

// Set via -ldflags at build time.
var (
	Version = "dev"
	Commit  = "unknown"
	Date    = "unknown"
)
