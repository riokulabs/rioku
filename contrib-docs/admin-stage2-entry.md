# Admin Stage-2 Entry Point

This document describes the entry points for Stage 2 development of the Rioku admin panel. Stage 1 shipped as a mock-backed SPA; Stage 2 connects the admin to the real daemon.

## Stage 1 — Summary

Shipped across 9 plans on `feat/admin-mantine` (604 commits vs `main`):

- **Plan 1 — Foundation**: App shell, routing, auth flow, theming, plugin host, zones, settings registry, identity model
- **Plan 2 — Sites + API management**: Services, routes, middlewares, sites, API keys, policies, RBAC foundations
- **Plan 3 — AI management**: AI providers, agents, tools, traces, MCP servers, rate limits
- **Plan 4 — Analytics + dashboard builder**: Dashboard viewer/builder, widgets, data signals, default dashboards
- **Plan 5 — Audit extended**: Audit list/detail, retention config, export, admin audit log with hash chain
- **Plan 6 — Plugins polish**: Plugin install flow, dev sideload, signers, permission approval, manifest validation
- **Plan 7 — Notifications**: Inbox, channels, routing rules, delivery log, top-bar bell
- **Plan 8 — Settings polish**: Profile, Tenant, Authentication, Network, PKI, TLS, Observability, Integrations, Plugin settings, Danger zone, in-page search
- **Plan 9 — Stage-1 integration close-out**: Dark-mode contrast fix, full a11y sweep, visual polish (tablet/mobile), plugin-dev-sideload stability, bundle audit

## Test coverage at handoff

- 1671 unit tests passing (175 test files)
- 221 E2E tests passing (80 smoke + 86+ a11y + 32 visual polish, 1 intentional skip)
- Bundle audit at `packages/web/BUNDLE_AUDIT.md`
- Daemon binary builds cleanly with embed

## Known Stage-2 Deferred Items (from spec §14.1)

These appear in the admin UI as fake-functional in stage 1. Each requires a real backend spec and implementation in stage 2+.

| Surface | Stage-1 UI | Deferred to later spec |
| --- | --- | --- |
| Plugin install (daemon-part) | Streams a simulated build/swap progress UI | Real daemon rebuild runtime (architecture.md §9.2–§9.3) |
| Iframe plugin sandbox | Manifest field + toggle in UI + loader stub | Real sandboxing runtime with postMessage RPC surface |
| Marketplace catalog | Static seeded catalog, click-to-install fake | Real registry feed / curated list backend |
| Cosign / SBOM / signer allow-list | Install-time approval UI + verification badge | Real crypto verification, key management, TUF root-rotation handling |
| Notification channels (outbound) | Config forms, test buttons, delivery log UI | Real SMTP / Slack / webhook clients, retry, DLQ |
| Password reset via email | UI flow shows the reset link | Real SMTP dispatch |
| Invite acceptance via email | UI flow shows the invite link | Real SMTP dispatch |
| First-run bootstrap | Form writes to in-browser mock store | Real daemon first-run detection + root user persistence |
| TOTP enrollment + recovery codes | QR code display + backup codes UI; mock store verifies codes | Real TOTP secret storage, RFC 6238 verification, hashed backup codes |
| Session revoke (single + all-other) | UI shows device list, revoke buttons update mock | Real daemon session bus + distributed invalidation |
| Audit log export (CSV / JSONL) | Export buttons download mock-store snapshot | Real audit store + streaming export |
| Subdomain tenancy mode | Router supports hostname-based tenant resolution; tenant picker warns "re-auth required" on subdomain switch | Daemon-side DNS wildcard, TLS cert per subdomain, CORS, per-subdomain cookie-domain |
| SSE live delivery | `EventTarget`-based mock | Real SSE with Last-Event-ID resume + `retry:` directive |
| OpenAPI type generation | Static captured spec committed | Proto-change triggers regen automation via `protoc-gen-openapi` v3 |
| CEL policy enforcement | `cel-js` parser-only browser syntax check + mock-returned eval results | Real daemon-side `cel-go` eval + Caddy-handler compile + cost limits |
| Plugin permissions runtime registration | UI shows `plugin-dynamic` flag | Real registry + cleanup-on-uninstall |
| URL PII opaque-handle store | `useOpaqueFilter` hook wired to in-memory mock resolver | Real daemon-side handle registration + custom ESLint rule enforcement |

