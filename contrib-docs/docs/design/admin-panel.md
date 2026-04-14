# Plan: Phase 1 Chunk 6 — Admin Panel (React + shadcn + Tailwind)

## Context

The admin panel skeleton exists at `packages/web/` with mock data, custom CSS, and TanStack Router routes. This plan replaces the custom CSS with shadcn/Tailwind, wires everything to the REST API, and builds a production-quality developer-focused dashboard.

## Issues: #34-38

## Design Decisions

| Decision | Choice |
|---|---|
| UI framework | shadcn/ui + Tailwind CSS (full replace of custom CSS) |
| Aesthetic | Developer-focused, dark-first (Zinc/Slate + cyan accents) |
| Charts | Recharts |
| Live traffic | Full observability view (waterfall, histogram, RPS gauge, error heat map) |
| Auth | Token-based login page → JWT in memory → auto-refresh |
| Dev workflow | Vite proxy to daemon (:5173 → :7778) |
| shadcn scope | Full kit (~20 components) |
| Sidebar | Collapsible with icons (toggle/keyboard shortcut) |
| Data fetching | TanStack Query (already installed) |

---

## Step 0: Plugin Extension Architecture

The admin panel must be extensible — Rioku plugins can contribute UI sections. This means the core panel needs a well-defined plugin API and reusable component exports.

### Plugin Developer API

Web plugins are ES modules loaded dynamically at runtime (per architecture doc Section 9.1). Each plugin can:

1. **Register navigation items** — add entries to the sidebar under a "Plugins" section
2. **Register route pages** — add new pages at `/plugins/<plugin-id>/*`
3. **Register dashboard widgets** — add cards/charts to the dashboard
4. **Register config panels** — add settings UI for plugin-specific configuration

```typescript
// @rioku/plugin-api — the contract plugins implement
interface RiokuWebPlugin {
  id: string;
  name: string;
  version: string;

  // Navigation
  navItems?: NavItem[];

  // Pages (lazy-loaded React components)
  routes?: PluginRoute[];

  // Dashboard widgets
  dashboardWidgets?: DashboardWidget[];

  // Config panel for plugin settings
  configPanel?: React.ComponentType<PluginConfigProps>;
}

interface NavItem {
  label: string;
  icon: string; // lucide icon name
  path: string;
}

interface PluginRoute {
  path: string;
  component: React.LazyComponent;
}

interface DashboardWidget {
  title: string;
  size: 'sm' | 'md' | 'lg'; // grid column span
  component: React.ComponentType<WidgetProps>;
}
```

### Plugin Registration

```typescript
// src/lib/plugin-registry.ts
class PluginRegistry {
  register(plugin: RiokuWebPlugin): void;
  getNavItems(): NavItem[];
  getRoutes(): PluginRoute[];
  getDashboardWidgets(): DashboardWidget[];
  getConfigPanel(pluginId: string): React.ComponentType | null;
}
```

Plugins are loaded via `<script type="module">` tags injected by the daemon. The daemon knows which web plugins are installed and serves their ES module bundles from the build service output.

### Exported Component Library

Plugin developers need access to Rioku's UI primitives so their panels look consistent. We export a `@rioku/ui` package (or namespace) containing:

```typescript
// Re-exports of shadcn components + Rioku-specific components
export {
  // shadcn primitives
  Button, Card, CardHeader, CardContent, CardTitle,
  Table, TableHeader, TableRow, TableCell,
  Dialog, DialogTrigger, DialogContent,
  Sheet, SheetTrigger, SheetContent,
  Badge, Input, Select, Tabs, TabsList, TabsTrigger, TabsContent,
  Toast, Tooltip, Skeleton, Switch, Label,

  // Rioku-specific
  StatCard,         // metric card with trend
  DataTable,        // sortable/filterable table
  PageHeader,       // consistent page title + actions
  EmptyState,       // placeholder with CTA
  StatusBadge,      // health state indicator
  CodeBlock,        // JSON/config display
  TimeAgo,          // relative timestamp
  Sparkline,        // mini inline chart

  // Hooks
  useApi,           // typed REST API client
  useAuth,          // auth context
  useTheme,         // dark/light toggle
  useSse,           // SSE stream subscription
} from '@rioku/ui';
```

This is NOT a separate npm package — it's exported from the web build so plugins loaded at runtime can import from a global namespace. Implementation: Vite library mode or a global `window.RiokuUI` object that plugins access.

