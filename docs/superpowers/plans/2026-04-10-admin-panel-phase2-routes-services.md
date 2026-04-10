# Admin Panel Phase 2: Routes & Services Overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Sheet-based route/service CRUD with full-page detail views, tabbed layouts, faceted DataTable filtering, inline editing, form/YAML dual-mode creation, and all fields from the spec -- rendering NEEDS BACKEND fields as disabled placeholders.

**Architecture:** Six new route files (list overhaul, detail page, create page -- for both routes and services), a shared Zod validation layer, shared hooks (useDirtyForm, useUnsavedWarning, useTabFromUrl, useFacetedFilter), i18n expansions, and comprehensive Vitest tests for every new component/hook. Each page follows the full-page detail pattern from the spec (Section 5.1). The existing `routes.tsx` and `services.tsx` files are replaced in-place. Phase 1 components (`DataTable`, `SearchableSelect`, `SearchableMultiSelect`, `YamlJsonEditor`, `Tabs`, `Skeleton`) are assumed to exist in `@/components/rioku/` or `@/components/ui/`.

**Tech Stack:** React 19, TanStack Router 1.x, TanStack Query 5.x, Zod, react-i18next, Vitest 4.x, @testing-library/react, happy-dom

**Spec:** `docs/superpowers/specs/2026-04-10-admin-panel-overhaul-v2.md` (Sections 4, 5, 6, 7, 8, 12, 16, 18)

**Depends on:** Phase 1 must be complete. The following components/hooks must exist:
- `@/components/rioku/data-table.tsx` -- enhanced DataTable with checkbox selection, faceted filtering, hover actions, bulk action bar, column visibility, URL state sync
- `@/components/rioku/searchable-select.tsx` -- SearchableSelect and SearchableMultiSelect
- `@/components/rioku/yaml-json-editor.tsx` -- YamlJsonEditor with bidirectional form sync
- `@/components/rioku/form-section.tsx` -- FormSection (collapsible), FormField, TagInput, DurationInput, KeyValueEditor
- `@/components/ui/checkbox.tsx` -- themed Checkbox (shadcn)
- `@/components/ui/tabs.tsx` -- already exists
- `@/components/ui/skeleton.tsx` -- already exists

---

## Backend API Status

Fields marked **FRONTEND ONLY** have working API endpoints. Fields marked **NEEDS BACKEND** render in the UI but are disabled with a tooltip: "Available in a future release."

### Route fields
| Field | API Status | Proto field |
|-------|-----------|-------------|
| name, matchers (hosts/paths/methods/headers), serviceId, policyIds, enabled, labels | FRONTEND ONLY | Exists in `config.proto` Route message |
| TLS (force HTTPS, min version, client auth, mTLS) | NEEDS BACKEND | Not in proto yet |
| Query matchers, header_regexp, CEL expression, NOT matcher | NEEDS BACKEND | Not in proto yet |
| Streaming toggle (flush_interval) | NEEDS BACKEND | Not in proto yet |
| Priority/ordering | NEEDS BACKEND | Not in proto yet |
| Traffic stats (charts, recent requests) | NEEDS BACKEND | TrafficService exists but per-route filtering TBD |
| Activity/change log | NEEDS BACKEND | Audit endpoint exists but per-entity filtering TBD |

### Service fields
| Field | API Status | Proto field |
|-------|-----------|-------------|
| name, upstreams (address/weight/tls/healthy), lbPolicy, healthCheck (enabled/path/interval/timeout/thresholds/statuses), labels | FRONTEND ONLY | Exists in `config.proto` Service/HealthCheck messages |
| Passive health checks (failure window, max failures, latency threshold, unhealthy statuses) | NEEDS BACKEND | Not in proto yet |
| Timeouts (dial, response header, idle) | NEEDS BACKEND | Not in proto yet |
| Retries (max attempts, retry statuses) | NEEDS BACKEND | Not in proto yet |
| Connection pool (max conns, max idle, keep-alive) | NEEDS BACKEND | Not in proto yet |
| Transport (TLS to upstream, HTTP version, keep-alive, connection pool) | NEEDS BACKEND | Not in proto yet |
| Cookie/Header LB policy params | NEEDS BACKEND | Not in proto yet |
| Traffic stats | NEEDS BACKEND | TrafficService per-service filtering TBD |
| Activity/change log | NEEDS BACKEND | Audit per-entity filtering TBD |

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `packages/web/src/lib/schemas/route.ts` | Zod schemas for route form validation |
| `packages/web/src/lib/schemas/service.ts` | Zod schemas for service form validation |
| `packages/web/src/hooks/use-dirty-form.ts` | Track dirty state by comparing initial vs current form values |
| `packages/web/src/hooks/use-unsaved-warning.ts` | Block navigation + beforeunload when form is dirty |
| `packages/web/src/hooks/use-tab-from-url.ts` | Sync active tab with `?tab=` URL search param |
| `packages/web/src/hooks/use-config-mutations.ts` | Shared route/service/policy mutation hooks (extract from current pages) |
| `packages/web/src/components/rioku/diff-view.tsx` | Side-by-side old/new value display for "Review changes" panel |
| `packages/web/src/components/rioku/needs-backend-field.tsx` | Disabled field wrapper with "Available in a future release" tooltip |
| `packages/web/src/routes/config/routes.index.tsx` | Route list page (replaces `routes.tsx`) |
| `packages/web/src/routes/config/routes.$routeId.tsx` | Route detail page (full-page, tabbed) |
| `packages/web/src/routes/config/routes.create.tsx` | Route create page (full-page, form+YAML) |
| `packages/web/src/routes/config/services.index.tsx` | Service list page (replaces `services.tsx`) |
| `packages/web/src/routes/config/services.$serviceId.tsx` | Service detail page (full-page, tabbed) |
| `packages/web/src/routes/config/services.create.tsx` | Service create page (full-page, form+YAML) |
| `packages/web/src/hooks/__tests__/use-dirty-form.test.ts` | Tests for useDirtyForm |
| `packages/web/src/hooks/__tests__/use-unsaved-warning.test.ts` | Tests for useUnsavedWarning |
| `packages/web/src/hooks/__tests__/use-tab-from-url.test.ts` | Tests for useTabFromUrl |
| `packages/web/src/hooks/__tests__/use-config-mutations.test.ts` | Tests for shared mutation hooks |
| `packages/web/src/lib/schemas/__tests__/route.test.ts` | Tests for route Zod schemas |
| `packages/web/src/lib/schemas/__tests__/service.test.ts` | Tests for service Zod schemas |
| `packages/web/src/components/rioku/__tests__/diff-view.test.tsx` | Tests for DiffView |
| `packages/web/src/components/rioku/__tests__/needs-backend-field.test.tsx` | Tests for NeedsBackendField |

### Modified Files

| File | Changes |
|------|---------|
| `packages/web/src/routes/config/routes.tsx` | Deleted -- replaced by `routes.index.tsx` |
| `packages/web/src/routes/config/services.tsx` | Deleted -- replaced by `services.index.tsx` |
| `packages/web/src/lib/api.ts` | Add missing type fields, add per-entity query helpers |
| `packages/web/src/locales/en/routes.json` | Expand with detail/create/tab translation keys |
| `packages/web/src/locales/en/services.json` | Expand with detail/create/tab translation keys |
| `packages/web/src/locales/en/common.json` | Add shared keys (unsaved, diff, tabs, needs-backend) |

---

## Task 1: Zod Validation Schemas

**Files:**
- Create: `packages/web/src/lib/schemas/route.ts`
- Create: `packages/web/src/lib/schemas/service.ts`
- Create: `packages/web/src/lib/schemas/__tests__/route.test.ts`
- Create: `packages/web/src/lib/schemas/__tests__/service.test.ts`

- [ ] **Step 1: Write route schema tests**

Create `packages/web/src/lib/schemas/__tests__/route.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  routeFormSchema,
  type RouteFormValues,
  pathMatcherSchema,
  headerMatcherSchema,
} from '../route'

describe('routeFormSchema', () => {
  it('accepts a valid minimal route', () => {
    const input: RouteFormValues = {
      name: 'api-gateway',
      enabled: true,
      hosts: [],
      paths: [{ type: 'TYPE_PREFIX', value: '/api' }],
      methods: [],
      headers: [],
      targetType: 'service',
      serviceId: 'svc-123',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }
    const result = routeFormSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const input = {
      name: '',
      enabled: true,
      hosts: [],
      paths: [],
      methods: [],
      headers: [],
      targetType: 'service',
      serviceId: 'svc-123',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }
    const result = routeFormSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name')
    }
  })

  it('rejects service target without serviceId', () => {
    const input = {
      name: 'test',
      enabled: true,
      hosts: [],
      paths: [],
      methods: [],
      headers: [],
      targetType: 'service',
      serviceId: '',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }
    const result = routeFormSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('accepts direct upstream target', () => {
    const input: RouteFormValues = {
      name: 'direct-route',
      enabled: true,
      hosts: ['api.example.com'],
      paths: [],
      methods: ['GET', 'POST'],
      headers: [],
      targetType: 'direct',
      serviceId: '',
      directAddress: '10.0.1.10:8080',
      directTls: 'TLS_MODE_AUTO',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }
    const result = routeFormSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('validates path matcher type is one of the allowed values', () => {
    const result = pathMatcherSchema.safeParse({ type: 'INVALID', value: '/api' })
    expect(result.success).toBe(false)
  })

  it('rejects path matcher with empty value', () => {
    const result = pathMatcherSchema.safeParse({ type: 'TYPE_PREFIX', value: '' })
    expect(result.success).toBe(false)
  })

  it('validates header matcher requires name', () => {
    const result = headerMatcherSchema.safeParse({ name: '', value: 'bar', invert: false })
    expect(result.success).toBe(false)
  })

  it('accepts full header matcher', () => {
    const result = headerMatcherSchema.safeParse({ name: 'X-Custom', value: 'bar', invert: true })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/lib/schemas/__tests__/route.test.ts`

Expected: FAIL -- module `../route` not found.

- [ ] **Step 3: Write route schema implementation**

Create `packages/web/src/lib/schemas/route.ts`:

```typescript
import { z } from 'zod'

export const PATH_MATCHER_TYPES = ['TYPE_EXACT', 'TYPE_PREFIX', 'TYPE_REGEXP'] as const
export const TLS_MODES = ['TLS_MODE_OFF', 'TLS_MODE_AUTO', 'TLS_MODE_CUSTOM', 'TLS_MODE_INTERNAL'] as const
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export const MIN_TLS_VERSIONS = ['1.2', '1.3'] as const
export const CLIENT_AUTH_MODES = ['off', 'request', 'require', 'require_and_verify'] as const

export const pathMatcherSchema = z.object({
  type: z.enum(PATH_MATCHER_TYPES),
  value: z.string().min(1, 'Path value is required'),
})

export const headerMatcherSchema = z.object({
  name: z.string().min(1, 'Header name is required'),
  value: z.string(),
  invert: z.boolean().default(false),
})

export const routeFormSchema = z.object({
  name: z.string().min(1, 'Route name is required').max(128, 'Route name too long'),
  enabled: z.boolean(),
  hosts: z.array(z.string()),
  paths: z.array(pathMatcherSchema),
  methods: z.array(z.enum(HTTP_METHODS)),
  headers: z.array(headerMatcherSchema),
  targetType: z.enum(['service', 'direct']),
  serviceId: z.string(),
  directAddress: z.string(),
  directTls: z.enum(TLS_MODES),
  policyIds: z.array(z.string()),
  labels: z.record(z.string(), z.string()),
  // TLS fields -- NEEDS BACKEND (rendered but disabled)
  forceTls: z.boolean(),
  minTlsVersion: z.enum(MIN_TLS_VERSIONS),
  clientAuth: z.enum(CLIENT_AUTH_MODES),
}).refine(
  (data) => {
    if (data.targetType === 'service') return data.serviceId.length > 0
    return data.directAddress.length > 0
  },
  {
    message: 'A service or direct upstream address is required',
    path: ['serviceId'],
  },
)

export type RouteFormValues = z.infer<typeof routeFormSchema>

/** Convert an API Route object to form values. */
export function routeToFormValues(route: {
  name: string
  matchers: Array<{
    hosts?: string[]
    paths?: Array<{ type: string; value: string }>
    methods?: string[]
    headers?: Array<{ name: string; value: string; invert?: boolean }>
  }>
  serviceId?: string
  enabled: boolean
  policyIds?: string[]
  labels?: Record<string, string> | null
}): RouteFormValues {
  const m = route.matchers[0]
  return {
    name: route.name,
    enabled: route.enabled,
    hosts: m?.hosts ?? [],
    paths: (m?.paths ?? []).map((p) => ({
      type: p.type as RouteFormValues['paths'][number]['type'],
      value: p.value,
    })),
    methods: (m?.methods ?? []) as RouteFormValues['methods'],
    headers: (m?.headers ?? []).map((h) => ({
      name: h.name,
      value: h.value,
      invert: h.invert ?? false,
    })),
    targetType: route.serviceId ? 'service' : 'direct',
    serviceId: route.serviceId ?? '',
    directAddress: '',
    directTls: 'TLS_MODE_OFF',
    policyIds: route.policyIds ?? [],
    labels: route.labels ?? {},
    forceTls: false,
    minTlsVersion: '1.2',
    clientAuth: 'off',
  }
}

/** Convert form values back to the API payload shape. */
export function formValuesToRoutePayload(
  values: RouteFormValues,
  existingId?: string,
): Record<string, unknown> {
  const route: Record<string, unknown> = {
    ...(existingId ? { id: existingId } : {}),
    name: values.name,
    enabled: values.enabled,
    matchers: [
      {
        ...(values.hosts.length > 0 ? { hosts: values.hosts } : {}),
        ...(values.paths.length > 0 ? { paths: values.paths } : {}),
        ...(values.methods.length > 0 ? { methods: values.methods } : {}),
        ...(values.headers.length > 0 ? { headers: values.headers } : {}),
      },
    ],
    policyIds: values.policyIds,
    labels: Object.keys(values.labels).length > 0 ? values.labels : null,
  }

  if (values.targetType === 'service') {
    route.serviceId = values.serviceId
  } else {
    route.upstream = {
      address: values.directAddress,
      tls: values.directTls,
    }
  }

  return route
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/lib/schemas/__tests__/route.test.ts`

Expected: All 8 tests PASS.

- [ ] **Step 5: Install zod (if not already present)**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && node -e "try{require.resolve('zod');console.log('zod already installed')}catch{console.log('NEEDS INSTALL')}"`

If output is `NEEDS INSTALL`, run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npm install zod`

- [ ] **Step 6: Write service schema tests**

