# Stage-1 Comprehensive Visual + Interaction Audit

**Date**: 2026-04-21
**Branch**: `fix/e2e-fixture-hydration`
**HEAD**: `d6a193e`
**Auditor**: Automated Playwright audit (5 spec files, `e2e/visual/comprehensive-*`)

---

## Summary

| Spec file | Tests | Passed | Failed | Notes |
|---|---|---|---|---|
| `comprehensive-pages.spec.ts` | 40 | 40 | 0 | All sidebar nav entries + settings sections |
| `comprehensive-drawers.spec.ts` | 25 | 25 | 0 | All row-click drawer captures |
| `comprehensive-forms.spec.ts` | 23 | 23 | 0 | All create forms + destructive modals |
| `comprehensive-tabs.spec.ts` | 14 | 14 | 0 | Filter/search/bulk-select/keyboard shortcuts |
| `comprehensive-empty.spec.ts` | 26 | 26 | 0 | Beta tenant empty-state coverage |
| **Total** | **128** | **128** | **0** | |

**Screenshots produced**: 135 files in `e2e/screenshots/comprehensive/`

All 128 tests passed. The findings below are from in-test diagnostic logs and visual inspection of screenshots — these are real app observations, not test failures.

---

## Real Issues

### Critical

None found.

---

### Important

#### I-1: Detail drawers have no tab navigation (Users, Roles, AI Agents)

**Surfaces affected**: User detail drawer, Role detail drawer, AI Agent detail drawer

The audit attempted to click through tabs (`Profile`, `Effective Permissions`, `Sessions`, `Audit` for users; `Overview`, `Members`, `Effective Permissions` for roles; `Profile`, `Tools`, `Traces`, `Audit` for AI agents). Zero tab elements with those names were found in any of the three drawers via `getByRole('tab', ...)`.

**What was visible**: The drawers did open and render content. For users, the drawer showed the "Open full page" button which navigated to a full-page user detail view, but tabs were not present in that view either (the post-navigation URL showed a full-page route but the tab content was not enumerated).

**Classification**: Important — the design calls for tabbed detail views (per spec). Either the tabs are rendered under different ARIA roles (e.g., `role="button"` rather than `role="tab"`), or they are implemented as anchor links / nav links without the `tab` role, or the full-page user/role detail routes are the intended pattern with no tabs inside the slide-over drawer itself.

**Recommended investigation**: Check `src/features/security/users/components/user-detail*.tsx` and the full-page user route for the ARIA roles used on the tab-like navigation controls.

---

#### I-2: Middleware row-click does not open a drawer

**Surface affected**: `/t/acme/middlewares`

Clicking the first row in the Middlewares table did not produce a `role="dialog"` element within 8 seconds. The page renders correctly (4 rows visible, filter bar, "New middleware" button present) but row interaction is not wired to a drawer. A stale toast notification ("Middleware disabled — rate-limit-1 is now inactive") was visible in the screenshot, suggesting the toggle action in a previous test triggered a store side-effect.

**Classification**: Important — row interaction is a core UX pattern across all list pages. Middlewares appears to be the only list page where row-click does not open a drawer.

**Screenshot**: `e2e/screenshots/comprehensive/middlewares-drawer-miss.png`

---

#### I-3: Session rows do not open a drawer

**Surface affected**: `/t/acme/security/sessions`

The Sessions page renders 2 rows (Chrome from two IPs). Clicking the first row produced no dialog. The page provides a "Revoke" button directly in the row and a "Revoke all other sessions" CTA at the top — this appears to be an intentional design where sessions are not detail-navigable. However, if a detail drawer is planned (to show session metadata, device fingerprint, etc.) it is not yet implemented.

**Classification**: Important if a session detail drawer is in scope; Minor if the current single-row action (Revoke) is the intended interaction model.

**Screenshot**: `e2e/screenshots/comprehensive/sessions-drawer-miss.png`

---

#### I-4: AI Traces rows do not open a drawer

**Surface affected**: `/t/acme/ai/traces`

The Traces page renders a dense table (~37 rows visible, full-page screenshot is 529 KB). Clicking the first row produced no dialog within 8 seconds. Given that the audit used `checkFullPage: false` for this surface (no "Open full page" button expected), the lack of a drawer may be intentional — traces may be a read-only log view. If a trace detail drawer is in scope, it is not implemented.

