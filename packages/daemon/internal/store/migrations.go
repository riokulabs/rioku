package store

import "embed"

// MigrationFS embeds all migration SQL files so that driver sub-packages
// can access them without needing their own go:embed (which cannot
// reference parent directories).
//
//go:embed migrations/*/*.sql
var MigrationFS embed.FS
