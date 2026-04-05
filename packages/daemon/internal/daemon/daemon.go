// Package daemon implements the core rioku daemon lifecycle.
// It owns the gRPC server, REST gateway, config engine, sync loop,
// plugin host, build manager, and Caddy child process.
package daemon
