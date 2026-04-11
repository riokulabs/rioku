# Admin Panel Remediation Spec

## Context

An audit comparing the admin panel implementation against the reference mockup (`tmp/admin-mockup/`) and design spec (`docs/superpowers/specs/2026-04-10-admin-panel-overhaul-v2.md`) found systematic gaps:

1. **No mock data** — every page is 100% API-driven. Without a running backend, the panel shows empty states everywhere. The mockup has rich hardcoded data on every page.
2. **Phase 1 components built but never used** — `YamlJsonEditor` and `SearchableSelect`/`SearchableMultiSelect` exist in `@rioku/ui` with tests but are not integrated into any page.
3. **"NEEDS BACKEND" used to skip work** — entire tabs and features wrapped in disabled placeholders instead of rendering mock UI.

## Approach: MSW (Mock Service Worker)

All mock data will be provided via MSW intercepting fetch calls at the network level. Pages remain unchanged — they think they're talking to a real API.

- MSW handlers defined in `packages/web/src/mocks/`
- Handlers organized per API domain: `handlers/config.ts`, `handlers/auth.ts`, `handlers/traffic.ts`, `handlers/settings.ts`, `handlers/audit.ts`, `handlers/cluster.ts`, `handlers/plugins.ts`, `handlers/certificates.ts`
- Mock data modules: `data/routes.ts`, `data/services.ts`, `data/policies.ts`, `data/users.ts`, `data/api-keys.ts`, `data/audit-entries.ts`, `data/nodes.ts`, `data/plugins.ts`, `data/certificates.ts`, `data/traffic.ts`, `data/settings.ts`
- MSW initialized conditionally: when API health check fails OR via `VITE_MOCK=true` env var
- All mock data should match the richness of the mockup (10 routes, 8 services, 8 policies, 5 users, 5 API keys, 15 audit entries, 3 nodes, 7 plugins, 6 certificates, traffic traces, analytics time series)
- MSW also handles mutations (POST/PUT/DELETE) — updates in-memory state so CRUD operations work in demo mode

## Phase A: Wire Up Existing Components

**Priority: Highest — these components exist and are tested, just not plugged in.**

### A1: YamlJsonEditor Integration

The `YamlJsonEditor` component exists in `@rioku/ui` with CodeMirror 6, format toggle, validation, copy, download. It needs to be integrated into:

- Route create page — Code mode tab
- Route detail page — YAML toggle in edit mode
- Service create page — Code mode tab
- Service detail page — YAML toggle in edit mode
- Policy create page — Code/YAML mode tab
- Policy detail page — YAML toggle in edit mode

Each integration requires:
1. Import `YamlJsonEditor` from `@rioku/ui`
2. Add form-to-YAML conversion function (serialize form state to YAML string)
3. Add YAML-to-form parsing function (parse YAML string back to form state)
4. Wire bidirectional sync: form changes update YAML, YAML changes update form
5. Mode toggle button (Form / YAML) or inline toggle in edit mode

### A2: SearchableSelect / SearchableMultiSelect Integration

Replace all plain `<Select>` dropdowns with `SearchableSelect` or `SearchableMultiSelect` where appropriate:

- Route create/detail: Service selector -> `SearchableSelect` (show upstream count, LB policy in option labels)
- Route create/detail: Policy attachment -> `SearchableMultiSelect`
- Service create/detail: LB policy -> `SearchableSelect`
- Service create/detail: TLS mode per upstream -> `SearchableSelect`
- User detail: Role assignment -> `SearchableMultiSelect`
- Settings pages: Timezone, locale selectors -> `SearchableSelect`
- API key create: Scope selection -> `SearchableMultiSelect`

### A3: KeyValueEditor Integration

The `kv-editor.tsx` component exists but isn't used. Wire it into:
- Route create/detail: Labels section
- Service create/detail: Labels section

## Phase B: Missing Mockup Features

### B1: MSW Setup + Mock Data

Set up MSW with all handlers and realistic mock data matching the mockup's richness. This unblocks every page from showing empty states.

### B2: Dashboard Overhaul

Current dashboard shows system status widgets. Mockup shows traffic-centric dashboard:
- 4 stat cards: Total Requests, Error Rate, P95 Latency, Active Routes (with change deltas)
- 4 charts: Request Rate (area), Error Rate (stacked bar), Latency Percentiles (line with p50/p95/p99), Top Routes (horizontal bar)
- Time range selector (1h/6h/24h/7d/30d)
- Keep existing System Status and Recent Changes cards as additional widgets

### B3: Shared Time Range Context

Create a `TimeRangeProvider` context that persists across Dashboard, Analytics, and AI Workloads pages:
- Store in URL search params (`?range=24h`)
- Time range selector component in page headers (not top bar — simpler)
- Options: 1h, 6h, 24h, 7d, 30d

### B4: Wizard Mode for Route Create