### Injection Zones (Slots)

Plugins can inject content into predefined zones on existing pages. This avoids plugins needing to replace entire pages just to add a section.

```typescript
// src/lib/plugin-registry.ts
interface InjectionZone {
  zone: string;
  component: React.ComponentType<ZoneProps>;
  priority?: number; // lower = renders first (default 100)
}

// Plugins register injections:
plugin.injections = [
  { zone: 'dashboard.widgets', component: MyWidget },
  { zone: 'route.detail.tabs', component: MyRouteTab },
  { zone: 'sidebar.bottom', component: MyNavItem },
];
```

**Available zones:**

| Zone ID | Location | What plugins can inject |
|---|---|---|
| `dashboard.widgets` | Dashboard page, after built-in widgets | Custom metric cards, charts |
| `dashboard.alerts` | Dashboard page, top (above widgets) | Warning banners, status alerts |
| `route.detail.tabs` | Route detail view, additional tabs | Plugin-specific route config (e.g. rate limit settings) |
| `route.detail.actions` | Route detail view, action buttons | Plugin-specific actions |
| `service.detail.tabs` | Service detail view, additional tabs | Plugin-specific service config |
| `service.detail.actions` | Service detail view, action buttons | Plugin-specific actions |
| `policy.create.types` | Policy create dialog, type selector | Additional policy types from plugins |
| `traffic.live.columns` | Live traffic table, additional columns | Plugin-specific request metadata |
| `traffic.live.filters` | Live traffic filter bar | Plugin-specific filter options |
| `traffic.detail.tabs` | Request detail panel, additional tabs | Plugin trace data (e.g. LLM token counts) |
| `security.sections` | Security page, additional sections | Plugin-specific security config |
| `settings.sections` | Settings page, additional sections | Plugin settings forms |
| `sidebar.top` | Sidebar, above navigation | Plugin branding/status |
| `sidebar.bottom` | Sidebar, below navigation | Plugin nav items, quick actions |
| `header.actions` | Header bar, right side | Plugin action buttons, indicators |

**Zone rendering:**

```tsx
// src/components/plugin/slot.tsx
function Slot({ zone, context }: { zone: string; context?: any }) {
  const registry = usePluginRegistry();
  const injections = registry.getInjections(zone);

  return (
    <>
      {injections
        .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
        .map((inj, i) => (
          <inj.component key={i} context={context} />
        ))}
    </>
  );
}

// Usage in a page:
<Slot zone="dashboard.widgets" />
<Tabs>
  <TabsContent value="overview">...</TabsContent>
  <Slot zone="route.detail.tabs" context={{ routeId }} />
</Tabs>
```

Every page includes `<Slot>` components at the defined injection points. If no plugins inject into a zone, the slot renders nothing (zero overhead).

### File structure for extensibility

```
src/
  lib/
    plugin-registry.ts    — plugin registration + discovery
    plugin-loader.ts      — dynamic ES module loading
  exports/
    index.ts              — @rioku/ui barrel export
  components/
    ui/                   — shadcn components (re-exported)
    rioku/                — Rioku-specific components (re-exported)
    plugin/
      plugin-page.tsx     — wrapper for plugin-contributed pages
      plugin-widget.tsx   — wrapper for plugin dashboard widgets
      plugin-nav.tsx      — renders plugin nav items in sidebar
```

## Cross-Cutting Concerns

### Keyboard Shortcuts (Cross-Platform)

All shortcuts use platform-adaptive modifier keys: `Cmd` on macOS, `Ctrl` on Windows/Linux. Display adapts to the detected platform.

| Shortcut | Action |
|---|---|
| `Mod+K` | Open command palette (search + navigate) |
| `Mod+B` | Toggle sidebar collapse |
| `Mod+/` | Focus search |
| `Mod+N` | New resource (context-aware: new route on routes page, new service on services page) |
| `Mod+S` | Save current form (when editing) |
| `Escape` | Close dialog/sheet/command palette |
| `Mod+Shift+T` | Toggle dark/light theme |
| `?` | Show keyboard shortcut help overlay |

Implementation: `src/hooks/use-hotkeys.ts` — detects platform via `navigator.platform`, maps `Mod` to the correct key, registers global and page-scoped shortcuts. Uses a centralized shortcut registry so plugins can add their own.

