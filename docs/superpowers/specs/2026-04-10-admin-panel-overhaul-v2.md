# Admin Panel UX Overhaul — v2 (Mockup-Validated)

**Date:** 2026-04-10
**Status:** Validated — mockup reviewed
**Supersedes:** `2026-04-09-admin-panel-overhaul-design.md` (Draft)
**Visual reference:** `tmp/admin-mockup/` (Vite + React prototype with all pages)
**Depends on:** Compiler hardening plan (proto enrichment must land first for new fields)

---

## 1. Problem Statement

The current admin panel is functional but feels like a prototype. Specific pain points:

1. **Tables are interaction-hostile** — the only way to act on a row is a tiny hamburger menu icon at the far right. Users must scan across the entire table width to find it. Row click does nothing.
2. **Edit/create panels are too cramped** — the right slide-out is narrow, making complex forms (route matchers, health checks, transport config, policy configuration) feel squeezed and hard to use.
3. **Settings is a single page** — Rioku has dozens of configuration dimensions (network, TLS, certs, observability, trace storage, PII filters, auth, PKI, plugins, AI). One page with read-only values doesn't scale.
4. **Policy creation is a JSON textarea** — the most configuration-heavy entity in the system has the worst creation UX.
5. **Missing fields everywhere** — route forms don't expose TLS, timeouts, streaming, advanced matchers. Service forms don't expose passive health checks, retries, transport config, connection pools. These fields are being added to the proto (compiler hardening plan) but the admin panel has no UI for them.
6. **No structured RBAC management** — permissions are flat checkboxes with no scoping, no hierarchy, no visual feedback on what a role can actually do.
7. **No trace detail view** — the live traffic table shows rows but clicking one doesn't show the full trace (request/response metadata, policy decisions, upstream timing, OTEL trace correlation).
8. **Visual polish** — the panel works but feels generic. It needs to feel like a product, not a template.

## 2. Design Decisions

### 2.1 Design system: shadcn/ui (stay, don't switch)

Keep the existing shadcn/ui + Tailwind foundation. Use satnaing/shadcn-admin (MIT, 11.7k stars, same stack) as a reference architecture for complex component patterns — layout shell, data tables, form composition. Copy and adapt patterns, not install as dependency.

**Additional libraries (all MIT or Apache-2.0):**
- **dnd-kit** — drag-and-drop for route priority reordering and role hierarchy management (MIT)
- **@tanstack/react-virtual** — virtual scrolling for large tables (MIT)

**Removed from v1 spec (no longer needed):**
- **@uiw/react-codemirror** + **@codemirror/lang-json** + **@codemirror/lang-yaml** + **@codemirror/lint** — code editor for YAML/JSON mode (MIT). React wrapper for CodeMirror 6 with first-party language support, inline validation, 20+ themes, ~140KB gzipped.
- ~~@rjsf/core~~ — JSON Schema-driven forms dropped; all policy types get structured forms or YAML/JSON mode
- ~~data-table-filters~~ — faceted filtering built in-house with existing shadcn primitives

### 2.2 Theme: dark default, light available

Dark mode is the primary design target. Light mode supported via CSS variables (not just shadcn toggle — full variable-based theming). System preference detection on first visit, user override persisted in localStorage.

All custom components must be tested in both themes. No hardcoded colors — everything through CSS custom properties (`--color-primary`, `--color-bg-surface`, etc.).

**Design note for production:** The theme system is architected to support user-editable custom themes stored as JSON in user preferences. v1 ships dark + light only. Custom theme creation is a future feature.

### 2.3 Persona: 80% operator, 20% developer

