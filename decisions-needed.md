# Decisions needed (worktree)

> Append entries here when validation reveals a gap. The orchestrator's
> `make decisions-sync` merges new entries into
> `contrib-docs/stage2-master-decisions.md` after each sub-PR merges.

## Item 001 — wildcard subdomain cert wiring through Caddy compiler

- **Status:** RESOLVED (2026-05-06)
- **Filed by:** plan-12-subdomain (stage2/plan-12-subdomain), 2026-05-06
- **Category:** undefined-behavior
- **What:** Plan 12 T2 adds `--subdomain-cert`/`--subdomain-key` flags and
  `caddy.subdomain_cert_file`/`subdomain_key_file` config fields. The values
  are accepted, parsed and stored on `config.CaddyConfig`, but the Caddy
  JSON compiler (`packages/daemon/internal/caddy/compiler.go`) does not yet
  emit a static `apps.tls.certificates.load_files` entry that loads them
  as a fallback wildcard cert. Today the values are inert.
- **Found in:**
  - `packages/daemon/internal/config/file.go` (CaddyConfig — fields added)
  - `packages/daemon/internal/cli/start.go` (flag plumbing)
  - `packages/daemon/internal/caddy/compiler.go` (gap: no
    `tls.certificates.load_files` emission)
- **Why it matters:** Without compiler emission, tenants in subdomain URL
  mode still cannot terminate TLS for `*.<parent_domain>` without
  per-tenant ACME provisioning. Sandbox `*.localhost` works only via the
  pre-existing self-signed leaf with wildcard SAN.
- **Recommendation:** In a follow-up, extend `Compiler.Compile()` to emit
  `apps.tls.certificates.load_files: [{certificate, key, tags: ["rioku-subdomain"]}]`
  when both `cfg.Caddy.SubdomainCertFile` and `SubdomainKeyFile` are set,
  and add a tagged automation policy `subjects: ["*.<parent_domain>"]`
  pointing at the loaded cert (skipping ACME for those subjects).
- **Alternatives:** Use Caddy's on-demand TLS with `ask` allow-listing the
  parent domain pattern (already partially wired via `tls_ask_addr`), but
  that still triggers ACME per-subdomain on first hit.
- **User decision:** Implement the recommendation directly. The compiler
  now emits `apps.tls.certificates.load_files` with the configured pair
  whenever both `SubdomainCertFile` and `SubdomainKeyFile` are set; the
  daemon plumbs the values from `Config.Caddy` into the compiler at
  startup via `Compiler.SetSubdomainCert`. Coverage:
  `TestCompiler_EmitsSubdomainCert`,
  `TestCompiler_OmitsSubdomainCertWhenUnset`, and
  `TestCompiler_SubdomainCertCoexistsWithOnDemand` in
  `packages/daemon/internal/caddy/compiler_test.go`.
- **Resolution date / commit:** 2026-05-06 — closed by the commit
  that introduces `SubdomainCertConfig`, `SetSubdomainCert`, and the
  load_files emission in `buildTLSApp`.