Add wizard mode matching the mockup:
- 3-mode switcher: Form / Wizard / YAML
- Wizard steps: Basics -> Matching -> Target -> Policies & TLS -> Review
- Step indicator with numbered circles, active/done/pending states
- Back/Forward navigation between steps
- Review step shows all configured values in a summary table
- All three modes share the same form state with bidirectional sync

### B5: Wizard Mode for Policy Create

Add wizard mode matching the mockup:
- 3-mode switcher: Form / Wizard / YAML
- Wizard steps: Type Selection -> Configuration -> Review
- Step indicator
- Review step with summary table
- Bidirectional sync between all modes

### B6: Traffic & Activity Tabs (Routes + Services)

Replace NeedsBackendField placeholders with actual UI backed by MSW mock data:

**Traffic tab** (both route and service detail):
- 4 stat cards: RPS, P95 Latency, Error Rate, Uptime
- Request rate area chart (48 data points)
- Error breakdown stacked bar chart (4xx/5xx)
- Recent requests table (10 rows with method, path, status, latency)

**Activity tab** (both route and service detail):
- Timeline with colored dots by action type (create/update/delete/enable/disable)
- 7+ entries showing: action, actor, timestamp, detail text

### B7: Profile Preferences & Sessions

Add to profile page:
- **Appearance**: Theme selector (System/Light/Dark) — currently only in header toggle
- **Accessibility**: Color vision selector (None, Deuteranopia, Protanopia, Tritanopia, Achromatopsia), High Contrast toggle, Reduced Motion toggle
- **Locale**: Timezone selector (SearchableSelect), Locale selector (SearchableSelect)
- **Active Sessions**: Table showing device, IP, location, last active, with terminate button

### B8: Route/Service List Traffic Columns

Add RPS and P95 Latency columns to route and service list tables (data from MSW mock).

### B9: Faceted Filters on List Pages

Wire up the existing `FacetedFilter` component on:
- Routes list: Status (Enabled/Disabled), Service, Has Policy
- Services list: Health Status, LB Policy, Has Health Check
- Policies list: Type

## Phase C: Security/RBAC Completion

### C1: Effective Permissions Panel

Implement the `EffectivePermissions` component on user detail view:
- Computed permission matrix from role hierarchy + access policies
- Resource x Action grid with allow/deny indicators
- "Inherited from" tooltips showing which role grants each permission

### C2: Access Policies (Beyond "Coming Soon")

Replace EmptyState with working UI:
- List page with table: name, effect, target type, targets, conditions count, priority, enabled toggle
- Create page with condition editor (already exists as component)
- Detail page with inline editing

### C3: Role Editing with Permission Rules

Wire up the existing `PermissionRuleEditor` component:
- Add/remove permission rules on role detail
- Resource/actions/scope/effect per rule
- Save mutations

### C4: User Sessions Management

Add to user detail page:
- Active sessions table: device, IP, location, last active
- Terminate session action
- "Terminate all other sessions" bulk action

### C5: API Key Create Enhancement

Enhance API key creation flow:
- Description field
- Expiry selector (30d, 60d, 90d, 1y, Never)
- Scope selection via SearchableMultiSelect (available routes/services)
- One-time key display with copy + warning

### C6: API Key Usage & Activity Tabs

Replace "Coming soon" text:
- Usage tab: request count stat cards (24h, 7d, 30d), last used info
- Activity tab: timeline of key events (created, used, rotated, scopes changed)

## Phase D: Quality of Life

### D1: Command Palette Entity Search

Extend command palette to search:
- Routes by name/host
- Services by name
- Policies by name/type
- Users by username/email
- API keys by name/prefix

### D2: Session Timeout Warning

- Detect approaching session expiry via cookie/API
- Show countdown modal 5 minutes before expiry
- "Extend session" button that hits the refresh endpoint
- Auto-logout when timer reaches zero

### D3: Auto-Save Drafts

- Auto-save form state to localStorage every 30s on create pages
- Key format: `rioku-draft:{entity}:{timestamp}`
- On page load, detect existing draft and prompt "Restore draft from {time ago}?"
- Clear draft on successful save or explicit discard

### D4: Inline Form Validation

- Show validation errors below fields (not just toast)
- Red border on invalid fields
- `aria-invalid` and `aria-describedby` for accessibility
- Focus first invalid field on submit
- Real-time validation on blur

### D5: Optimistic Updates

- Toggle enable/disable on routes: update UI immediately, revert on error
- Delete actions: remove row immediately, revert on error
- Use TanStack Query `onMutate` / `onError` / `onSettled` pattern

### D6: Stale Data & Recently Viewed

- "Last updated X ago" on dashboard and list pages
- Refresh button on dashboard
- Recently viewed entities stored in localStorage
- "Recent" section in command palette

---

## Implementation Order

Phase A -> Phase B -> Phase C -> Phase D

Within each phase, tasks should be further broken down into implementation plans with detailed steps. Each phase should be its own plan file.