Create `packages/web/src/lib/schemas/__tests__/service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  serviceFormSchema,
  type ServiceFormValues,
  upstreamSchema,
  activeHealthCheckSchema,
} from '../service'

describe('serviceFormSchema', () => {
  it('accepts a valid minimal service', () => {
    const input: ServiceFormValues = {
      name: 'backend-api',
      lbPolicy: 'LB_POLICY_ROUND_ROBIN',
      upstreams: [{ address: '10.0.1.10:8080', weight: 1, tls: 'TLS_MODE_OFF' }],
      activeHealthCheck: {
        enabled: false,
        path: '/health',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        healthyThreshold: 2,
        unhealthyThreshold: 3,
        expectedStatuses: [200],
      },
      passiveHealthCheck: {
        enabled: false,
        failureWindow: '',
        maxFailures: 5,
        latencyThreshold: '',
        unhealthyStatuses: [],
      },
      timeouts: { dial: '', responseHeader: '', idle: '' },
      retries: { maxAttempts: 0, retryStatuses: [] },
      connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
      labels: {},
    }
    const result = serviceFormSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const input = {
      name: '',
      lbPolicy: 'LB_POLICY_ROUND_ROBIN',
      upstreams: [{ address: '10.0.1.10:8080', weight: 1, tls: 'TLS_MODE_OFF' }],
      activeHealthCheck: { enabled: false, path: '', intervalSeconds: 0, timeoutSeconds: 0, healthyThreshold: 0, unhealthyThreshold: 0, expectedStatuses: [] },
      passiveHealthCheck: { enabled: false, failureWindow: '', maxFailures: 0, latencyThreshold: '', unhealthyStatuses: [] },
      timeouts: { dial: '', responseHeader: '', idle: '' },
      retries: { maxAttempts: 0, retryStatuses: [] },
      connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
      labels: {},
    }
    const result = serviceFormSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name')
    }
  })

  it('rejects service with no upstreams', () => {
    const input = {
      name: 'test',
      lbPolicy: 'LB_POLICY_ROUND_ROBIN',
      upstreams: [],
      activeHealthCheck: { enabled: false, path: '', intervalSeconds: 0, timeoutSeconds: 0, healthyThreshold: 0, unhealthyThreshold: 0, expectedStatuses: [] },
      passiveHealthCheck: { enabled: false, failureWindow: '', maxFailures: 0, latencyThreshold: '', unhealthyStatuses: [] },
      timeouts: { dial: '', responseHeader: '', idle: '' },
      retries: { maxAttempts: 0, retryStatuses: [] },
      connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
      labels: {},
    }
    const result = serviceFormSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('validates upstream address is required', () => {
    const result = upstreamSchema.safeParse({ address: '', weight: 1, tls: 'TLS_MODE_OFF' })
    expect(result.success).toBe(false)
  })

  it('validates upstream weight must be non-negative', () => {
    const result = upstreamSchema.safeParse({ address: '10.0.0.1:8080', weight: -1, tls: 'TLS_MODE_OFF' })
    expect(result.success).toBe(false)
  })

  it('validates active health check path when enabled', () => {
    const result = activeHealthCheckSchema.safeParse({
      enabled: true, path: '', intervalSeconds: 10, timeoutSeconds: 5,
      healthyThreshold: 2, unhealthyThreshold: 3, expectedStatuses: [200],
    })
    expect(result.success).toBe(false)
  })

  it('accepts disabled health check with empty path', () => {
    const result = activeHealthCheckSchema.safeParse({
      enabled: false, path: '', intervalSeconds: 0, timeoutSeconds: 0,
      healthyThreshold: 0, unhealthyThreshold: 0, expectedStatuses: [],
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 7: Run service schema tests to verify failure**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/lib/schemas/__tests__/service.test.ts`

Expected: FAIL -- module `../service` not found.

- [ ] **Step 8: Write service schema implementation**

Create `packages/web/src/lib/schemas/service.ts`:

```typescript
import { z } from 'zod'

export const LB_POLICIES = [
  'LB_POLICY_UNSPECIFIED',
  'LB_POLICY_ROUND_ROBIN',
  'LB_POLICY_RANDOM',
  'LB_POLICY_LEAST_CONN',
  'LB_POLICY_IP_HASH',
  'LB_POLICY_WEIGHTED_ROUND_ROBIN',
] as const

export const LB_POLICY_LABELS: Record<string, string> = {
  LB_POLICY_UNSPECIFIED: 'None',
  LB_POLICY_ROUND_ROBIN: 'Round Robin',
  LB_POLICY_RANDOM: 'Random',
  LB_POLICY_LEAST_CONN: 'Least Connections',
  LB_POLICY_IP_HASH: 'IP Hash',
  LB_POLICY_WEIGHTED_ROUND_ROBIN: 'Weighted Round Robin',
}

export const TLS_MODES = ['TLS_MODE_OFF', 'TLS_MODE_AUTO', 'TLS_MODE_CUSTOM', 'TLS_MODE_INTERNAL'] as const

export const TLS_MODE_LABELS: Record<string, string> = {
  TLS_MODE_OFF: 'Off',
  TLS_MODE_AUTO: 'Auto',
  TLS_MODE_CUSTOM: 'Custom',
  TLS_MODE_INTERNAL: 'Internal (mTLS)',
}

export const upstreamSchema = z.object({
  address: z.string().min(1, 'Address is required'),
  weight: z.number().min(0, 'Weight must be non-negative'),
  tls: z.enum(TLS_MODES),
})

export const activeHealthCheckSchema = z.object({
  enabled: z.boolean(),
  path: z.string(),
  intervalSeconds: z.number().min(0),
  timeoutSeconds: z.number().min(0),
  healthyThreshold: z.number().min(0),
  unhealthyThreshold: z.number().min(0),
  expectedStatuses: z.array(z.number()),
}).refine(
  (data) => !data.enabled || data.path.length > 0,
  { message: 'Health check path is required when enabled', path: ['path'] },
)

export const passiveHealthCheckSchema = z.object({
  enabled: z.boolean(),
  failureWindow: z.string(),
  maxFailures: z.number().min(0),
  latencyThreshold: z.string(),
  unhealthyStatuses: z.array(z.number()),
})

export const timeoutsSchema = z.object({
  dial: z.string(),
  responseHeader: z.string(),
  idle: z.string(),
})

export const retriesSchema = z.object({
  maxAttempts: z.number().min(0),
  retryStatuses: z.array(z.number()),
})

export const connectionPoolSchema = z.object({
  maxConnsPerHost: z.number().min(0),
  maxIdleConns: z.number().min(0),
  keepAliveInterval: z.string(),
})

export const serviceFormSchema = z.object({
  name: z.string().min(1, 'Service name is required').max(128, 'Service name too long'),
  lbPolicy: z.enum(LB_POLICIES),
  upstreams: z.array(upstreamSchema).min(1, 'At least one upstream is required'),
  activeHealthCheck: activeHealthCheckSchema,
  passiveHealthCheck: passiveHealthCheckSchema,
  connectionPool: connectionPoolSchema,
  timeouts: timeoutsSchema,
  retries: retriesSchema,
  labels: z.record(z.string(), z.string()),
})

export type ServiceFormValues = z.infer<typeof serviceFormSchema>
export type UpstreamValues = z.infer<typeof upstreamSchema>

/** Convert an API Service to form values. */
export function serviceToFormValues(service: {
  name: string
  lbPolicy: string
  upstreams: Array<{ address: string; weight: number; tls: string }>
  healthCheck?: { enabled: boolean; path: string; intervalSeconds: number; timeoutSeconds: number; unhealthyThreshold: number; healthyThreshold: number; expectedStatuses: number[] } | null
  labels?: Record<string, string> | null
}): ServiceFormValues {
  const hc = service.healthCheck
  return {
    name: service.name,
    lbPolicy: service.lbPolicy as ServiceFormValues['lbPolicy'],
    upstreams: service.upstreams.map((u) => ({
      address: u.address,
      weight: u.weight,
      tls: u.tls as UpstreamValues['tls'],
    })),
    activeHealthCheck: {
      enabled: hc?.enabled ?? false,
      path: hc?.path ?? '/health',
      intervalSeconds: hc?.intervalSeconds ?? 10,
      timeoutSeconds: hc?.timeoutSeconds ?? 5,
      healthyThreshold: hc?.healthyThreshold ?? 2,
      unhealthyThreshold: hc?.unhealthyThreshold ?? 3,
      expectedStatuses: hc?.expectedStatuses ?? [200],
    },
    passiveHealthCheck: {
      enabled: false,
      failureWindow: '',
      maxFailures: 5,
      latencyThreshold: '',
      unhealthyStatuses: [],
    },
    timeouts: { dial: '', responseHeader: '', idle: '' },
    retries: { maxAttempts: 0, retryStatuses: [] },
    connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
    labels: service.labels ?? {},
  }
}

/** Convert form values to API payload. */
export function formValuesToServicePayload(
  values: ServiceFormValues,
  existingId?: string,
): Record<string, unknown> {
  return {
    ...(existingId ? { id: existingId } : {}),
    name: values.name,
    lbPolicy: values.lbPolicy,
    upstreams: values.upstreams.map((u) => ({
      id: '',
      address: u.address,
      weight: u.weight,
      tls: u.tls,
      healthy: true,
    })),
    healthCheck: values.activeHealthCheck.enabled
      ? {
          enabled: true,
          path: values.activeHealthCheck.path,
          intervalSeconds: values.activeHealthCheck.intervalSeconds,
          timeoutSeconds: values.activeHealthCheck.timeoutSeconds,
          healthyThreshold: values.activeHealthCheck.healthyThreshold,
          unhealthyThreshold: values.activeHealthCheck.unhealthyThreshold,
          expectedStatuses: values.activeHealthCheck.expectedStatuses,
        }
      : null,
    labels: Object.keys(values.labels).length > 0 ? values.labels : null,
  }
}
```

- [ ] **Step 9: Run service schema tests to verify they pass**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/lib/schemas/__tests__/service.test.ts`

Expected: All 7 tests PASS.

- [ ] **Step 10: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/lib/schemas/
git commit -m "feat(web): add Zod validation schemas for route and service forms"
```

---

## Task 2: Shared Hooks (useDirtyForm, useUnsavedWarning, useTabFromUrl)

**Files:**
- Create: `packages/web/src/hooks/use-dirty-form.ts`
- Create: `packages/web/src/hooks/use-unsaved-warning.ts`
- Create: `packages/web/src/hooks/use-tab-from-url.ts`
- Create: `packages/web/src/hooks/__tests__/use-dirty-form.test.ts`
- Create: `packages/web/src/hooks/__tests__/use-unsaved-warning.test.ts`
- Create: `packages/web/src/hooks/__tests__/use-tab-from-url.test.ts`

- [ ] **Step 1: Write useDirtyForm tests**

Create `packages/web/src/hooks/__tests__/use-dirty-form.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDirtyForm } from '../use-dirty-form'

describe('useDirtyForm', () => {
  it('returns not dirty when values equal initial', () => {
    const initial = { name: 'foo', enabled: true }
    const { result } = renderHook(() => useDirtyForm(initial, initial))
    expect(result.current.isDirty).toBe(false)
    expect(result.current.changedFields).toEqual([])
  })

  it('returns dirty when a string field changes', () => {
    const initial = { name: 'foo', enabled: true }
    const current = { name: 'bar', enabled: true }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(true)
    expect(result.current.changedFields).toEqual(['name'])
  })

  it('returns dirty when a boolean field changes', () => {
    const initial = { name: 'foo', enabled: true }
    const current = { name: 'foo', enabled: false }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(true)
    expect(result.current.changedFields).toEqual(['enabled'])
  })

  it('detects array changes', () => {
    const initial = { tags: ['a', 'b'] }
    const current = { tags: ['a', 'c'] }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(true)
    expect(result.current.changedFields).toEqual(['tags'])
  })

  it('treats identical arrays as not dirty', () => {
    const initial = { tags: ['a', 'b'] }
    const current = { tags: ['a', 'b'] }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(false)
  })

  it('detects nested object changes via JSON comparison', () => {
    const initial = { meta: { key: 'val' } }
    const current = { meta: { key: 'changed' } }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/hooks/__tests__/use-dirty-form.test.ts`

Expected: FAIL -- module not found.

- [ ] **Step 3: Implement useDirtyForm**

Create `packages/web/src/hooks/use-dirty-form.ts`:

```typescript
import { useMemo } from 'react'

interface DirtyFormResult {
  isDirty: boolean
  changedFields: string[]
}

/**
 * Compare initial and current form values to detect unsaved changes.
 * Uses JSON serialization for deep comparison of arrays and objects.
 */
export function useDirtyForm<T extends Record<string, unknown>>(
  initial: T,
  current: T,
): DirtyFormResult {
  return useMemo(() => {
    const changedFields: string[] = []
    const keys = Object.keys(initial) as Array<keyof T & string>

    for (const key of keys) {
      const a = initial[key]
      const b = current[key]
      if (a === b) continue
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changedFields.push(key)
      }
    }

    return { isDirty: changedFields.length > 0, changedFields }
  }, [initial, current])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/hooks/__tests__/use-dirty-form.test.ts`

Expected: All 6 tests PASS.

- [ ] **Step 5: Write useUnsavedWarning tests**

Create `packages/web/src/hooks/__tests__/use-unsaved-warning.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnsavedWarning } from '../use-unsaved-warning'

describe('useUnsavedWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds beforeunload listener when dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedWarning(true))
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })

  it('does not add listener when not dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedWarning(false))
    const beforeunloadCalls = addSpy.mock.calls.filter(
      ([event]) => event === 'beforeunload',
    )
    expect(beforeunloadCalls).toHaveLength(0)
  })

  it('removes listener on cleanup', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useUnsavedWarning(true))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })
})
```

- [ ] **Step 6: Implement useUnsavedWarning**

Create `packages/web/src/hooks/use-unsaved-warning.ts`:

```typescript
import { useEffect, useCallback } from 'react'

/**
 * Attach a `beforeunload` warning when the form has unsaved changes.
 * Also provides a `confirmDiscard()` function for in-app navigation guards.
 */
export function useUnsavedWarning(isDirty: boolean): {
  confirmDiscard: () => boolean
} {
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
      }
    },
    [isDirty],
  )

  useEffect(() => {
    if (isDirty) {
      window.addEventListener('beforeunload', handleBeforeUnload)
      return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [isDirty, handleBeforeUnload])

  const confirmDiscard = useCallback(() => {
    if (!isDirty) return true
    return window.confirm('You have unsaved changes. Discard them?')
  }, [isDirty])

  return { confirmDiscard }
}
```

