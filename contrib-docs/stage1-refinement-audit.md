# Stage-1 Mock — Refinement Audit

> Generated 2026-04-22 from `develop` HEAD `76a4973`. Combines visual (Playwright), code completeness, and pattern-consistency audits.
>
> **⚠️ Visual-audit caveat**: the Playwright-based visual sweep had two infrastructure bugs — (1) light-mode captures were no-ops (identical md5 to dark-mode) because Mantine reads scheme from its internal context, not the DOM attribute; (2) Playwright navigation races the TanStack Router's code-split lazy imports, so screenshots captured near-empty DOM for main content on some pages. Treat visual findings as TRIAGE needing manual browser verification — code-based findings (completeness + pattern) are not affected.

## Critical (ship-blocker for stage-1 polish pass)

1. **Dashboard home "blank" finding** — **contested**: user confirms dashboard renders correctly in the real browser; Playwright captured a race state. Real issue: fixture doesn't wait for route split-chunk to hydrate.
2. **Sidebar hardcoded to `/t/acme/`** — every single nav link regardless of active tenant. Multi-tenant navigation structurally broken for beta/gamma users.
3. **Tables pervasively overflow on mobile** — ~18 tables across services / routes / sites / middlewares / policies / AI / notifications / dashboards / security / plugins. No horizontal-scroll container. Every table page unusable at 390px.
4. **`ActionsCell` is Tooltip-not-Menu** — `src/components/data-table/column-helpers.tsx:106`. Every row-action column across every list table is degraded. Code comment says "Stage 2 upgrade".
5. **`STUB_TENANTS` hardcoded** in `routes/tenants.tsx:6` (`['acme', 'beta', 'gamma']`). Tenant picker ignores store.
6. **`/admin/cluster` is EmptyState** while `<ClusterPage>` component fully exists — wired to wrong route.
7. **API Explorer skeleton loop** at `/t/acme/api-explorer` desktop — Scalar shows loading skeleton that never resolves. (Note: may also be Playwright timing; spot-check in real browser.)
8. **DOM hydration error on `/security/roles`** — `<Badge>` nested inside `<Text component="p">` → invalid HTML, console warning every page load, latent SSR hydration mismatch.

## Important

### Completeness — user-visible "Coming soon"
- **SSO** (settings/authentication) — OAuth + SAML Coming-soon cards
- **Passkeys** (settings/profile) — "planned for a future release"
- **Integrations OAuth connectors** — permanent disabled buttons
- **PKI Revoke/Delete** — permanently disabled, tooltip "stage 2"
- **Network listen addresses** — read-only, "Editable in stage 2"
- **Keyboard shortcuts** — `g d` and `g s` labeled "(placeholder)" in help modal

### Completeness — auth/session stubs
- `getSessionToken()` returns `null` always (mock bearer = no-op)
- `PLACEHOLDER_CURRENT_SESSION = 'current-session-mock'` hardcoded
- Session geolocation = last IP octet mod 10 (presented as real location)
- Plugin signer verify/revoke: status-flip only, no real cosign
- Plugin sandbox iframe: handshake only, no RPC bridge
- CEL eval is JS approximation (access policies, tool routing)

### Pattern consistency
| Pattern | Compliance | Impact |
|---|---|---|
| `c="dimmed"` leaks | 61 hits (heavy in cluster/, super-admin/, shared) | Dark-mode contrast degradation |
| Drawer `transitionProps={{ duration: 0 }}` | 9/36 sites; **0/27** route-level drawers | JSDOM test hangs, animation inconsistency |
| `<Badge>` → StatusBadge | 33% compliance (~120 inline violations) | Inconsistent status semantics |
| `schemaResolver({ sync: true })` | 40/47 (7 forms miss `sync: true`) | Inconsistent validation timing |
| `form.resetDirty(form.values)` | 5 bare `form.resetDirty()` calls | Dirty flicker post-save |
| `color="red"` on destructive | 20 wrong; 2 correct `red.8` | WCAG AA contrast |
| Route-level `requirePermissions` | 29/32 (rbac-policies, roles, access-policies missing) | Authz gap |
| Component-level `usePermission` | 0 in services/routes/middlewares/policies forms | Authz only at route level |
| "Open full page" affordance | 3/~10+ entities (only services/routes/users) | Inconsistent |

### Visual — mobile settings tables overflow
- settings-tenant (441px, "Subdomain" clipped)
- settings-pki (621px, enrollments table)
- settings-integrations (427px, webhook table)
- settings-tls (Actions column clipped)
- cluster (832px, Nodes table)

### Visual — other (spot-check needed due to Playwright race)
- **Settings > Profile** reported dark in light mode — unclear if real or capture artifact
- **Dashboard viewer "Requests by Service" chart** — no bars, no Y-axis labels ✅ confirmed by user screenshot of Overview dashboard (card shows dashed grid + service labels, no bars)
- **Security > Users actions column**: filled red "Deactivate" + plain-text "Remove" side-by-side
- **Settings > Observability** — 3 isolated Save buttons, tight spacing
- **Dashboard viewer header** — 5 same-weight action buttons
- **Danger Zone** — 3 adjacent actions with 3 different button variants

### Sparse seed data
- **beta + gamma tenants have NO resources** — memberships only. Switching tenants → empty everywhere.
- notification channel webhook URLs literal `xxxx` placeholders
- 3 MCP servers (1 disabled) — thin for filter exercise
- 4 plugins total, 3 are acme-only

## Minor

- `ai-traces` mobile table scrolls to 1153px (worst offender)
- `security-roles` mobile truncates long slugs ("com.acme.billing:invoice-admin" → "...invo")
- `security-audit` mobile hides "Action" column (primary log value)
- `api-explorer` mobile ~blank (6KB PNG)
- `OpenApiSpec = unknown` dead typing deferred to Scalar integration
- `Dashboard.Widget.x/y` legacy fields still in types.ts with `TODO(Plan 4c)` removal note

## Suggested attack order

**Sprint A (blockers)** — sidebar hardcoding + STUB_TENANTS, `ActionsCell` real Menu, `/admin/cluster` rewire, hydration error on roles, table horizontal-scroll wrapper in `DataTable` (one change fixes ~18 mobile tables), Requests-by-service chart fix.

**Sprint B (consistency sweep)** — `c="dimmed"` → `gray-7` mass replace, route-level drawer `transitionProps`, StatusBadge migration, `color="red"` → `red.8`, missing route `requirePermissions`, schemaResolver `sync:true` stragglers.

**Sprint C (Coming-soon decisions)** — gate each behind a feature flag OR remove until implemented: SSO, Passkeys, Integrations OAuth, PKI revoke, network listen-addresses edit.

**Sprint D (seed + polish)** — seed beta/gamma with realistic data; fix dashboard viewer chart + header action-bar grouping; Profile light-mode theme leak (after verifying real vs Playwright artifact).

## Companion Document

Full mock-derived stage-2 API + DB spec at `contrib-docs/stage2-api-target.md` (1,423 lines). Feature inventory, ~240 REST endpoints, 7 Mermaid ER diagrams.

## Open Infrastructure Issue

**Playwright test harness reliability** — diagnostic on 2026-04-22 showed the `authedPage` fixture races TanStack Router code-split imports. After fixture completes (`currentUserId !== null`) + goto + networkidle + 800ms wait, main route content is STILL not rendered (only sidebar). This means:
- Screenshot-based visual tests can capture empty states as if they were real renders
- Assertion-based E2E tests (which wait via `expect(...)toBeVisible()` internally) are less affected
- Need to fix the fixture to wait for a route-ready sentinel before handing off to tests
