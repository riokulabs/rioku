// Package sync implements the cluster sync agent. Each node watches
// the config store for changes and pushes them to its local Caddy
// instance via the admin API.
package sync