**Screenshot**: `e2e/screenshots/comprehensive/ai-traces-drawer-miss.png`

---

#### I-5: Cluster page has no DataTable rows — drawer test could not run

**Surface affected**: `/t/acme/cluster`

The Cluster page renders a stat cards row (4 nodes, 75% healthy, v0.1.0, 46 ms p95 latency), a Nodes table with 4 rows, and an Active enrollment tokens section. However, the audit's row locator (`tbody tr[role="row"]`) did not match any rows within the 10-second timeout. The page clearly has content, but the Nodes table uses a custom rendering pattern that may not emit the standard `role="row"` attribute on `<tr>` elements.

**Impact**: The drawer test for cluster nodes could not run. Enrollment token modal **was** successfully captured via a direct "Enroll node" button click.

**Screenshot**: `e2e/screenshots/comprehensive/cluster-no-rows.png`, `e2e/screenshots/comprehensive/cluster-enrollment-token-modal.png`

**Recommended fix**: Add `role="row"` to the cluster Nodes `<tr>` elements, or adjust the Playwright selector to match the actual DOM pattern.

---

#### I-6: `<Badge>` inside `<Text component="p">` produces React hydration errors

**Surfaces affected**: Multiple pages (visible in server console during every test run)

The Vite dev server emits repeated React hydration errors:

```
[vite] (client) [console.error] In HTML, <div> cannot be a descendant of <p>.
This will cause a hydration error.
```

The stack trace consistently shows a Mantine `Badge` (`<div>`) rendered inside a Mantine `Text` with `component="p"`. This is the pattern used in several list columns where a badge is rendered alongside text content:

```tsx
<Text size="sm" fw={500}>
  {name}
  <Badge ml="xs" size="xs" variant="outline" color="gray">SYSTEM</Badge>
</Text>
```

**Impact**: This is a semantic HTML violation that causes React to log a hydration warning in development. In production (SSR is not used for this SPA), the visual rendering works, but the error will surface in React 19 strict mode with hydration mismatches if SSR is ever added. It also pollutes the dev console, masking real errors.

**Affected components**: Confirmed in the roles list column (where `SYSTEM` badge is shown inside role name text), and likely in any list that uses the same pattern.

**Recommended fix**: Wrap the badge outside the `<Text>` paragraph, or use `component="span"` on the `Text` node when a badge is a sibling.

---

#### I-7: Plugins "Signers" tab not found via `role="tab"`

**Surface affected**: `/t/acme/plugins`

The Plugins page has tabs for Marketplace and Installed (both found and clicked successfully). The "Signers" tab was not found via `getByRole('tab', { name: /signers/i })`. This may be because:

1. The tab is rendered as a link/button rather than `role="tab"`
2. "Signers" tab only appears when the user has a specific permission not held by Derrick in the mock store
3. Plugin signers is accessible only via a separate URL (e.g. `/t/acme/plugins/signers`)

**Screenshot**: `e2e/screenshots/comprehensive/plugins-tab-marketplace.png`, `e2e/screenshots/comprehensive/plugins-tab-installed.png`

---

#### I-8: Beta tenant shows cross-tenant seeded data (not an empty state)

**Surface affected**: All beta tenant pages (`/t/beta/*`)

Navigating to `/t/beta/services` showed 7 services. Navigating to `/t/beta/ai/agents` showed 2 agents. These pages rendered data instead of empty states. This indicates the mock-store seed distributes entities across all 3 seeded tenants using `pick()`, and the beta tenant happens to receive its share of seeded data.

The `beta` tenant is thus **not** a clean empty-state tenant — it is a real seeded tenant with proportional data. Only the sessions page showed a proper empty state on beta.

**Impact**: There is no easy way to test empty states via a dedicated tenant in the current mock seed. Empty-state components can only be reached by clearing all data from a feature (which would break other tests) or by adding a dedicated empty-state fixture tenant.

**Classification**: Important for testing completeness; not a runtime bug.

**Recommended action**: Add a fourth tenant to the seed (e.g., `gamma` or `empty-tenant`) that receives zero entities from every `pick()` call, to enable reliable empty-state testing.

---

### Minor