## What `VITE_USE_MOCKS=false` Flip Requires on the Daemon

The admin REST client lives at `packages/web/src/api/client.ts`. Every group below maps to a set of daemon endpoints that must exist before the flip is safe.

- **Auth**: login, TOTP enrollment, sign-out, bootstrap/invite-acceptance
- **Identity**: users, memberships, roles, permissions catalog (read), impersonation
- **Services**: list, create, update, delete, health status
- **Routes**: list, create, update, delete, match order
- **Middlewares**: list, create, update, delete
- **Sites**: list, create, update, delete
- **API keys**: list, create, rotate, revoke
- **Policies (RBAC + access)**: list, create, update, delete
- **Sessions**: list, revoke
- **Audit**: list, detail, export, retention config read/write, admin audit log
- **AI providers**: list, create, update, delete
- **AI agents**: list, create, update, delete, invoke
- **AI tools**: list, create, update, delete
- **AI traces**: list (streaming SSE), detail
- **AI rate limits**: list, create, update, delete
- **AI MCP servers**: list, create, update, delete
- **Dashboards**: list, create, update, delete, share, set-default
- **Widgets**: query data
- **Notifications**: list (SSE inbox), mark-read, archive
- **Notification channels**: list, create, update, delete, test-send
- **Notification routing**: list, create, update, delete, reorder
- **Notification delivery log**: list, detail
- **Plugins**: list installed, install, uninstall, enable, disable, dev-sideload
- **Plugin signers**: list, create, update, delete
- **Tenant settings**: tenant record read/write, auth policy, network config, TLS config/certs, PKI CAs/enrollments, observability config, webhook endpoints
- **Danger zone**: tenant hard-reset, tenant export JSON, tenant delete (super-admin)

### Real feature requirements beyond HTTP endpoints

- **SSE streaming** for notifications, AI traces, audit live-tail
- **Real CEL evaluation** for permission `when` clauses
- **Real ACME/PKI** for TLS certificate issuance
- **Real OpenTelemetry/Prometheus integration** for metrics + traces
- **Real SMTP/Slack/Webhook delivery** for notification channels
- **Plugin runtime**: validate manifests, sandbox execution, register zones/commands
- **Caddy config reload** after network/TLS config changes

## Open Questions for Stage 2 Spec Author

- How does the daemon expose the permission catalog? Static embed vs dynamic endpoint?
- What's the shape of the SSE notification stream? Per-user? Per-tenant? Heartbeat?
- How are "dev sideload" plugins trusted in a real daemon — dev-mode-only flag?
- Multi-tenant data isolation model — DB schema per tenant, row-level filters, or both?
- Super-admin role — is it a daemon-level concept or per-tenant escalation?
- How do AI provider secrets flow from admin-create to daemon (never through admin UI's store)?
- What's the ACME challenge strategy for internal hostnames in development?

## Handoff Checklist

When starting Stage 2:

1. Set `VITE_USE_MOCKS=false` in `packages/web/.env.production` (or equivalent)
2. Verify `packages/web/src/api/mode.ts` routes queries to real fetch
3. Retire the sandbox-bypass carve-out in `rioku/CLAUDE.md` (spec §13.0)
4. Add integration tests that exercise daemon↔admin round-trips
5. Begin wiring endpoints feature-by-feature; admin unit tests continue to mock at the `api/client.ts` layer

## References

- Spec: `tmp/specs/2026-04-18-admin-mantine-design.md` (local, not committed)
- Plans: `tmp/plans/2026-04-{18-20}-*.md` (local, not committed)
- Branch: `feat/admin-mantine` (local-only, 604 commits vs main)
- Bundle audit: `packages/web/BUNDLE_AUDIT.md`
