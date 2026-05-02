// Package mirror implements the rioku_mirror Caddy handler module.
// It duplicates a configurable fraction of inbound requests to a
// secondary upstream for shadow-traffic testing while leaving the
// primary request path untouched.
package mirror