#### M-1: Dashboard heading not found by `getByRole('heading')`

**Surface affected**: `/t/acme/dashboard`

The dashboard page renders correctly (confirmed by screenshot — shows "Overview" title with METABASE/DEFAULT badges, stat cards, charts, Top routes table). However `getByRole('heading', { name: /dashboard/i })` timed out. The dashboard viewer uses "Overview" as the heading (the dashboard name), not the word "Dashboard". The sidebar nav label is "Dashboard" but the page content heading is the dashboard title.

**Impact**: Test diagnostic only — the test still passed (assertion was wrapped in `.catch()`). The page renders correctly.

**Fix**: Update the assertion to `getByRole('heading', { name: /overview/i })` or `getByText('Dashboard')` from the sidebar active state.

---

#### M-2: Services / API-keys create forms have no obvious Save button matching `/^(save|create|add)$/i`

**Surface affected**: Service create form, API key create form

The form dialogs opened correctly but the Save/Create button did not match the simple regex `/(save|create|add)/i` using `getByRole('button', { name: ... })`. The actual button label may be "New service", "Generate key", or a multi-word label. The forms themselves render fine — this is a test selector issue only.

**Impact**: The empty-submit validation screenshots for services and API keys were not captured. Real validation behavior unknown for these two forms.

---

#### M-3: Role create form shows browser-native validation, not Mantine validation

**Surface affected**: Role create — empty submit

When the role create form was submitted empty, the browser showed its native tooltip "Please fill out this field." (visible in `role-validation-errors.png`) rather than a Mantine `InputWrapper` error message. This means the `<input required>` attribute is present but the form does not use `react-hook-form`'s `mode: 'onSubmit'` with Mantine error display.

**Impact**: Minor UX inconsistency — browser-native validation popups do not match the Mantine design system. All other forms should be checked for consistent Mantine validation vs browser-native validation.

**Screenshot**: `e2e/screenshots/comprehensive/role-validation-errors.png`

---

#### M-4: Bulk-select toolbar label is "Delete selected" only — no non-destructive bulk actions

**Surface affected**: Services list

After selecting 2 rows, a bulk-action toolbar appeared with "2 selected" and a single "Delete selected" button. There are no non-destructive bulk actions (e.g., bulk-enable, bulk-tag, bulk-export).

**Classification**: Visual polish / feature gap. Not a bug. The toolbar renders correctly.

**Screenshot**: `e2e/screenshots/comprehensive/services-bulk-select-attempt.png`

---

#### M-5: Routes and API-keys pages have no editable search input

**Surface affected**: `/t/acme/routes`, `/t/acme/security/api-keys`

These two pages returned 0 non-readonly text inputs. The routes page has no filter bar visible at 1440×900; the API keys page may rely on column-level filtering rather than a global search box. Neither had a visible search input matching `input[type="text"]:not([readonly])`.

**Impact**: Users cannot text-search within the routes or API keys lists — confirmed by screenshot visual inspection.

**Screenshots**: `e2e/screenshots/comprehensive/routes-no-search.png`, `e2e/screenshots/comprehensive/api-keys-no-search.png`

---

#### M-6: Dashboard chart widgets render with 0×0 size warnings

**Surface affected**: All dashboard viewer and builder pages

Every test run that visited a dashboard produced repeated Vite console warnings:

```
[vite] (client) [console.warn] The width(-1) and height(-1) of chart should be greater than 0
```

This is a Recharts/react-grid-layout issue where charts are measured before the container has laid out. Charts do render correctly in the screenshots (confirmed), but the console noise may indicate a timing issue that occasionally renders blank chart containers on slower machines.

---

#### M-7: Topbar "/" shortcut does not focus the search

**Surface affected**: All tenant pages

Pressing `/` on the keyboard (while focus is on the page body) did not open a search modal. Ctrl+K successfully opened the spotlight (3 items: Go to Dashboard, Go to Sites, Toggle theme). The `/` shortcut is either not implemented or requires a specific focus context (e.g., the topbar search input must first be clicked).

**Screenshot**: `e2e/screenshots/comprehensive/keyboard-slash-no-search.png`, `e2e/screenshots/comprehensive/keyboard-ctrl-k-spotlight.png`

---

#### M-8: Ctrl+K spotlight is very minimal (3 commands only)

