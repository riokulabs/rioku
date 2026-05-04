# D12: Vault Reference Resolution — Daemon Resolves, Caddy Never Persists Plaintext

**Date**: 2026-04-30
**Issue**: #169
**Status**: Accepted

## Context

Sprint 3 introduces vault references — a `{vault://name/resource}`
syntax that lives on every secret-bearing config field (api_keys,
provider credentials, webhook signing secrets, OTLP token headers,
etc.). The reference is a pointer; resolution must happen before the
underlying secret is used by the data plane.

Three resolution boundaries are plausible:

1. **Resolve in the daemon, inject plaintext into Caddy.** The daemon
   keeps vault refs at rest and at the admin layer; resolution happens
   only at the moment the daemon compiles a Caddy config. The compiled
   Caddy JSON contains plaintext secrets but is held in memory and
   sent over the local Caddy admin socket. Caddy never sees the ref
   string, never reads the vault backend, and never persists secrets
   to disk.

2. **Push refs into Caddy; let Caddy resolve.** Caddy gains a new
   reference-resolver module. Caddy reads vault backends directly.

3. **Resolve at admin-API read time.** The admin REST layer resolves
   refs whenever it reads the config. Plaintext leaks into REST
   response bodies and logs.

## Decision

**Daemon resolves; Caddy never persists plaintext.** Specifically:

- At rest in the config store: refs are stored verbatim (e.g.,
  `{vault://env/OPENAI_API_KEY}`).
- On the admin REST read path: refs are returned verbatim alongside a
  `$refs` JSON sidecar that records the resolved/expected location.
  Plaintext is **never** returned over admin REST.
- On the Caddy compile path: the daemon resolves every ref via the
  `internal/vault.Backend` interface and writes plaintext into the
  in-memory Caddy admin payload only. The plaintext is not persisted
  to the config store, not written to logs, not exposed via REST.
- Caddy itself remains unaware of vault syntax. From Caddy's
  perspective the config is plain JSON.

## Why not "Caddy resolves"

Caddy is a child process. Pushing vault resolution into Caddy means:

- Each Caddy plugin needs its own resolver hook, OR Caddy gains a
  pre-processor module — both surface area we don't want.
- Caddy now has to authenticate to the vault backend. That widens the
  trust boundary and forces us to ship credentials to Caddy.
- Hot-swapping Caddy (a sliding-window concern per the 2026-04-04
  Caddy version-coupling decision) becomes harder because each
  version may handle refs differently.

The daemon already owns the config store, the migration system, the
admin auth layer, and the Caddy compile pipeline. Resolution belongs
on the same side of the trust boundary.

## Why not "resolve at admin-REST read time"

Resolved plaintext on REST responses is a leak vector:

- Admins who can read config inherit the ability to read every
  secret. The `$refs` sidecar pattern + reference-only round-trip
  preserves an audit boundary: admins can see the *reference*, not
  the *value*.
- Plaintext in REST responses ends up in browser history, proxy
  logs, intercepting tools, and accidental screen-shares.

## Consequences

- `internal/vault.Backend` interface lives in the daemon package
  tree, not in Caddy.
- The Caddy compiler (`internal/caddy/compiler/`) gains a
  `resolveVaultRefs(cfg *caddyJSON) error` step that runs immediately
  before posting to the Caddy admin socket.
- The admin REST layer adds a `$refs` JSON object to every response
  body that contains secret-bearing fields. The `$refs` value mirrors
  the field tree shape, with each leaf being either `null` (literal
  value) or the original reference string.
- Resolution failures are surfaced as structured errors with the
  reference name + backend name; the failed compile is rejected
  cleanly (the previous Caddy config keeps running).
- The caller for Caddy compile is the **only** path that returns
  plaintext. Other code paths that need a plaintext secret (e.g.,
  the OTLP exporter init) call the same resolver explicitly; there
  is no ambient "auto-resolve" behavior.
- Init-phase ordering: env-backed refs resolve synchronously at
  startup; network-backed refs (HCV, AWS-SM, GCP-SM in v2) resolve
  lazily and cache. The startup compile blocks on network-backed
  refs only if they are reachable; otherwise the previous compile
  remains effective and the failed resolve is logged.
- Plaintext never enters the audit log. The audit entry records the
  ref string + the backend used; the resolved value is not captured.