### Notifications & Preferences

**Toast notifications** (shadcn Sonner integration):
- Success: green, auto-dismiss 3s
- Error: red, persistent until dismissed
- Info: blue, auto-dismiss 5s
- Mutation feedback: "Route created", "Service deleted", etc.

**Persistent notifications** (bell icon in header):
- Config sync events
- Health state changes (store degraded, Caddy restart)
- Plugin status changes
- Stored in memory (cleared on page refresh)

**User preferences** (stored in localStorage):
- Theme (dark/light/system)
- Sidebar collapsed state
- Table page sizes
- Notification preferences (which types to show)
- Locale preference

Implementation: `src/lib/preferences.ts` with a typed schema and React context.

### Responsive Design (Mobile-First)

Must work on:
- Desktop (1440px+)
- Laptop (1024-1439px)
- Tablet (768-1023px)
- Foldable unfolded (Samsung Fold: ~717px inner screen)
- Foldable folded / phone (320-716px)

**Breakpoint strategy:**

| Breakpoint | Layout |
|---|---|
| `>= 1024px` | Full sidebar + header + content |
| `768-1023px` | Collapsed sidebar (icons only) + header + content |
| `< 768px` | No sidebar (hamburger menu overlay) + compact header + full-width content |

**Component adaptations:**
- DataTable → responsive: horizontal scroll on mobile, or card view below 640px
- StatCards → stack vertically on mobile
- Charts → full-width, reduced height on mobile
- Forms → full-width inputs, stacked layout
- Dialogs → Sheet (bottom slide-up) on mobile instead of centered modal
- Command palette → full-screen on mobile

Tailwind responsive classes handle most of this. shadcn components are responsive by default.

### Localization (i18n)

English is the primary language. The admin panel will be prepared for localization from day one using a string extraction pattern.

**Implementation:** Use `react-i18next` with:

```bash
npm install i18next react-i18next
```

**String organization:**

```
src/
  locales/
    en/
      common.json       — shared strings (buttons, labels, status)
      dashboard.json    — dashboard page strings
      routes.json       — route management strings
      services.json     — service management strings
      ...
```

**Usage pattern:**

```tsx
// All user-facing strings go through t()
const { t } = useTranslation('routes');
<PageHeader title={t('title')} />
<Button>{t('create')}</Button>
<EmptyState description={t('empty.description')} />
```

**Rules:**
1. Never hardcode user-facing strings — always use `t()`.
2. Keep technical identifiers (route IDs, status codes) untranslated.
3. Use ICU message format for plurals and variables: `t('routes.count', { count: 5 })`.
4. Plugin strings are namespaced: `plugin.<plugin-id>.key`.

**Phase 1 scope:** English only, but all strings extracted. Community translations can be contributed later via the locale JSON files.

### Audit Logging

Every action in the admin panel that changes state must be auditable. The backend already records audit entries via the config engine — the admin panel must ensure it triggers auditable API calls for every mutation, and surfaces the audit trail prominently.

**What gets audited (backend enforces, panel must trigger correctly):**

| Category | Actions | Audit Fields |
|---|---|---|
| **Routes** | Create, update, delete, enable, disable | actor, entity_type=route, entity_id, operation, diff |
| **Services** | Create, update, delete, add upstream, remove upstream | actor, entity_type=service, entity_id, operation, diff |
| **Policies** | Create, update, delete, attach, detach | actor, entity_type=policy, entity_id, operation, diff |
| **API Keys** | Create, revoke | actor, entity_type=api_key, entity_id, operation |
| **Config** | Import, export | actor, entity_type=config, operation |
| **Auth** | Login (token exchange), token refresh, failed auth attempts | actor, entity_type=auth, operation |
| **Settings** | Any daemon config change | actor, entity_type=settings, operation, diff |
| **Plugins** | Install, remove, enable, disable, config change | actor, entity_type=plugin, entity_id, operation |

**Admin panel responsibilities:**

1. **Always pass auth context** — every REST call includes the Bearer token so the backend can extract the actor for the audit entry. The actor should be the authenticated user/key identity, never "anonymous".

2. **Confirmation dialogs for destructive actions** — delete, revoke, import (overwrites), disable. The dialog shows what will happen. The audit log captures that the action was intentional.