**Surface affected**: All tenant pages

The Ctrl+K spotlight opened successfully and showed 3 commands:

1. "Go to Dashboard — Navigate to tenant dashboard"
2. "Go to Sites — Navigate to tenant sites"
3. "Toggle theme — Current: dark"

For a full-featured API gateway admin panel, the spotlight is expected to include navigation to all 20+ sidebar pages, entity search, and action shortcuts. The current implementation is a stub.

**Classification**: Minor feature gap (stage-1 scope).

**Screenshot**: `e2e/screenshots/comprehensive/keyboard-ctrl-k-spotlight.png`

---

#### M-9: Tenant picker does not show "beta" tenant option

**Surface affected**: Sidebar footer tenant picker

Opening the tenant picker from the sidebar footer showed the picker dropdown, but the "beta" tenant option was not visible. The picker may only show a limited set of tenants (those the user has recently accessed or has explicit membership in), or the picker may list tenants by display name rather than slug (so "beta" would appear under a different name).

**Classification**: Minor — the `beta` tenant is accessible via direct URL navigation (`/t/beta/*`), so the picker limitation does not block access.

---

#### M-10: Danger zone modal pre-fills confirmation fields

**Surface affected**: Settings → Danger Zone → Hard reset tenant data

The destructive "Hard reset tenant data" modal opened and showed a triple-confirm UI (type tenant slug + type "RESET" + checkbox). Notably the modal appeared to have the fields partially visible but the "Reset tenant data" button was disabled until all three confirmations are satisfied. The "Delete tenant" button is visible but was not interacted with.

**Visual note**: The modal correctly shows a "Stage-1 limitation" warning callout explaining that the mock reset affects ALL tenants, not just the current one. This is a correct disclosure for stage-1.

**Screenshot**: `e2e/screenshots/comprehensive/danger-zone-delete-modal.png`

---

#### M-11: API Explorer renders correctly — no skeleton loop

**Surface affected**: `/t/acme/api-explorer`

The Scalar API explorer rendered fully, including the sidebar navigation with all API sections (BuildService, JapInV1Build etc.). The `aside[role="navigation"]` sidebar was confirmed visible. No skeleton loop was observed. Full-page screenshot is 289 KB showing the complete OpenAPI documentation.

**Classification**: Pass. No issues.

**Screenshot**: `e2e/screenshots/comprehensive/api-explorer-desktop.png`

---

## Playwright Infrastructure Issues

### P-1: `role="row"` not emitted by cluster Nodes table

The cluster Nodes table uses a custom table rendering that does not attach `role="row"` to `<tr>` elements. The standard `tbody tr[role="row"]` selector used across all other list pages returns 0 matches on `/t/acme/cluster`. This prevented the row-click drawer test from running on cluster nodes.

**Fix**: Add `role="row"` to cluster node `<tr>` elements, or use a different stable selector for cluster rows in future tests.

---

### P-2: Middleware and Sessions drawer tests cannot use standard row-click pattern

Middlewares does not open a drawer on row click (I-2 above). Sessions does not open a drawer on row click (I-3). These two are test-design matches for the real app behavior — they are not Playwright timing issues.

---

### P-3: Detail tab ARIA roles are non-standard

User detail, Role detail, and AI Agent detail drawers all have tab-like navigation but do not expose `role="tab"` elements. Future tests that want to assert on tabs should use a surface-specific selector (e.g., `getByRole('button', { name: /profile/i })` or discover the actual tab component role from the source).

---

### P-4: `waitForAppReady` succeeds but body text < 1000 chars on ~14 list pages

14 page tests logged `[DIAGNOSTIC] Body text only NNN chars` (ranging from 624 to 995 chars). All pages passed the `>200` chars soft assertion. The 1000-char threshold is exceeded by pages with large seeded tables; pages with small seed counts (e.g., middlewares at 4 rows, tool-routing at ~2 rows) naturally produce less body text. This is not a bug — the threshold was diagnostic only.

---

## Visual Polish

### VP-1: Charts render with 0×0 initial size (then correct)

All dashboard widget charts log width/height -1 warnings in the console. The final screenshots show correct chart rendering. This may produce brief blank flashes during initial load but resolves before the user sees the page in normal use.

---

