// Package keyring implements the secret store system for the CA private
// key passphrase. Supports multiple backends: systemd-creds, kernel-keyring,
// env vars, and encrypted-file fallback.
package keyring