3. **Audit log page** — dedicated `/audit` page (already in route structure) with:
   - Filterable table: actor, entity type, entity ID, operation, timestamp
   - Time range selector
   - Actor filter (who did it)
   - Entity type filter (routes, services, policies, keys, etc.)
   - Diff viewer (expandable row showing what changed — JSON diff)
   - Export audit log (CSV/JSON download for compliance)

4. **Inline audit trail** — on every resource detail page (route detail, service detail, etc.), show a "History" tab with the audit entries for that specific entity. Shows who changed what, when.

5. **Dashboard recent activity** — the dashboard widget showing "Recent changes" pulls from the audit log endpoint.

6. **Real-time audit events** — the SSE stream includes audit events so the admin panel can show live notifications when config changes happen (useful for multi-operator environments).

7. **Failed operation visibility** — if a mutation fails (validation error, conflict), the panel shows the error clearly. Backend logs the attempt. This is important for security monitoring (repeated failed auth attempts, permission violations).

**Implementation notes:**
- The `POST /api/v1/config` endpoint already creates audit entries for every ConfigChange — the panel doesn't need to make separate audit API calls for config mutations.
- For API key operations (create/revoke), the key routes handler should also create audit entries.
- Auth events (login, refresh, failed attempts) need audit entries added to the auth routes handler.
- All audit entries include the `X-Request-ID` for correlation with server logs.

## Step 1: Install Tailwind + shadcn + dependencies (#35 partial)

Remove `app.css`. Install and configure:

```bash
# Tailwind
npm install -D tailwindcss @tailwindcss/vite

# shadcn deps (Radix primitives, class-variance-authority, clsx, tailwind-merge)
npx shadcn@latest init

# Charts
npm install recharts

# Icons
npm install lucide-react

# Date handling (for audit log, timestamps)
npm install date-fns

# Localization
npm install i18next react-i18next

# Toast notifications
npm install sonner
```

**Tailwind config:** Dark mode via `class` strategy. Zinc/Slate color palette. Custom CSS variables for shadcn theming.

**shadcn components to install:**
```
button card table dialog sheet tabs badge input select
dropdown-menu toast command tooltip separator avatar skeleton
scroll-area switch label textarea popover alert
```

**Vite config update:** Add Tailwind plugin, configure proxy for `/api/*` → `http://localhost:7778`.

## Step 2: Layout rebuild — Sidebar + Header

**Files:**
- `src/components/layout/sidebar.tsx` — Collapsible sidebar with icon+label nav
- `src/components/layout/header.tsx` — Top bar with breadcrumbs, search (Command palette), user menu
- `src/components/layout/app-shell.tsx` — Main layout wrapper (sidebar + header + content)
- `src/routes/__root.tsx` — Updated to use new layout

**Sidebar sections:**
1. **Overview** — Dashboard
2. **Configuration** — Routes, Services, Policies
3. **Traffic** — Live, Analytics, AI Workloads
4. **Infrastructure** — Cluster, Plugins
5. **Security** — API Keys, Certificates
6. **Settings** — Daemon config

Collapsible: toggle button at bottom + `Cmd+B` keyboard shortcut. State persisted in localStorage.

**Command palette (Cmd+K):** Quick navigation to any page, search routes/services by name.

## Step 3: API client + auth (#35)

**Files:**
- `src/lib/api.ts` — REST API client (fetch-based, typed)
- `src/lib/auth.ts` — Token management (in-memory, auto-refresh)
- `src/hooks/use-auth.ts` — Auth context + hook
- `src/routes/login.tsx` — Login page (token/API key entry)
- `src/components/auth/protected-route.tsx` — Redirect to login if unauthenticated

**Auth flow:**
1. User enters bootstrap token or API key on login page
2. `POST /api/v1/auth/token` → receives access + refresh tokens
3. Access token stored in memory (React state), NOT localStorage
4. TanStack Query configured with auth header via `defaultOptions.queries.queryFn`
5. On 401 response → attempt refresh via `/api/v1/auth/refresh`
6. On refresh failure → redirect to login

**API client types:**
```typescript
// Typed API responses matching proto JSON
interface ConfigSnapshot { version: number; routes: Route[]; services: Service[]; policies: Policy[]; }
interface Route { id: string; name: string; matchers: Matcher[]; enabled: boolean; ... }
interface Service { id: string; name: string; upstreams: Upstream[]; lbPolicy: string; ... }
interface HealthStatus { overall: string; store: SubsystemHealth; caddy: SubsystemHealth; version: string; }
```

