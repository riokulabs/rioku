# Rioku — Open Questions

Unresolved questions from the design phase. These need answers before or during implementation.

---

1. **Plugin registry** — Self-hosted only, or a central registry like pkg.go.dev / a dedicated hub?
2. **Config store default transition** — SQLite for single-node, Postgres for multi-node. What is the transition path? (addressed partially by `rku migrate` design)
3. **Web plugin isolation** — ESM modules loaded dynamically? iframes for untrusted plugins? Security model needs definition.
4. **Caddy version coupling** — How tightly pinned to a Caddy version? Upgrade path when Caddy releases breaking changes?
5. **Gateway auth bootstrap** — `rku init` prints bootstrap token to stdout once. Is this the only delivery mechanism? Should `rku configure` offer OS keyring storage?
6. **Licensing** — Apache 2.0 for core? Business Source License for commercial modules? Needs legal review before public launch.
7. **CLI alias verification** — Confirm `rku` is not a system binary on major Linux distros and macOS.
8. **Domain availability** — Verify `rioku.dev`, `rioku.io`, `rioku.com` availability.
9. **Token storage in CLI config** — Should `rku configure` offer to store the token in the OS keyring rather than plaintext in `~/.config/rioku/config`?
10. **`--non-interactive` exit behavior** — Confirm exit code `2` when required flags are missing in non-interactive mode.
11. **USPTO trademark clearance** — Required before any public launch or trademark filing.
12. **Pricing page** — Even a simple one signals the project is serious about sustainability.
13. **Entity formation** — Sole proprietorship is fine initially; LLC before first commercial customer.
