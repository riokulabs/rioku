# Admin Panel Architecture

## Overview

The admin panel is a React 19 SPA at `packages/web/` that provides full management of the Rioku API gateway. It embeds into the daemon binary via `go:embed` and is served at the REST API port (default `:7778`).

## Tech Stack

| Concern | Technology |
|---|---|
| UI framework | React 19 |
| Design system | `@rioku/ui` (monorepo package at `packages/ui/`) |
| Routing | TanStack Router (file-based) |
| Server state | TanStack React Query |
| Forms | react-hook-form + Zod |
| Styling | Tailwind CSS v4 |
| Icons | lucide-react (via `@rioku/ui` `Icon` wrapper) |
| Charts | Recharts |
| i18n | react-i18next |
| Build | Vite |
| Tests | Vitest + React Testing Library + Playwright |
| Mocks | MSW (Mock Service Worker) |

## Design System (`@rioku/ui`)

All base UI components live in the `@rioku/ui` monorepo package. The admin panel imports everything from `@rioku/ui` — there are no local UI primitive components.

### Component Categories (~61 components)

- **Form Controls**: Button, Input, Textarea, Select, NativeSelect, Checkbox, Switch, RadioGroup, Slider, DatePicker, FileUpload, ColorPicker, InputGroup, TagInput, KVEditor, DurationInput, SearchableSelect, SearchableMultiSelect, FormField, FormSection, FieldError, Label, Spinner
- **Data Display**: Badge, Avatar, Card, Table, ResponsiveTable, Tooltip, Popover, Accordion, StatCard, EmptyState, Skeleton, CodeBlock, KeyValueList
- **Layout**: Separator, ScrollArea, Tabs, PageHeader, Stack, Grid, ProgressBar
- **Feedback & Overlays**: Dialog, Sheet, Alert, Toast, ConfirmDialog, Command, DropdownMenu
- **Navigation**: Breadcrumb, Pagination, StepIndicator
- **Typography**: Heading, Text, Link
- **Editors**: YamlJsonEditor
- **Infrastructure**: Icon, ErrorBoundary, VirtualList, VirtualTable, FocusTrap, SkipToContent, Gate, GateAction, InjectionZone, RiokuProvider

### Design Tokens

Three-layer token system:
1. **Primitive** — theme-independent values (spacing, radii, font sizes, shadows, animation, z-index)
2. **Semantic** — theme-aware colors (change per dark/light/high-contrast)
3. **Component** — optional per-component overrides

All defined as CSS custom properties in `packages/ui/src/theme/tokens.css`.

### Theming

- Three built-in themes: Dark (default), Light, High Contrast
- Custom themes via `ThemeContract` TypeScript interface + `registerTheme()` API
- OS preference detection (`prefers-color-scheme`, `prefers-reduced-motion`, `prefers-contrast`)
- All colors in OKLCh color space

### Provider Stack

```
<RiokuProvider>
  <ThemeProvider>       — theme switching, OS detection
  <LocaleProvider>      — locale, dir (RTL/LTR), Intl formatters
  <PortalProvider>      — overlay mount points
  <PermissionProvider>  — 3-state permissions (allowed/read-only/denied)
  <ZoneProvider>        — plugin injection zone registry
</RiokuProvider>
```

### Compound Component Convention

Components with 2+ content slots use dot notation:

```tsx
<Card>
  <Card.Header>Title</Card.Header>
  <Card.Body>Content</Card.Body>
  <Card.Footer>Actions</Card.Footer>
</Card>
```

Single-element components use flat props: `<Button variant="primary" loading>Save</Button>`

## Web App Architecture

### Directory Structure

```
packages/web/src/
├── components/
│   ├── config/          — Route, Service, Policy feature components
│   ├── security/        — User, Role, API Key, Access Policy components
│   ├── traffic/         — Analytics, Live, AI traffic components
│   ├── settings/        — Settings form components
│   ├── system/          — Dashboard, Audit, Cluster, Certificate components
│   ├── shared/          — Cross-feature components (data-table, status-badge, etc.)
│   ├── layout/          — App shell (sidebar, header, nav, command palette)
│   ├── plugin/          — Plugin host, error boundary
│   └── dev/             — Dev-only toolbar
├── hooks/               — Custom React hooks
├── lib/
│   ├── api/             — Domain-split API layer
│   │   ├── client.ts    — Typed fetch wrapper with error handling
│   │   ├── config.ts    — Route/Service/Policy types + queries
│   │   ├── security.ts  — User/Role/ApiKey types + queries
│   │   ├── traffic.ts   — Analytics/Live/AI types + queries
│   │   ├── settings.ts  — Settings types + queries
│   │   ├── system.ts    — Health/Cluster/Cert/Audit types + queries
│   │   └── index.ts     — Barrel re-export
│   └── schemas/         — Zod validation schemas
├── mocks/
│   ├── data/            — Typed mock data by domain
│   ├── handlers/        — MSW handlers by domain
│   └── scenarios/       — Pre-configured mock states (full, empty, error, readonly)
├── routes/              — TanStack Router file-based routes (all <200 lines)
├── locales/             — i18n translation files
└── test/                — Test utilities (providers, mocks, matchers)
```

### Route File Convention

Route files are thin orchestrators. Max 200 lines. They define the route, set up the loader, and compose imported feature components.

```tsx
// Example: routes/config/services.$serviceId.tsx (~80 lines)
export const Route = createFileRoute('/config/services/$serviceId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(serviceQueryOptions(params.serviceId)),
  component: ServiceDetailPage,
})

function ServiceDetailPage() {
  const { data: service } = useSuspenseQuery(serviceQueryOptions(serviceId))
  return (
    <>
      <PageHeader title={service.name} />
      <Tabs value={tab} onValueChange={setTab}>
        <Tabs.Content value="overview"><ServiceOverviewTab service={service} /></Tabs.Content>
        {/* ... other tabs ... */}
      </Tabs>
    </>
  )
}
```