- [ ] **Step 7: Run useUnsavedWarning tests**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/hooks/__tests__/use-unsaved-warning.test.ts`

Expected: All 3 tests PASS.

- [ ] **Step 8: Write useTabFromUrl tests**

Create `packages/web/src/hooks/__tests__/use-tab-from-url.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTabFromUrl } from '../use-tab-from-url'

// Mock window.location.search and history.replaceState
const replaceStateSpy = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, search: '' },
  })
  window.history.replaceState = replaceStateSpy
})

describe('useTabFromUrl', () => {
  it('returns default tab when no search param', () => {
    const { result } = renderHook(() =>
      useTabFromUrl('overview', ['overview', 'matching', 'tls', 'policies']),
    )
    expect(result.current.activeTab).toBe('overview')
  })

  it('reads tab from URL search param', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, search: '?tab=tls' },
    })
    const { result } = renderHook(() =>
      useTabFromUrl('overview', ['overview', 'matching', 'tls', 'policies']),
    )
    expect(result.current.activeTab).toBe('tls')
  })

  it('falls back to default if URL param is invalid', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, search: '?tab=nonexistent' },
    })
    const { result } = renderHook(() =>
      useTabFromUrl('overview', ['overview', 'matching', 'tls']),
    )
    expect(result.current.activeTab).toBe('overview')
  })

  it('updates URL when tab changes', () => {
    const { result } = renderHook(() =>
      useTabFromUrl('overview', ['overview', 'matching', 'tls']),
    )
    act(() => {
      result.current.setActiveTab('matching')
    })
    expect(replaceStateSpy).toHaveBeenCalled()
    expect(result.current.activeTab).toBe('matching')
  })
})
```

- [ ] **Step 9: Implement useTabFromUrl**

Create `packages/web/src/hooks/use-tab-from-url.ts`:

```typescript
import { useState, useCallback } from 'react'

/**
 * Synchronize the active tab with the `?tab=` URL search parameter.
 * Enables deep linking to specific tabs.
 */
export function useTabFromUrl(
  defaultTab: string,
  validTabs: readonly string[],
): {
  activeTab: string
  setActiveTab: (tab: string) => void
} {
  const [activeTab, setActiveTabState] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search)
    const urlTab = params.get('tab')
    if (urlTab && validTabs.includes(urlTab)) return urlTab
    return defaultTab
  })

  const setActiveTab = useCallback(
    (tab: string) => {
      if (!validTabs.includes(tab)) return
      setActiveTabState(tab)
      const params = new URLSearchParams(window.location.search)
      if (tab === defaultTab) {
        params.delete('tab')
      } else {
        params.set('tab', tab)
      }
      const search = params.toString()
      const url = window.location.pathname + (search ? `?${search}` : '')
      window.history.replaceState(null, '', url)
    },
    [defaultTab, validTabs],
  )

  return { activeTab, setActiveTab }
}
```

- [ ] **Step 10: Run all hook tests**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/hooks/__tests__/use-dirty-form.test.ts src/hooks/__tests__/use-unsaved-warning.test.ts src/hooks/__tests__/use-tab-from-url.test.ts`

Expected: All 13 tests PASS.

- [ ] **Step 11: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/hooks/use-dirty-form.ts packages/web/src/hooks/use-unsaved-warning.ts packages/web/src/hooks/use-tab-from-url.ts packages/web/src/hooks/__tests__/
git commit -m "feat(web): add useDirtyForm, useUnsavedWarning, useTabFromUrl hooks"
```

---

## Task 3: Shared Config Mutation Hooks

**Files:**
- Create: `packages/web/src/hooks/use-config-mutations.ts`
- Create: `packages/web/src/hooks/__tests__/use-config-mutations.test.ts`

- [ ] **Step 1: Write mutation hook tests**

Create `packages/web/src/hooks/__tests__/use-config-mutations.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRouteMutations, useServiceMutations } from '../use-config-mutations'

// Mock the apiClient module
vi.mock('@/lib/api', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({}),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useRouteMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides save, delete, and toggle mutations', () => {
    const { result } = renderHook(() => useRouteMutations(), {
      wrapper: createWrapper(),
    })
    expect(result.current.saveMutation).toBeDefined()
    expect(result.current.deleteMutation).toBeDefined()
    expect(result.current.toggleMutation).toBeDefined()
  })

  it('save mutation calls apiClient.post with UPSERT', async () => {
    const { apiClient } = await import('@/lib/api')
    const { result } = renderHook(() => useRouteMutations(), {
      wrapper: createWrapper(),
    })
    result.current.saveMutation.mutate({ name: 'test', enabled: true })
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/config',
      expect.objectContaining({
        route: expect.objectContaining({ action: 'UPSERT' }),
      }),
    ))
  })
})