## Step 4: Dashboard page (#36)

**File:** `src/routes/index.tsx`

Developer-focused dashboard with real data:

**Top row — Key metrics (StatCards):**
- Total Routes (with trend)
- Active Services
- Requests/sec (from Caddy metrics if available)
- Store Health (OK/Degraded/Unhealthy)

**Middle row — Charts (Recharts):**
- Request rate over time (area chart, 1h window)
- Response time distribution (histogram)

**Bottom row — Quick status:**
- Recent config changes (last 5 audit entries)
- Caddy status card (version, upstreams healthy/total)
- Cluster nodes (if clustered)

All data fetched via TanStack Query with auto-refresh intervals.

## Step 5: Config pages — Routes, Services, Policies (#37)

**Route management (`src/routes/config/routes.tsx` + `routes.$id.tsx`):**

| Action | UI Element | REST Call | Audited |
|---|---|---|---|
| List routes | DataTable (Name, Matchers, Target, Enabled, Actions) | `GET /api/v1/config` | No (read) |
| View route detail | Detail page with tabs (Overview, Matchers, Policies, History) | `GET /api/v1/config` | No (read) |
| Create route | Sheet slide-over with form (name, matchers, target, enabled) | `POST /api/v1/config` (RouteOp UPSERT) | Yes |
| Update route | Same form, pre-filled with existing data | `POST /api/v1/config` (RouteOp UPSERT) | Yes |
| Delete route | Confirmation dialog ("Delete route X? This cannot be undone.") | `POST /api/v1/config` (RouteOp DELETE) | Yes |
| Enable/disable | Inline Switch toggle (immediate, no dialog) | `POST /api/v1/config` (RouteOp UPSERT) | Yes |
| Attach policy | Dropdown/dialog to select policy | Update route's policy_ids | Yes |
| Detach policy | Remove button on attached policy badge | Update route's policy_ids | Yes |

**Service management (`src/routes/config/services.tsx` + `services.$id.tsx`):**

| Action | UI Element | REST Call | Audited |
|---|---|---|---|
| List services | DataTable (Name, Upstreams, LB Policy, Health, Actions) | `GET /api/v1/config` | No (read) |
| View service detail | Detail page with tabs (Overview, Upstreams, Health, History) | `GET /api/v1/config` | No (read) |
| Create service | Sheet with name, LB policy selector, upstream list (add/remove rows) | `POST /api/v1/config` (ServiceOp UPSERT) | Yes |
| Update service | Same form, pre-filled | `POST /api/v1/config` (ServiceOp UPSERT) | Yes |
| Delete service | Confirmation dialog | `POST /api/v1/config` (ServiceOp DELETE) | Yes |
| Add upstream | Inline form row in service detail (address, weight, TLS mode) | `POST /api/v1/config` (ServiceOp UPSERT) | Yes |
| Remove upstream | Remove button with confirmation | `POST /api/v1/config` (ServiceOp UPSERT) | Yes |

**Policy management (`src/routes/config/policies.tsx` + `policies.$id.tsx`):**

| Action | UI Element | REST Call | Audited |
|---|---|---|---|
| List policies | DataTable (Name, Type, Attached count, Actions) | `GET /api/v1/config` | No (read) |
| View policy detail | Detail page with tabs (Overview, Config, Attached To, History) | `GET /api/v1/config` | No (read) |
| Create policy | Sheet with name, type selector, JSON config editor (Monaco-style or textarea) | `POST /api/v1/config` (PolicyOp UPSERT) | Yes |
| Update policy | Same form, pre-filled, config editor shows current JSON | `POST /api/v1/config` (PolicyOp UPSERT) | Yes |
| Delete policy | Confirmation dialog (warns if attached to routes/services) | `POST /api/v1/config` (PolicyOp DELETE) | Yes |

**API Key management (`src/routes/security.tsx`):**

| Action | UI Element | REST Call | Audited |
|---|---|---|---|
| List keys | DataTable (Name, Scopes, Created, Actions) | `GET /api/v1/keys` | No (read) |
| Create key | Dialog with name, scopes, expiry. Shows generated key ONCE | `POST /api/v1/keys` | Yes |
| Revoke key | Confirmation dialog ("Revoke key X? Applications using this key will lose access.") | `DELETE /api/v1/keys/{id}` | Yes |