### VP-2: AI Traces page produces very large screenshots (529 KB)

The traces list renders ~37 rows of dense tabular data at 1440×900 full page height. No horizontal overflow. The page is functional but information-dense. Consider pagination reduction or row height reduction for readability.

---

### VP-3: Bulk-select toolbar uses only destructive action

The services bulk-select toolbar shows "2 selected | Delete selected" in red. There are no secondary bulk actions (enable/disable, export, tag). For a list with health-status rows, bulk-toggle would be useful. This is a stage-1 feature gap, not a bug.

---

### VP-4: "Requests by service" chart in dashboard has very light bars

In the dashboard screenshot, the "Requests by service" chart shows faint dashed lines only (no visible bar data). The chart renders the series data but the bars are barely visible against the dark background. This may be a color contrast issue specific to the dark theme.

---

### VP-5: Role create form uses browser-native validation instead of Mantine errors

As noted in M-3, the browser-native "Please fill out this field" tooltip appears instead of a Mantine `InputWrapper` error message when submitting the empty role create form. The visual inconsistency is minor but noticeable — all other forms should be audited for this pattern.

---

### VP-6: Spotlight (Ctrl+K) overlay blurs background correctly

The Ctrl+K spotlight screenshot shows the app content blurred behind the spotlight overlay, which is visually correct. However the spotlight itself appears very minimal (3 entries, basic list style). The placeholder text inside the input and the overall dimension of the spotlight modal could be more polished.

---

## Pages Not Covered

The following surfaces were either not tested or could not be reached within the audit scope:

| Surface | Reason not covered |
|---|---|
| Middleware detail drawer | Middlewares does not open a drawer on row click (I-2) |
| Session detail drawer | Sessions does not open a drawer on row click (I-3) |
| AI Trace detail drawer | Traces does not open a drawer on row click (I-4) |
| Cluster node detail drawer | `role="row"` not emitted (P-1) |
| User detail full-page tabs | "Open full page" navigated correctly but tabs under non-`role="tab"` selector not tested |
| Role detail tabs | Same as above |
| AI Agent detail tabs | Same as above |
| Plugin Signers tab | Tab not found via `role="tab"` (I-7) |
| Notification routing page | Not navigated to in scope (not a sidebar entry) |
| Notification channels subpage | Reached via settings only — channels link not found in notification settings |
| AI Tool Routing detail drawer | Not tested in drawer pass (page renders, drawer status unknown) |
| True empty-state views | No truly empty tenant exists in the seed (I-8) |
| Mobile viewport | Covered by existing `mobile-audit.spec.ts` — out of scope for this audit |
| Light theme | Covered by existing `polish-check.spec.ts` — out of scope for this audit |
| RTL layout | Covered by existing `rtl.spec.ts` — out of scope for this audit |

---

## Appendix: Screenshot Index

All screenshots are in `e2e/screenshots/comprehensive/`. Key files:

| Screenshot | What it shows |
|---|---|
| `dashboard-desktop.png` | Dashboard with Overview title, stat cards, charts, Top routes |
| `api-explorer-desktop.png` | Scalar fully rendered with sidebar nav |
| `keyboard-ctrl-k-spotlight.png` | Ctrl+K spotlight with 3 commands |
| `services-bulk-select-attempt.png` | Bulk select toolbar "2 selected / Delete selected" |
| `role-validation-errors.png` | Browser-native validation on role create form |
| `danger-zone-delete-modal.png` | Triple-confirm destructive modal (Hard reset) |
| `middlewares-drawer-miss.png` | Middlewares page — no drawer on row click |
| `sessions-drawer-miss.png` | Sessions page — no drawer (Revoke inline) |
| `ai-traces-drawer-miss.png` | AI Traces dense table — no drawer on row click |
| `cluster-no-rows.png` | Cluster page with nodes but no `role="row"` match |
| `cluster-enrollment-token-modal.png` | Enroll node modal captured successfully |
| `beta-services.png` | Beta tenant services — shows 7 rows (not empty) |
| `beta-ai-agents.png` | Beta tenant agents — shows 2 rows (not empty) |
| `password-change-modal.png` | Password change modal captured successfully |
| `api-key-delete-confirm-modal.png` | API key delete confirm modal |
| `notification-channel-create.png` | Notification channel create form |