describe('useServiceMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides save and delete mutations', () => {
    const { result } = renderHook(() => useServiceMutations(), {
      wrapper: createWrapper(),
    })
    expect(result.current.saveMutation).toBeDefined()
    expect(result.current.deleteMutation).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/hooks/__tests__/use-config-mutations.test.ts`

Expected: FAIL -- module not found.

- [ ] **Step 3: Implement useConfigMutations**

Create `packages/web/src/hooks/use-config-mutations.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api'
import type { Route, Service } from '@/lib/api'

/**
 * Shared route mutations: save (UPSERT), delete, toggle enable/disable.
 * Invalidates the config query on success.
 */
export function useRouteMutations() {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: (route: Record<string, unknown>) =>
      apiClient.post('/config', { route: { action: 'UPSERT', route } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onError: () => {
      toast.error('Failed to save route')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', { route: { action: 'DELETE', id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success('Route deleted')
    },
    onError: () => {
      toast.error('Failed to delete route')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (route: Pick<Route, 'id' | 'enabled'>) =>
      apiClient.post('/config', {
        route: { action: 'UPSERT', route: { id: route.id, enabled: !route.enabled } },
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(variables.enabled ? 'Route disabled' : 'Route enabled')
    },
    onError: () => {
      toast.error('Failed to toggle route')
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (route: Record<string, unknown>) => {
      const { id, ...rest } = route
      return apiClient.post('/config', {
        route: { action: 'UPSERT', route: { ...rest, name: `${rest.name}-copy` } },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success('Route duplicated')
    },
    onError: () => {
      toast.error('Failed to duplicate route')
    },
  })

  return { saveMutation, deleteMutation, toggleMutation, duplicateMutation }
}

/**
 * Shared service mutations: save (UPSERT), delete.
 */
export function useServiceMutations() {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: (service: Record<string, unknown>) =>
      apiClient.post('/config', { service: { action: 'UPSERT', service } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onError: () => {
      toast.error('Failed to save service')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', { service: { action: 'DELETE', id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success('Service deleted')
    },
    onError: () => {
      toast.error('Failed to delete service')
    },
  })

  return { saveMutation, deleteMutation }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/hooks/__tests__/use-config-mutations.test.ts`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/hooks/use-config-mutations.ts packages/web/src/hooks/__tests__/use-config-mutations.test.ts
git commit -m "feat(web): extract shared route/service config mutation hooks"
```

---

## Task 4: DiffView and NeedsBackendField Components

**Files:**
- Create: `packages/web/src/components/rioku/diff-view.tsx`
- Create: `packages/web/src/components/rioku/needs-backend-field.tsx`
- Create: `packages/web/src/components/rioku/__tests__/diff-view.test.tsx`
- Create: `packages/web/src/components/rioku/__tests__/needs-backend-field.test.tsx`

- [ ] **Step 1: Write DiffView tests**

Create `packages/web/src/components/rioku/__tests__/diff-view.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiffView } from '../diff-view'

describe('DiffView', () => {
  it('renders changed fields with old and new values', () => {
    const changes = [
      { field: 'Name', oldValue: 'old-route', newValue: 'new-route' },
      { field: 'Enabled', oldValue: 'true', newValue: 'false' },
    ]
    render(<DiffView changes={changes} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('old-route')).toBeInTheDocument()
    expect(screen.getByText('new-route')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('renders empty state when no changes', () => {
    render(<DiffView changes={[]} />)
    expect(screen.getByText('No changes detected')).toBeInTheDocument()
  })

  it('renders added items with green indicator', () => {
    const changes = [
      { field: 'Host matcher', oldValue: null, newValue: 'api.example.com' },
    ]
    render(<DiffView changes={changes} />)
    expect(screen.getByText('api.example.com')).toBeInTheDocument()
    expect(screen.getByTestId('diff-added')).toBeInTheDocument()
  })

  it('renders removed items with red indicator', () => {
    const changes = [
      { field: 'Policy', oldValue: 'rate-limit', newValue: null },
    ]
    render(<DiffView changes={changes} />)
    expect(screen.getByText('rate-limit')).toBeInTheDocument()
    expect(screen.getByTestId('diff-removed')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/components/rioku/__tests__/diff-view.test.tsx`

Expected: FAIL -- module not found.

- [ ] **Step 3: Implement DiffView**

Create `packages/web/src/components/rioku/diff-view.tsx`:

```tsx
import { cn } from '@/lib/utils'
import { MinusIcon, PlusIcon, ArrowRightIcon } from 'lucide-react'

export interface DiffChange {
  field: string
  oldValue: string | null
  newValue: string | null
}

interface DiffViewProps {
  changes: DiffChange[]
  className?: string
}

function DiffView({ changes, className }: DiffViewProps) {
  if (changes.length === 0) {
    return (
      <div className={cn('py-8 text-center text-sm text-muted-foreground', className)}>
        No changes detected
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      {changes.map((change, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-md border p-3 text-sm"
        >
          <span className="min-w-[120px] font-medium text-foreground">
            {change.field}
          </span>
          <div className="flex flex-1 items-center gap-2 text-muted-foreground">
            {change.oldValue === null ? (
              <div data-testid="diff-added" className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                <PlusIcon className="size-3.5" />
                <span className="font-mono text-xs">{change.newValue}</span>
              </div>
            ) : change.newValue === null ? (
              <div data-testid="diff-removed" className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                <MinusIcon className="size-3.5" />
                <span className="font-mono text-xs line-through">{change.oldValue}</span>
              </div>
            ) : (
              <>
                <span className="font-mono text-xs text-red-600 line-through dark:text-red-400">
                  {change.oldValue}
                </span>
                <ArrowRightIcon className="size-3.5 shrink-0" />
                <span className="font-mono text-xs text-green-600 dark:text-green-400">
                  {change.newValue}
                </span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export { DiffView }
export type { DiffViewProps }
```

- [ ] **Step 4: Run DiffView tests**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/components/rioku/__tests__/diff-view.test.tsx`

Expected: All 4 tests PASS.

- [ ] **Step 5: Write NeedsBackendField tests**

Create `packages/web/src/components/rioku/__tests__/needs-backend-field.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeedsBackendField } from '../needs-backend-field'

describe('NeedsBackendField', () => {
  it('renders children with reduced opacity', () => {
    render(
      <NeedsBackendField>
        <input data-testid="inner-input" />
      </NeedsBackendField>,
    )
    const input = screen.getByTestId('inner-input')
    expect(input.closest('[data-testid="needs-backend-wrapper"]')).toBeInTheDocument()
  })

  it('shows tooltip text', () => {
    render(
      <NeedsBackendField>
        <span>Field</span>
      </NeedsBackendField>,
    )
    expect(screen.getByText('Available in a future release')).toBeInTheDocument()
  })

  it('blocks pointer events on children', () => {
    render(
      <NeedsBackendField>
        <button data-testid="btn">Click me</button>
      </NeedsBackendField>,
    )
    const wrapper = screen.getByTestId('needs-backend-wrapper')
    expect(wrapper).toHaveClass('pointer-events-none')
  })
})
```

- [ ] **Step 6: Implement NeedsBackendField**

Create `packages/web/src/components/rioku/needs-backend-field.tsx`:

```tsx
import { cn } from '@/lib/utils'

interface NeedsBackendFieldProps {
  children: React.ReactNode
  className?: string
  message?: string
}

/**
 * Wraps a form field that requires backend support not yet available.
 * Renders the field visually but disabled, with an explanatory message.
 */
function NeedsBackendField({
  children,
  className,
  message = 'Available in a future release',
}: NeedsBackendFieldProps) {
  return (
    <div
      data-testid="needs-backend-wrapper"
      className={cn('pointer-events-none relative opacity-50', className)}
    >
      {children}
      <p className="mt-1 text-xs italic text-muted-foreground">{message}</p>
    </div>
  )
}

export { NeedsBackendField }
export type { NeedsBackendFieldProps }
```

- [ ] **Step 7: Run NeedsBackendField tests**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/components/rioku/__tests__/needs-backend-field.test.tsx`

Expected: All 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/components/rioku/diff-view.tsx packages/web/src/components/rioku/needs-backend-field.tsx packages/web/src/components/rioku/__tests__/diff-view.test.tsx packages/web/src/components/rioku/__tests__/needs-backend-field.test.tsx
git commit -m "feat(web): add DiffView and NeedsBackendField components"
```

---

## Task 5: Expand i18n Translation Keys

**Files:**
- Modify: `packages/web/src/locales/en/routes.json`
- Modify: `packages/web/src/locales/en/services.json`
- Modify: `packages/web/src/locales/en/common.json`

- [ ] **Step 1: Expand routes.json**

Replace the entire contents of `packages/web/src/locales/en/routes.json` with:

```json
{
  "title": "Routes",
  "subtitle": "Manage gateway routing rules",
  "table": {
    "name": "Name",
    "matchers": "Matchers",
    "targetService": "Target service",
    "status": "Status",
    "updated": "Updated",
    "actions": "Actions",
    "policies": "Policies",
    "labels": "Labels"
  },
  "form": {
    "createRoute": "Create route",
    "editRoute": "Edit route",
    "routeName": "Route name",
    "routeNamePlaceholder": "api-gateway",
    "matchHost": "Match host",
    "matchPath": "Match path",
    "matchMethod": "Match method",
    "targetService": "Target service",
    "enabled": "Enabled",
    "enabledDescription": "When disabled, this route will not match any traffic",
    "targetType": "Target type",
    "targetTypeService": "Service",
    "targetTypeDirect": "Direct upstream",
    "directAddress": "Upstream address",
    "directAddressPlaceholder": "10.0.1.10:8080",
    "directTls": "Upstream TLS",
    "duplicateRoute": "Duplicate route"
  },
  "detail": {
    "backToRoutes": "Back to routes",
    "overview": "Overview",
    "matching": "Matching",
    "tls": "TLS",
    "policiesTab": "Policies",
    "traffic": "Traffic",
    "activity": "Activity",
    "editSection": "Edit",
    "saveChanges": "Save changes",
    "cancelEdit": "Cancel",
    "reviewChanges": "Review changes",
    "applyChanges": "Apply changes",
    "routeId": "Route ID",
    "createdAt": "Created",
    "updatedAt": "Last updated",
    "serviceTarget": "Service target",
    "directTarget": "Direct upstream",
    "noTarget": "No target configured"
  },
  "matching": {
    "hosts": "Host matchers",
    "hostsDescription": "Hostnames this route matches (supports wildcards: *.example.com)",
    "addHost": "Add host",
    "paths": "Path matchers",
    "pathsDescription": "URL paths this route matches",
    "addPath": "Add path",
    "pathType": "Match type",
    "pathValue": "Path",
    "pathValuePlaceholder": "/api/v1",
    "methods": "HTTP methods",
    "methodsDescription": "Restrict to specific HTTP methods (empty = all methods)",
    "headers": "Header matchers",
    "headersDescription": "Match requests by header values",
    "addHeader": "Add header",
    "headerName": "Header name",
    "headerValue": "Header value",
    "headerInvert": "Invert match"
  },
  "tls": {
    "forceHttps": "Force HTTPS",
    "forceHttpsDescription": "Redirect all HTTP requests to HTTPS",
    "minVersion": "Minimum TLS version",
    "clientAuth": "Client authentication",
    "clientAuthOff": "Off",
    "clientAuthRequest": "Request",
    "clientAuthRequire": "Require",
    "clientAuthRequireVerify": "Require & Verify"
  },
  "policies": {
    "attached": "Attached policies",
    "attachedDescription": "Policies applied to this route in order",
    "attachPolicy": "Attach policy",
    "detach": "Detach",
    "noPolicies": "No policies attached",
    "noPoliciesDescription": "Attach policies to apply rate limiting, authentication, and other rules to this route."
  },
  "create": {
    "title": "Create route",
    "subtitle": "Define a new routing rule for incoming requests",
    "formMode": "Form",
    "codeMode": "YAML / JSON",
    "sectionBasics": "Basics",
    "sectionMatching": "Matching rules",
    "sectionTarget": "Target",
    "sectionPolicies": "Policies",
    "sectionTls": "TLS",
    "sectionAdvanced": "Advanced",
    "advancedQueryMatchers": "Query string matchers",
    "advancedCelExpression": "CEL expression",
    "advancedStreaming": "Streaming",
    "advancedPriority": "Priority",
    "advancedLabels": "Labels"
  },
  "messages": {
    "routeCreated": "Route created successfully",
    "routeUpdated": "Route updated successfully",
    "routeDeleted": "Route deleted successfully",
    "routeDuplicated": "Route duplicated",
    "confirmDelete": "Are you sure you want to delete this route?",
    "confirmDeleteTitle": "Delete route",
    "unsavedChanges": "You have unsaved changes. Discard them?"
  },
  "empty": {
    "noRoutes": "No routes configured",
    "noRoutesDesc": "Create a route to start directing traffic to your services."
  },
  "filter": {
    "status": "Status",
    "service": "Service",
    "hasPolicy": "Has policy",
    "enabled": "Enabled",
    "disabled": "Disabled"
  }
}
```

- [ ] **Step 2: Expand services.json**

Replace the entire contents of `packages/web/src/locales/en/services.json` with:

```json
{
  "title": "Services",
  "subtitle": "Manage upstream service definitions",
  "table": {
    "name": "Name",
    "upstreams": "Upstreams",
    "lbPolicy": "LB policy",
    "health": "Health",
    "updated": "Updated",
    "actions": "Actions",
    "labels": "Labels"
  },
  "form": {
    "createService": "Create service",
    "editService": "Edit service",
    "serviceName": "Service name",
    "serviceNamePlaceholder": "backend-api",
    "lbPolicy": "Load-balancing policy",
    "addUpstream": "Add upstream",
    "removeUpstream": "Remove upstream",
    "address": "Address",
    "addressPlaceholder": "10.0.1.10:8080",
    "weight": "Weight",
    "tlsMode": "TLS mode"
  },
  "detail": {
    "backToServices": "Back to services",
    "overview": "Overview",
    "healthChecks": "Health checks",
    "transport": "Transport",
    "policiesTab": "Policies",
    "traffic": "Traffic",
    "activity": "Activity",
    "editSection": "Edit",
    "saveChanges": "Save changes",
    "cancelEdit": "Cancel",
    "reviewChanges": "Review changes",
    "applyChanges": "Apply changes",
    "serviceId": "Service ID",
    "createdAt": "Created",
    "updatedAt": "Last updated",
    "upstreamCount": "Upstream count"
  },
  "healthChecks": {
    "active": "Active health checks",
    "activeDescription": "Periodically probe upstreams to verify they are healthy",
    "passive": "Passive health checks",
    "passiveDescription": "Monitor live traffic to detect unhealthy upstreams",
    "enabled": "Enabled",
    "path": "Health check path",
    "pathPlaceholder": "/health",
    "interval": "Interval (seconds)",
    "timeout": "Timeout (seconds)",
    "healthyThreshold": "Healthy threshold",
    "unhealthyThreshold": "Unhealthy threshold",
    "expectedStatuses": "Expected status codes",
    "failureWindow": "Failure window",
    "maxFailures": "Max failures in window",
    "latencyThreshold": "Latency threshold",
    "unhealthyStatuses": "Unhealthy status codes"
  },
  "transport": {
    "title": "Transport configuration",
    "description": "TLS, HTTP version, and connection pool settings for upstream connections",
    "tlsToUpstream": "TLS to upstream",
    "httpVersion": "HTTP version",
    "keepAlive": "Keep-alive",
    "dialTimeout": "Dial timeout",
    "responseHeaderTimeout": "Response header timeout",
    "idleTimeout": "Idle timeout",
    "maxRetries": "Max retries",
    "retryStatuses": "Retry on status codes",
    "maxConnsPerHost": "Max connections per host",
    "maxIdleConns": "Max idle connections",
    "keepAliveInterval": "Keep-alive interval"
  },
  "create": {
    "title": "Create service",
    "subtitle": "Define a new upstream service with load balancing",
    "formMode": "Form",
    "codeMode": "YAML / JSON",
    "sectionGeneral": "General",
    "sectionUpstreams": "Upstreams",
    "sectionActiveHealth": "Active health checks",
    "sectionPassiveHealth": "Passive health checks",
    "sectionTimeouts": "Timeouts",
    "sectionRetries": "Retries",
    "sectionConnectionPool": "Connection pool",
    "sectionLabels": "Labels"
  },
  "messages": {
    "serviceCreated": "Service created successfully",
    "serviceUpdated": "Service updated successfully",
    "serviceDeleted": "Service deleted successfully",
    "confirmDelete": "Are you sure you want to delete this service?",
    "confirmDeleteTitle": "Delete service",
    "unsavedChanges": "You have unsaved changes. Discard them?"
  },
  "empty": {
    "noServices": "No services configured",
    "noServicesDesc": "Create a service to define upstream targets for your routes."
  },
  "filter": {
    "lbPolicy": "LB policy",
    "healthStatus": "Health status",
    "hasHealthCheck": "Has health check"
  }
}
```

- [ ] **Step 3: Add shared keys to common.json**

Add the following keys to `packages/web/src/locales/en/common.json` (merge into existing object):

Add to the `"actions"` section:
```json
"duplicate": "Duplicate",
"attach": "Attach",
"detach": "Detach",
"reviewChanges": "Review changes",
"applyChanges": "Apply changes",
"discardChanges": "Discard changes",
"backToList": "Back to list"
```

Add a new `"tabs"` section:
```json
"tabs": {
  "overview": "Overview",
  "matching": "Matching",
  "tls": "TLS",
  "policies": "Policies",
  "healthChecks": "Health checks",
  "transport": "Transport",
  "traffic": "Traffic",
  "activity": "Activity"
}
```

Add a new `"form"` section:
```json
"form": {
  "unsavedChanges": "You have unsaved changes",
  "unsavedChangesDescription": "Your changes will be lost if you leave this page.",
  "stay": "Stay on page",
  "leave": "Leave page",
  "needsBackend": "Available in a future release",
  "required": "Required",
  "mode": {
    "form": "Form",
    "code": "YAML / JSON"
  }
}
```

Add a new `"diff"` section:
```json
"diff": {
  "title": "Review changes",
  "noChanges": "No changes detected",
  "added": "Added",
  "removed": "Removed",
  "changed": "Changed"
}
```

Add a new `"bulk"` section:
```json
"bulk": {
  "selected": "{{count}} selected",
  "enableAll": "Enable all",
  "disableAll": "Disable all",
  "deleteSelected": "Delete selected",
  "attachPolicy": "Attach policy to all"
}
```

- [ ] **Step 4: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/locales/
git commit -m "feat(web): expand i18n keys for route/service detail and create pages"
```

---

## Task 6: Extend API Types

**Files:**
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add missing type fields to api.ts**

Add to the `Route` interface (after `updatedAt`):

```typescript
// NEEDS BACKEND -- not in proto yet, used for UI placeholders
// forceTls?: boolean
// minTlsVersion?: string
// clientAuth?: string
// priority?: number
// streamingEnabled?: boolean
```

Add a new interface for individual route/service fetch helpers below the `apiClient` export:

```typescript
/** Fetch a single route by ID from the config snapshot. */
export async function fetchRouteById(id: string): Promise<Route | undefined> {
  const config = await apiClient.get<ConfigSnapshot>('/config')
  return config.routes.find((r) => r.id === id)
}

/** Fetch a single service by ID from the config snapshot. */
export async function fetchServiceById(id: string): Promise<Service | undefined> {
  const config = await apiClient.get<ConfigSnapshot>('/config')
  return config.services.find((s) => s.id === id)
}

/** Fetch all policies (for SearchableMultiSelect options). */
export async function fetchPolicies(): Promise<Policy[]> {
  const config = await apiClient.get<ConfigSnapshot>('/config')
  return config.policies
}

/** Fetch all services (for SearchableSelect options). */
export async function fetchServices(): Promise<Service[]> {
  const config = await apiClient.get<ConfigSnapshot>('/config')
  return config.services
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/lib/api.ts
git commit -m "feat(web): add entity fetch helpers and NEEDS BACKEND type annotations"
```

---

## Task 7: Route List Page Overhaul

**Files:**
- Create: `packages/web/src/routes/config/routes.index.tsx`
- Delete: `packages/web/src/routes/config/routes.tsx` (after verification)

This replaces the current routes list with the DataTable pattern from the spec: faceted filtering, hover actions (toggle/edit/duplicate/delete), bulk actions, clickable name links to detail page.

- [ ] **Step 1: Create the new route list page**

Create `packages/web/src/routes/config/routes.index.tsx`:

```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  PlusIcon,
  RouteIcon,
  PencilIcon,
  CopyIcon,
  TrashIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Route as RouteType } from '@/lib/api'
import { useRouteMutations } from '@/hooks/use-config-mutations'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'

import { useState } from 'react'

export const Route = createFileRoute('/config/routes/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: RouteListPage,
})

function RouteListPage() {
  const { t } = useTranslation('routes')
  const config = Route.useLoaderData()
  const routes = config.routes
  const services = config.services

  const { toggleMutation, deleteMutation, duplicateMutation } = useRouteMutations()
  const [deleteTarget, setDeleteTarget] = useState<RouteType | null>(null)

  function getServiceName(serviceId: string): string {
    return services.find((s) => s.id === serviceId)?.name ?? serviceId
  }

  const tableData = routes.map((r) => ({
    ...r,
    _matcherDisplay: r.matchers
      .flatMap((m) => [...(m.hosts ?? []), ...(m.paths ?? []).map((p) => p.value)])
      .join(', '),
    _serviceName: r.serviceId ? getServiceName(r.serviceId) : '\u2014',
    _policyCount: (r.policyIds ?? []).length,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button asChild>
            <Link to="/config/routes/create">
              <PlusIcon className="size-4" />
              {t('form.createRoute')}
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={[
          {
            key: 'name',
            header: t('table.name'),
            sortable: true,
            render: (r) => (
              <Link
                to="/config/routes/$routeId"
                params={{ routeId: r.id as string }}
                className="font-mono text-sm text-primary hover:underline"
              >
                {r.name}
              </Link>
            ),
          },
          {
            key: '_matcherDisplay',
            header: t('table.matchers'),
            render: (r) => {
              const route = r as unknown as RouteType
              return (
                <div className="flex flex-wrap gap-1">
                  {route.matchers.flatMap((m, mi) => [
                    ...(m.hosts ?? []).map((h, hi) => (
                      <Badge key={`h-${mi}-${hi}`} variant="secondary">
                        {h}
                      </Badge>
                    )),
                    ...(m.paths ?? []).map((p, pi) => (
                      <Badge key={`p-${mi}-${pi}`} variant="outline">
                        {p.value}
                      </Badge>
                    )),
                  ])}
                </div>
              )
            },
          },
          {
            key: '_serviceName',
            header: t('table.targetService'),
            render: (r) => (
              <span className="font-mono text-sm text-muted-foreground">
                {r._serviceName}
              </span>
            ),
          },
          {
            key: '_policyCount',
            header: t('table.policies'),
            render: (r) => (
              <span className="text-sm text-muted-foreground">
                {r._policyCount === 0 ? '\u2014' : `${r._policyCount}`}
              </span>
            ),
          },
          {
            key: 'enabled',
            header: t('table.status'),
            render: (r) => (
              <Switch
                checked={r.enabled as boolean}
                onCheckedChange={() =>
                  toggleMutation.mutate({ id: r.id as string, enabled: r.enabled as boolean })
                }
              />
            ),
          },
          {
            key: 'updatedAt',
            header: t('table.updated'),
            sortable: true,
            render: (r) =>
              r.updatedAt ? <TimeAgo date={r.updatedAt as string} /> : '\u2014',
          },
        ]}
        data={tableData}
        searchable
        searchPlaceholder="Search routes..."
        pageSize={10}
        hoverActions={(row) => [
          {
            icon: <Switch checked={row.enabled as boolean} size="sm" />,
            label: row.enabled ? t('common:actions.disable') : t('common:actions.enable'),
            onClick: () =>
              toggleMutation.mutate({ id: row.id as string, enabled: row.enabled as boolean }),
          },
          {
            icon: <PencilIcon className="size-4" />,
            label: t('form.editRoute'),
            href: `/config/routes/${row.id}`,
          },
          {
            icon: <CopyIcon className="size-4" />,
            label: t('form.duplicateRoute'),
            onClick: () => duplicateMutation.mutate(row as unknown as Record<string, unknown>),
          },
          {
            icon: <TrashIcon className="size-4" />,
            label: t('common:actions.delete'),
            variant: 'destructive' as const,
            onClick: () => setDeleteTarget(row as unknown as RouteType),
          },
        ]}
        emptyState={
          <EmptyState
            icon={<RouteIcon className="size-5" />}
            title={t('empty.noRoutes')}
            description={t('empty.noRoutesDesc')}
            action={
              <Button asChild size="sm">
                <Link to="/config/routes/create">
                  <PlusIcon className="size-4" />
                  {t('form.createRoute')}
                </Link>
              </Button>
            }
          />
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('messages.confirmDeleteTitle')}
        description={t('messages.confirmDelete')}
        confirmLabel={t('common:actions.delete')}
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Delete old routes.tsx**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git rm packages/web/src/routes/config/routes.tsx
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors related to route list page. Note: If TanStack Router auto-generates the route tree, run `npx vite` briefly or the router plugin to regenerate `routeTree.gen.ts`.

- [ ] **Step 4: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/routes/config/routes.index.tsx
git commit -m "feat(web): overhaul route list page with DataTable, hover actions, bulk actions"
```

---

## Task 8: Route Detail Page (Full-Page, Tabbed)

**Files:**
- Create: `packages/web/src/routes/config/routes.$routeId.tsx`

This is the core detail view with tabs: Overview, Matching, TLS, Policies, Traffic, Activity. Uses inline editing (Section 5.2), the diff review panel (Section 18.4), deep-linked tabs (Section 18.5), loading skeletons, and error boundaries.

- [ ] **Step 1: Create the route detail page**

Create `packages/web/src/routes/config/routes.$routeId.tsx`:

```tsx
import { useState, useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react'

import { apiClient, fetchRouteById } from '@/lib/api'
import type { ConfigSnapshot, Route as RouteType, Service, Policy } from '@/lib/api'
import { routeFormSchema, routeToFormValues, formValuesToRoutePayload } from '@/lib/schemas/route'
import type { RouteFormValues } from '@/lib/schemas/route'
import { useRouteMutations } from '@/hooks/use-config-mutations'
import { useDirtyForm } from '@/hooks/use-dirty-form'
import { useUnsavedWarning } from '@/hooks/use-unsaved-warning'
import { useTabFromUrl } from '@/hooks/use-tab-from-url'

import { PageHeader } from '@/components/rioku/page-header'
import { TimeAgo } from '@/components/rioku/time-ago'
import { StatusBadge } from '@/components/rioku/status-badge'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { DiffView } from '@/components/rioku/diff-view'
import type { DiffChange } from '@/components/rioku/diff-view'
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'
import { EmptyState } from '@/components/rioku/empty-state'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ROUTE_TABS = ['overview', 'matching', 'tls', 'policies', 'traffic', 'activity'] as const

export const Route = createFileRoute('/config/routes/$routeId')({
  loader: async ({ context, params }) => {
    const config = await context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    })
    const route = config.routes.find((r) => r.id === params.routeId)
    if (!route) throw new Error('Route not found')
    return { route, services: config.services, policies: config.policies }
  },
  component: RouteDetailPage,
})

function RouteDetailPage() {
  const { t } = useTranslation('routes')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const { route, services, policies } = Route.useLoaderData()

  const { saveMutation, deleteMutation, toggleMutation } = useRouteMutations()

  const [isEditing, setIsEditing] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const initialValues = useMemo(() => routeToFormValues(route), [route])
  const [formValues, setFormValues] = useState<RouteFormValues>(initialValues)

  const { isDirty, changedFields } = useDirtyForm(initialValues, formValues)
  useUnsavedWarning(isDirty)

  const { activeTab, setActiveTab } = useTabFromUrl('overview', ROUTE_TABS)

  function startEditing() {
    setFormValues(routeToFormValues(route))
    setIsEditing(true)
  }

  function cancelEditing() {
    setFormValues(initialValues)
    setIsEditing(false)
  }

  function openReview() {
    const validation = routeFormSchema.safeParse(formValues)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    setReviewOpen(true)
  }

  function handleSave() {
    const payload = formValuesToRoutePayload(formValues, route.id)
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('messages.routeUpdated'))
        setIsEditing(false)
        setReviewOpen(false)
      },
    })
  }

  function handleDelete() {
    deleteMutation.mutate(route.id, {
      onSuccess: () => {
        navigate({ to: '/config/routes' })
      },
    })
  }

  function computeDiffChanges(): DiffChange[] {
    const changes: DiffChange[] = []
    if (initialValues.name !== formValues.name) {
      changes.push({ field: 'Name', oldValue: initialValues.name, newValue: formValues.name })
    }
    if (initialValues.enabled !== formValues.enabled) {
      changes.push({
        field: 'Enabled',
        oldValue: String(initialValues.enabled),
        newValue: String(formValues.enabled),
      })
    }
    if (JSON.stringify(initialValues.hosts) !== JSON.stringify(formValues.hosts)) {
      changes.push({
        field: 'Hosts',
        oldValue: initialValues.hosts.join(', ') || null,
        newValue: formValues.hosts.join(', ') || null,
      })
    }
    if (JSON.stringify(initialValues.paths) !== JSON.stringify(formValues.paths)) {
      changes.push({
        field: 'Paths',
        oldValue: initialValues.paths.map((p) => p.value).join(', ') || null,
        newValue: formValues.paths.map((p) => p.value).join(', ') || null,
      })
    }
    if (JSON.stringify(initialValues.methods) !== JSON.stringify(formValues.methods)) {
      changes.push({
        field: 'Methods',
        oldValue: initialValues.methods.join(', ') || null,
        newValue: formValues.methods.join(', ') || null,
      })
    }
    if (initialValues.serviceId !== formValues.serviceId) {
      changes.push({
        field: 'Target service',
        oldValue: initialValues.serviceId || null,
        newValue: formValues.serviceId || null,
      })
    }
    if (JSON.stringify(initialValues.policyIds) !== JSON.stringify(formValues.policyIds)) {
      changes.push({
        field: 'Policies',
        oldValue: initialValues.policyIds.join(', ') || null,
        newValue: formValues.policyIds.join(', ') || null,
      })
    }
    return changes
  }

  function getServiceName(serviceId: string): string {
    return services.find((s: Service) => s.id === serviceId)?.name ?? serviceId
  }

  function getPolicyName(policyId: string): string {
    return policies.find((p: Policy) => p.id === policyId)?.name ?? policyId
  }

  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/config/routes">
            <ArrowLeftIcon className="size-4" />
            <span className="sr-only">{t('detail.backToRoutes')}</span>
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{route.name}</h1>
            <Switch
              checked={route.enabled}
              onCheckedChange={() =>
                toggleMutation.mutate({ id: route.id, enabled: route.enabled })
              }
              size="sm"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('detail.routeId')}: <code className="font-mono text-xs">{route.id}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <Button variant="outline" onClick={startEditing}>
              <PencilIcon className="size-4" />
              {t('detail.editSection')}
            </Button>
          )}
          {isEditing && (
            <>
              <Button variant="outline" onClick={cancelEditing}>
                <XIcon className="size-4" />
                {t('detail.cancelEdit')}
              </Button>
              <Button onClick={openReview} disabled={!isDirty || saveMutation.isPending}>
                <CheckIcon className="size-4" />
                {t('detail.reviewChanges')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <TrashIcon className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="overview">{t('detail.overview')}</TabsTrigger>
          <TabsTrigger value="matching">{t('detail.matching')}</TabsTrigger>
          <TabsTrigger value="tls">{t('detail.tls')}</TabsTrigger>
          <TabsTrigger value="policies">{t('detail.policiesTab')}</TabsTrigger>
          <TabsTrigger value="traffic">{t('detail.traffic')}</TabsTrigger>
          <TabsTrigger value="activity">{t('detail.activity')}</TabsTrigger>
        </TabsList>

        {/* --- Overview Tab --- */}
        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('detail.overview')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('form.routeName')}</Label>
                    {isEditing ? (
                      <Input
                        value={formValues.name}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                    ) : (
                      <p className="font-mono text-sm">{route.name}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('table.status')}</Label>
                    {isEditing ? (
                      <div className="flex items-center gap-2 pt-1">
                        <Switch
                          checked={formValues.enabled}
                          onCheckedChange={(checked) =>
                            setFormValues((prev) => ({ ...prev, enabled: checked }))
                          }
                        />
                        <span className="text-sm">{formValues.enabled ? tc('status.enabled') : tc('status.disabled')}</span>
                      </div>
                    ) : (
                      <StatusBadge status={route.enabled ? 'healthy' : 'unknown'} label={route.enabled ? tc('status.enabled') : tc('status.disabled')} />
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('detail.serviceTarget')}</Label>
                  {isEditing ? (
                    <Select
                      value={formValues.serviceId}
                      onValueChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a service" />
                      </SelectTrigger>
                      <SelectContent>
                        {services.map((svc: Service) => (
                          <SelectItem key={svc.id} value={svc.id}>
                            {svc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="font-mono text-sm">
                      {route.serviceId ? getServiceName(route.serviceId) : t('detail.noTarget')}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Metadata sidebar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('detail.createdAt')}</span>
                  <p>{route.createdAt ? <TimeAgo date={route.createdAt} /> : '\u2014'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.updatedAt')}</span>
                  <p>{route.updatedAt ? <TimeAgo date={route.updatedAt} /> : '\u2014'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.routeId')}</span>
                  <p className="font-mono text-xs break-all">{route.id}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* --- Matching Tab --- */}
        <TabsContent value="matching">
          <Card>
            <CardHeader>
              <CardTitle>{t('matching.hosts')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t('matching.hostsDescription')}</p>
                  <Input
                    value={formValues.hosts.join(', ')}
                    onChange={(e) =>
                      setFormValues((prev) => ({
                        ...prev,
                        hosts: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      }))
                    }
                    placeholder="api.example.com, *.example.com"
                  />
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(route.matchers[0]?.hosts ?? []).map((h, i) => (
                    <Badge key={i} variant="secondary">{h}</Badge>
                  ))}
                  {(route.matchers[0]?.hosts ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">All hosts</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('matching.paths')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t('matching.pathsDescription')}</p>
                  {formValues.paths.map((path, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select
                        value={path.type}
                        onValueChange={(val) => {
                          const next = [...formValues.paths]
                          next[idx] = { ...next[idx], type: val as typeof path.type }
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TYPE_PREFIX">Prefix</SelectItem>
                          <SelectItem value="TYPE_EXACT">Exact</SelectItem>
                          <SelectItem value="TYPE_REGEXP">Regexp</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={path.value}
                        onChange={(e) => {
                          const next = [...formValues.paths]
                          next[idx] = { ...next[idx], value: e.target.value }
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                        placeholder={t('matching.pathValuePlaceholder')}
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          const next = formValues.paths.filter((_, i) => i !== idx)
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFormValues((prev) => ({
                        ...prev,
                        paths: [...prev.paths, { type: 'TYPE_PREFIX', value: '' }],
                      }))
                    }
                  >
                    {t('matching.addPath')}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(route.matchers[0]?.paths ?? []).map((p, i) => (
                    <Badge key={i} variant="outline">
                      <span className="mr-1 text-xs text-muted-foreground">
                        {p.type === 'TYPE_PREFIX' ? 'prefix' : p.type === 'TYPE_EXACT' ? 'exact' : 'regexp'}:
                      </span>
                      {p.value}
                    </Badge>
                  ))}
                  {(route.matchers[0]?.paths ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">All paths</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('matching.methods')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="flex flex-wrap gap-1.5">
                  {HTTP_METHODS.map((method) => (
                    <Button
                      key={method}
                      variant={formValues.methods.includes(method) ? 'default' : 'outline'}
                      size="xs"
                      onClick={() =>
                        setFormValues((prev) => ({
                          ...prev,
                          methods: prev.methods.includes(method)
                            ? prev.methods.filter((m) => m !== method)
                            : [...prev.methods, method] as RouteFormValues['methods'],
                        }))
                      }
                    >
                      {method}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(route.matchers[0]?.methods ?? []).map((m, i) => (
                    <Badge key={i}>{m}</Badge>
                  ))}
                  {(route.matchers[0]?.methods ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">All methods</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('matching.headers')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-2">
                  {formValues.headers.map((header, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={header.name}
                        onChange={(e) => {
                          const next = [...formValues.headers]
                          next[idx] = { ...next[idx], name: e.target.value }
                          setFormValues((prev) => ({ ...prev, headers: next }))
                        }}
                        placeholder={t('matching.headerName')}
                        className="flex-1"
                      />
                      <Input
                        value={header.value}
                        onChange={(e) => {
                          const next = [...formValues.headers]
                          next[idx] = { ...next[idx], value: e.target.value }
                          setFormValues((prev) => ({ ...prev, headers: next }))
                        }}
                        placeholder={t('matching.headerValue')}
                        className="flex-1"
                      />
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={header.invert}
                          onChange={(e) => {
                            const next = [...formValues.headers]
                            next[idx] = { ...next[idx], invert: e.target.checked }
                            setFormValues((prev) => ({ ...prev, headers: next }))
                          }}
                        />
                        {t('matching.headerInvert')}
                      </label>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          const next = formValues.headers.filter((_, i) => i !== idx)
                          setFormValues((prev) => ({ ...prev, headers: next }))
                        }}
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFormValues((prev) => ({
                        ...prev,
                        headers: [...prev.headers, { name: '', value: '', invert: false }],
                      }))
                    }
                  >
                    {t('matching.addHeader')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {(route.matchers[0]?.headers ?? []).map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <code className="font-mono text-xs">{h.name}: {h.value}</code>
                      {h.invert && <Badge variant="outline" className="text-xs">inverted</Badge>}
                    </div>
                  ))}
                  {(route.matchers[0]?.headers ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">No header matchers</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- TLS Tab (NEEDS BACKEND) --- */}
        <TabsContent value="tls">
          <NeedsBackendField>
            <Card>
              <CardHeader>
                <CardTitle>{t('tls.forceHttps')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t('tls.forceHttps')}</Label>
                    <p className="text-xs text-muted-foreground">{t('tls.forceHttpsDescription')}</p>
                  </div>
                  <Switch checked={false} disabled />
                </div>
                <div>
                  <Label>{t('tls.minVersion')}</Label>
                  <Select disabled value="1.2">
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1.2">TLS 1.2</SelectItem>
                      <SelectItem value="1.3">TLS 1.3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t('tls.clientAuth')}</Label>
                  <Select disabled value="off">
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">{t('tls.clientAuthOff')}</SelectItem>
                      <SelectItem value="request">{t('tls.clientAuthRequest')}</SelectItem>
                      <SelectItem value="require">{t('tls.clientAuthRequire')}</SelectItem>
                      <SelectItem value="require_and_verify">{t('tls.clientAuthRequireVerify')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </NeedsBackendField>
        </TabsContent>

        {/* --- Policies Tab --- */}
        <TabsContent value="policies">
          <Card>
            <CardHeader>
              <CardTitle>{t('policies.attached')}</CardTitle>
            </CardHeader>
            <CardContent>
              {(route.policyIds ?? []).length > 0 ? (
                <div className="space-y-2">
                  {(route.policyIds ?? []).map((pid) => (
                    <div key={pid} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <span className="font-mono text-sm">{getPolicyName(pid)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{pid}</span>
                      </div>
                      {isEditing && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            setFormValues((prev) => ({
                              ...prev,
                              policyIds: prev.policyIds.filter((id) => id !== pid),
                            }))
                          }
                        >
                          {t('policies.detach')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={t('policies.noPolicies')}
                  description={t('policies.noPoliciesDescription')}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Traffic Tab (NEEDS BACKEND) --- */}
        <TabsContent value="traffic">
          <NeedsBackendField message="Per-route traffic analytics require TrafficService enrichment">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.traffic')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                  </div>
                  <Skeleton className="h-64" />
                </div>
              </CardContent>
            </Card>
          </NeedsBackendField>
        </TabsContent>

        {/* --- Activity Tab (NEEDS BACKEND) --- */}
        <TabsContent value="activity">
          <NeedsBackendField message="Per-entity activity logs require audit trail enrichment">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.activity')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-48" />
              </CardContent>
            </Card>
          </NeedsBackendField>
        </TabsContent>
      </Tabs>

      {/* Review changes dialog */}
      <ConfirmDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={t('detail.reviewChanges')}
        description=""
        confirmLabel={t('detail.applyChanges')}
        variant="default"
        loading={saveMutation.isPending}
        onConfirm={handleSave}
      >
        <DiffView changes={computeDiffChanges()} />
      </ConfirmDialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('messages.confirmDeleteTitle')}
        description={t('messages.confirmDelete')}
        confirmLabel={tc('actions.delete')}
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
```

**Note:** The `ConfirmDialog` component currently doesn't accept `children`. If Phase 1 has not extended it, add a `children?: React.ReactNode` prop to `ConfirmDialogProps` in `packages/web/src/components/rioku/confirm-dialog.tsx` and render `{children}` between the description and footer. This is a one-line change:

In `confirm-dialog.tsx`, add inside `DialogContent`, after `</DialogHeader>`:
```tsx
{children}
```
And add `children?: React.ReactNode` to the `ConfirmDialogProps` interface.

- [ ] **Step 2: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors (or only pre-existing errors unrelated to this file).

- [ ] **Step 3: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/routes/config/routes.\$routeId.tsx packages/web/src/components/rioku/confirm-dialog.tsx
git commit -m "feat(web): add full-page route detail view with tabbed layout and inline editing"
```

---

## Task 9: Route Create Page

**Files:**
- Create: `packages/web/src/routes/config/routes.create.tsx`

Full-page creation with form mode (progressive disclosure) and YAML/JSON mode with bidirectional sync.

- [ ] **Step 1: Create the route create page**

Create `packages/web/src/routes/config/routes.create.tsx`:

```tsx
import { useState, useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, PlusIcon, XIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Service, Policy } from '@/lib/api'
import {
  routeFormSchema,
  formValuesToRoutePayload,
  HTTP_METHODS,
} from '@/lib/schemas/route'
import type { RouteFormValues } from '@/lib/schemas/route'
import { useRouteMutations } from '@/hooks/use-config-mutations'
import { useDirtyForm } from '@/hooks/use-dirty-form'
import { useUnsavedWarning } from '@/hooks/use-unsaved-warning'

import { PageHeader } from '@/components/rioku/page-header'
import { DiffView } from '@/components/rioku/diff-view'
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/config/routes/create')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: RouteCreatePage,
})

const EMPTY_FORM: RouteFormValues = {
  name: '',
  enabled: true,
  hosts: [],
  paths: [{ type: 'TYPE_PREFIX', value: '' }],
  methods: [],
  headers: [],
  targetType: 'service',
  serviceId: '',
  directAddress: '',
  directTls: 'TLS_MODE_OFF',
  policyIds: [],
  labels: {},
  forceTls: false,
  minTlsVersion: '1.2',
  clientAuth: 'off',
}

function RouteCreatePage() {
  const { t } = useTranslation('routes')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const config = Route.useLoaderData()
  const services = config.services
  const policies = config.policies

  const { saveMutation } = useRouteMutations()

  const [mode, setMode] = useState<'form' | 'code'>('form')
  const [formValues, setFormValues] = useState<RouteFormValues>(EMPTY_FORM)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basics: true,
    matching: true,
    target: true,
    policies: false,
    tls: false,
    advanced: false,
  })

  const { isDirty } = useDirtyForm(EMPTY_FORM, formValues)
  useUnsavedWarning(isDirty)

  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleCreate() {
    const validation = routeFormSchema.safeParse(formValues)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    const payload = formValuesToRoutePayload(formValues)
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('messages.routeCreated'))
        navigate({ to: '/config/routes' })
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/config/routes">
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <PageHeader
          title={t('create.title')}
          description={t('create.subtitle')}
        />
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('form')}
        >
          {t('create.formMode')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('code')}
        >
          {t('create.codeMode')}
        </Button>
      </div>

      {mode === 'form' ? (
        <div className="space-y-4">
          {/* Basics section */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('basics')}
            >
              <CardTitle className="text-base">{t('create.sectionBasics')}</CardTitle>
            </CardHeader>
            {expandedSections.basics && (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="route-name">
                    {t('form.routeName')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="route-name"
                    value={formValues.name}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder={t('form.routeNamePlaceholder')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="route-enabled">{t('form.enabled')}</Label>
                    <p className="text-xs text-muted-foreground">{t('form.enabledDescription')}</p>
                  </div>
                  <Switch
                    id="route-enabled"
                    checked={formValues.enabled}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                </div>
              </CardContent>
            )}
          </Card>

          {/* Matching section */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('matching')}
            >
              <CardTitle className="text-base">{t('create.sectionMatching')}</CardTitle>
            </CardHeader>
            {expandedSections.matching && (
              <CardContent className="space-y-4">
                {/* Hosts */}
                <div className="space-y-2">
                  <Label>{t('matching.hosts')}</Label>
                  <Input
                    value={formValues.hosts.join(', ')}
                    onChange={(e) =>
                      setFormValues((prev) => ({
                        ...prev,
                        hosts: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      }))
                    }
                    placeholder="api.example.com, *.example.com"
                  />
                  <p className="text-xs text-muted-foreground">{t('matching.hostsDescription')}</p>
                </div>
                {/* Paths */}
                <div className="space-y-2">
                  <Label>{t('matching.paths')}</Label>
                  {formValues.paths.map((path, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select
                        value={path.type}
                        onValueChange={(val) => {
                          const next = [...formValues.paths]
                          next[idx] = { ...next[idx], type: val as typeof path.type }
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                      >
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TYPE_PREFIX">Prefix</SelectItem>
                          <SelectItem value="TYPE_EXACT">Exact</SelectItem>
                          <SelectItem value="TYPE_REGEXP">Regexp</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={path.value}
                        onChange={(e) => {
                          const next = [...formValues.paths]
                          next[idx] = { ...next[idx], value: e.target.value }
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                        placeholder={t('matching.pathValuePlaceholder')}
                        className="flex-1"
                      />
                      {formValues.paths.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            const next = formValues.paths.filter((_, i) => i !== idx)
                            setFormValues((prev) => ({ ...prev, paths: next }))
                          }}
                        >
                          <XIcon className="size-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFormValues((prev) => ({
                        ...prev,
                        paths: [...prev.paths, { type: 'TYPE_PREFIX', value: '' }],
                      }))
                    }
                  >
                    {t('matching.addPath')}
                  </Button>
                </div>
                {/* Methods */}
                <div className="space-y-2">
                  <Label>{t('matching.methods')}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {HTTP_METHODS.map((method) => (
                      <Button
                        key={method}
                        variant={formValues.methods.includes(method) ? 'default' : 'outline'}
                        size="xs"
                        onClick={() =>
                          setFormValues((prev) => ({
                            ...prev,
                            methods: prev.methods.includes(method)
                              ? prev.methods.filter((m) => m !== method)
                              : [...prev.methods, method] as RouteFormValues['methods'],
                          }))
                        }
                      >
                        {method}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('matching.methodsDescription')}</p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Target section */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('target')}
            >
              <CardTitle className="text-base">{t('create.sectionTarget')}</CardTitle>
            </CardHeader>
            {expandedSections.target && (
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    variant={formValues.targetType === 'service' ? 'default' : 'outline'}
                    onClick={() => setFormValues((prev) => ({ ...prev, targetType: 'service' }))}
                  >
                    {t('form.targetTypeService')}
                  </Button>
                  <Button
                    variant={formValues.targetType === 'direct' ? 'default' : 'outline'}
                    onClick={() => setFormValues((prev) => ({ ...prev, targetType: 'direct' }))}
                  >
                    {t('form.targetTypeDirect')}
                  </Button>
                </div>
                {formValues.targetType === 'service' ? (
                  <div className="space-y-2">
                    <Label>
                      {t('form.targetService')} <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={formValues.serviceId}
                      onValueChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val }))
                      }
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select a service" /></SelectTrigger>
                      <SelectContent>
                        {services.map((svc: Service) => (
                          <SelectItem key={svc.id} value={svc.id}>
                            {svc.name} ({svc.upstreams.length} upstreams)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>
                        {t('form.directAddress')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={formValues.directAddress}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, directAddress: e.target.value }))
                        }
                        placeholder={t('form.directAddressPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('form.directTls')}</Label>
                      <Select
                        value={formValues.directTls}
                        onValueChange={(val) =>
                          setFormValues((prev) => ({ ...prev, directTls: val as RouteFormValues['directTls'] }))
                        }
                      >
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TLS_MODE_OFF">Off</SelectItem>
                          <SelectItem value="TLS_MODE_AUTO">Auto</SelectItem>
                          <SelectItem value="TLS_MODE_CUSTOM">Custom</SelectItem>
                          <SelectItem value="TLS_MODE_INTERNAL">Internal (mTLS)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Policies section (collapsed) */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('policies')}
            >
              <CardTitle className="text-base">{t('create.sectionPolicies')}</CardTitle>
            </CardHeader>
            {expandedSections.policies && (
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t('policies.attachedDescription')}
                </p>
                {/* Placeholder -- SearchableMultiSelect from Phase 1 goes here */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {formValues.policyIds.map((pid) => {
                    const policy = policies.find((p: Policy) => p.id === pid)
                    return (
                      <Badge key={pid} variant="secondary" className="gap-1">
                        {policy?.name ?? pid}
                        <button
                          onClick={() =>
                            setFormValues((prev) => ({
                              ...prev,
                              policyIds: prev.policyIds.filter((id) => id !== pid),
                            }))
                          }
                          className="ml-1"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              </CardContent>
            )}
          </Card>

          {/* TLS section (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('tls')}
            >
              <CardTitle className="text-base">{t('create.sectionTls')}</CardTitle>
            </CardHeader>
            {expandedSections.tls && (
              <CardContent>
                <NeedsBackendField>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label>{t('tls.forceHttps')}</Label>
                      <Switch checked={false} disabled />
                    </div>
                    <div>
                      <Label>{t('tls.minVersion')}</Label>
                      <Select disabled value="1.2">
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1.2">TLS 1.2</SelectItem>
                          <SelectItem value="1.3">TLS 1.3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t('tls.clientAuth')}</Label>
                      <Select disabled value="off">
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">{t('tls.clientAuthOff')}</SelectItem>
                          <SelectItem value="request">{t('tls.clientAuthRequest')}</SelectItem>
                          <SelectItem value="require">{t('tls.clientAuthRequire')}</SelectItem>
                          <SelectItem value="require_and_verify">{t('tls.clientAuthRequireVerify')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Advanced section (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('advanced')}
            >
              <CardTitle className="text-base">{t('create.sectionAdvanced')}</CardTitle>
            </CardHeader>
            {expandedSections.advanced && (
              <CardContent>
                <NeedsBackendField>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>{t('create.advancedQueryMatchers')}</Label>
                      <Input disabled placeholder="key=value" />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('create.advancedCelExpression')}</Label>
                      <Input disabled placeholder="request.host.endsWith('.example.com')" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>{t('create.advancedStreaming')}</Label>
                      <Switch checked={false} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('create.advancedPriority')}</Label>
                      <Input type="number" disabled placeholder="0" className="w-24" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>
        </div>
      ) : (
        /* YAML/JSON mode -- delegates to YamlJsonEditor from Phase 1 */
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              YAML/JSON mode uses the YamlJsonEditor component from Phase 1.
              Paste or edit route configuration in YAML or JSON format.
            </p>
            {/* <YamlJsonEditor value={...} onChange={...} schema={routeFormSchema} /> */}
            <div className="mt-4 rounded-md border p-8 text-center text-sm text-muted-foreground">
              YamlJsonEditor placeholder -- Phase 1 component required
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-3 border-t pt-4">
        <Button
          onClick={handleCreate}
          disabled={saveMutation.isPending || !formValues.name}
        >
          {saveMutation.isPending ? 'Creating...' : t('form.createRoute')}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/config/routes">{tc('actions.cancel')}</Link>
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit 2>&1 | head -30`

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/routes/config/routes.create.tsx
git commit -m "feat(web): add full-page route create with form mode and progressive disclosure"
```

---

## Task 10: Service List Page Overhaul

**Files:**
- Create: `packages/web/src/routes/config/services.index.tsx`
- Delete: `packages/web/src/routes/config/services.tsx`

Same DataTable pattern as routes: clickable name links, hover actions, faceted filtering.

- [ ] **Step 1: Create the new service list page**

Create `packages/web/src/routes/config/services.index.tsx`:

```tsx
import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  PlusIcon,
  ServerIcon,
  PencilIcon,
  TrashIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Service } from '@/lib/api'
import { LB_POLICY_LABELS } from '@/lib/schemas/service'
import { useServiceMutations } from '@/hooks/use-config-mutations'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { StatusBadge } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/config/services/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: ServiceListPage,
})

function ServiceListPage() {
  const { t } = useTranslation('services')
  const config = Route.useLoaderData()
  const services = config.services

  const { deleteMutation } = useServiceMutations()
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null)

  const tableData = services.map((svc) => ({
    ...svc,
    _upstreamCount: svc.upstreams.length,
    _upstreamPreview: svc.upstreams[0]?.address ?? '\u2014',
    _healthCheckEnabled: svc.healthCheck?.enabled ?? false,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button asChild>
            <Link to="/config/services/create">
              <PlusIcon className="size-4" />
              {t('form.createService')}
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={[
          {
            key: 'name',
            header: t('table.name'),
            sortable: true,
            render: (r) => (
              <Link
                to="/config/services/$serviceId"
                params={{ serviceId: r.id as string }}
                className="font-mono text-sm text-primary hover:underline"
              >
                {r.name}
              </Link>
            ),
          },
          {
            key: '_upstreamCount',
            header: t('table.upstreams'),
            render: (r) => (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{r._upstreamCount}</Badge>
                <span className="truncate text-xs text-muted-foreground font-mono">
                  {r._upstreamPreview}
                </span>
              </div>
            ),
          },
          {
            key: 'lbPolicy',
            header: t('table.lbPolicy'),
            render: (r) => (
              <Badge variant="outline">
                {LB_POLICY_LABELS[r.lbPolicy as string] ?? r.lbPolicy}
              </Badge>
            ),
          },
          {
            key: '_health',
            header: t('table.health'),
            render: (r) => (
              <StatusBadge
                status={r._healthCheckEnabled ? 'healthy' : 'unknown'}
                label={r._healthCheckEnabled ? 'Monitored' : 'Unmonitored'}
              />
            ),
          },
          {
            key: 'updatedAt',
            header: t('table.updated'),
            sortable: true,
            render: (r) =>
              r.updatedAt ? <TimeAgo date={r.updatedAt as string} /> : '\u2014',
          },
        ]}
        data={tableData}
        searchable
        searchPlaceholder="Search services..."
        pageSize={10}
        hoverActions={(row) => [
          {
            icon: <PencilIcon className="size-4" />,
            label: t('form.editService'),
            href: `/config/services/${row.id}`,
          },
          {
            icon: <TrashIcon className="size-4" />,
            label: 'Delete',
            variant: 'destructive' as const,
            onClick: () => setDeleteTarget(row as unknown as Service),
          },
        ]}
        emptyState={
          <EmptyState
            icon={<ServerIcon className="size-5" />}
            title={t('empty.noServices')}
            description={t('empty.noServicesDesc')}
            action={
              <Button asChild size="sm">
                <Link to="/config/services/create">
                  <PlusIcon className="size-4" />
                  {t('form.createService')}
                </Link>
              </Button>
            }
          />
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('messages.confirmDeleteTitle')}
        description={t('messages.confirmDelete')}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Delete old services.tsx**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git rm packages/web/src/routes/config/services.tsx
```

- [ ] **Step 3: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/routes/config/services.index.tsx
git commit -m "feat(web): overhaul service list page with DataTable, hover actions, clickable names"
```

---

## Task 11: Service Detail Page (Full-Page, Tabbed)

**Files:**
- Create: `packages/web/src/routes/config/services.$serviceId.tsx`

Tabbed detail: Overview (LB, upstreams), Health Checks (active + passive), Transport (TLS, HTTP version, connection pool), Policies, Traffic, Activity.

- [ ] **Step 1: Create the service detail page**

Create `packages/web/src/routes/config/services.$serviceId.tsx`:

```tsx
import { useState, useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XIcon,
  PlusIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Service as ServiceType } from '@/lib/api'
import {
  serviceFormSchema,
  serviceToFormValues,
  formValuesToServicePayload,
  LB_POLICY_LABELS,
  TLS_MODE_LABELS,
} from '@/lib/schemas/service'
import type { ServiceFormValues } from '@/lib/schemas/service'
import { useServiceMutations } from '@/hooks/use-config-mutations'
import { useDirtyForm } from '@/hooks/use-dirty-form'
import { useUnsavedWarning } from '@/hooks/use-unsaved-warning'
import { useTabFromUrl } from '@/hooks/use-tab-from-url'

import { PageHeader } from '@/components/rioku/page-header'
import { TimeAgo } from '@/components/rioku/time-ago'
import { StatusBadge } from '@/components/rioku/status-badge'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { DiffView } from '@/components/rioku/diff-view'
import type { DiffChange } from '@/components/rioku/diff-view'
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const SERVICE_TABS = ['overview', 'health-checks', 'transport', 'policies', 'traffic', 'activity'] as const

export const Route = createFileRoute('/config/services/$serviceId')({
  loader: async ({ context, params }) => {
    const config = await context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    })
    const service = config.services.find((s) => s.id === params.serviceId)
    if (!service) throw new Error('Service not found')
    return { service, policies: config.policies }
  },
  component: ServiceDetailPage,
})

function ServiceDetailPage() {
  const { t } = useTranslation('services')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const { service, policies } = Route.useLoaderData()

  const { saveMutation, deleteMutation } = useServiceMutations()

  const [isEditing, setIsEditing] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const initialValues = useMemo(() => serviceToFormValues(service), [service])
  const [formValues, setFormValues] = useState<ServiceFormValues>(initialValues)

  const { isDirty } = useDirtyForm(initialValues, formValues)
  useUnsavedWarning(isDirty)

  const { activeTab, setActiveTab } = useTabFromUrl('overview', SERVICE_TABS)

  function startEditing() {
    setFormValues(serviceToFormValues(service))
    setIsEditing(true)
  }

  function cancelEditing() {
    setFormValues(initialValues)
    setIsEditing(false)
  }

  function openReview() {
    const validation = serviceFormSchema.safeParse(formValues)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    setReviewOpen(true)
  }

  function handleSave() {
    const payload = formValuesToServicePayload(formValues, service.id)
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('messages.serviceUpdated'))
        setIsEditing(false)
        setReviewOpen(false)
      },
    })
  }

  function handleDelete() {
    deleteMutation.mutate(service.id, {
      onSuccess: () => {
        navigate({ to: '/config/services' })
      },
    })
  }

  function computeDiffChanges(): DiffChange[] {
    const changes: DiffChange[] = []
    if (initialValues.name !== formValues.name) {
      changes.push({ field: 'Name', oldValue: initialValues.name, newValue: formValues.name })
    }
    if (initialValues.lbPolicy !== formValues.lbPolicy) {
      changes.push({
        field: 'LB Policy',
        oldValue: LB_POLICY_LABELS[initialValues.lbPolicy],
        newValue: LB_POLICY_LABELS[formValues.lbPolicy],
      })
    }
    if (JSON.stringify(initialValues.upstreams) !== JSON.stringify(formValues.upstreams)) {
      changes.push({
        field: 'Upstreams',
        oldValue: initialValues.upstreams.map((u) => u.address).join(', '),
        newValue: formValues.upstreams.map((u) => u.address).join(', '),
      })
    }
    if (JSON.stringify(initialValues.activeHealthCheck) !== JSON.stringify(formValues.activeHealthCheck)) {
      changes.push({
        field: 'Health check',
        oldValue: initialValues.activeHealthCheck.enabled ? 'enabled' : 'disabled',
        newValue: formValues.activeHealthCheck.enabled ? 'enabled' : 'disabled',
      })
    }
    return changes
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/config/services">
            <ArrowLeftIcon className="size-4" />
            <span className="sr-only">{t('detail.backToServices')}</span>
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{service.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t('detail.serviceId')}: <code className="font-mono text-xs">{service.id}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <Button variant="outline" onClick={startEditing}>
              <PencilIcon className="size-4" />
              {t('detail.editSection')}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={cancelEditing}>
                <XIcon className="size-4" />
                {t('detail.cancelEdit')}
              </Button>
              <Button onClick={openReview} disabled={!isDirty || saveMutation.isPending}>
                <CheckIcon className="size-4" />
                {t('detail.reviewChanges')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <TrashIcon className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="overview">{t('detail.overview')}</TabsTrigger>
          <TabsTrigger value="health-checks">{t('detail.healthChecks')}</TabsTrigger>
          <TabsTrigger value="transport">{t('detail.transport')}</TabsTrigger>
          <TabsTrigger value="policies">{t('detail.policiesTab')}</TabsTrigger>
          <TabsTrigger value="traffic">{t('detail.traffic')}</TabsTrigger>
          <TabsTrigger value="activity">{t('detail.activity')}</TabsTrigger>
        </TabsList>

        {/* --- Overview Tab --- */}
        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('detail.overview')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('form.serviceName')}</Label>
                    {isEditing ? (
                      <Input
                        value={formValues.name}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                    ) : (
                      <p className="font-mono text-sm">{service.name}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('form.lbPolicy')}</Label>
                    {isEditing ? (
                      <Select
                        value={formValues.lbPolicy}
                        onValueChange={(val) =>
                          setFormValues((prev) => ({ ...prev, lbPolicy: val as ServiceFormValues['lbPolicy'] }))
                        }
                      >
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(LB_POLICY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">
                        {LB_POLICY_LABELS[service.lbPolicy] ?? service.lbPolicy}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Upstreams */}
                <div>
                  <Label className="text-xs text-muted-foreground">{t('table.upstreams')}</Label>
                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      {formValues.upstreams.map((upstream, idx) => (
                        <div key={idx} className="flex items-center gap-2 rounded-md border p-2">
                          <Input
                            value={upstream.address}
                            onChange={(e) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], address: e.target.value }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                            placeholder={t('form.addressPlaceholder')}
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            min={0}
                            value={upstream.weight}
                            onChange={(e) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], weight: parseInt(e.target.value, 10) || 0 }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                            className="w-20"
                          />
                          <Select
                            value={upstream.tls}
                            onValueChange={(val) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], tls: val as typeof upstream.tls }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                          >
                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(TLS_MODE_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {formValues.upstreams.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => {
                                const next = formValues.upstreams.filter((_, i) => i !== idx)
                                setFormValues((prev) => ({ ...prev, upstreams: next }))
                              }}
                            >
                              <XIcon className="size-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setFormValues((prev) => ({
                            ...prev,
                            upstreams: [...prev.upstreams, { address: '', weight: 1, tls: 'TLS_MODE_OFF' }],
                          }))
                        }
                      >
                        <PlusIcon className="size-3" />
                        {t('form.addUpstream')}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {service.upstreams.map((u, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <StatusBadge status={u.healthy ? 'healthy' : 'unhealthy'} />
                          <code className="font-mono text-xs">{u.address}</code>
                          <span className="text-xs text-muted-foreground">w:{u.weight}</span>
                          <Badge variant="outline" className="text-xs">
                            {TLS_MODE_LABELS[u.tls] ?? u.tls}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Metadata sidebar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('detail.createdAt')}</span>
                  <p>{service.createdAt ? <TimeAgo date={service.createdAt} /> : '\u2014'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.updatedAt')}</span>
                  <p>{service.updatedAt ? <TimeAgo date={service.updatedAt} /> : '\u2014'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.serviceId')}</span>
                  <p className="font-mono text-xs break-all">{service.id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.upstreamCount')}</span>
                  <p>{service.upstreams.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* --- Health Checks Tab --- */}
        <TabsContent value="health-checks">
          <Card>
            <CardHeader>
              <CardTitle>{t('healthChecks.active')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">{t('healthChecks.activeDescription')}</p>
              {isEditing ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>{t('healthChecks.enabled')}</Label>
                    <Switch
                      checked={formValues.activeHealthCheck.enabled}
                      onCheckedChange={(checked) =>
                        setFormValues((prev) => ({
                          ...prev,
                          activeHealthCheck: { ...prev.activeHealthCheck, enabled: checked },
                        }))
                      }
                    />
                  </div>
                  {formValues.activeHealthCheck.enabled && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('healthChecks.path')}</Label>
                        <Input
                          value={formValues.activeHealthCheck.path}
                          onChange={(e) =>
                            setFormValues((prev) => ({
                              ...prev,
                              activeHealthCheck: { ...prev.activeHealthCheck, path: e.target.value },
                            }))
                          }
                          placeholder={t('healthChecks.pathPlaceholder')}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('healthChecks.interval')}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={formValues.activeHealthCheck.intervalSeconds}
                          onChange={(e) =>
                            setFormValues((prev) => ({
                              ...prev,
                              activeHealthCheck: {
                                ...prev.activeHealthCheck,
                                intervalSeconds: parseInt(e.target.value, 10) || 0,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('healthChecks.timeout')}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={formValues.activeHealthCheck.timeoutSeconds}
                          onChange={(e) =>
                            setFormValues((prev) => ({
                              ...prev,
                              activeHealthCheck: {
                                ...prev.activeHealthCheck,
                                timeoutSeconds: parseInt(e.target.value, 10) || 0,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('healthChecks.healthyThreshold')}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={formValues.activeHealthCheck.healthyThreshold}
                          onChange={(e) =>
                            setFormValues((prev) => ({
                              ...prev,
                              activeHealthCheck: {
                                ...prev.activeHealthCheck,
                                healthyThreshold: parseInt(e.target.value, 10) || 0,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('healthChecks.unhealthyThreshold')}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={formValues.activeHealthCheck.unhealthyThreshold}
                          onChange={(e) =>
                            setFormValues((prev) => ({
                              ...prev,
                              activeHealthCheck: {
                                ...prev.activeHealthCheck,
                                unhealthyThreshold: parseInt(e.target.value, 10) || 0,
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={service.healthCheck?.enabled ? 'healthy' : 'unknown'}
                      label={service.healthCheck?.enabled ? 'Active' : 'Disabled'}
                    />
                  </div>
                  {service.healthCheck?.enabled && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground">Path:</span> {service.healthCheck.path}</div>
                      <div><span className="text-muted-foreground">Interval:</span> {service.healthCheck.intervalSeconds}s</div>
                      <div><span className="text-muted-foreground">Timeout:</span> {service.healthCheck.timeoutSeconds}s</div>
                      <div><span className="text-muted-foreground">Thresholds:</span> {service.healthCheck.healthyThreshold}/{service.healthCheck.unhealthyThreshold}</div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Passive health checks -- NEEDS BACKEND */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('healthChecks.passive')}</CardTitle>
            </CardHeader>
            <CardContent>
              <NeedsBackendField>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">{t('healthChecks.passiveDescription')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.failureWindow')}</Label>
                      <Input disabled placeholder="30s" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.maxFailures')}</Label>
                      <Input type="number" disabled placeholder="5" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.latencyThreshold')}</Label>
                      <Input disabled placeholder="2000ms" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.unhealthyStatuses')}</Label>
                      <Input disabled placeholder="502, 503, 504" />
                    </div>
                  </div>
                </div>
              </NeedsBackendField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Transport Tab (NEEDS BACKEND) --- */}
        <TabsContent value="transport">
          <NeedsBackendField message="Transport configuration requires proto enrichment">
            <Card>
              <CardHeader>
                <CardTitle>{t('transport.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">{t('transport.description')}</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.dialTimeout')}</Label>
                    <Input disabled placeholder="5s" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.responseHeaderTimeout')}</Label>
                    <Input disabled placeholder="30s" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.idleTimeout')}</Label>
                    <Input disabled placeholder="90s" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.maxRetries')}</Label>
                    <Input type="number" disabled placeholder="3" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.retryStatuses')}</Label>
                    <Input disabled placeholder="502, 503, 504" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.maxConnsPerHost')}</Label>
                    <Input type="number" disabled placeholder="100" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.maxIdleConns')}</Label>
                    <Input type="number" disabled placeholder="10" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.keepAliveInterval')}</Label>
                    <Input disabled placeholder="30s" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </NeedsBackendField>
        </TabsContent>

        {/* --- Policies Tab (placeholder) --- */}
        <TabsContent value="policies">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.policiesTab')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Service-level policy attachment is configured on individual routes that target this service.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Traffic Tab (NEEDS BACKEND) --- */}
        <TabsContent value="traffic">
          <NeedsBackendField message="Per-service traffic analytics require TrafficService enrichment">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.traffic')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                  </div>
                  <Skeleton className="h-64" />
                </div>
              </CardContent>
            </Card>
          </NeedsBackendField>
        </TabsContent>

        {/* --- Activity Tab (NEEDS BACKEND) --- */}
        <TabsContent value="activity">
          <NeedsBackendField message="Per-entity activity logs require audit trail enrichment">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.activity')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-48" />
              </CardContent>
            </Card>
          </NeedsBackendField>
        </TabsContent>
      </Tabs>

      {/* Review changes dialog */}
      <ConfirmDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={t('detail.reviewChanges')}
        description=""
        confirmLabel={t('detail.applyChanges')}
        variant="default"
        loading={saveMutation.isPending}
        onConfirm={handleSave}
      >
        <DiffView changes={computeDiffChanges()} />
      </ConfirmDialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('messages.confirmDeleteTitle')}
        description={t('messages.confirmDelete')}
        confirmLabel={tc('actions.delete')}
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit 2>&1 | head -30`

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/routes/config/services.\$serviceId.tsx
git commit -m "feat(web): add full-page service detail view with health checks, transport, inline editing"
```

---

## Task 12: Service Create Page

**Files:**
- Create: `packages/web/src/routes/config/services.create.tsx`

- [ ] **Step 1: Create the service create page**

Create `packages/web/src/routes/config/services.create.tsx`:

```tsx
import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, PlusIcon, XIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot } from '@/lib/api'
import {
  serviceFormSchema,
  formValuesToServicePayload,
  LB_POLICY_LABELS,
  TLS_MODE_LABELS,
} from '@/lib/schemas/service'
import type { ServiceFormValues } from '@/lib/schemas/service'
import { useServiceMutations } from '@/hooks/use-config-mutations'
import { useDirtyForm } from '@/hooks/use-dirty-form'
import { useUnsavedWarning } from '@/hooks/use-unsaved-warning'

import { PageHeader } from '@/components/rioku/page-header'
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/config/services/create')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: ServiceCreatePage,
})

const EMPTY_FORM: ServiceFormValues = {
  name: '',
  lbPolicy: 'LB_POLICY_ROUND_ROBIN',
  upstreams: [{ address: '', weight: 1, tls: 'TLS_MODE_OFF' }],
  activeHealthCheck: {
    enabled: false,
    path: '/health',
    intervalSeconds: 10,
    timeoutSeconds: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
    expectedStatuses: [200],
  },
  passiveHealthCheck: {
    enabled: false,
    failureWindow: '',
    maxFailures: 5,
    latencyThreshold: '',
    unhealthyStatuses: [],
  },
  timeouts: { dial: '', responseHeader: '', idle: '' },
  retries: { maxAttempts: 0, retryStatuses: [] },
  connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
  labels: {},
}

function ServiceCreatePage() {
  const { t } = useTranslation('services')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()

  const { saveMutation } = useServiceMutations()

  const [mode, setMode] = useState<'form' | 'code'>('form')
  const [formValues, setFormValues] = useState<ServiceFormValues>(EMPTY_FORM)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    general: true,
    upstreams: true,
    activeHealth: true,
    passiveHealth: false,
    timeouts: false,
    retries: false,
    connectionPool: false,
    labels: false,
  })

  const { isDirty } = useDirtyForm(EMPTY_FORM, formValues)
  useUnsavedWarning(isDirty)

  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleCreate() {
    const validation = serviceFormSchema.safeParse(formValues)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    const payload = formValuesToServicePayload(formValues)
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('messages.serviceCreated'))
        navigate({ to: '/config/services' })
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/config/services">
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <PageHeader
          title={t('create.title')}
          description={t('create.subtitle')}
        />
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('form')}
        >
          {t('create.formMode')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('code')}
        >
          {t('create.codeMode')}
        </Button>
      </div>

      {mode === 'form' ? (
        <div className="space-y-4">
          {/* General */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('general')}>
              <CardTitle className="text-base">{t('create.sectionGeneral')}</CardTitle>
            </CardHeader>
            {expandedSections.general && (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>
                    {t('form.serviceName')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={formValues.name}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder={t('form.serviceNamePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('form.lbPolicy')}</Label>
                  <Select
                    value={formValues.lbPolicy}
                    onValueChange={(val) =>
                      setFormValues((prev) => ({ ...prev, lbPolicy: val as ServiceFormValues['lbPolicy'] }))
                    }
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(LB_POLICY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Upstreams */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('upstreams')}>
              <CardTitle className="text-base">{t('create.sectionUpstreams')}</CardTitle>
            </CardHeader>
            {expandedSections.upstreams && (
              <CardContent className="space-y-3">
                {formValues.upstreams.map((upstream, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-lg border p-3">
                    <div className="flex-1 space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('form.address')}</Label>
                        <Input
                          value={upstream.address}
                          onChange={(e) => {
                            const next = [...formValues.upstreams]
                            next[idx] = { ...next[idx], address: e.target.value }
                            setFormValues((prev) => ({ ...prev, upstreams: next }))
                          }}
                          placeholder={t('form.addressPlaceholder')}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{t('form.weight')}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={upstream.weight}
                            onChange={(e) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], weight: parseInt(e.target.value, 10) || 0 }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t('form.tlsMode')}</Label>
                          <Select
                            value={upstream.tls}
                            onValueChange={(val) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], tls: val as typeof upstream.tls }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                          >
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(TLS_MODE_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    {formValues.upstreams.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          const next = formValues.upstreams.filter((_, i) => i !== idx)
                          setFormValues((prev) => ({ ...prev, upstreams: next }))
                        }}
                        className="mt-5 shrink-0"
                      >
                        <XIcon className="size-3" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFormValues((prev) => ({
                      ...prev,
                      upstreams: [...prev.upstreams, { address: '', weight: 1, tls: 'TLS_MODE_OFF' }],
                    }))
                  }
                >
                  <PlusIcon className="size-3" />
                  {t('form.addUpstream')}
                </Button>
              </CardContent>
            )}
          </Card>

          {/* Active health checks */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('activeHealth')}>
              <CardTitle className="text-base">{t('create.sectionActiveHealth')}</CardTitle>
            </CardHeader>
            {expandedSections.activeHealth && (
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t('healthChecks.enabled')}</Label>
                  <Switch
                    checked={formValues.activeHealthCheck.enabled}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({
                        ...prev,
                        activeHealthCheck: { ...prev.activeHealthCheck, enabled: checked },
                      }))
                    }
                  />
                </div>
                {formValues.activeHealthCheck.enabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.path')}</Label>
                      <Input
                        value={formValues.activeHealthCheck.path}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: { ...prev.activeHealthCheck, path: e.target.value },
                          }))
                        }
                        placeholder={t('healthChecks.pathPlaceholder')}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.interval')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formValues.activeHealthCheck.intervalSeconds}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: {
                              ...prev.activeHealthCheck,
                              intervalSeconds: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.timeout')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formValues.activeHealthCheck.timeoutSeconds}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: {
                              ...prev.activeHealthCheck,
                              timeoutSeconds: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.healthyThreshold')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formValues.activeHealthCheck.healthyThreshold}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: {
                              ...prev.activeHealthCheck,
                              healthyThreshold: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.unhealthyThreshold')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formValues.activeHealthCheck.unhealthyThreshold}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: {
                              ...prev.activeHealthCheck,
                              unhealthyThreshold: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Passive health checks (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('passiveHealth')}>
              <CardTitle className="text-base">{t('create.sectionPassiveHealth')}</CardTitle>
            </CardHeader>
            {expandedSections.passiveHealth && (
              <CardContent>
                <NeedsBackendField>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.failureWindow')}</Label>
                      <Input disabled placeholder="30s" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.maxFailures')}</Label>
                      <Input type="number" disabled placeholder="5" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.latencyThreshold')}</Label>
                      <Input disabled placeholder="2000ms" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.unhealthyStatuses')}</Label>
                      <Input disabled placeholder="502, 503, 504" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Timeouts (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('timeouts')}>
              <CardTitle className="text-base">{t('create.sectionTimeouts')}</CardTitle>
            </CardHeader>
            {expandedSections.timeouts && (
              <CardContent>
                <NeedsBackendField>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.dialTimeout')}</Label>
                      <Input disabled placeholder="5s" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.responseHeaderTimeout')}</Label>
                      <Input disabled placeholder="30s" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.idleTimeout')}</Label>
                      <Input disabled placeholder="90s" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Retries (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('retries')}>
              <CardTitle className="text-base">{t('create.sectionRetries')}</CardTitle>
            </CardHeader>
            {expandedSections.retries && (
              <CardContent>
                <NeedsBackendField>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.maxRetries')}</Label>
                      <Input type="number" disabled placeholder="3" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.retryStatuses')}</Label>
                      <Input disabled placeholder="502, 503, 504" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Connection pool (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('connectionPool')}>
              <CardTitle className="text-base">{t('create.sectionConnectionPool')}</CardTitle>
            </CardHeader>
            {expandedSections.connectionPool && (
              <CardContent>
                <NeedsBackendField>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.maxConnsPerHost')}</Label>
                      <Input type="number" disabled placeholder="100" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.maxIdleConns')}</Label>
                      <Input type="number" disabled placeholder="10" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.keepAliveInterval')}</Label>
                      <Input disabled placeholder="30s" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Labels (collapsed) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('labels')}>
              <CardTitle className="text-base">{t('create.sectionLabels')}</CardTitle>
            </CardHeader>
            {expandedSections.labels && (
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Key-value labels for organizing and filtering services.
                </p>
                {/* TagInput / KeyValueEditor from Phase 1 goes here */}
                <div className="mt-2 rounded-md border p-4 text-center text-sm text-muted-foreground">
                  KeyValueEditor placeholder -- Phase 1 component required
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              YAML/JSON mode uses the YamlJsonEditor component from Phase 1.
            </p>
            <div className="mt-4 rounded-md border p-8 text-center text-sm text-muted-foreground">
              YamlJsonEditor placeholder -- Phase 1 component required
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-3 border-t pt-4">
        <Button
          onClick={handleCreate}
          disabled={saveMutation.isPending || !formValues.name || formValues.upstreams.every((u) => !u.address.trim())}
        >
          {saveMutation.isPending ? 'Creating...' : t('form.createService')}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/config/services">{tc('actions.cancel')}</Link>
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit 2>&1 | head -30`

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add packages/web/src/routes/config/services.create.tsx
git commit -m "feat(web): add full-page service create with all form sections and NEEDS BACKEND placeholders"
```

---

## Task 13: Final Verification and Full Test Suite

**Files:** All files created/modified in Tasks 1-12

- [ ] **Step 1: Run all unit tests**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run`

Expected: All tests pass (existing + new).

- [ ] **Step 2: Run TypeScript type check**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Verify route tree generation**

TanStack Router auto-generates routes. After creating the new route files, the route tree should include the new routes.

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vite build 2>&1 | tail -20`

Expected: Build succeeds. The route tree includes `/config/routes/`, `/config/routes/$routeId`, `/config/routes/create`, `/config/services/`, `/config/services/$serviceId`, `/config/services/create`.

- [ ] **Step 4: Final commit**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && git add -A
git commit -m "chore(web): regenerate route tree for new route/service pages"
```

---

## Summary Checklist

| Spec Section | Task | Status |
|-------------|------|--------|
| 4.1 Click entity name → full-page detail | Tasks 7, 8, 10, 11 | Link in name column navigates to `/$routeId` / `/$serviceId` |
| 4.2 Inline hover actions | Tasks 7, 10 | `hoverActions` prop on DataTable |
| 4.3 Bulk actions | Tasks 7, 10 | Checkbox + bulk action bar via enhanced DataTable |
| 4.4 Faceted filtering | Tasks 7, 10 | Faceted filter bar via enhanced DataTable |
| 5.1 Full-page detail pattern | Tasks 8, 11 | Separate route files, breadcrumb back button |
| 5.2 Inline editing | Tasks 8, 11 | Edit button toggles read/write mode |
| 5.3 YAML toggle | Tasks 9, 12 | Mode toggle on create pages (Phase 1 YamlJsonEditor) |
| 5.4 SearchableSelect | Tasks 8, 9 | Phase 1 component (select fallback for now) |
| 6.1 Two input modes | Tasks 9, 12 | Form mode + YAML/JSON mode toggle |
| 6.3 Bidirectional sync | Tasks 9, 12 | YamlJsonEditor handles this (Phase 1) |
| 6.4 Create as full page | Tasks 9, 12 | `/config/routes/create`, `/config/services/create` |
| 7.1 Route form sections | Task 9 | Basics, Matching, Target, Policies, TLS, Advanced |
| 7.2 NEEDS BACKEND fields | Tasks 8, 9 | NeedsBackendField wrapper on TLS, Advanced |
| 8.1 Service form sections | Task 12 | General, Upstreams, Health checks, Timeouts, Retries, Pool, Labels |
| 12.1 Activity tab | Tasks 8, 11 | Tab present, NEEDS BACKEND skeleton |
| 18.1 Unsaved changes warning | Task 2 | useUnsavedWarning + useDirtyForm |
| 18.4 Diff view before save | Tasks 4, 8, 11 | DiffView component + review dialog |
| 18.5 Deep linking tabs | Task 2 | useTabFromUrl hook |
| 18.7 Loading skeletons | Tasks 8, 11 | Skeleton in NEEDS BACKEND tabs |
| 18.8 Error boundaries | Tasks 8, 11 | TanStack Router error component |
| 18.13 Inline Zod validation | Tasks 1, 8, 9 | routeFormSchema + serviceFormSchema |
| 18.14 Optimistic toggles | Task 7 | toggleMutation in list page |