### API Layer

Domain-split files, each containing types + query options + mutation functions:

```tsx
// lib/api/config.ts
export const serviceListQueryOptions = () =>
  queryOptions({
    queryKey: ['services'],
    queryFn: ({ signal }) => client.get<Service[]>('/config/services', { signal }),
  })

export const createService = (payload: ServiceCreatePayload) =>
  client.post<Service>('/config/services', payload)
```

The `client` handles auth cookies, request IDs, structured errors (`ApiError`), and network error detection.

### Form Architecture

All forms use react-hook-form + Zod. No raw `useState` for form state.

```tsx
const schema = z.object({ name: z.string().min(1), email: z.string().email() })
const { register, handleSubmit } = useForm({ resolver: zodResolver(schema) })
```

Shared validators in `lib/schemas/validators.ts` (duration, urlPath, port, hostname, etc.).

### Permission System

Three permission states: **allowed**, **read-only**, **denied**.

```tsx
<Gate permission="services:write" fallback="read-only">
  <ServiceForm service={service} />  {/* Disabled inputs when read-only */}
</Gate>

<GateAction permission="services:delete">
  <Button variant="danger">Delete</Button>  {/* Hidden when denied */}
</GateAction>
```

Permission logic: `admin` = all access, `resource:*` wildcard, `resource:read` for `resource:write` = read-only fallback.

## Plugin Extension System

### Injection Zones

Plugins inject UI at named mount points throughout the admin panel:

| Zone | Location |
|---|---|
| `sidebar.top` / `sidebar.bottom` / `sidebar.nav` | Sidebar areas |
| `header.actions` | Header action buttons |
| `command-palette` | Custom commands |
| `dashboard.widgets` / `dashboard.charts` | Dashboard page |
| `service.tabs` / `route.tabs` / `user.tabs` | Detail page tabs |
| `settings.sections` | Settings categories |
| `*.actions` | Entity action buttons |

```tsx
<InjectionZone name="dashboard.widgets" context={{ timeRange }} />
```

### Plugin Manifest

```tsx
export const pluginManifest = {
  id: 'my-plugin',
  name: 'My Plugin',
  permissions: {
    requires: ['analytics:read'],
    registers: [{ key: 'my-plugin:configure', label: 'Configure My Plugin' }],
  },
  zones: [
    { zone: 'dashboard.widgets', component: () => import('./widget'), priority: 10 },
    { zone: 'sidebar.nav', component: () => import('./nav'), priority: 100 },
  ],
}
```

### Plugin Developer Experience

Plugins get full `@rioku/ui` component library, theme-aware rendering, locale support, and permission integration. They're sandboxed from core translations, theme mutation, and route registration.

## Cross-Cutting Concerns

### Responsive Design

Mobile-first breakpoints: base (0), sm (640), md (768), lg (1024), xl (1280), 2xl (1536).

- **Desktop**: Full sidebar (240px), multi-column forms, full table columns
- **Tablet**: Collapsed sidebar (64px icons), single-column forms, reduced columns
- **Mobile**: Hidden sidebar (Sheet overlay), card-based tables, stacked layout

### Accessibility

- WCAG 2.1 AA minimum, AAA for high-contrast mode
- Full keyboard navigation on all interactive components
- ARIA attributes, focus management, screen reader support
- `prefers-reduced-motion` support
- RTL support via logical CSS properties
- Minimum 44x44px touch targets

### Localization

- react-i18next with namespace isolation
- No hardcoded English in `@rioku/ui` components
- RTL support via `LocaleProvider`
- Locale-aware date/number formatting via `Intl` APIs
- Plugin translation namespaces isolated from core

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Mod+K` | Command palette |
| `Mod+B` | Toggle sidebar |
| `Mod+/` | Focus search |
| `Mod+N` | New resource (context-aware) |
| `Mod+S` | Save form |
| `Escape` | Close overlay |
| `Mod+Shift+T` | Toggle theme |
| `?` | Shortcut help |

### Development Workflow

- `make dev` — Full sandbox with real backend
- `npm run dev` — Standalone with MSW mocks (scenario switcher via dev toolbar)
- `npm run storybook` — Component development in isolation
- `npm run test` — Vitest unit/integration tests
- Dev toolbar shows: viewport width, current mode, mock scenario

### Testing

- **Unit**: Vitest + React Testing Library (851 tests)
- **Component**: Storybook stories (54 stories + 9 MDX docs)
- **Design system**: Vitest (637 tests)
- **E2E**: Playwright against sandbox

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard (stats, charts, recent activity, health) |
| `/login` | Authentication |
| `/config/services/*` | Service CRUD (list, create, detail with 6 tabs) |
| `/config/routes/*` | Route CRUD (list, create with 3 modes, detail) |
| `/config/policies/*` | Policy CRUD (list, create, detail) |
| `/security/users/*` | User management + roles + access policies |
| `/security/api-keys/*` | API key management |
| `/traffic/analytics` | Traffic analytics with charts |
| `/traffic/live` | Live request stream via SSE |
| `/traffic/ai` | AI workload metrics |
| `/audit` | Audit log with filters + diff viewer |
| `/cluster` | Cluster node management |
| `/certificates` | TLS certificate management |
| `/settings/*` | Daemon settings (profile, observability, TLS, auth, PKI, etc.) |
| `/plugins/$pluginId` | Plugin pages |