Operators (DevOps/SRE managing the gateway) are the primary user. They see everything. Developers (API owners checking their routes' health) get a focused read-mostly view based on RBAC — they see their routes, their traffic, their keys. Navigation is the same for both; RBAC controls what's visible and editable.

### 2.4 Localization

Continue using react-i18next (already installed). English-only for now, but all user-facing strings must go through the translation layer — no hardcoded text in components. This is non-negotiable for future language support.

Namespaces: `common`, `dashboard`, `routes`, `services`, `policies`, `traffic`, `security`, `settings`, `cluster`, `plugins`, `audit`.

### 2.5 Responsiveness

All pages must work at three breakpoints:
- **Desktop** (1280px+) — full sidebar, multi-column layouts, data tables
- **Tablet** (768-1279px) — collapsed sidebar (icon mode), single-column forms, narrower tables
- **Mobile** (< 768px) — sidebar hidden entirely, opens as overlay drawer via hamburger menu button in the top bar

**Mobile-specific behaviors (validated in mockup):**
- Sidebar is an overlay drawer that slides in from the left, with backdrop dimming
- Hamburger menu icon appears in the top bar at <768px
- Content padding reduces from 24px to 16px
- Stat grids collapse from 4-col to 2-col
- Data tables become horizontally scrollable within their container
- Detail panels render as full-width overlays on small screens
- Configuration workflows (route/service/policy creation) degrade gracefully but remain usable

`FRONTEND ONLY` — all responsive behavior is pure CSS/React, no backend changes needed.

## 3. Navigation & Layout

### 3.1 Sidebar

Collapsible sidebar using shadcn's `Sidebar` component with `collapsible="icon"`. Default expanded on desktop, collapsed on tablet, hidden (overlay drawer) on mobile.

```
Rioku Gateway                    [collapse toggle]
────────────────────────────────
Overview

CONFIGURATION
  Routes
  Services
  Policies

TRAFFIC
  Live view
  Analytics
  AI workloads

INFRASTRUCTURE
  Cluster
  Certificates
  Plugins

SECURITY
  Users & roles
  API keys
  Access policies
  Audit log

────────────────────────────────
[user avatar] admin@rioku.dev   [^]
```

Changes from v1:
- **"Access policies" added** under SECURITY — new page for conditional access rules (see Section 11.4)
- **Settings removed from sidebar nav** — moved to user menu popup (see Section 3.4)
- **Plugin-provided pages appear dynamically** — when a plugin registers admin pages, they appear in the sidebar under INFRASTRUCTURE > Plugins as sub-items (see Section 13.3)
- **User area at bottom is a button** — clicking opens an upward popup menu (see Section 3.4)

Each nav item has an icon (lucide-react, already in the project). When collapsed, only icons show with tooltips on hover. Active item highlighted with left accent border. Section headers hidden when collapsed.

`FRONTEND ONLY`

### 3.2 Top bar

Minimal top bar:
- Left: breadcrumbs (e.g., Configuration > Routes > payments-api)
- Right: shared time range selector (when on Dashboard/Analytics/AI Workloads), notification bell, theme toggle, command palette trigger (Cmd+K)

**Notification bell** (new in v2): Icon with unread count badge (red circle with number). Clicking opens a dropdown panel showing typed notifications:
- Each notification has: icon, title, message, timestamp, colored left border by type
- Types: `warning` (amber border), `error` (red border), `success` (green border), `info` (blue border)
- "Mark all as read" button at the top
- Notifications stack newest-first
- Unread notifications have a subtle background highlight
- Panel is dismissible by clicking outside or pressing Escape

`FRONTEND ONLY` — notification data comes from SSE events (backend already emits these); the UI just needs to render them.

### 3.3 Command palette (Cmd+K)

Global search across all entities. Powered by shadcn's `Command` component (cmdk). Sections:
- **Navigation** — jump to any page
- **Routes** — search by name, host, path
- **Services** — search by name
- **Policies** — search by name, type
- **Settings** — jump to specific settings sections
- **Actions** — create route, create service, create policy

This is the power-user fast path. Operators who know what they want should be able to Cmd+K, type, Enter, and be there in under 2 seconds.

`FRONTEND ONLY`

### 3.4 Sidebar user menu

The bottom user area (avatar + email) is a **button** that opens an **upward popup menu** with three options:
1. **Profile** — navigates to the user's profile page (see Section 11.7)
2. **Settings** — navigates to the settings section (see Section 10)
3. **Log out** — logs the user out with confirmation

This replaces the separate "Settings" nav item in the sidebar. Settings is now accessed only through this menu, keeping the main nav focused on operational tasks.

`FRONTEND ONLY`

### 3.5 Shared time range context

A time range selector appears in the top bar when the user is on Dashboard, Analytics, or AI Workloads pages. Options: **1h | 6h | 24h | 7d | 30d**. Selecting a range:
- Applies to all charts and stats on the current page
- Persists when navigating between Dashboard, Analytics, and AI Workloads (shared context)
- Regenerates all data for the selected range
- Resets to 24h on page load (not persisted across sessions)

The selector is a segmented button group, visually integrated into the top bar. It does not appear on other pages.

`FRONTEND ONLY` — the backend already supports time range parameters on all stats endpoints.

## 4. Table Interactions

### 4.1 Primary interaction: click the entity name

Clicking an entity name (link-styled, primary color) navigates to a **full-page detail view** that replaces the table entirely. This is not a slide-out, not an overlay, and not rendered above the table. The detail view is a separate page/route. A back button (or breadcrumb) returns to the table.

The name column is always the first data column and always a clickable link.

### 4.2 Inline actions

Common actions appear on row hover as icon buttons at the right edge:
- Toggle enable/disable (routes only)
- Edit (navigates to detail view in edit mode)
- More (...) menu for destructive actions (delete, duplicate)

These appear on hover, not as a permanent column. Reduces visual noise, keeps the table clean.

### 4.3 Bulk actions

Checkbox column for multi-select. Checkboxes use **custom themed styling**: dark background, primary-colored check state, white checkmark icon. No browser-default checkbox rendering.

When items are selected, a floating action bar appears above the table with bulk actions (enable all, disable all, delete selected, attach policy to all).

`FRONTEND ONLY`

### 4.4 Faceted filtering

Replace the current simple text search with a faceted property filter bar above the table. Users can build compound filters:
- `Status = Active AND Host contains example.com AND Service = payments-svc`

Built with existing shadcn primitives (Popover + Command + Badge). Filter state persisted in URL query params so filtered views are shareable/bookmarkable.

`FRONTEND ONLY`

### 4.5 Table preferences

Gear icon opens a preferences panel:
- Column visibility toggles
- Column reordering (drag)
- Page size (10, 25, 50, 100)
- Density (compact, comfortable, spacious)

Preferences persisted via a `usePreferences(key, { scope })` hook with two scoping modes:

- **`scope: "global"`** — follows the user across all devices. Used for: theme, colorblind mode, reduced motion, high contrast, locale, time range, recently viewed.
- **`scope: "device"`** (default) — per-device settings, since screen size and context differ. Used for: table density, column visibility, page size, sidebar collapsed state.

Device identity is a hash of `screen.width + screen.height + navigator.userAgent`, stored in localStorage on first visit. This means the same user on a laptop vs. a 4K monitor automatically gets separate table layout preferences.

**Storage key format:** `rioku-pref:{scope}:{userId}:{deviceHash?}:{key}`

**Storage backend (phased):**
- **Phase 1 (now):** localStorage only. `FRONTEND ONLY`
- **Phase 2 (when preferences API exists):** Write-through cache — write to localStorage immediately (fast, offline-capable), background sync to server (durable, cross-device for global scope). No call-site changes required. `NEEDS BACKEND`

`FRONTEND ONLY`

## 5. Detail Views

### 5.1 Full-page detail view pattern

This is the standard pattern for ALL entity detail views (routes, services, policies, users, API keys). The behavior is consistent:

1. User clicks entity name in the table
2. Browser navigates to a detail route (e.g., `/config/routes/:id`)
3. The table page is **replaced** by the detail page (not overlaid, not stacked)
4. Breadcrumbs show the path back: Configuration > Routes > payments-api
5. A "Back to [entity list]" button is always visible at the top-left
6. The detail view uses a **tabbed layout** for organizing content sections

### 5.2 Inline editing

On the detail view, each card/section has an "Edit" button that transforms the read-only display into an inline form. No separate edit page — the detail view IS the edit view with a toggle. Save/Cancel buttons appear when editing. Changes are validated client-side (zod) and submitted as a single API call.

**Field types in edit mode** use proper input types:
- Text fields: standard text input
- Durations: number + unit selector (ms/s/m/h)
- Enums: native `<select>` for fixed small sets (allow/deny, TLS versions, HTTP methods)
- Dynamic data references: `SearchableSelect` or `SearchableMultiSelect` component (see Section 5.4)
- Booleans: toggle switch
- Lists: tag input with add/remove
- Key-value pairs: dynamic row editor

### 5.3 YAML toggle in edit mode

When editing any entity, a "Code" toggle button appears in the toolbar. Clicking it switches the entire edit form to the YAML/JSON editor view (see Section 6.2 for the editor component). A format toggle in the editor toolbar switches between YAML and JSON. Switching back to form mode parses the code and updates the form fields (bidirectional sync — see Section 6.3).

### 5.4 SearchableSelect and SearchableMultiSelect components

**All dropdowns that reference dynamic data** (roles, services, policies, timezones, users, routes) use a custom `SearchableSelect` or `SearchableMultiSelect` combobox component:

- Text input with search/filter
- Dropdown list of matching options, virtualized for large lists
- Keyboard navigation (arrow keys, Enter to select, Escape to close)
- Selected items shown as removable badges (multi-select) or inline text (single-select)
- Placeholder text: "Search [entity type]..."

**Fixed enums stay as native `<select>`**: allow/deny, TLS versions (1.2/1.3), HTTP methods, effect types, log levels, and any other small fixed set where search adds no value.

`FRONTEND ONLY`

### 5.5 Quick actions from the table

For simple actions that don't need a full form (toggle enable/disable, attach a policy, change LB policy), use modals or popovers directly from the table. Only complex multi-field edits go to the detail page.

## 6. Create/Edit Workflows

### 6.1 Two input modes (all entities)

Every creation flow (routes, services, policies) offers **two** modes, selectable via a toggle at the top:

**Form mode (default):**
Progressive disclosure form with expandable "Advanced" sections. Basic fields always visible, advanced fields collapsed by default. Uses react-hook-form + zod for validation. Structured, guided, type-safe.

**YAML/JSON mode:**
Custom code editor component (see Section 6.2) with syntax highlighting, live validation, format toggle, and error panel. For power users who want to paste a config or edit raw YAML/JSON.

**Removed from v1:** Wizard mode has been dropped. The progressive disclosure form with collapsible sections achieves the same guided experience without the overhead of a separate step-by-step flow.

### 6.2 YAML/JSON editor component (`<YamlJsonEditor>`)

Built on `@uiw/react-codemirror` (React wrapper for CodeMirror 6) with first-party language packages. This gives us professional-grade editing without maintaining custom syntax highlighting or validation.

**Underlying packages:**
- `@uiw/react-codemirror` — React component wrapper (~140KB gz total with dependencies)
- `@codemirror/lang-json` — JSON syntax highlighting + structure-aware features
- `@codemirror/lang-yaml` — YAML syntax highlighting
- `@codemirror/lint` — inline error markers, gutter diagnostics, tooltip errors

**Our wrapper (`<YamlJsonEditor>`)** adds a Rioku-specific toolbar and format toggle on top of the CodeMirror instance. The wrapper lives in `@rioku/ui` and is the component pages import — they never import CodeMirror directly.

**Format toggle:** A YAML / JSON segmented control in the toolbar switches between formats. YAML is the default. Switching converts the content between formats. The selected format is persisted per-user in localStorage.

**Features (provided by CodeMirror 6):**
- **Syntax highlighting** — first-party grammars for both YAML and JSON, with full token-level coloring
- **Line numbers** — built-in gutter with proper scroll sync
- **Inline validation** — `@codemirror/lint` shows error markers in the gutter, red underlines on error ranges, and hover tooltips with error messages. YAML linting wraps the `yaml` package's parser errors into CM6 diagnostics (~15 lines). JSON linting uses `JSON.parse` error mapping.
- **Bracket matching, auto-indent, smart Tab** — all built-in CM6 behaviors. Tab inserts 2 spaces.
- **Search and replace** — Cmd+F within the editor (built-in CM6 extension)
- **Accessibility** — CM6 has excellent screen reader support, ARIA roles, and keyboard navigation out of the box

**Features (provided by our wrapper toolbar):**
- Format toggle: YAML | JSON (segmented control)
- Valid/Error indicator: green "Valid" or red "X errors" badge with count
- Copy to clipboard button
- Download as `.yaml` / `.json` button (matches selected format)
- Format/prettify button (normalizes indentation)

**Theming:** We create a custom Rioku CodeMirror theme using `createTheme()` from `@uiw/react-codemirror` that pulls colors from our CSS variables (`var(--color-background)`, `var(--color-foreground)`, etc.). This ensures the editor matches dark/light/custom themes automatically. The theme is defined once in `@rioku/ui` and passed to every `<YamlJsonEditor>` instance.

This component is used in all 6 create/detail page contexts: routes, services, policies, users, API keys, and settings.

`FRONTEND ONLY`

### 6.3 Bidirectional code / form sync

Editing in YAML/JSON mode and switching back to form mode **updates the form fields** with the changes. Editing in form mode and switching to YAML/JSON mode **regenerates the code** from the current form state in the selected format.

Implementation: A simple YAML key-value parser and `JSON.parse`/`JSON.stringify` handle the round-trip. The parsers map flat and nested keys to form field paths. They do not need to handle arbitrary structures — only the shapes that match the entity's form schema.

Edge cases:

- If the code contains keys not in the form schema, they are preserved in a `_extra` field and re-emitted when switching back to code mode
- If the code is unparseable (syntax errors), switching to form mode shows a warning and keeps the last valid form state
- Comments in YAML are stripped on round-trip (documented in the UI with a tooltip). JSON does not support comments.
- Switching between YAML and JSON formats preserves all data — it's a pure serialization format change

`FRONTEND ONLY`

### 6.4 Create as full page, not modal

Route/service/policy creation is a full-page workflow (e.g., `/config/routes/create`). Not a modal, not a slide-out. Complex forms need space. Breadcrumbs show: Configuration > Routes > Create route.

A cancel button navigates back to the list. Unsaved changes trigger a confirmation dialog.

## 7. Route Builder

### 7.1 Form mode — sections

**Always visible:**
- Name (text input)
- Enabled (toggle with description)

**Matching rules (expanded by default):**
- Host matchers (dynamic array — add/remove hostnames with wildcard support)
- Path matcher (type selector: prefix/exact/regexp + value input)
- Method filter (multiselect: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)

**Target (expanded by default):**
- Target type (tile selector: Service or Direct upstream)
- Service selector (`SearchableSelect` — shows upstream count and LB policy in option labels)
- Or: direct address input + TLS mode selector (native `<select>`: off, auto, custom)

**Policies (collapsed by default):**
- `SearchableMultiSelect` to attach existing policies (shows policy type badge in options)
- "Create new policy" link that opens policy creation in a new tab/modal

**TLS (collapsed by default):**
- Force HTTPS toggle
- Min TLS version selector (native `<select>`: 1.2, 1.3)
- Client auth / mTLS mode (native `<select>`: off, request, require, require & verify)
- Trust pool CA upload (when mTLS enabled)

**Advanced (collapsed by default):**
- Header matchers (key-value pair editor with invert toggle)
- Query string matchers (key-value pair editor)
- CEL expression (text input with syntax hint)
- NOT matcher (nested matcher wrapper)
- Streaming toggle (flush_interval: -1)
- Priority (number input — lower = higher priority, affects route ordering)
- Labels (key-value pair editor)

**Activity tab:** See Section 12.1.

### 7.2 Missing from current form (being added)

All fields from the compiler hardening proto changes:
- Query matchers, header_regexp, CEL expression, NOT matcher
- Streaming toggle
- TLS per-route settings
- Priority/ordering

`NEEDS BACKEND` — proto fields must land first from the compiler hardening plan.

## 8. Service Builder

### 8.1 Form mode — sections

**Always visible:**
- Name (text input)
- Load balancing policy (native `<select>`: round robin, random, least conn, IP hash, weighted round robin, cookie, URI hash, header)
- When cookie/header LB: cookie name or header name input

**Upstreams (expanded by default):**
- Dynamic array of upstreams, each with:
  - Address (host:port input)
  - Weight (number, shown when weighted round robin selected)
  - TLS mode (native `<select>`: off, auto, custom, internal mTLS)
  - When custom TLS: insecure skip verify toggle, SNI override input
- Add/remove buttons
- Drag-and-drop reordering (via dnd-kit)

**Active health checks (expanded by default):**
- Enabled toggle
- Path (text input)
- Interval (duration input, e.g., "10s")
- Timeout (duration input)
- Healthy threshold (number)
- Unhealthy threshold (number)
- Expected status codes (multiselect or tag input)

**Passive health checks (collapsed by default):**
- Failure window (duration input)
- Max failures in window (number)
- Unhealthy latency threshold (duration input, e.g., "2000ms")
- Unhealthy status codes (tag input)

**Timeouts (collapsed by default):**
- Dial timeout
- Response header timeout
- Idle timeout

**Retries (collapsed by default):**
- Max retry attempts (number)
- Retry on status codes (tag input: 502, 503, 504)

**Connection pool (collapsed by default):**
- Max connections per host
- Max idle connections
- Keep-alive interval

**Labels (collapsed by default):**
- Key-value pair editor

**Activity tab:** See Section 12.1.

## 9. Policy Builder

### 9.1 Type selection

First step in any mode: select the policy type. Types displayed as tiles with icons and descriptions:

| Type | Icon | Description |
|------|------|-------------|
| Rate Limit | gauge | Limit request rate by IP, API key, or agent |
| Auth (JWT) | shield-check | Validate JWT Bearer tokens |
| Auth (API Key) | key | Validate API keys in headers or query |
| CORS | globe | Cross-origin resource sharing rules |
| Circuit Breaker | zap-off | Stop sending to failing upstreams |
| Transform | arrows-up-down | Modify request/response headers and paths |
| Cache | database | Cache upstream responses |
| Retry | refresh-cw | Retry failed upstream requests |

### 9.2 Structured forms (all types)

All policy types now get structured forms (v1 used JSON Schema forms for circuit breaker, cache, retry). The structured forms for the top types remain the same as v1:

**Rate Limit:**
- Requests per window (number + duration selector: per second/minute/hour/day)
- Scope (`SearchableSelect`: per IP, per API key, per agent, per route, global)
- Token-aware toggle (when enabled: input/output/total token limits per window)
- Cost-aware toggle (when enabled: USD budget per day)
- Burst allowance (number — max burst above steady rate)
- Response when limited (native `<select>`: 429 with Retry-After, 503, drop connection)

**Auth JWT:**
- Issuer URL (text input)
- JWKS endpoint (text input, auto-populated from issuer if OIDC)
- Audience (text input)
- Required claims (key-value pair editor)
- Token location (native `<select>`: Authorization header, cookie, query param)
- Clock skew tolerance (duration input)

**Auth API Key:**
- Header name (text input, default: X-API-Key)
- Query parameter name (text input, optional)
- Prefix (text input, e.g., "rku_" — for key format validation)

**CORS:**
- Allowed origins (tag input — specific origins or *)
- Allowed methods (multiselect)
- Allowed headers (tag input)
- Exposed headers (tag input)
- Max age (duration input)
- Allow credentials (toggle)

**Transform:**
- Request header operations (dynamic array: action (native `<select>`: set/add/delete/replace) + header name + value)
- Response header operations (same)
- Path rewrite (strip prefix input, add prefix input)
- Query string operations (add/remove/set key-value pairs)

**Circuit Breaker:**
- Failure threshold (number — consecutive failures before tripping)
- Success threshold (number — consecutive successes to close)
- Timeout (duration — how long to stay open before half-open)
- Max requests in half-open (number)
- Monitored status codes (tag input)

**Cache:**
- Default max age (duration)
- Cacheable status codes (tag input, default: 200, 301, 302)
- Cacheable methods (multiselect, default: GET, HEAD)
- Max body size (number + unit selector: KB/MB)
- Vary headers (tag input)
- Stale-while-revalidate duration (duration)

**Retry:**
- Max attempts (number)
- Retry on status codes (tag input: 502, 503, 504)
- Backoff strategy (native `<select>`: none, constant, exponential)
- Initial backoff interval (duration, when backoff enabled)
- Max backoff interval (duration, when exponential)

### 9.3 YAML/JSON mode

Custom code editor (Section 6.2) with the entity's schema used for validation. YAML/JSON format toggle. Bidirectional sync with form mode (Section 6.3).

**Activity tab:** See Section 12.1.

## 10. Settings (multi-page)

Replace the single settings page with a dedicated settings section using its own sub-navigation. Each settings area is a full page. Accessed via the user menu popup (Section 3.4), not the sidebar.

### 10.1 Settings navigation

Settings gets its own layout with a left sub-nav (inside the main content area, not the sidebar):

```
Settings
├── General
├── Network
├── TLS & Certificates
├── Observability
├── Config Store
├── Authentication
├── PKI
└── Danger Zone
```

### 10.2 General settings

- Instance name (text input)
- Data directory (read-only display)
- Log level (native `<select>`: debug, info, warn, error)
- Daemon version, Caddy version (read-only)

`FRONTEND ONLY` — reads from existing config endpoint.

### 10.3 Network settings

- Trusted proxies (dynamic CIDR range list with add/remove)
- Client IP headers (tag input: X-Forwarded-For, X-Real-IP)
- Strict mode toggle
- Listening addresses (read-only display: gRPC, REST, Caddy HTTP/HTTPS, admin)

`FRONTEND ONLY`

### 10.4 TLS & Certificates

- ACME provider selector (native `<select>`: Let's Encrypt, ZeroSSL)
- DNS challenge provider selector (native `<select>`: None, Cloudflare, Route53, Google Cloud, Azure, DigitalOcean) with API credential inputs per provider
- On-demand TLS toggle with rate limit config (interval, burst)
- Default min TLS version (native `<select>`: 1.2, 1.3)
- Active certificates table (domain, issuer, expiry, status, actions: force renew, revoke)
- Certificate detail view (click a cert to see chain, SANs, fingerprint)

`NEEDS BACKEND` — certificate listing and management endpoints not yet implemented.

### 10.5 Observability

- Trace sampling rate (slider 1-100%)
- Always-trace toggles (errors, AI requests, slow requests)
- Slow request threshold (ms input)
- Trace retention settings (raw traces, aggregated stats, AI sessions — each with duration selector)
- Trace storage backend (read-only: SQLite/ClickHouse/Postgres)
- Storage usage (progress bar: current size / max size)
- Backup configuration (destination URL, status indicator)
- PII log filters section:
  - IP masking toggle + prefix length config
  - Query parameter redaction (tag input)
  - Cookie redaction (tag input)
  - Custom regex patterns (dynamic array)
- Prometheus endpoint toggle and status
- OpenTelemetry exporter endpoint config

`NEEDS BACKEND` — PII filter config and trace retention settings need new endpoints.

### 10.6 Config store

- Backend type (read-only: SQLite, Postgres, MySQL, Raft)
- Connection info (read-only, sensitive values masked)
- Current config version
- Store health status
- Migration history
- Export config button (downloads config bundle)
- Import config button (upload with dry-run validation)

`NEEDS BACKEND` — export/import endpoints not yet implemented.

### 10.7 Authentication

- Session settings (cookie lifetime, idle timeout, max concurrent sessions)
- Password policy (min length, require uppercase/lowercase/number/special, max age)
- Account lockout (max attempts, lockout duration, reset window)
- TOTP 2FA settings (issuer name, enforce for all users toggle)
- Brute-force protection (rate limit config)

`NEEDS BACKEND` — auth policy configuration not yet exposed via API.

> **Note:** This page covers local authentication settings only. Third-party SSO provider management (OIDC, SAML, OAuth2, LDAP) is a separate feature requiring its own design spec — see the design gap note in Section 11.2. When that spec is implemented, this settings page gains additional sub-sections for provider configuration, group mapping, and JIT provisioning settings.

### 10.8 PKI (internal)

- CA status (algorithm, validity, expiry, fingerprint)
- Node certificate status (expiry, SANs, auto-rotation threshold)
- DB client certificate status
- Rotation history
- Force rotation button (with confirmation dialog)
- CA certificate download (for trust distribution)

`NEEDS BACKEND` — PKI status and rotation endpoints not yet implemented.

### 10.9 Danger zone

- Reset all configuration (with double confirmation)
- Rotate bootstrap token
- Purge all traces
- Factory reset

Red-bordered section. Every action requires typing a confirmation phrase.

`NEEDS BACKEND` — most danger zone actions need dedicated endpoints.

## 11. Security & RBAC

### 11.1 Users page — table

Full-page user list with:
- Data table (first name, last name, username, email, roles (badges), status, last login, MFA status, created)
- Faceted filtering (by role, status, MFA)
- Click username → full-page detail view (replaces the table — see Section 11.2)

`FRONTEND ONLY` — user list endpoint exists.

### 11.2 User detail view

Clicking a user in the table navigates to a **full-page detail view** that replaces the table (consistent with the detail view pattern in Section 5.1). Layout:

**Identity card (left, main column):**
All user fields, editable inline:
- First name (text input)
- Last name (text input)
- Username (text input, editable — validated for uniqueness on blur)
- Email (text input)
- Title (text input)
- Department (text input)
- Phone (text input)
- Timezone (`SearchableSelect` — full timezone list)
- Locale (`SearchableSelect` — language/region list)
- SSO provider (text input, read-only if set)
- SSO subject (text input, read-only if set)

`NEEDS BACKEND` — user model must be expanded with title, department, phone, timezone, locale, SSO fields. Requires proto changes and migration.

> **Design gap: Third-party authentication integration.** The SSO fields above are placeholders for a much larger feature surface that needs its own dedicated design spec. This includes:
>
> - **Basic SSO providers:** OIDC (Okta, Auth0, Keycloak), SAML 2.0 (Azure AD, Google Workspace), LDAP/Active Directory
> - **Advanced SSO:** OAuth2 flows (authorization code, client credentials, device flow), MCP authentication for agent identity, custom provider plugins
> - **Provider management UI:** Add/configure/test providers, provider-specific settings (tenant ID, client ID/secret, JWKS URL, group claim mapping)
> - **Group/role mapping:** Map external IdP groups to Rioku roles automatically (e.g., "okta:admins" → Rioku Admin role)
> - **JIT (just-in-time) provisioning:** Auto-create Rioku users on first SSO login with mapped roles
> - **Session management:** SSO session lifetime vs. Rioku session, single logout (SLO), forced re-authentication for sensitive operations
> - **Multi-provider:** Support multiple SSO providers simultaneously (e.g., OIDC for employees, API key for CI bots, OAuth2 for partner integrations)
>
> This is out of scope for this spec. It requires a separate design cycle: `YYYY-MM-DD-authentication-providers-design.md`. The current spec only provides the user model fields (`ssoProvider`, `ssoSubject`) and the UI patterns (read-only when SSO-managed, SSO info block on user detail) as extension points for that future work.

**Roles card (below identity):**
- `SearchableMultiSelect` component listing all available roles
- Selected roles shown as removable badges
- Changing role selection immediately recalculates the Effective Permissions panel (Section 11.6)
- Roles are ordered by hierarchy level (highest first)

`NEEDS BACKEND` — multi-role assignment requires backend schema change (current model is single-role).

**Effective Permissions panel (below roles):**
See Section 11.6. Collapsed by default. Expands to show the computed permission matrix based on current role assignments and active access policies.

**Security card (below effective permissions):**
Split into two columns:

Left column — Account security:
- Password: "Change password" button (opens inline form with current + new + confirm)
- MFA status: enabled/disabled badge with enable/disable button
- Account status: active/suspended/locked with toggle

Right column — Active sessions:
- List of active sessions (browser/device, IP, last active, created)
- "Revoke" button per session
- "Revoke all other sessions" button

**Metadata sidebar (right column):**
- Created date
- Last modified date
- Last login date + IP
- Login count
- Account ID (monospace, copyable)

**Danger zone (bottom):**
- Delete user button (red, with confirmation dialog requiring typed username)

`FRONTEND ONLY` for password, MFA, sessions (endpoints exist). `NEEDS BACKEND` for expanded user model fields.

### 11.3 Roles page — redesigned RBAC model

The v1 checkbox matrix has been completely replaced. The new RBAC model:

**Core concepts:**
- Users can have **multiple roles** (not a single role)
- Roles form a **hierarchy with multiple inheritance** (directed acyclic graph / DAG, not a simple tree)
- A role inherits all permissions from its parent roles
- Each role has **granular permission rules** (not just resource-level checkboxes)

**Role list table:**
- Columns: name, description, member count, parent roles, built-in badge
- Click role name → full-page role detail view

**Role detail view — tabs:**

**Permissions tab:**
Each role has an ordered list of permission rules. Each rule has:
- **Resource** (`SearchableSelect`): routes, services, policies, keys, users, roles, settings, cluster, plugins, audit, traffic, certificates
- **Actions** (multiselect checkboxes): view, create, update, delete, manage (varies by resource)
- **Scope** (native `<select>`):
  - `all` — applies to all instances of the resource
  - `owned` — only resources created by this user
  - `labeled` — resources matching specific labels → `scopeValue` is a label key-value input
  - `specific` — a specific resource instance → `scopeValue` is a `SearchableSelect` for the resource
- **Scope value** (conditional — only shown for `labeled` and `specific` scopes)
- **Effect** (native `<select>`): `allow` or `deny`

Rules are displayed as a list of cards. Add rule button appends a new blank rule. Rules can be reordered (drag) and deleted (X button).

**Deny rules take precedence** when a user has multiple roles with conflicting permissions.

**Hierarchy tab:**
- Visual display of this role's position in the role DAG
- Parent roles: `SearchableMultiSelect` to assign parent roles
- Child roles: read-only list of roles that inherit from this one
- **Drag-and-drop role reordering** (via dnd-kit) with visual hints:
  - Dragging over the **top half** of a role = sibling (same level)
  - Dragging over the **bottom half** of a role = child (becomes a child of that role)
  - Visual indicator (blue line for sibling, indented blue line for child) during drag

**Members tab:**
- List of users assigned to this role
- `SearchableMultiSelect` to add/remove users

**Built-in roles** (non-deletable, non-editable permissions):
- `super-admin` — full access to everything
- `admin` — full access except danger zone and PKI
- `operator` — read/write on config and traffic, read on security
- `viewer` — read-only on everything
- `developer` — read on routes/services/policies, view own traffic

Custom roles can be created that inherit from built-in roles and add/restrict permissions.

`NEEDS BACKEND` — the entire RBAC model needs backend implementation: multi-role assignment, role hierarchy (DAG), granular permission rules with resource/actions/scope/effect. This is a significant backend effort requiring proto definitions, database schema, and enforcement middleware. Create GitHub issue.

### 11.4 Access policies page (new)

A new page under SECURITY for **conditional access rules** — rules that apply additional conditions beyond basic role permissions.

**Access policy list table:**
- Columns: name, target (roles/users), conditions summary, effect, priority, enabled status
- Click name → full-page detail view

**Access policy detail / create form:**

Each access policy has:
- **Name** (text input)
- **Description** (text input)
- **Effect** (native `<select>`): `allow` or `deny`
- **Target** (who this policy applies to):
  - Target type (native `<select>`): `roles` or `users`
  - Target value: `SearchableMultiSelect` for roles or users
- **Conditions** (array of condition rules, all must be true for policy to fire):
  - Condition type (native `<select>`): `time`, `ip`, `mfa`, `geo`, `device`, `custom`
  - Per type:
    - `time`: start time, end time, days of week (multiselect: Mon-Sun), timezone (`SearchableSelect`)
    - `ip`: CIDR ranges (tag input), negate toggle
    - `mfa`: required (boolean — user must have MFA enabled)
    - `geo`: country codes (tag input), negate toggle
    - `device`: allowed user agents (tag input, regex)
    - `custom`: CEL expression (text input with syntax hint)
- **Priority** (number — lower number = evaluated first, higher priority)
- **Enabled** (toggle)

Access policies are evaluated after role permissions. They can further restrict or allow access based on contextual conditions. Example use cases:
- Deny all access outside business hours for the `developer` role
- Require MFA for any user accessing the `settings` resource
- Allow access only from specific IP ranges for the `admin` role
- Deny access from specific countries

**Priority ordering:** Policies are evaluated in priority order (lowest number first). The first matching policy's effect is applied. If no policy matches, the default role permissions stand.

`NEEDS BACKEND` — access policies are a new concept requiring proto definitions, database schema, policy storage, and evaluation engine. Create GitHub issue.

### 11.5 API Keys page

**Key list table:**
- Columns: name, key prefix (e.g., `rku_abc...`), scopes summary, created, expires, last used, status
- Click name → full-page detail view (replaces table)

**API key detail view — tabs:**

**Details tab:**
- Name (editable text input)
- Description (editable text area)
- Key prefix (read-only, monospace)
- Created date (read-only)
- Expires date (read-only)
- Last used (read-only)
- Scopes section:
  - List of current scopes as removable badges
  - `SearchableMultiSelect` to add new scopes
  - Each scope shows: resource type + specific resource name (or "all")
  - "Add scope" and "Remove scope" actions with immediate visual feedback

**Usage tab:**
- Stats cards: total requests (24h, 7d, 30d)
- Scope breakdown: bar chart showing request count per scope
- Recent requests table: timestamp, method, path, status, latency (last 50 requests)

**Activity tab:** See Section 12.1 — shows timestamped history of changes to this key.

**Key creation flow:**
1. Name (text input)
2. Description (text area)
3. Expiry (native `<select>`: 30d, 90d, 1y, never)
4. Scopes (`SearchableMultiSelect` — which routes/services this key can access)
5. Create button
6. Generated key shown ONCE in a modal with:
   - Full key displayed in monospace with copy button
   - Warning: "This key will not be shown again. Copy it now."
   - "I've copied the key" confirmation button to dismiss

`FRONTEND ONLY` for key CRUD (endpoints exist). `NEEDS BACKEND` for usage stats and recent requests on the Usage tab.

### 11.6 Effective permissions panel

A collapsible panel that appears on the **user detail view** (Section 11.2) below the roles card. When expanded, it shows:

**Computed permission matrix:**
- Rows: all resources (routes, services, policies, keys, users, roles, settings, cluster, plugins, audit, traffic, certificates)
- Columns: all actions (view, create, update, delete, manage)
- Cells: green checkmark (allowed), red X (denied), gray dash (no rule — denied by default)
- Each cell shows which role or access policy granted/denied the permission on hover (tooltip)

**How it's computed:**
1. Start with no permissions (deny-by-default)
2. Walk the role hierarchy for all assigned roles, collecting permission rules
3. Apply role permission rules (allow rules grant, deny rules remove)
4. Apply access policies in priority order (matching policies override)
5. Display the final computed state

**Live recalculation:** Changing the user's role assignments in the roles card immediately recalculates the effective permissions panel without saving. This lets administrators preview the effect of role changes before committing.

**Default state:** Collapsed. The panel header shows a summary: "X permissions across Y resources" to give a quick sense without expanding.

`FRONTEND ONLY` — computation happens client-side from role and policy data already loaded. The backend does the authoritative computation; this is a preview.

### 11.7 Profile page

The current user's own profile page (accessed via sidebar user menu > Profile). Same layout as the user detail view (Section 11.2) but:
- Only shows the current user's data
- Roles and effective permissions are read-only (users cannot change their own roles)
- Security card allows password change and MFA management
- No danger zone (users cannot delete themselves)

**Additional profile-only settings:**

**Accessibility section (new — see Section 15.4):**
- Color Vision selector (native `<select>`): none, deuteranopia, protanopia, tritanopia, achromatopsia
- High Contrast toggle
- Reduced Motion toggle

All accessibility preferences are persisted to localStorage and applied immediately.

**Appearance section:**
- Theme selector (native `<select>`): dark, light, system

`FRONTEND ONLY`

### 11.8 Audit log page

Global audit log with:
- Data table: timestamp, user, action, resource type, resource name, detail, IP address
- Faceted filtering: by user, action type, resource type, date range
- Click row → expanded detail view showing full before/after diff (inline, not full-page)
- Export button (CSV download)
- Retention info display

`FRONTEND ONLY` — audit log endpoint exists.

## 12. Activity Logs & Entity History

### 12.1 Activity tab on all entities

Routes, services, policies, users, and API keys all have an **Activity tab** in their detail view. This tab shows a timestamped change history specific to that entity.

**Activity entry format:**
Each entry is a row with:
- **Colored dot** (left side) indicating the change type:
  - Green: created
  - Blue: updated
  - Amber: configuration changed
  - Red: deleted / disabled
  - Gray: viewed / accessed
- **Timestamp** (relative: "2 hours ago", absolute on hover)
- **Action description** (e.g., "Updated route matching rules")
- **User** who performed the action (avatar + name, clickable to user detail)
- **Detail** (expandable — shows what specifically changed, e.g., "Added host matcher: api.example.com")

**Differences from the global Audit Log:**
- The Activity tab is scoped to a single entity
- It shows a more detailed, human-readable change description
- It includes the colored visual indicators
- The global Audit Log (Section 11.8) shows everything across all entities

`NEEDS BACKEND` — entity-level change history requires the backend to store per-entity audit trails with structured change data. The global audit log exists but per-entity filtering and detailed change descriptions need work. Create GitHub issue.

## 13. Infrastructure Pages

### 13.1 Cluster

- Node list table (name, address, role, state, health, Caddy version, last seen)
- Node detail view (click node → full stats, cert status, sync state)
- Cluster topology visualization (future — use reactflow if implemented)

`NEEDS BACKEND` — cluster API endpoints are defined in proto but not implemented.

### 13.2 Certificates

Dedicated cert management page (not just a settings tab):
- Active certificates table with filtering
- Certificate detail view (chain, SANs, fingerprint, OCSP status)
- Force renewal action
- Revocation action
- ACME challenge history / errors

`NEEDS BACKEND` — certificate management endpoints not yet implemented.

### 13.3 Plugins

**Installed plugins grid:**
- Card layout with name, type badge, status toggle, version
- Plugin detail page (click card → full page with config editor, dependent routes, status history)

**Plugin-provided admin pages (new in v2):**

Plugins can register admin panel pages that appear in the sidebar navigation. When a plugin provides admin pages:
- A sub-item appears under INFRASTRUCTURE > Plugins in the sidebar (e.g., "AI Dashboard" for the `rioku-ai-dashboard` plugin)
- The page is rendered within the admin panel's layout shell (sidebar, top bar, breadcrumbs)
- When the plugin is disabled/uninstalled, the sidebar item disappears
- Navigating to a disabled plugin's page URL shows a **404 page** with a message: "This page is provided by the [plugin name] plugin, which is currently disabled."

**Sample plugin:** `rioku-ai-dashboard` — demonstrates a plugin-provided admin page with custom AI-specific visualizations. This appears in the sidebar when the plugin is enabled and disappears when disabled.

**Plugin page registration** (design-level — implementation TBD):
```typescript
// Plugin manifest declares admin pages
{
  "name": "rioku-ai-dashboard",
  "adminPages": [
    {
      "path": "/plugins/ai-dashboard",
      "title": "AI Dashboard",
      "icon": "brain",
      "sidebarSection": "INFRASTRUCTURE"
    }
  ]
}
```

`NEEDS BACKEND` — plugin system including admin page registration is not yet implemented. The frontend can scaffold the routing and sidebar integration. Create GitHub issue.

## 14. Traffic & Observability

### 14.1 Live traffic view

Real-time request stream powered by SSE. Changes from current:
- **Click a row to see trace detail** — slide-out panel (this is the one case where a slide-out works, because you want to keep the stream visible)
- Trace detail shows: full request metadata, response status/timing, upstream address, policy decisions (which policies fired, pass/fail), OTEL trace ID (clickable link to external trace viewer if configured)
- Pause/resume button that buffers events without losing them
- Filtered stream (by route, status, method, latency threshold)

`FRONTEND ONLY` — SSE endpoint exists.

### 14.2 Analytics dashboard

Uses the shared time range selector (Section 3.5).

**Charts (all updated per mockup review):**

All charts must show **both axes** (x-axis with time labels, y-axis with value labels). No axis-less sparklines.

**Timezone caption:** Every chart with time on the x-axis includes a small caption below: "Times shown in UTC" (or the user's configured timezone).

- **Request rate** (area chart): x=time, y=requests/sec. Single series, primary color fill.
- **Error rate** (stacked bar chart — changed from area chart in v1):
  - Each bar is a time bucket
  - Stacked segments for error types: 4xx (amber), 502 (red), 503 (orange), 429 (purple), other 5xx (dark red)
  - Legend showing all error types with their colors
  - Custom tooltip on hover showing all values with colored dots per type
- **Latency percentiles** (line chart): x=time, y=ms. Three overlaid lines: p50 (blue), p95 (amber), p99 (red). Legend at top.
- **Top routes by traffic** (horizontal bar chart): y=route names, x=request count. Top 10 routes.
- **Status code distribution** (donut chart): 2xx (green), 3xx (blue), 4xx (amber), 5xx (red).
- Per-route drilldown (click a route in the bar chart → filtered analytics for that route)

**Chart tooltips** (applies to all charts with multiple series):
- Custom tooltip component (not browser default)
- Shows all data values for the hovered time point
- Each value prefixed with a colored dot matching the series color
- Bold the series with the highest value

**Legends** on all multi-series charts. Position: top of chart, horizontal layout, wrapping.

`FRONTEND ONLY` — TrafficService stats endpoints exist. Chart rendering is pure frontend.

### 14.3 AI workloads

Uses the shared time range selector (Section 3.5).

- Token usage over time (area chart: input vs output tokens, both axes, timezone caption)
- Cost over time (area chart: USD, both axes, timezone caption)
- Model breakdown table (provider, model, requests, tokens, cost)
- Active agent sessions table (session ID, agent, turns, tokens, cost, status)
- Click session → session detail with turn-by-turn trace timeline

`FRONTEND ONLY` for charts and tables. `NEEDS BACKEND` for session detail view.

### 14.4 Trace detail view

When clicking any trace (from live view, analytics, or AI workloads):
- **Request** — method, path, host, headers (collapsible), query params, body preview (if stored)
- **Response** — status, headers (collapsible), body preview (if stored), size
- **Timing** — total duration, upstream duration, overhead calculation
- **Routing** — which route matched, which service, which upstream handled it
- **Policies** — which policies were evaluated, pass/fail for each, rate limit remaining if applicable
- **Identity** — actor type (API key / agent / anonymous), actor ID, session ID
- **AI fields** (if present) — provider, model, tokens (input/output/cache), cost estimate, finish reason, tool calls
- **OTEL** — trace ID, span ID, link to external trace viewer

`FRONTEND ONLY` — trace data comes from existing TrafficService endpoints.

## 15. Accessibility

### 15.1 Keyboard navigation

All interactive elements reachable via Tab. Focus rings visible in both themes. Command palette (Cmd+K) as the keyboard-first navigation path. Escape closes any modal/panel/drawer.

`FRONTEND ONLY`

### 15.2 Screen readers

All form fields have labels (no placeholder-only inputs). Status indicators have aria-labels. Tables have proper header associations. Toast notifications are aria-live regions.

`FRONTEND ONLY`

### 15.3 Color independence

Status indicators use icons + text, not color alone. Red/green is supplemented with shapes (checkmark, X, warning triangle). Meets WCAG 2.1 AA contrast ratios in both themes.

`FRONTEND ONLY`

### 15.4 Colorblind accessibility (new in v2)

The profile page (Section 11.7) includes a **Color Vision** selector with the following options:
- **None** (default) — no filter applied
- **Deuteranopia** — green-blind compensation
- **Protanopia** — red-blind compensation
- **Tritanopia** — blue-blind compensation
- **Achromatopsia** — total color blindness compensation

**Implementation:** SVG `feColorMatrix` filters applied to the root element. Each mode has a predefined color matrix that shifts the palette to be distinguishable for that vision type. The filter does not replace the theme — it transforms the existing theme colors.

Additionally:
- **High Contrast toggle** — increases contrast ratios beyond AA to AAA levels, thickens borders, increases font weight
- **Reduced Motion toggle** — disables all CSS transitions and animations (`prefers-reduced-motion: reduce`)

All three settings are persisted to **localStorage** and applied on page load before first paint (to avoid a flash of unfiltered content).

`FRONTEND ONLY`

## 16. Toast Notification System

### 16.1 Toast utility

A pub/sub toast system used across all pages for action feedback. Built on sonner (already installed).

**Toast types and styling:**
- **Success** (green left border): used after save, create, enable actions
- **Error** (red left border): used after failed saves, validation errors, server errors
- **Info** (blue left border): used for informational messages (e.g., "Settings exported")

**Behavior:**
- Auto-dismiss after 5 seconds (configurable per toast)
- Manual dismiss via X button
- Stack from bottom-right, max 3 visible at once
- Oldest toast dismissed when limit exceeded
- Action button support (e.g., "Undo" on delete toast)

**Usage across the app** — every mutation action produces a toast:
- Creating an entity: success toast with entity name
- Saving changes: success toast "Changes saved"
- Deleting an entity: success toast "Deleted [name]" with undo action
- Toggle enable/disable: success toast "[name] enabled/disabled"
- Validation failure: error toast with summary
- Server error: error toast with status code and message
- Copy to clipboard: info toast "Copied to clipboard"

`FRONTEND ONLY`

## 17. Themed Checkboxes

All checkboxes throughout the admin panel use custom CSS styling instead of browser defaults:

- **Unchecked state:** dark background (`--color-bg-input`), subtle border (`--color-border-default`), rounded corners
- **Checked state:** primary color background (`--color-primary`), white checkmark icon (CSS `::after` pseudo-element or inline SVG)
- **Hover state:** border color brightens
- **Disabled state:** reduced opacity, no hover effect
- **Focus state:** focus ring matching the global focus ring style

This applies to: table row selection checkboxes, bulk action checkboxes, permission matrix checkboxes, toggle-style checkboxes in forms, and the select-all header checkbox.

`FRONTEND ONLY`

## 17B. Component API Design Philosophy

### 17B.1 Every component is a public API

Every UI component we build — DataTable, SearchableSelect, YamlJsonEditor, FormSection, StatusBadge, StatCard, PageHeader, toast system, etc. — **must be designed as if it will be used by third-party plugin developers.** This is not aspirational; it is a requirement.

Plugin developers building admin pages (Section 13.3) need access to the same component library we use internally. If our components are tightly coupled to internal state, have hardcoded assumptions about our data shapes, or require importing from deep internal paths, they are unusable by plugins.

**This means:**

1. **Stable, documented props API.** Every component has a clear TypeScript interface. Props are the contract — changing them is a breaking change. No `any` types on public-facing props.

2. **No internal dependencies.** Components must not import from route files, page files, or internal state stores. They receive everything they need via props. A `DataTable` takes `columns` and `data`, not `useRouteQuery()` internally.

3. **Composable, not monolithic.** Prefer small components that compose over large components that configure. A plugin developer should be able to use `SearchableSelect` without also pulling in `FormSection`. Each component works standalone.

4. **Consistent patterns.** If `DataTable` takes an `onRowClick` callback, `SearchableSelect` takes an `onChange` callback, and `FormToggle` takes an `onChange` callback — they should all follow the same naming and behavior patterns. Don't surprise developers.

5. **Theme-aware via CSS variables.** Components must use the CSS variable system (Section 2.2), never hardcoded colors. If a plugin developer's admin page uses our components, they automatically inherit whatever theme (including custom themes) the user has configured.

6. **Accessible by default.** Every component we ship meets the accessibility requirements in Sections 15 and 18B without the plugin developer needing to do extra work. Focus management, aria attributes, keyboard navigation, screen reader support — baked in, not opt-in.

### 17B.2 Component export structure

All reusable components live in `packages/web/src/components/ui/` (shadcn primitives) and `packages/web/src/components/rioku/` (Rioku-specific). The `rioku/` directory is the public component library for plugin developers.

Export convention:

```
packages/web/src/components/rioku/
├── data-table.tsx           # DataTable, Column type
├── searchable-select.tsx    # SearchableSelect, SearchableMultiSelect
├── yaml-json-editor.tsx     # YamlJsonEditor
├── form-section.tsx         # FormSection, FormField, FormInput, FormSelect, FormToggle, TagInput
├── stat-card.tsx            # StatCard
├── status-badge.tsx         # StatusBadge
├── page-header.tsx          # PageHeader
├── time-range-selector.tsx  # TimeRangeSelector
├── confirm-dialog.tsx       # ConfirmDialog
├── empty-state.tsx          # EmptyState
└── index.ts                 # Re-exports everything
```

Plugin developers import from a single entry point:

```typescript
import { DataTable, SearchableSelect, StatusBadge, StatCard } from "@rioku/components"
```

The `@rioku/components` alias resolves to `packages/web/src/components/rioku/index.ts`. This path is stable and documented. Internal components that are NOT part of the public API live elsewhere (e.g., layout components in `components/layout/`).

### 17B.3 Versioning and stability

Since plugins depend on our component APIs:

- **Breaking changes to component props require a major version bump** of the admin panel. Plugin developers must know when they need to update.
- **New optional props are non-breaking** — existing plugins continue to work.
- **Deprecate before removing.** If a prop needs to go, mark it `@deprecated` for one release cycle before removing.
- **Document each component.** Every component in `rioku/` gets a JSDoc header describing its purpose, props, and basic usage example. This is the minimum — we may eventually build a Storybook or similar component browser, but JSDoc is the baseline.

### 17B.4 Design system: `packages/ui/` (`@rioku/ui`)

The reusable component library lives in its own package in the monorepo: `packages/ui/`. This is the Rioku design system. It is built as part of Phase 1.

**Package structure:**

```
packages/ui/
├── package.json              # @rioku/ui, exports components + theme tokens
├── tsconfig.json
├── src/
│   ├── components/
│   │   ├── data-table.tsx
│   │   ├── searchable-select.tsx
│   │   ├── yaml-json-editor.tsx
│   │   ├── form-section.tsx
│   │   ├── stat-card.tsx
│   │   ├── status-badge.tsx
│   │   ├── page-header.tsx
│   │   ├── time-range-selector.tsx
│   │   ├── confirm-dialog.tsx
│   │   ├── empty-state.tsx
│   │   └── index.ts          # Re-exports all components
│   ├── theme/
│   │   ├── tokens.css         # CSS variables (dark + light + high-contrast)
│   │   ├── tokens.json        # Machine-readable theme token schema
│   │   └── index.ts           # Theme utilities (useTheme, ThemeProvider)
│   ├── hooks/
│   │   ├── use-toast.ts       # Toast pub/sub hook
│   │   └── index.ts
│   └── index.ts               # Package entry: components + theme + hooks
├── .storybook/
│   ├── main.ts                # Storybook config (Vite builder)
│   └── preview.ts             # Global decorators (ThemeProvider, dark mode)
└── stories/
    ├── DataTable.stories.tsx
    ├── SearchableSelect.stories.tsx
    ├── StatusBadge.stories.tsx
    ├── StatCard.stories.tsx
    ├── FormSection.stories.tsx
    ├── YamlJsonEditor.stories.tsx
    └── ...                    # One story file per component
```

**Design principles (non-negotiable):**

- Components use **CSS variables** for all theme colors — never hardcoded hex, never Tailwind color classes. Tailwind utilities are fine for spacing, layout, border-radius, etc.
- Components have **zero app-level dependencies** — no React Router, no TanStack Query, no i18next. They receive everything via props.
- Components are **composable** — each works standalone. `SearchableSelect` doesn't require `FormSection`. `StatusBadge` doesn't require `DataTable`.
- Components are **accessible by default** — focus management, aria attributes, keyboard navigation, screen reader support baked in.
- **TypeScript-first** — all props have explicit interfaces with JSDoc descriptions. No `any` on public APIs.

**How `packages/web/` consumes it:**

```typescript
// packages/web/ imports from the workspace package
import { DataTable, SearchableSelect, StatusBadge } from "@rioku/ui"
import { useToast, ThemeProvider } from "@rioku/ui"
import "@rioku/ui/theme/tokens.css"
```

The `packages/web/package.json` declares `"@rioku/ui": "workspace:*"` as a dependency. In the Go embed build, the `ui` package is built first and its output is consumed by `web/`.

**How plugin developers consume it:**

```typescript
// Plugin developers import the same way
import { DataTable, StatCard, FormSection } from "@rioku/ui"
```

Plugins built against `@rioku/ui` are guaranteed visual and behavioral consistency with the core admin panel. Theme changes (dark/light/custom/colorblind) automatically propagate to plugin pages.

**Storybook:**

Each component gets a Storybook story file showing:
- Default state
- All major prop variations
- Dark and light theme
- Interactive props controls (args)
- Usage code snippet

Storybook runs via `make ui-storybook` and is available at `localhost:6006`. It is the component documentation for both the team and plugin developers.

**Versioning:**

- `@rioku/ui` follows semver independently from the daemon version
- Breaking changes to component props = major version bump
- New optional props = minor version bump
- Plugin SDK documentation specifies which `@rioku/ui` version each daemon version is compatible with

`FRONTEND ONLY`

## 18. Quality of Life

### 18.1 Unsaved changes warning

Navigating away from a dirty form (any field changed from its saved state) triggers a browser-level `beforeunload` warning AND an in-app confirmation dialog ("You have unsaved changes. Discard or stay?"). Applies to: all create forms, all inline edit modes, all settings pages, YAML editor, profile page.

Track dirty state via a `useDirtyForm(initialValues, currentValues)` hook that compares shallow equality. The confirmation dialog is a shared component, not a browser native `confirm()`.

`FRONTEND ONLY`

### 18.2 Session timeout warning

Display a countdown modal 60 seconds before the auth session expires: "Your session expires in X seconds" with "Extend session" and "Log out" buttons. Extending calls the `/auth/refresh` endpoint (if available) or redirects to login.

If no interaction for the full timeout, redirect to login with a flash message "Session expired — please log in again" and preserve the current URL as a `?redirect=` param so the user lands back where they were.

`NEEDS BACKEND` — requires session expiry info in the `/auth/me` response

### 18.3 Auto-save drafts

Complex create/edit forms auto-save to localStorage every 10 seconds while dirty. Key format: `rioku-draft:{entity}:{id|create}`. On returning to the form, if a draft exists newer than the last save, show a prompt: "You have an unsaved draft from [timestamp]. Restore or discard?"

Drafts are cleared on successful save or explicit discard. Maximum 10 drafts stored; oldest evicted when limit exceeded.

`FRONTEND ONLY`

### 18.4 Diff view before save

When editing an entity (route, service, policy, settings), the Save button first shows a "Review changes" panel that displays:
- Changed fields highlighted (old value → new value)
- Added/removed items (e.g., new upstream, detached policy)
- YAML diff view (for complex changes)

The user confirms "Apply changes" or goes back to continue editing. This is critical for config changes that affect live traffic — operators need to verify what they're about to push.

`FRONTEND ONLY`

### 18.5 Deep linking to tabs

All tabbed views include the active tab in the URL: `/config/routes/payments-api?tab=policies`, `/settings?tab=network`, `/security/users?tab=roles`. Sharing a URL opens the correct tab. Tab changes update the URL via `useSearchParams()` without a full navigation.

`FRONTEND ONLY`

### 18.6 Table state in URL

DataTable sort column, sort direction, active filters, page number, search query, and page size are all reflected in URL query params. Example: `/config/routes?sort=name&dir=asc&status=active&page=2&q=payments`. This makes filtered/sorted views shareable and bookmarkable.

Uses `useSearchParams()` for state management. Table state is initialized from URL on mount and synced bidirectionally.

`FRONTEND ONLY`

### 18.7 Loading skeletons

Every page that fetches data shows a shimmer placeholder matching the layout shape while loading:
- **Stat cards**: gray pulsing rectangles matching card dimensions
- **Tables**: gray rows with column-width blocks
- **Charts**: gray rounded rectangles matching chart container size
- **Detail views**: card outlines with shimmer blocks for key-value pairs
- **Forms**: input-shaped shimmer blocks

Use a shared `<Skeleton>` component (shadcn/ui already has one). Never show a blank page or a spinner-only state.

`FRONTEND ONLY`

### 18.8 Error boundaries

Each major section of a page is wrapped in a React error boundary that catches render errors and displays "Something went wrong" with a "Retry" button, without crashing the entire page.

Granularity: one boundary per card/section, not one per page. A failing chart shouldn't take down the stat cards next to it.

`FRONTEND ONLY`

### 18.9 Connection lost indicator

If the daemon API becomes unreachable (fetch fails with network error, SSE stream disconnects), show a persistent banner at the top of the content area: "Connection lost — retrying..." with an auto-reconnect spinner.

SSE streams (live traffic) should automatically reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s). REST calls should retry 2-3 times before showing an error toast.

On reconnection, the banner dismisses and a brief "Reconnected" success toast appears. All stale queries are refetched.

`FRONTEND ONLY` — relies on existing API, just needs client-side retry/reconnect logic

### 18.10 Recently viewed

A "Recent" section in the command palette (Cmd+K) showing the last 10 entities the user visited: route detail, service detail, policy detail, user detail, API key detail, settings page.

Stored in localStorage as `rioku-recent: [{type, id, name, path, timestamp}]`. Updated on every detail page visit. Capped at 10, oldest evicted.

Also available as a small expandable section at the top of each list page: "Recently viewed: [payments-api] [auth-svc] [jwt-auth]" as clickable chips.

`FRONTEND ONLY`

### 18.11 Command palette entity search

The Cmd+K command palette (Section 3.3) must search across all entities, not just navigation:
- **Routes** — by name, host, path
- **Services** — by name
- **Policies** — by name, type
- **Users** — by username, first/last name, email
- **API Keys** — by name, prefix
- **Settings sections** — by section name

Results are grouped by entity type with type badges. Selecting a result navigates to the detail page. The search is client-side against cached data (TanStack Query cache), not a server-side search endpoint.

`FRONTEND ONLY` — but quality depends on having entity data cached

### 18.12 Bulk import/export

Every list page (routes, services, policies) has an "Import" and "Export" button in the page header dropdown menu:
- **Export**: downloads all visible (filtered) entities as a YAML or JSON file
- **Import**: file upload dialog, validates the file structure, shows a preview of what will be created/updated, then applies on confirmation

Individual entity detail pages have a "Copy as YAML" button that copies the entity config to clipboard.

`NEEDS BACKEND` — import requires batch create/update API endpoints

### 18.13 Inline form validation

All form fields show validation errors inline (red border + error message below the field), not just via toast after submit. Validation runs on blur for individual fields and on submit for the full form.

Validation rules are defined as Zod schemas that drive both client-side validation and error display. Error messages are user-friendly (not raw Zod messages).

Required fields are marked with a red asterisk. Fields in error state have `aria-invalid="true"` and `aria-describedby` pointing to the error message element for screen reader accessibility.

`FRONTEND ONLY`

### 18.14 Optimistic updates

All toggle/switch actions update the UI immediately without waiting for the server response:
- Enable/disable routes
- Enable/disable plugins
- Enable/disable access policies
- Attach/detach policies from routes
- Toggle settings (strict mode, on-demand TLS, etc.)

If the server rejects the change, revert the UI and show an error toast explaining why. Uses TanStack Query's `onMutate`/`onError`/`onSettled` pattern.

`FRONTEND ONLY`

### 18.15 Request retry with backoff

Failed API calls (network error or 5xx) retry automatically:
- 3 retries with exponential backoff (1s, 2s, 4s)
- 4xx errors do NOT retry (client errors are not transient)
- 429 errors retry after the `Retry-After` header value
- Retries are transparent to the user unless all retries fail, in which case an error toast appears

Configure via TanStack Query's global `retry` and `retryDelay` options.

`FRONTEND ONLY`

### 18.16 Stale data indicators

If displayed data is older than the configured stale time:
- **Dashboard/analytics**: show "Last updated X ago" in the header with a refresh icon button
- **Entity lists**: show a subtle "Data may be stale" indicator if no refetch has happened in >60s
- **Detail views**: show "Last fetched X ago" in the metadata sidebar

The refresh button forces an immediate refetch. Auto-refetch happens on window focus (TanStack Query default) and on a configurable interval.

`FRONTEND ONLY`

## 18B. Additional Accessibility Requirements (new in v2)

### 18B.1 Skip to content link

A visually hidden link at the very top of the page that becomes visible on focus: "Skip to main content". Clicking it focuses the `<main>` element, bypassing the sidebar and header. Standard WCAG 2.1 requirement.

`FRONTEND ONLY`

### 18B.2 Focus management on navigation

When navigating to a new page (via sidebar link, table row click, or command palette), focus moves to the page's `<h1>` element. This ensures screen reader users know they've navigated and hear the new page title. Implemented via a `useEffect` in the layout component that watches `location.pathname`.

`FRONTEND ONLY`

### 18B.3 OS preference detection

On first visit (no localStorage settings):
- Detect `prefers-reduced-motion: reduce` → auto-enable Reduced Motion toggle
- Detect `prefers-contrast: more` → auto-enable High Contrast toggle
- Detect `prefers-color-scheme: dark/light` → set matching theme

After the user explicitly sets a preference via the profile page, the manual setting takes precedence over OS detection. The OS preference is only used as the default.

`FRONTEND ONLY`

### 18B.4 Font size scaling

The admin panel respects browser zoom levels without layout breakage. Additionally, the profile page accessibility section includes a text size multiplier (90% / 100% / 110% / 120% / 130%) that scales the root `font-size` via a CSS variable. This is separate from browser zoom — it only affects text, not layout geometry.

`FRONTEND ONLY`

### 18B.5 Focus-visible consistency

Every interactive element (buttons, links, inputs, toggles, table rows, tabs, sidebar items) must have a visible focus indicator when focused via keyboard (`focus-visible`). The focus ring style is consistent: 2px offset, primary color, rounded to match the element's border radius. Defined once in the global CSS, not per-component.

`FRONTEND ONLY`

### 18B.6 Form validation announcements

All form validation errors are announced to screen readers:
- Error fields have `aria-invalid="true"`
- Error messages are linked via `aria-describedby`
- On form submit with errors, an `aria-live="polite"` region announces "X validation errors found"
- Focus moves to the first error field on submit failure

`FRONTEND ONLY`

### 18B.7 Touch targets

All interactive elements on mobile/tablet have a minimum touch target of 44x44px (WCAG 2.1 AAA). This applies to:
- Sidebar nav items
- Table action buttons (hover actions become always-visible on touch devices)
- Pagination buttons
- Toggle switches
- Filter chips
- Close/dismiss buttons

If the visual element is smaller than 44px, the clickable area extends via padding or a transparent hit area.

`FRONTEND ONLY`

## 20. Performance Considerations

### 18.1 Route-based code splitting

Each major page should be lazy-loaded via TanStack Router's code splitting. The initial bundle should only include the auth flow and layout shell. Route modules load on demand.

### 18.2 Virtual scrolling

Tables with potentially thousands of rows (audit log, traces) must use virtual scrolling (TanStack Table supports this via @tanstack/react-virtual). Never render all rows to DOM.

### 18.3 SSE efficiency

The live traffic view must not re-render the entire table on each event. Use a ring buffer in React state (same pattern as the backend) with prepend-only renders. New rows animate in at the top; old rows fall off the bottom without re-rendering.

### 18.4 Optimistic updates

Toggle actions (enable/disable route, activate/deactivate plugin) should update the UI immediately and reconcile with the server response. Use TanStack Query's optimistic update pattern.

### 18.5 Stale-while-revalidate

Dashboard stats and analytics charts use stale-while-revalidate — show cached data immediately, refresh in background. 30-second stale time for dashboards, 5-minute for analytics.

## 21. External Libraries Summary

All free, all permissively licensed:

| Library | License | Purpose | Already installed? |
|---------|---------|---------|-------------------|
| shadcn/ui | MIT | Component primitives | Yes |
| TanStack Router | MIT | Routing | Yes |
| TanStack Query | MIT | Data fetching | Yes |
| TanStack Table | MIT | Data tables | Yes |
| react-hook-form | MIT | Form state | Yes |
| zod | MIT | Schema validation | Yes |
| Recharts | MIT | Charts | Yes |
| react-i18next | MIT | Localization | Yes |
| lucide-react | ISC | Icons | Yes |
| sonner | MIT | Toast notifications | Yes |
| cmdk | MIT | Command palette | Yes |
| dnd-kit | MIT | Drag-and-drop | No — add |
| @tanstack/react-virtual | MIT | Virtual scrolling | No — add |
| @uiw/react-codemirror | MIT | CodeMirror 6 React wrapper | No — add |
| @codemirror/lang-json | MIT | JSON syntax + structure | No — add |
| @codemirror/lang-yaml | MIT | YAML syntax | No — add |
| @codemirror/lint | MIT | Inline validation/diagnostics | No — add |

**Removed from v1 (no longer needed):**

- ~~@rjsf/core~~ — all policy types get structured forms
- ~~data-table-filters~~ — built in-house with shadcn primitives

## 22. Placeholder Data & Feature Flags

Pages and components for features not yet implemented on the backend should render with **realistic placeholder/mock data** so the full UI is reviewable and demonstrable. A simple feature flag system controls whether mock data is shown.

### 20.1 Feature flag implementation

```typescript
// src/lib/feature-flags.ts
export const features = {
  clusterTopology: false,     // reactflow cluster viz
  pluginMarketplace: false,   // plugin registry browser
  pluginAdminPages: false,    // plugin-provided admin pages
  aiAssistant: false,         // chat with Rioku via MCP
  certManagement: false,      // cert table + actions (backend not wired)
  l4Routes: false,            // L4/TCP route management
  agentSessions: false,       // AI agent session drilldown
  piiFilters: false,          // PII log filter config
  webhookAlerts: false,       // alerting/notification config
  customDashboard: false,     // user-arranged dashboard widgets
  accessPolicies: false,      // conditional access rules
  effectivePermissions: false, // computed permission matrix
  entityActivity: false,      // per-entity activity logs
  colorblindMode: false,      // colorblind accessibility filters
} as const;
```

- Feature flags are compile-time constants (tree-shaken in production builds)
- Playwright tests run with all flags OFF (`RIOKU_FEATURES=none`) to test only wired functionality
- Demo mode runs with all flags ON (`RIOKU_FEATURES=all`) showing placeholder data
- Individual flags can be toggled via env: `RIOKU_FEATURE_CERT_MANAGEMENT=true`

### 20.2 Placeholder data pattern

```typescript
// Components check the flag and render mock data or "coming soon"
function CertificatesPage() {
  if (!features.certManagement) {
    return <ComingSoon feature="Certificate Management" />;
  }
  return <CertTable />;
}
```

The `ComingSoon` component shows a styled placeholder with the feature name, a brief description of what it will do, and optionally a link to the relevant GitHub issue.

### 20.3 Pages with placeholder data (backend not yet wired)

- Certificates table and detail view
- L4 route management
- Plugin marketplace/browser
- Plugin-provided admin pages
- AI agent session drilldown
- Cluster topology visualization
- PII log filter configuration
- Webhook/alerting configuration
- AI assistant (chat with Rioku)
- Access policies (conditional rules)
- Effective permissions (computed matrix)
- Per-entity activity logs

### 20.4 Pages fully wired (backend exists)

- Dashboard (HealthService, TrafficService)
- Routes CRUD (ConfigService)
- Services CRUD (ConfigService)
- Policies CRUD (ConfigService)
- Live traffic (TrafficService SSE)
- Analytics (TrafficService stats)
- AI workloads (TrafficService token stats)
- Users & roles (auth REST endpoints)
- API keys (keys REST endpoints)
- Audit log (ConfigService audit)
- Settings (rioku.yaml read/write via REST)
- Profile & security (auth endpoints)

## 23. Implementation Phases

The admin panel overhaul follows a **frontend-first** approach: build the UI with mock data where backends don't exist, wire to real APIs as they become available. This avoids blocking frontend work on backend implementation.

### Phase 1: Layout Shell & Navigation

**Scope:** The structural skeleton that every other page lives inside.

- [ ] Sidebar with all nav items, section headers, collapse/expand, icon mode
- [ ] Sidebar user menu popup (Profile, Settings, Log out)
- [ ] Top bar with breadcrumbs, theme toggle, command palette trigger, notification bell placeholder
- [ ] Mobile responsive sidebar (overlay drawer at <768px, hamburger menu)
- [ ] Dark/light theme via CSS variables
- [ ] Command palette (Cmd+K) with navigation sections
- [ ] Toast notification system (sonner integration with typed toasts)
- [ ] Themed checkbox component (custom CSS, replaces browser defaults)
- [ ] Breadcrumb component wired to TanStack Router

**All items:** `FRONTEND ONLY`
**GitHub issues:** 1 issue for the shell, 1 for command palette, 1 for responsive sidebar

### Phase 2: Tables, Detail Views & Core CRUD

**Scope:** The table interaction pattern, detail view pattern, and form/YAML editing for routes, services, and policies.

- [ ] Data table component with: click-to-navigate name column, hover inline actions, bulk select with themed checkboxes, faceted filtering, column preferences
- [ ] Full-page detail view pattern: tabbed layout, back button, breadcrumbs, inline editing
- [ ] Custom YAML editor component (syntax highlighting, line numbers, validation, toolbar)
- [ ] Bidirectional YAML / form sync
- [ ] SearchableSelect and SearchableMultiSelect components
- [ ] Route builder (form mode with all sections, YAML mode)
- [ ] Route detail view with all tabs
- [ ] Service builder (form mode with all sections, YAML mode)
- [ ] Service detail view with all tabs
- [ ] Policy builder (type tiles, structured forms for all 8 types, YAML mode)
- [ ] Policy detail view with all tabs
- [ ] Create flows as full pages (not modals)

**Mix of `FRONTEND ONLY` and `NEEDS BACKEND`** — forms can be built now, but some fields require proto changes from compiler hardening.
**GitHub issues:** 1 per entity type (routes, services, policies), 1 for shared table/detail components, 1 for YAML editor, 1 for SearchableSelect

### Phase 3: Security & RBAC

**Scope:** The completely redesigned RBAC system, user management, API keys, and access policies.

- [ ] User list page with expanded columns (first/last name, roles badges)
- [ ] User detail view (identity card, roles card, security card split columns, metadata sidebar, danger zone)
- [ ] Role list page
- [ ] Role detail view (permissions tab with granular rules, hierarchy tab with drag-and-drop, members tab)
- [ ] Effective permissions panel (collapsed, live-recalculating)
- [ ] Access policies page (list table, detail/create with conditions UI)
- [ ] API key detail view with tabs (details with scope management, usage stats, activity)
- [ ] API key creation flow (scopes selection, one-time key display modal)
- [ ] Profile page (user fields, accessibility settings, appearance)
- [ ] Colorblind accessibility (SVG feColorMatrix filters, high contrast, reduced motion)

**Mostly `NEEDS BACKEND`** — multi-role, role hierarchy, granular permissions, access policies all need backend work.
**GitHub issues:** 1 for user model expansion, 1 for RBAC model (roles + permissions), 1 for access policies, 1 for API key detail, 1 for profile/accessibility, 1 for effective permissions

### Phase 4: Traffic, Analytics & Charts

**Scope:** Dashboard, analytics, AI workloads, live traffic, and trace detail.

- [ ] Dashboard page with stat cards and charts (shared time range)
- [ ] Analytics page with all chart types (error rate as stacked bars, latency percentiles, top routes)
- [ ] Chart improvements: both axes on all charts, timezone captions, custom tooltips with colored dots, legends on multi-series
- [ ] AI workloads page (token usage, cost, model breakdown, agent sessions)
- [ ] Live traffic view with SSE, pause/resume, filtered stream
- [ ] Trace detail slide-out (request/response/timing/routing/policies/identity/AI/OTEL)
- [ ] Notification bell dropdown with typed notifications
- [ ] Shared time range context (1h/6h/24h/7d/30d) across Dashboard, Analytics, AI Workloads

**Mostly `FRONTEND ONLY`** — TrafficService endpoints exist. Chart rendering is pure frontend.
**GitHub issues:** 1 for dashboard, 1 for analytics charts, 1 for AI workloads, 1 for live traffic + trace detail, 1 for notification panel

### Phase 5: Infrastructure, Settings & Plugins

**Scope:** Settings multi-page, cluster, certificates, plugins with admin pages, audit log.

- [ ] Settings multi-page layout with sub-nav
- [ ] All settings pages (General, Network, TLS, Observability, Config Store, Auth, PKI, Danger Zone)
- [ ] Cluster page (node list, node detail)
- [ ] Certificates page (cert table, cert detail, renewal/revocation actions)
- [ ] Plugins page (installed grid, plugin detail, status toggle)
- [ ] Plugin-provided admin pages (dynamic sidebar items, 404 for disabled plugins)
- [ ] Audit log page (global, faceted filtering, row expand for diff, export)
- [ ] Activity tabs on routes, services, policies, users, API keys (per-entity history)

**Mostly `NEEDS BACKEND`** — settings write endpoints, cluster API, cert management, plugin admin page registration all need backend work.
**GitHub issues:** 1 for settings shell + general/network, 1 for TLS/certs settings, 1 for observability settings, 1 for cluster, 1 for plugins + admin pages, 1 for audit log, 1 for entity activity tabs

## 24. Summary of Backend Work Required

The following features require backend changes before they can be fully wired. Each should have a GitHub issue tracking the backend work.

| Feature | Backend work needed | Priority |
|---------|-------------------|----------|
| Expanded user model | Add title, department, phone, timezone, locale, SSO fields to proto + migration | High |
| Multi-role assignment | Schema change from single role to many-to-many user-role | High |
| Role hierarchy (DAG) | Role parent relationships, inheritance resolution | High |
| Granular permission rules | Permission model: resource + actions + scope + effect | High |
| Access policies | New entity: conditional access rules with evaluation engine | Medium |
| Entity activity logs | Per-entity change tracking with structured diffs | Medium |
| Plugin admin pages | Plugin manifest with admin page registration, frontend routing integration | Medium |
| Certificate management | List/detail/renew/revoke endpoints via Caddy admin API | Medium |
| API key usage stats | Request counting per key, per scope | Low |
| Settings write endpoints | Many settings pages read config but can't write it yet | Low |
| Cluster API | Node listing, health, sync state endpoints | Low |
| PKI management | CA status, rotation, certificate download endpoints | Low |

## 25. What Gets Deferred

- **Mobile-native app** — much later; web responsive handles mobile for now
- **Custom dashboard builder** — users arrange their own widgets. Fixed layout is fine for now.
- **Webhook/notification configuration** — alerting on cert expiry, health failures. Important but separate design cycle. Placeholder page included.
- **Custom themes** — the CSS variable system supports it, but the UI for creating/editing/sharing themes is deferred. Dark + light only for v1.
- **Cluster topology visualization** — reactflow integration deferred until cluster API is implemented.
- **AI assistant** — chat-with-Rioku via MCP. Placeholder page included.

---

**Changelog from v1 (2026-04-09):**

1. RBAC completely redesigned: multi-role, DAG hierarchy, granular permissions with resource/actions/scope/effect, access policies, effective permissions panel
2. User model expanded with first/last name, title, department, phone, timezone, locale, SSO fields
3. SearchableSelect/SearchableMultiSelect components replace native selects for dynamic data
4. YAML/JSON editor uses @uiw/react-codemirror (CodeMirror 6 React wrapper) with @codemirror/lang-json, @codemirror/lang-yaml, @codemirror/lint — professional editor with format toggle, inline validation, theming
5. Bidirectional YAML / form sync added
6. Colorblind accessibility with SVG feColorMatrix filters, high contrast, reduced motion
7. Theme system documented as CSS variable-based with future custom theme support
8. Notification bell panel with typed notifications added to top bar
9. Shared time range context (1h/6h/24h/7d/30d) across Dashboard, Analytics, AI Workloads
10. Chart improvements: both axes, timezone captions, stacked error bars, custom tooltips, legends
11. Plugin-provided admin pages with dynamic sidebar items and 404 for disabled plugins
12. Activity tabs on all entity detail views (routes, services, policies, users, API keys)
13. Detail view pattern standardized: click name → full page replaces table, tabbed layout
14. User detail view redesigned: identity card, roles card, effective permissions, security split columns, metadata sidebar, danger zone
15. API key detail view with tabs: details (scope management), usage stats, activity
16. Sidebar user menu popup replaces settings nav item
17. Toast notification system documented with all trigger points
18. Mobile responsive behavior specified: overlay drawer sidebar, responsive grids, scrollable tables
19. Themed checkboxes with custom CSS (dark bg, primary check, white checkmark)
20. Implementation phases defined (5 phases, frontend-first)
21. Wizard mode removed (progressive disclosure form is sufficient)
22. @rjsf/core removed (all policy types get structured forms)
23. data-table-filters removed (built in-house)
24. Backend work requirements enumerated with priority
25. Quality of life additions (Section 18): unsaved changes warning, session timeout, auto-save drafts, diff view before save, deep linking to tabs, table state in URL, loading skeletons, error boundaries, connection lost indicator, recently viewed, command palette entity search, bulk import/export, inline form validation, optimistic updates, request retry with backoff, stale data indicators
26. Additional accessibility (Section 18B): skip to content link, focus management on navigation, OS preference detection (prefers-reduced-motion, prefers-contrast, prefers-color-scheme), font size scaling, focus-visible consistency, form validation announcements for screen readers, 44x44px minimum touch targets
27. Section numbering updated: 18 = Quality of Life, 18B = Additional Accessibility, 19 = (reserved), 20 = Performance, 21 = Libraries, 22 = Feature Flags, 23 = Phases, 24 = Backend Work, 25 = Deferred
28. YAML editor upgraded to YAML/JSON editor — format toggle in toolbar, JSON syntax highlighting and validation, bidirectional sync works with both formats, download/copy respects selected format