**Config management (`src/routes/config/` actions):**

| Action | UI Element | REST Call | Audited |
|---|---|---|---|
| Export config | Button → downloads JSON file | `GET /api/v1/config` | Yes |
| Import config | File upload dialog with preview + confirmation ("This will replace all config") | `POST /api/v1/config/import` | Yes |

**Shared patterns:**
- TanStack Query `useMutation` for all writes with optimistic updates
- Toast notifications on success (green) and error (red, persistent)
- Loading skeletons during fetch
- Empty states with call-to-action ("No routes yet. Create your first route.")
- Confirmation dialogs for ALL destructive actions (delete, revoke, import)
- "History" tab on every detail page showing entity-specific audit trail
- Diff viewer for audit entries (JSON diff of before/after state)
- Form validation: client-side (immediate feedback) + server-side (RFC 7807 errors displayed inline)

## Step 6: Live traffic view (#38)

**File:** `src/routes/traffic/live.tsx`

Full observability view:

**Top row — Real-time gauges:**
- RPS gauge (animated, current requests/sec)
- P50/P95/P99 latency display
- Error rate percentage
- Active connections

**Main area — Request stream:**
- Auto-scrolling table of live requests via SSE (`/api/v1/events/config`)
- Columns: Time, Method, Path, Status, Latency, Upstream
- Color-coded by status (2xx green, 4xx yellow, 5xx red)
- Smooth entry animations (fade + slide)
- Pause/resume button
- Filter bar: method, path pattern, status range

**Side panel — Sparklines:**
- Mini RPS chart (last 60s)
- Latency sparkline
- Error rate sparkline

**Bottom — Request detail:**
- Click a request row to expand details
- Headers, timing breakdown, upstream response

Uses `EventSource` API for SSE connection. Reconnects automatically on disconnect.

## Step 7: Additional pages

**Analytics (`src/routes/traffic/analytics.tsx`):**
- Recharts area/bar charts for traffic patterns
- Time range selector (1h, 6h, 24h, 7d)
- Top routes by request count
- Status code breakdown (pie/donut chart)

**AI Workloads (`src/routes/traffic/ai.tsx`):**
- Token usage over time
- Cost breakdown by model
- Request latency by provider
- (Placeholder until LLM proxy is built)

**Cluster (`src/routes/cluster.tsx`):**
- Node cards with health indicators
- Raft leader indicator
- Node detail expandable

**Security (`src/routes/security.tsx`):**
- API key management (create/revoke via REST)
- Certificate status (PKI info when available)

**Settings (`src/routes/settings.tsx`):**
- Daemon config display (store driver, listen addresses, data dir)
- Store migration status (current backend, connection info)
- PKI status (CA validity, node cert expiry, rotation schedule)
- Log level control (change at runtime if supported)

### Feature parity with CLI

The admin panel must not gate users behind CLI usage. Every operation available in the CLI should be available in the panel (except node-local ops like init/start/stop/migrate which require filesystem access).

| Capability | CLI | Panel | Status |
|---|---|---|---|
| Route CRUD | `rku route *` | Config > Routes | Covered |
| Service CRUD | `rku service *` | Config > Services | Covered |
| Policy CRUD | `rku policy *` | Config > Policies | Covered |
| API key management | `rku key *` | Security page | Covered |
| Config export/import | `rku config export/import` | Config actions | Covered |
| Audit log | `rku audit list` | Audit page | Covered |
| Health status | `rku status` | Dashboard | Covered |
| Plugin management | `rku plugin *` (future) | Plugins page | Ready (slots for future) |
| Build management | `rku build *` (future) | Plugins page | Ready (slots for future) |
| Cluster management | `rku cluster *` (future) | Cluster page | Ready (slots for future) |
| Store migration | `rku migrate *` | Settings (status only) | Node-local ops excluded |

---

## Files Summary

### Deleted:
- `src/app.css` — replaced by Tailwind + shadcn

### New infrastructure:
- `tailwind.config.ts`
- `src/lib/utils.ts` (shadcn utility — cn() function)
- `src/lib/api.ts` — typed REST API client
- `src/lib/auth.ts` — token management
- `src/lib/preferences.ts` — user preferences (localStorage)
- `src/lib/plugin-registry.ts` — plugin registration + injection zones
- `src/lib/plugin-loader.ts` — dynamic ES module loading
- `src/hooks/use-auth.ts` — auth context
- `src/hooks/use-hotkeys.ts` — cross-platform keyboard shortcuts
- `src/hooks/use-sse.ts` — SSE stream subscription
- `src/locales/en/*.json` — English locale strings
- `src/components/ui/*` — ~20 shadcn components
- `src/components/layout/sidebar.tsx`
- `src/components/layout/header.tsx`
- `src/components/layout/app-shell.tsx`
- `src/components/auth/protected-route.tsx`
- `src/components/plugin/slot.tsx` — injection zone renderer
- `src/components/plugin/plugin-page.tsx` — plugin page wrapper
- `src/components/rioku/stat-card.tsx` — metric card (exported for plugins)
- `src/components/rioku/data-table.tsx` — sortable/filterable table (exported)
- `src/components/rioku/page-header.tsx` — page title + actions (exported)
- `src/components/rioku/empty-state.tsx` — placeholder with CTA (exported)
- `src/components/rioku/status-badge.tsx` — health indicator (exported)
- `src/components/rioku/code-block.tsx` — JSON/config display (exported)
- `src/components/rioku/sparkline.tsx` — mini inline chart (exported)
- `src/exports/index.ts` — @rioku/ui barrel export for plugins

### Rebuilt pages (all routes):
- `src/routes/__root.tsx` — new layout
- `src/routes/login.tsx` — new
- `src/routes/index.tsx` — dashboard with real data
- `src/routes/config/routes.tsx` — CRUD with shadcn DataTable
- `src/routes/config/services.tsx` — CRUD
- `src/routes/config/policies.tsx` — CRUD
- `src/routes/traffic/live.tsx` — full observability
- `src/routes/traffic/analytics.tsx` — charts
- `src/routes/traffic/ai.tsx` — AI metrics
- `src/routes/cluster.tsx` — node management
- `src/routes/plugins.tsx` — plugin list
- `src/routes/security.tsx` — key management
- `src/routes/settings.tsx` — config display

### Modified:
- `package.json` — new dependencies
- `vite.config.ts` — Tailwind plugin + proxy config
- `tsconfig.json` — path aliases if needed

---

## Verification

- [ ] `npm run dev` starts Vite dev server with hot reload
- [ ] Proxy to daemon works (real API data loads)
- [ ] Login page → token exchange → authenticated dashboard
- [ ] Auto-refresh tokens (access expires → refresh → new token)
- [ ] Route CRUD: create, list, enable/disable, delete
- [ ] Service CRUD: create with upstreams, list, delete
- [ ] Policy CRUD: create with JSON config, list, delete
- [ ] Dashboard shows real metrics from health endpoint
- [ ] Live traffic view connects via SSE and streams events
- [ ] Dark/light theme toggle works
- [ ] Sidebar collapses/expands with Cmd+B
- [ ] Command palette (Cmd+K) navigates to pages
- [ ] Toast notifications on mutations
- [ ] Loading skeletons during data fetch
- [ ] Empty states when no data
- [ ] Responsive: desktop (1440px+), tablet (768px), foldable (717px), phone (375px)
- [ ] Sidebar: full on desktop, icons-only on tablet, hamburger overlay on mobile
- [ ] DataTable: horizontal scroll or card view on mobile
- [ ] Keyboard shortcuts: Cmd+K (palette), Cmd+B (sidebar), Cmd+N (new), ? (help)
- [ ] Shortcuts display correct modifier (Cmd on macOS, Ctrl on Windows/Linux)
- [ ] Toast notifications on all mutations (create, delete, enable, etc.)
- [ ] Audit log page: filter by actor, entity type, time range
- [ ] Audit log: diff viewer shows JSON diff of changes
- [ ] Resource detail pages: "History" tab shows entity-specific audit trail
- [ ] Dashboard: "Recent activity" widget shows last 5 audit entries
- [ ] Destructive actions require confirmation dialog before executing
- [ ] Auth events (login, failed attempts) create audit entries
- [ ] API key operations create audit entries
- [ ] No mutation can happen without producing an audit entry
- [ ] All user-facing strings use t() — no hardcoded English in components
- [ ] Locale files exist at src/locales/en/*.json
- [ ] Plugin injection zones render nothing when no plugins installed
- [ ] @rioku/ui exports are accessible for plugin development
- [ ] `npm run build` produces optimized bundle for go:embed
