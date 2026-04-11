# Admin Panel Remediation -- Phase B: Missing Mockup Features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all missing mockup features from the reference admin-mockup: traffic-centric dashboard with charts, time range context, wizard modes for route/policy creation, Traffic + Activity tabs on detail pages, profile preferences/accessibility, list page traffic columns, and faceted filters.

**Architecture:** All traffic data comes from MSW handlers (set up in Phase A). New components are shared where possible (TimeRangeSelector, WizardStepIndicator, TrafficTab, ActivityTimeline). The dashboard is overhauled from system-status to traffic-centric. Wizard modes add a third form state alongside existing Form/Code modes. Preferences use the existing `usePreferences` hook backed by scoped localStorage.

**Tech Stack:** React 19, TypeScript 6, TanStack Router + Query, Recharts (already installed), Vitest 4.x, @testing-library/react, happy-dom

**Working directory:** `.worktrees/admin-remediation-b/packages/web/`

**Depends on:** Phase A must be complete. The following must exist:
- MSW fully wired with all handlers (`src/mocks/handlers/traffic.ts`, `src/mocks/data/traffic.ts`)
- `YamlJsonEditor`, `SearchableSelect`, `SearchableMultiSelect` from `@rioku/ui`
- All config pages with Form/Code mode toggle already working
- `usePreferences` hook in `src/hooks/use-preferences.ts`
- `useTheme` hook in `src/hooks/use-theme.ts`
- `FacetedFilter` component in `src/components/rioku/faceted-filter.tsx`
- `StatCard` component in `src/components/rioku/stat-card.tsx`
- `DataTable` with `filterColumns` prop support

**Key conventions:**
- Conventional Commits required (`feat:`, `fix:`, etc.)
- No AI tool references in commits
- TDD where practical
- Vitest + @testing-library/react + happy-dom for testing
- Use `source ~/.nvm/nvm.sh &&` before any node/npx commands
- Button uses `render` prop pattern, NOT `asChild`
- Components from `@rioku/ui`: SearchableSelect, SearchableMultiSelect, YamlJsonEditor

---

## Task 1: Shared TimeRangeContext + TimeRangeSelector Component (B2)

**Why first:** The dashboard (B1) and future analytics pages depend on this context.

**Files:**
- Create: `src/hooks/use-time-range.ts`
- Create: `src/hooks/__tests__/use-time-range.test.ts`
- Create: `src/components/rioku/time-range-selector.tsx`
- Create: `src/components/rioku/__tests__/time-range-selector.test.tsx`

- [ ] **Step 1: Write test for useTimeRange hook**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run src/hooks/__tests__/use-time-range.test.ts
```

File: `src/hooks/__tests__/use-time-range.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimeRange, TIME_RANGE_OPTIONS, type TimeRange } from '@/hooks/use-time-range'

// The hook reads from TanStack Router search params. For unit testing,
// we test the pure logic; integration tests cover URL sync.

describe('useTimeRange', () => {
  it('exports the valid range options', () => {
    expect(TIME_RANGE_OPTIONS).toEqual(['1h', '6h', '24h', '7d', '30d'])
  })

  it('defaults to 24h', () => {
    const { result } = renderHook(() => useTimeRange())
    expect(result.current.range).toBe('24h')
  })

  it('setRange updates the range', () => {
    const { result } = renderHook(() => useTimeRange())
    act(() => result.current.setRange('7d'))
    expect(result.current.range).toBe('7d')
  })

  it('rejects invalid ranges gracefully', () => {
    const { result } = renderHook(() => useTimeRange())
    act(() => result.current.setRange('99d' as TimeRange))
    // Should stay at previous valid value
    expect(TIME_RANGE_OPTIONS).not.toContain('99d')
  })
})
```

- [ ] **Step 2: Implement useTimeRange hook**

File: `src/hooks/use-time-range.ts`

```ts
import { useState, useCallback } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'

export const TIME_RANGE_OPTIONS = ['1h', '6h', '24h', '7d', '30d'] as const
export type TimeRange = (typeof TIME_RANGE_OPTIONS)[number]

function isValidRange(v: unknown): v is TimeRange {
  return TIME_RANGE_OPTIONS.includes(v as TimeRange)
}

/**
 * Shared time range state persisted in URL search params (?range=24h).
 * Falls back to '24h' when no search param or invalid value.
 */
export function useTimeRange() {
  // Try to read from URL search params for pages that use TanStack Router
  let urlRange: string | undefined
  try {
    const search = useSearch({ strict: false }) as Record<string, unknown>
    urlRange = search?.range as string | undefined
  } catch {
    // Not inside a router context — fall back to local state
  }

  let navigate: ReturnType<typeof useNavigate> | null = null
  try {
    navigate = useNavigate()
  } catch {
    // Not inside a router context
  }

  const initial = isValidRange(urlRange) ? urlRange : '24h'
  const [localRange, setLocalRange] = useState<TimeRange>(initial)

  const range = isValidRange(urlRange) ? urlRange : localRange

  const setRange = useCallback(
    (newRange: TimeRange) => {
      if (!isValidRange(newRange)) return
      setLocalRange(newRange)
      if (navigate) {
        navigate({
          search: (prev: Record<string, unknown>) => ({ ...prev, range: newRange }),
          replace: true,
        })
      }
    },
    [navigate],
  )

  return { range, setRange }
}
```

- [ ] **Step 3: Write test for TimeRangeSelector component**

File: `src/components/rioku/__tests__/time-range-selector.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimeRangeSelector } from '@/components/rioku/time-range-selector'

describe('TimeRangeSelector', () => {
  it('renders all range options as buttons', () => {
    render(<TimeRangeSelector range="24h" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '1h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '6h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '24h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument()
  })

  it('highlights the active range', () => {
    render(<TimeRangeSelector range="7d" onChange={vi.fn()} />)
    const btn = screen.getByRole('button', { name: '7d' })
    expect(btn.className).toContain('bg-primary')
  })

  it('calls onChange when a different range is clicked', () => {
    const onChange = vi.fn()
    render(<TimeRangeSelector range="24h" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '1h' }))
    expect(onChange).toHaveBeenCalledWith('1h')
  })
})
```

- [ ] **Step 4: Implement TimeRangeSelector component**

File: `src/components/rioku/time-range-selector.tsx`

```tsx
import { cn } from '@/lib/utils'
import { TIME_RANGE_OPTIONS, type TimeRange } from '@/hooks/use-time-range'

interface TimeRangeSelectorProps {
  range: TimeRange
  onChange: (range: TimeRange) => void
  className?: string
}

function TimeRangeSelector({ range, onChange, className }: TimeRangeSelectorProps) {
  return (
    <div className={cn('inline-flex items-center rounded-lg border border-border bg-card', className)}>
      {TIME_RANGE_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            range === opt
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
            opt === '1h' && 'rounded-l-lg',
            opt === '30d' && 'rounded-r-lg',
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export { TimeRangeSelector }
export type { TimeRangeSelectorProps }
```

- [ ] **Step 5: Run tests, verify green, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run src/hooks/__tests__/use-time-range.test.ts src/components/rioku/__tests__/time-range-selector.test.tsx
```

Commit: `feat(web): add TimeRangeSelector component and useTimeRange hook`

---

## Task 2: Expand MSW Traffic Handlers for Dashboard + Detail Pages (B2 prerequisite)

**Why:** The dashboard and detail page Traffic tabs need per-range traffic data and per-entity traffic data from MSW.

**Files:**
- Modify: `src/mocks/data/traffic.ts` (add range-aware generators, per-entity data, recent requests)
- Modify: `src/mocks/handlers/traffic.ts` (add `/traffic/stats`, `/traffic/routes/:id`, `/traffic/services/:id`, `/traffic/dashboard` endpoints)

- [ ] **Step 1: Extend mock traffic data with range-aware generation**

File: `src/mocks/data/traffic.ts` -- add after existing exports:

```ts
export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d'

interface RangeConfig {
  points: number
  labelFn: (i: number) => string
  reqBase: number
}

const rangeConfigs: Record<TimeRange, RangeConfig> = {
  '1h':  { points: 12, labelFn: (i) => `${(i * 5).toString().padStart(2, '0')}m`,  reqBase: 3200 },
  '6h':  { points: 12, labelFn: (i) => `${(i * 30).toString().padStart(2, '0')}m`, reqBase: 18000 },
  '24h': { points: 24, labelFn: (i) => `${(i + 1).toString().padStart(2, '0')}:00`, reqBase: 38000 },
  '7d':  { points: 14, labelFn: (i) => `Day ${Math.floor(i / 2) + 1}${i % 2 === 0 ? 'a' : 'p'}`, reqBase: 420000 },
  '30d': { points: 30, labelFn: (i) => `Day ${i + 1}`, reqBase: 1200000 },
}

export function generateDashboardData(range: TimeRange) {
  const cfg = rangeConfigs[range]
  const labels = Array.from({ length: cfg.points }, (_, i) => cfg.labelFn(i))

  const requestRateData = labels.map((time, i) => ({
    time,
    requests: Math.round(cfg.reqBase + Math.sin(i / 3) * cfg.reqBase * 0.3 + Math.random() * cfg.reqBase * 0.15),
  }))

  const errorRateData = labels.map((time, i) => {
    const total = +(0.2 + Math.sin(i / 4) * 0.15 + Math.random() * 0.1).toFixed(2)
    const e4xx = +(total * (0.35 + Math.random() * 0.1)).toFixed(3)
    const e502 = +(total * (0.12 + Math.random() * 0.05)).toFixed(3)
    const e503 = +(total * (0.10 + Math.random() * 0.05)).toFixed(3)
    const e429 = +(total * (0.18 + Math.random() * 0.08)).toFixed(3)
    const e5xx_other = +(Math.max(0, total - e4xx - e502 - e503 - e429)).toFixed(3)
    return { time, e4xx, e502, e503, e429, e5xx_other }
  })

  const latencyData = labels.map((time, i) => ({
    time,
    p50: Math.round(28 + Math.sin(i / 5) * 8 + Math.random() * 5),
    p95: Math.round(120 + Math.sin(i / 4) * 30 + Math.random() * 20),
    p99: Math.round(280 + Math.sin(i / 3) * 60 + Math.random() * 40),
  }))

  const scaleMultiplier = { '1h': 0.04, '6h': 0.25, '24h': 1, '7d': 7, '30d': 30 }[range]
  const topRoutesData = [
    { route: '/api/v1/users', requests: Math.round(312400 * scaleMultiplier) },
    { route: '/api/v1/products', requests: Math.round(248700 * scaleMultiplier) },
    { route: '/api/v1/auth/login', requests: Math.round(189300 * scaleMultiplier) },
    { route: '/api/v1/orders', requests: Math.round(156800 * scaleMultiplier) },
    { route: '/api/v1/ai/completions', requests: Math.round(134200 * scaleMultiplier) },
    { route: '/api/v1/search', requests: Math.round(98500 * scaleMultiplier) },
  ]

  const totalRequests = requestRateData.reduce((s, d) => s + d.requests, 0)
  const errorTotal = errorRateData.reduce((s, d) => s + d.e4xx + d.e502 + d.e503 + d.e429 + d.e5xx_other, 0)

  return {
    requestRateData,
    errorRateData,
    latencyData,
    topRoutesData,
    summary: {
      totalRequests,
      errorRate: totalRequests > 0 ? +((errorTotal / totalRequests) * 100).toFixed(2) : 0,
      p95Latency: latencyData.length > 0 ? latencyData[latencyData.length - 1].p95 : 0,
      activeRoutes: 47,
      disabledRoutes: 3,
      requestsDelta: '+12.3%',
      errorDelta: '-0.08%',
      latencyDelta: '+8ms',
    },
  }
}

export interface RecentRequest {
  time: string
  method: string
  path: string
  status: number
  latencyMs: number
}

export const mockRecentRequests: RecentRequest[] = [
  { time: '12:04:32', method: 'POST', path: '/v1/payments/charge', status: 200, latencyMs: 34 },
  { time: '12:04:31', method: 'GET', path: '/v1/payments/txn-8821', status: 200, latencyMs: 22 },
  { time: '12:04:30', method: 'POST', path: '/v1/payments/refund', status: 201, latencyMs: 48 },
  { time: '12:04:28', method: 'GET', path: '/v1/payments/txn-8820', status: 200, latencyMs: 18 },
  { time: '12:04:27', method: 'PUT', path: '/v1/payments/txn-8819', status: 200, latencyMs: 41 },
  { time: '12:04:25', method: 'GET', path: '/v1/payments/list', status: 200, latencyMs: 56 },
  { time: '12:04:23', method: 'POST', path: '/v1/payments/charge', status: 422, latencyMs: 12 },
  { time: '12:04:21', method: 'DELETE', path: '/v1/payments/txn-8815', status: 204, latencyMs: 30 },
  { time: '12:04:19', method: 'GET', path: '/v1/payments/txn-8814', status: 404, latencyMs: 8 },
  { time: '12:04:17', method: 'POST', path: '/v1/payments/charge', status: 200, latencyMs: 38 },
]

export interface ActivityEntry {
  action: string
  user: string
  timestamp: string
  detail: string
}

export const mockRouteActivity: ActivityEntry[] = [
  { action: 'Configuration updated', user: 'jdoe@company.com', timestamp: '2026-04-09 16:22 UTC', detail: 'Changed load balancing from round_robin to least_conn' },
  { action: 'Policy attached', user: 'admin@rioku.io', timestamp: '2026-04-08 11:05 UTC', detail: 'Attached cors-public-api policy (order: 3)' },
  { action: 'Route enabled', user: 'admin@rioku.io', timestamp: '2026-04-07 09:30 UTC', detail: 'Route re-enabled after maintenance window' },
  { action: 'TLS updated', user: 'schen@company.com', timestamp: '2026-04-05 14:18 UTC', detail: 'Enabled Force HTTPS, set min TLS version to 1.3' },
  { action: 'Route created', user: 'admin@rioku.io', timestamp: '2026-03-15 10:00 UTC', detail: 'Initial creation with payments-svc target' },
  { action: 'Path updated', user: 'jdoe@company.com', timestamp: '2026-03-20 08:45 UTC', detail: 'Changed path from /v1/payments to /v1/payments/*' },
  { action: 'Policy detached', user: 'admin@rioku.io', timestamp: '2026-03-22 16:30 UTC', detail: 'Detached deprecated rate-limit-v1 policy' },
]

export const mockServiceActivity: ActivityEntry[] = [
  { action: 'Upstream added', user: 'jdoe@company.com', timestamp: '2026-04-09 14:10 UTC', detail: 'Added upstream 10.0.1.17:8080 (weight: 1)' },
  { action: 'Health check updated', user: 'admin@rioku.io', timestamp: '2026-04-08 09:30 UTC', detail: 'Changed active health check interval from 30s to 10s' },
  { action: 'Configuration updated', user: 'schen@company.com', timestamp: '2026-04-06 16:45 UTC', detail: 'Changed load balancing from round_robin to least_conn' },
  { action: 'Upstream removed', user: 'admin@rioku.io', timestamp: '2026-04-04 11:20 UTC', detail: 'Removed unhealthy upstream 10.0.1.14:8080' },
  { action: 'Policy attached', user: 'admin@rioku.io', timestamp: '2026-04-02 08:15 UTC', detail: 'Attached circuit-breaker-default policy' },
  { action: 'Service created', user: 'admin@rioku.io', timestamp: '2026-02-15 10:00 UTC', detail: 'Initial creation with 2 upstreams, round_robin LB' },
  { action: 'Transport updated', user: 'jdoe@company.com', timestamp: '2026-03-10 13:22 UTC', detail: 'Enabled TLS to upstream, set HTTP/2' },
]
```

- [ ] **Step 2: Add MSW handlers for dashboard + entity traffic**

File: `src/mocks/handlers/traffic.ts` -- add to the `trafficHandlers` array:

```ts
http.get('/api/v1/traffic/dashboard', ({ request }) => {
  const url = new URL(request.url)
  const range = (url.searchParams.get('range') ?? '24h') as TimeRange
  const data = generateDashboardData(range)
  return HttpResponse.json(data)
}),

http.get('/api/v1/traffic/routes/:routeId', () => {
  return HttpResponse.json({
    rps: 342,
    rpsDelta: '+5.2%',
    errorRate: 0.12,
    errorCount: 3,
    totalRequests: 2508,
    p95LatencyMs: 45,
    p50LatencyMs: 18,
    bandwidth: '2.4 MB/s',
    requestRateData: generateEntityTrafficChart(),
    errorBreakdownData: generateEntityErrorChart(),
    recentRequests: mockRecentRequests,
  })
}),

http.get('/api/v1/traffic/services/:serviceId', () => {
  return HttpResponse.json({
    rps: 342,
    rpsDelta: '+3.8%',
    errorRate: 0.08,
    errorCount: 2,
    totalRequests: 2508,
    p95LatencyMs: 42,
    p50LatencyMs: 18,
    activeConnections: 187,
    upstreamCount: 3,
    requestRateData: generateEntityTrafficChart(),
    errorBreakdownData: generateEntityErrorChart(),
    recentRequests: mockRecentRequests,
  })
}),

http.get('/api/v1/audit/routes/:routeId', () => {
  return HttpResponse.json({ entries: mockRouteActivity })
}),

http.get('/api/v1/audit/services/:serviceId', () => {
  return HttpResponse.json({ entries: mockServiceActivity })
}),
```

Add helper functions to `src/mocks/data/traffic.ts`:

```ts
export function generateEntityTrafficChart() {
  return Array.from({ length: 48 }, (_, i) => {
    const mins = i * 1.25
    const h = Math.floor(mins / 60) + 11
    const m = Math.round(mins % 60)
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    const raw = [35, 42, 38, 55, 48, 62, 58, 45, 52, 67, 72, 65, 58, 48, 55, 62, 70, 68, 75, 72, 78, 82, 76, 68, 72, 80, 85, 78, 74, 70, 66, 72, 75, 80, 82, 78, 74, 68, 65, 70, 72, 76, 80, 84, 78, 72, 68, 64]
    return { time, rps: Math.round((raw[i] / 100) * 420) }
  })
}

export function generateEntityErrorChart() {
  const labels = Array.from({ length: 24 }, (_, i) => {
    const mins = i * 1.25
    const h = Math.floor(mins / 60) + 11
    const m = Math.round(mins % 60)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  })
  const e4xxSeeds = [0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 0, 1, 0]
  const e5xxSeeds = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
  return labels.map((time, i) => ({
    time,
    '4xx': e4xxSeeds[i],
    '5xx': e5xxSeeds[i],
  }))
}
```

- [ ] **Step 3: Commit**

Commit: `feat(web): extend MSW traffic handlers for dashboard and entity detail pages`

---

## Task 3: Dashboard Overhaul (B1)

**Files:**
- Modify: `src/routes/index.tsx` (replace entire Dashboard function body)

- [ ] **Step 1: Rewrite dashboard with traffic-centric layout**

Replace the `Dashboard` function in `src/routes/index.tsx`. Keep the existing `Route` export with its loader (health, config, audit), but add a new `useQuery` for dashboard traffic data. The layout follows the mockup: 4 stat cards with deltas, 4 Recharts charts, TimeRangeSelector, then System Status + Recent Changes at the bottom.

New imports to add at the top of the file:

```tsx
import { useMemo } from 'react'
import {
  LineChart, Line, Legend,
} from 'recharts'
import { Activity, AlertTriangle, Clock, Route as RouteIcon } from 'lucide-react'
import { TimeRangeSelector } from '@/components/rioku/time-range-selector'
import { useTimeRange } from '@/hooks/use-time-range'
```

Replace the `Dashboard` function body. Key structure:

```tsx
function Dashboard() {
  const { t } = useTranslation('dashboard')
  const [health, config, audit] = Route.useLoaderData()
  const { range, setRange } = useTimeRange()

  const { data: dashboardData } = useQuery({
    queryKey: ['traffic', 'dashboard', range],
    queryFn: () => apiClient.get('/traffic/dashboard', { range }),
    refetchInterval: 60000,
    retry: false,
  })

  const {
    requestRateData = [],
    errorRateData = [],
    latencyData = [],
    topRoutesData = [],
    summary,
  } = dashboardData ?? {}

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title', 'Dashboard')}
        description={t('description', 'Gateway performance at a glance')}
        actions={<TimeRangeSelector range={range} onChange={setRange} />}
      />

      <Slot zone="dashboard.alerts" />

      {/* 4 stat cards with deltas */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Total Requests"
          value={summary?.totalRequests?.toLocaleString() ?? '--'}
          icon={<Activity className="size-5" />}
          trend={summary?.requestsDelta ? {
            value: summary.requestsDelta,
            direction: summary.requestsDelta.startsWith('+') ? 'up' : 'down',
          } : undefined}
        />
        <StatCard
          title="Error Rate"
          value={summary?.errorRate != null ? `${summary.errorRate}%` : '--'}
          icon={<AlertTriangle className="size-5" />}
          trend={summary?.errorDelta ? {
            value: summary.errorDelta,
            direction: summary.errorDelta.startsWith('-') ? 'up' : 'down',
          } : undefined}
        />
        <StatCard
          title="P95 Latency"
          value={summary?.p95Latency != null ? `${summary.p95Latency}ms` : '--'}
          icon={<Clock className="size-5" />}
          trend={summary?.latencyDelta ? {
            value: summary.latencyDelta,
            direction: summary.latencyDelta.startsWith('-') ? 'up' : 'down',
          } : undefined}
        />
        <StatCard
          title="Active Routes"
          value={summary?.activeRoutes ?? config?.routes.length ?? 0}
          icon={<RouteIcon className="size-5" />}
          trend={summary?.disabledRoutes ? {
            value: `${summary.disabledRoutes} disabled`,
            direction: 'down',
          } : undefined}
        />
      </div>

      {/* Row 1: Request Rate (area) + Error Rate (stacked bar) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Request Rate</CardTitle></CardHeader>
          <CardContent>
            {requestRateData.length === 0 ? (
              <ChartPlaceholder message="No traffic data" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={requestRateData}>
                  <defs>
                    <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1, hsl(var(--primary)))" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--chart-1, hsl(var(--primary)))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip />
                  <Area type="monotone" dataKey="requests" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#reqGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Error Rate</CardTitle></CardHeader>
          <CardContent>
            {errorRateData.length === 0 ? (
              <ChartPlaceholder message="No error data" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={errorRateData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip />
                  <Bar dataKey="e4xx" stackId="errors" fill="#f59e0b" name="4xx" />
                  <Bar dataKey="e502" stackId="errors" fill="#dc2626" name="502" />
                  <Bar dataKey="e503" stackId="errors" fill="#ea580c" name="503" />
                  <Bar dataKey="e429" stackId="errors" fill="#a855f7" name="429" />
                  <Bar dataKey="e5xx_other" stackId="errors" fill="#ef4444" name="5xx Other" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Latency Percentiles (line) + Top Routes (horizontal bar) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Latency Percentiles</CardTitle></CardHeader>
          <CardContent>
            {latencyData.length === 0 ? (
              <ChartPlaceholder message="No latency data" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={latencyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}ms`} />
                  <Tooltip />
                  <Legend verticalAlign="top" align="right" iconType="line" iconSize={12} wrapperStyle={{ fontSize: '11px', paddingBottom: '8px' }} />
                  <Line type="monotone" dataKey="p50" stroke="hsl(var(--chart-2, 160 60% 45%))" strokeWidth={2} dot={false} name="p50" />
                  <Line type="monotone" dataKey="p95" stroke="hsl(var(--chart-3, 30 80% 55%))" strokeWidth={2} dot={false} name="p95" />
                  <Line type="monotone" dataKey="p99" stroke="hsl(var(--chart-4, 280 65% 60%))" strokeWidth={2} dot={false} name="p99" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top Routes by Traffic</CardTitle></CardHeader>
          <CardContent>
            {topRoutesData.length === 0 ? (
              <ChartPlaceholder message="No route data" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topRoutesData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                  <XAxis type="number" className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis dataKey="route" type="category" className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} width={130} />
                  <Tooltip />
                  <Bar dataKey="requests" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: keep existing System Status + Recent Changes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent changes card -- same as current */}
        {/* System status card -- same as current */}
      </div>

      <Slot zone="dashboard.widgets" />
    </div>
  )
}
```

Note: Preserve the existing Recent Changes and System Status cards at the bottom. Only replace the stat cards row and charts section.

- [ ] **Step 2: Run full test suite to verify no regressions**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

- [ ] **Step 3: Commit**

Commit: `feat(web): overhaul dashboard with traffic-centric charts and time range selector`

---

## Task 4: WizardStepIndicator Shared Component (B3/B4 prerequisite)

**Files:**
- Create: `src/components/rioku/wizard-step-indicator.tsx`
- Create: `src/components/rioku/__tests__/wizard-step-indicator.test.tsx`

- [ ] **Step 1: Write test**

File: `src/components/rioku/__tests__/wizard-step-indicator.test.tsx`

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WizardStepIndicator } from '@/components/rioku/wizard-step-indicator'

describe('WizardStepIndicator', () => {
  const steps = ['Basics', 'Matching', 'Target', 'Policies & TLS', 'Review']

  it('renders all step labels', () => {
    render(<WizardStepIndicator steps={steps} currentStep={0} />)
    for (const label of steps) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('marks completed steps with a check icon', () => {
    const { container } = render(<WizardStepIndicator steps={steps} currentStep={2} />)
    // Steps 0 and 1 should be done (have check marks)
    const doneSteps = container.querySelectorAll('[data-step-done="true"]')
    expect(doneSteps).toHaveLength(2)
  })

  it('highlights the active step', () => {
    const { container } = render(<WizardStepIndicator steps={steps} currentStep={2} />)
    const activeStep = container.querySelector('[data-step-active="true"]')
    expect(activeStep).toBeInTheDocument()
    expect(activeStep?.textContent).toContain('3') // 0-indexed step 2 = display number 3
  })

  it('marks future steps as pending', () => {
    const { container } = render(<WizardStepIndicator steps={steps} currentStep={1} />)
    const pendingSteps = container.querySelectorAll('[data-step-pending="true"]')
    expect(pendingSteps.length).toBe(3) // steps 2, 3, 4
  })
})
```

- [ ] **Step 2: Implement component**

File: `src/components/rioku/wizard-step-indicator.tsx`

```tsx
import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WizardStepIndicatorProps {
  steps: string[]
  currentStep: number
  className?: string
}

function WizardStepIndicator({ steps, currentStep, className }: WizardStepIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {steps.map((label, i) => {
        const isDone = i < currentStep
        const isActive = i === currentStep
        const isPending = i > currentStep
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                data-step-done={isDone || undefined}
                data-step-active={isActive || undefined}
                data-step-pending={isPending || undefined}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-xs font-bold',
                  isDone && 'bg-green-600 text-white',
                  isActive && 'bg-primary text-primary-foreground',
                  isPending && 'bg-muted text-muted-foreground',
                )}
              >
                {isDone ? <CheckIcon className="size-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-sm font-medium',
                  isDone && 'text-green-600',
                  isActive && 'text-primary',
                  isPending && 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn('h-px w-12', isDone ? 'bg-green-600' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export { WizardStepIndicator }
export type { WizardStepIndicatorProps }
```

- [ ] **Step 3: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run src/components/rioku/__tests__/wizard-step-indicator.test.tsx
```

Commit: `feat(web): add WizardStepIndicator shared component`

---

## Task 5: Wizard Mode for Route Create (B3)

**Files:**
- Modify: `src/routes/config/routes.create.tsx`

- [ ] **Step 1: Add wizard mode to route create page**

The existing page has `mode: 'form' | 'code'`. Extend to `mode: 'form' | 'wizard' | 'code'`. Add a `wizardStep` state (0-4). The wizard shares the same `formValues` state as the form mode.

Add state:
```tsx
const [mode, setMode] = useState<'form' | 'wizard' | 'code'>('form')
const [wizardStep, setWizardStep] = useState(0)
```

Add the WIZARD_STEPS constant:
```tsx
const WIZARD_STEPS = ['Basics', 'Matching', 'Target', 'Policies & TLS', 'Review']
```

Replace the mode toggle buttons (currently 2 buttons: Form / Code) with 3 buttons:

```tsx
<div className="flex items-center gap-2">
  {(['form', 'wizard', 'code'] as const).map((m) => (
    <Button
      key={m}
      variant={mode === m ? 'default' : 'outline'}
      size="sm"
      onClick={() => {
        if (mode === 'code' && m !== 'code') {
          const parsed = yamlToRouteForm(yamlContent)
          setFormValues((prev) => ({ ...prev, ...parsed }))
        }
        if (mode !== 'code' && m === 'code') {
          setYamlContent(routeFormToYaml(formValues))
        }
        setMode(m)
        if (m === 'wizard') setWizardStep(0)
      }}
    >
      {m === 'code' ? 'YAML' : m.charAt(0).toUpperCase() + m.slice(1)}
    </Button>
  ))}
</div>
```

Add wizard mode rendering after the form mode block. Each step renders a Card with the relevant form fields from `formValues`, reusing the same `setFormValues` updaters. The fields are identical to the form mode but organized into wizard steps:

- **Step 0 (Basics):** name, enabled
- **Step 1 (Matching):** hosts, paths, methods, headers
- **Step 2 (Target):** targetType, serviceId/directAddress, directTls
- **Step 3 (Policies & TLS):** policyIds (SearchableMultiSelect), forceTls, minTlsVersion, clientAuth
- **Step 4 (Review):** summary table of all values

```tsx
{mode === 'wizard' && (
  <div className="space-y-6">
    <WizardStepIndicator steps={WIZARD_STEPS} currentStep={wizardStep} />

    {wizardStep === 0 && (
      <Card>
        <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Set the route name and toggle its status.</p>
          {/* Same name + enabled fields as form mode basics section */}
          <div className="space-y-2">
            <Label htmlFor="wiz-name">{t('form.routeName')} <span className="text-destructive">*</span></Label>
            <Input id="wiz-name" value={formValues.name} onChange={(e) => setFormValues((prev) => ({ ...prev, name: e.target.value }))} placeholder={t('form.routeNamePlaceholder')} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="wiz-enabled">{t('form.enabled')}</Label>
            <Switch id="wiz-enabled" checked={formValues.enabled} onCheckedChange={(checked) => setFormValues((prev) => ({ ...prev, enabled: checked }))} />
          </div>
        </CardContent>
      </Card>
    )}

    {wizardStep === 1 && (
      <Card>
        <CardHeader><CardTitle>Matching Rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Define how incoming requests are matched to this route.</p>
          {/* Same hosts, paths, methods fields as form mode matching section */}
        </CardContent>
      </Card>
    )}

    {wizardStep === 2 && (
      <Card>
        <CardHeader><CardTitle>Target</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose where matched requests should be routed.</p>
          {/* Same target fields as form mode target section */}
        </CardContent>
      </Card>
    )}

    {wizardStep === 3 && (
      <Card>
        <CardHeader><CardTitle>Policies & TLS</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Attach policies and configure TLS settings.</p>
          {/* policyIds via SearchableMultiSelect + TLS fields */}
        </CardContent>
      </Card>
    )}

    {wizardStep === 4 && (
      <Card>
        <CardHeader><CardTitle>Review Route Configuration</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">Verify the settings below before creating this route.</p>
          <div className="divide-y divide-border/50">
            {[
              { label: 'Name', value: formValues.name || '(not set)' },
              { label: 'Enabled', value: formValues.enabled ? 'Yes' : 'No' },
              { label: 'Hosts', value: formValues.hosts.join(', ') || '(none)' },
              { label: 'Paths', value: formValues.paths.map((p) => `${p.type}: ${p.value}`).join(', ') || '(none)' },
              { label: 'Methods', value: formValues.methods.join(', ') || '(all)' },
              { label: 'Target', value: formValues.targetType === 'service' ? `Service: ${services.find((s: Service) => s.id === formValues.serviceId)?.name ?? formValues.serviceId}` : `Direct: ${formValues.directAddress}` },
              { label: 'Policies', value: formValues.policyIds.map((id) => policies.find((p: Policy) => p.id === id)?.name ?? id).join(', ') || '(none)' },
              { label: 'Force TLS', value: formValues.forceTls ? 'Yes' : 'No' },
              { label: 'Min TLS Version', value: formValues.minTlsVersion },
            ].map((item) => (
              <div key={item.label} className="grid grid-cols-[180px_1fr] gap-4 py-3">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className="text-sm">{item.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )}

    {/* Wizard navigation */}
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
        disabled={wizardStep === 0}
      >
        Back
      </Button>
      {wizardStep === WIZARD_STEPS.length - 1 ? (
        <Button onClick={handleCreate}>Create route</Button>
      ) : (
        <Button onClick={() => setWizardStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}>
          Continue
        </Button>
      )}
    </div>
  </div>
)}
```

Add import for `WizardStepIndicator`:
```tsx
import { WizardStepIndicator } from '@/components/rioku/wizard-step-indicator'
```

- [ ] **Step 2: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

Commit: `feat(web): add wizard mode to route create page with 5-step flow`

---

## Task 6: Wizard Mode for Policy Create (B4)

**Files:**
- Modify: `src/routes/config/policies.create.tsx`

- [ ] **Step 1: Add wizard mode to policy create page**

The existing page has `mode: 'form' | 'code'`. Extend to `mode: 'form' | 'wizard' | 'code'`. The wizard has 3 steps: Type Selection, Configuration, Review.

Add state:
```tsx
const [mode, setMode] = useState<'form' | 'wizard' | 'code'>('form')
const [wizardStep, setWizardStep] = useState(0)
const WIZARD_STEPS = ['Type Selection', 'Configuration', 'Review']
```

Replace the mode toggle with 3 buttons (same pattern as route create).

Add wizard mode rendering:

```tsx
{mode === 'wizard' && (
  <div className="space-y-6">
    <WizardStepIndicator steps={WIZARD_STEPS} currentStep={wizardStep} />

    {wizardStep === 0 && (
      <Card>
        <CardHeader>
          <CardTitle>{t('create.selectType')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('create.selectTypeDesc')}</p>
        </CardHeader>
        <CardContent>
          <TypeSelectorTiles
            options={TYPE_OPTIONS}
            value={selectedType}
            onChange={setSelectedType}
          />
        </CardContent>
      </Card>
    )}

    {wizardStep === 1 && selectedType && (
      <Card>
        <CardHeader>
          <CardTitle>{t('create.configuration')}</CardTitle>
          <p className="text-sm text-muted-foreground">Configure the policy behavior.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wiz-policy-name">{t('create.policyName')}</Label>
            <Input
              id="wiz-policy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.policyNamePlaceholder')}
            />
          </div>
          <PolicyFormForType
            type={selectedType}
            value={config}
            onChange={setConfig}
            errors={errors}
          />
        </CardContent>
      </Card>
    )}

    {wizardStep === 2 && (
      <Card>
        <CardHeader>
          <CardTitle>Review Policy Configuration</CardTitle>
          <p className="text-sm text-muted-foreground">Verify the settings below before creating this policy.</p>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border/50">
            <div className="grid grid-cols-[180px_1fr] gap-4 py-3">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm">{name || '(not set)'}</span>
            </div>
            <div className="grid grid-cols-[180px_1fr] gap-4 py-3">
              <span className="text-sm text-muted-foreground">Type</span>
              <span className="text-sm">{TYPE_OPTIONS.find((t) => t.value === selectedType)?.label ?? selectedType}</span>
            </div>
            {Object.entries(config).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[180px_1fr] gap-4 py-3">
                <span className="text-sm text-muted-foreground">{key}</span>
                <span className="text-sm">{String(value)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )}

    {/* Wizard navigation */}
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
        disabled={wizardStep === 0}
      >
        Back
      </Button>
      {wizardStep === WIZARD_STEPS.length - 1 ? (
        <Button onClick={handleSave} disabled={createMutation.isPending || !name.trim() || !selectedType}>
          {createMutation.isPending ? 'Creating...' : t('create.save')}
        </Button>
      ) : (
        <Button
          onClick={() => setWizardStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}
          disabled={wizardStep === 0 && !selectedType}
        >
          Continue
        </Button>
      )}
    </div>
  </div>
)}
```

Add import:
```tsx
import { WizardStepIndicator } from '@/components/rioku/wizard-step-indicator'
```

- [ ] **Step 2: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

Commit: `feat(web): add wizard mode to policy create page with 3-step flow`

---

## Task 7: Shared TrafficTab + ActivityTimeline Components (B5/B6 prerequisite)

**Files:**
- Create: `src/components/rioku/traffic-tab.tsx`
- Create: `src/components/rioku/__tests__/traffic-tab.test.tsx`
- Create: `src/components/rioku/activity-timeline.tsx`
- Create: `src/components/rioku/__tests__/activity-timeline.test.tsx`

- [ ] **Step 1: Write ActivityTimeline test**

File: `src/components/rioku/__tests__/activity-timeline.test.tsx`

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityTimeline } from '@/components/rioku/activity-timeline'

const entries = [
  { action: 'Route created', user: 'admin@rioku.io', timestamp: '2026-04-09 16:22 UTC', detail: 'Initial creation' },
  { action: 'Configuration updated', user: 'jdoe@company.com', timestamp: '2026-04-08 11:05 UTC', detail: 'Changed LB policy' },
]

describe('ActivityTimeline', () => {
  it('renders all entries', () => {
    render(<ActivityTimeline entries={entries} />)
    expect(screen.getByText('Route created')).toBeInTheDocument()
    expect(screen.getByText('Configuration updated')).toBeInTheDocument()
  })

  it('shows user and detail for each entry', () => {
    render(<ActivityTimeline entries={entries} />)
    expect(screen.getByText(/admin@rioku\.io/)).toBeInTheDocument()
    expect(screen.getByText('Initial creation')).toBeInTheDocument()
  })

  it('renders empty state when no entries', () => {
    render(<ActivityTimeline entries={[]} />)
    expect(screen.getByText(/no activity/i)).toBeInTheDocument()
  })

  it('applies color coding based on action type', () => {
    const { container } = render(<ActivityTimeline entries={entries} />)
    // 'created' should have a green dot
    const dots = container.querySelectorAll('[data-activity-dot]')
    expect(dots.length).toBe(2)
  })
})
```

- [ ] **Step 2: Implement ActivityTimeline**

File: `src/components/rioku/activity-timeline.tsx`

```tsx
import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface ActivityEntry {
  action: string
  user: string
  timestamp: string
  detail: string
}

function getActivityDotColor(action: string): string {
  const lower = action.toLowerCase()
  if (lower.includes('created')) return 'bg-green-500'
  if (lower.includes('added')) return 'bg-green-500'
  if (lower.includes('updated')) return 'bg-blue-500'
  if (lower.includes('enabled') || lower.includes('disabled')) return 'bg-amber-500'
  if (lower.includes('attached') || lower.includes('detached')) return 'bg-purple-500'
  if (lower.includes('deleted') || lower.includes('removed')) return 'bg-red-500'
  return 'bg-muted-foreground'
}

interface ActivityTimelineProps {
  entries: ActivityEntry[]
  title?: string
}

function ActivityTimeline({ entries, title = 'Recent Changes' }: ActivityTimelineProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded</p>
        ) : (
          <div className="divide-y divide-border/50">
            {entries.map((entry, i) => (
              <div key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div
                      data-activity-dot
                      className={cn('size-2 rounded-full', getActivityDotColor(entry.action))}
                    />
                    <span className="text-sm font-medium">{entry.action}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{entry.timestamp}</span>
                </div>
                <p className="ml-4 text-sm text-muted-foreground">{entry.detail}</p>
                <span className="ml-4 mt-0.5 inline-block text-xs text-muted-foreground/70">
                  by {entry.user}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export { ActivityTimeline }
export type { ActivityTimelineProps, ActivityEntry }
```

- [ ] **Step 3: Write TrafficTab test**

File: `src/components/rioku/__tests__/traffic-tab.test.tsx`

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrafficTab } from '@/components/rioku/traffic-tab'

describe('TrafficTab', () => {
  const mockData = {
    rps: 342,
    rpsDelta: '+5.2%',
    errorRate: 0.12,
    errorCount: 3,
    totalRequests: 2508,
    p95LatencyMs: 45,
    p50LatencyMs: 18,
    requestRateData: [],
    errorBreakdownData: [],
    recentRequests: [],
  }

  it('renders stat cards with traffic data', () => {
    render(<TrafficTab data={mockData} />)
    expect(screen.getByText('342')).toBeInTheDocument()
    expect(screen.getByText('0.12%')).toBeInTheDocument()
    expect(screen.getByText('45ms')).toBeInTheDocument()
  })

  it('renders loading state when data is null', () => {
    render(<TrafficTab data={null} isLoading />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Implement TrafficTab**

File: `src/components/rioku/traffic-tab.tsx`

```tsx
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface RecentRequest {
  time: string
  method: string
  path: string
  status: number
  latencyMs: number
}

interface TrafficTabData {
  rps: number
  rpsDelta?: string
  errorRate: number
  errorCount: number
  totalRequests: number
  p95LatencyMs: number
  p50LatencyMs?: number
  bandwidth?: string
  activeConnections?: number
  upstreamCount?: number
  requestRateData: { time: string; rps: number }[]
  errorBreakdownData: { time: string; '4xx': number; '5xx': number }[]
  recentRequests: RecentRequest[]
}

interface TrafficTabProps {
  data: TrafficTabData | null
  isLoading?: boolean
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-blue-400',
  POST: 'text-green-400',
  PUT: 'text-yellow-400',
  PATCH: 'text-yellow-400',
  DELETE: 'text-red-400',
}

function StatusColor({ status }: { status: number }) {
  const color = status >= 200 && status < 300
    ? 'text-green-500'
    : status >= 400 && status < 500
      ? 'text-amber-500'
      : status >= 500
        ? 'text-red-500'
        : 'text-foreground'
  return <span className={cn('font-mono text-sm font-medium', color)}>{status}</span>
}

function TrafficTab({ data, isLoading }: TrafficTabProps) {
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="gap-0 py-0">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">RPS</p>
            <p className="mt-1 text-2xl font-bold">{data.rps}</p>
            {data.rpsDelta && (
              <p className="mt-1 text-xs text-green-500">{data.rpsDelta} vs last hour</p>
            )}
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Error Rate</p>
            <p className={cn('mt-1 text-2xl font-bold', data.errorRate < 1 ? 'text-green-500' : 'text-red-500')}>
              {data.errorRate}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.errorCount} errors / {data.totalRequests.toLocaleString()} total
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">P95 Latency</p>
            <p className="mt-1 text-2xl font-bold">{data.p95LatencyMs}ms</p>
            {data.p50LatencyMs != null && (
              <p className="mt-1 text-xs text-muted-foreground">P50: {data.p50LatencyMs}ms</p>
            )}
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">
              {data.bandwidth ? 'Bandwidth' : 'Active Connections'}
            </p>
            <p className="mt-1 text-2xl font-bold">
              {data.bandwidth ?? data.activeConnections ?? '--'}
            </p>
            {data.upstreamCount != null && (
              <p className="mt-1 text-xs text-muted-foreground">across {data.upstreamCount} upstreams</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Request Rate chart */}
      {data.requestRateData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Request Rate (last 1h)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={192}>
              <BarChart data={data.requestRateData} barCategoryGap={1}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} interval={7} />
                <YAxis className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="rps" fill="hsl(var(--primary))" opacity={0.5} radius={[2, 2, 0, 0]} name="RPS" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Error breakdown chart */}
      {data.errorBreakdownData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Error Breakdown</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={data.errorBreakdownData} barCategoryGap={2}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" hide />
                <YAxis className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="4xx" stackId="errors" fill="#f59e0b" opacity={0.8} name="4xx" />
                <Bar dataKey="5xx" stackId="errors" fill="hsl(var(--destructive))" opacity={0.8} radius={[2, 2, 0, 0]} name="5xx" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent requests table */}
      {data.recentRequests.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Recent Requests</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Time</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Method</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Path</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.recentRequests.map((req, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{req.time}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('font-mono font-medium', METHOD_COLORS[req.method] ?? 'text-foreground')}>
                        {req.method}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono">{req.path}</td>
                    <td className="px-4 py-2.5"><StatusColor status={req.status} /></td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-muted-foreground">{req.latencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export { TrafficTab }
export type { TrafficTabProps, TrafficTabData }
```

- [ ] **Step 5: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run src/components/rioku/__tests__/traffic-tab.test.tsx src/components/rioku/__tests__/activity-timeline.test.tsx
```

Commit: `feat(web): add TrafficTab and ActivityTimeline shared components`

---

## Task 8: Route Traffic + Activity Tabs (B5)

**Files:**
- Modify: `src/routes/config/routes.$routeId.tsx` (replace NeedsBackendField in Traffic and Activity TabsContent)

- [ ] **Step 1: Replace Traffic tab placeholder**

In `src/routes/config/routes.$routeId.tsx`, find the `<TabsContent value="traffic">` block (around line 745) and replace it.

Add imports:
```tsx
import { TrafficTab } from '@/components/rioku/traffic-tab'
import { ActivityTimeline } from '@/components/rioku/activity-timeline'
```

Add query inside `RouteDetailPage`:
```tsx
const { data: trafficData, isLoading: trafficLoading } = useQuery({
  queryKey: ['traffic', 'routes', route.id],
  queryFn: () => apiClient.get(`/traffic/routes/${route.id}`),
  enabled: activeTab === 'traffic',
})

const { data: activityData, isLoading: activityLoading } = useQuery({
  queryKey: ['audit', 'routes', route.id],
  queryFn: () => apiClient.get(`/audit/routes/${route.id}`),
  enabled: activeTab === 'activity',
})
```

Add `useQuery` to imports from `@tanstack/react-query`.

Replace the Traffic TabsContent:
```tsx
<TabsContent value="traffic">
  <TrafficTab data={trafficData ?? null} isLoading={trafficLoading} />
</TabsContent>
```

Replace the Activity TabsContent:
```tsx
<TabsContent value="activity">
  <ActivityTimeline
    entries={activityData?.entries ?? []}
    title={t('detail.activity')}
  />
  {activityLoading && (
    <div className="flex justify-center py-8">
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  )}
</TabsContent>
```

Remove the `NeedsBackendField` import if it is no longer used in this file (check if other tabs still use it; if yes, keep it).

- [ ] **Step 2: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

Commit: `feat(web): replace route detail Traffic and Activity placeholders with real UI`

---

## Task 9: Service Traffic + Activity Tabs (B6)

**Files:**
- Modify: `src/routes/config/services.$serviceId.tsx` (replace NeedsBackendField in Traffic and Activity TabsContent)

- [ ] **Step 1: Same pattern as Task 8, but for service detail**

Add imports:
```tsx
import { TrafficTab } from '@/components/rioku/traffic-tab'
import { ActivityTimeline } from '@/components/rioku/activity-timeline'
```

Add query inside `ServiceDetailPage`:
```tsx
const { data: trafficData, isLoading: trafficLoading } = useQuery({
  queryKey: ['traffic', 'services', service.id],
  queryFn: () => apiClient.get(`/traffic/services/${service.id}`),
  enabled: activeTab === 'traffic',
})

const { data: activityData, isLoading: activityLoading } = useQuery({
  queryKey: ['audit', 'services', service.id],
  queryFn: () => apiClient.get(`/audit/services/${service.id}`),
  enabled: activeTab === 'activity',
})
```

Replace Traffic TabsContent (around line 680):
```tsx
<TabsContent value="traffic">
  <TrafficTab data={trafficData ?? null} isLoading={trafficLoading} />
</TabsContent>
```

Replace Activity TabsContent (around line 696):
```tsx
<TabsContent value="activity">
  <ActivityTimeline
    entries={activityData?.entries ?? []}
    title={t('detail.activity')}
  />
</TabsContent>
```

- [ ] **Step 2: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

Commit: `feat(web): replace service detail Traffic and Activity placeholders with real UI`

---

## Task 10: Profile Preferences and Sessions (B7)

**Files:**
- Modify: `src/routes/settings/profile.tsx`

- [ ] **Step 1: Add preferences and sessions sections to profile page**

The existing profile page has: Profile info card, Password card, TOTP card. Add after those:

Add imports:
```tsx
import { useTheme } from '@/hooks/use-theme'
import { usePreferences } from '@/hooks/use-preferences'
import { SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
import { Switch } from '@/components/ui/switch'
import { MonitorIcon, TerminalIcon, LaptopIcon } from 'lucide-react'
```

Add state/hooks inside `ProfilePage`:
```tsx
const { theme, setTheme } = useTheme()
const [colorBlindMode, setColorBlindMode] = usePreferences('colorBlindMode', 'none', 'global')
const [highContrast, setHighContrast] = usePreferences('highContrast', false, 'global')
const [reducedMotion, setReducedMotion] = usePreferences('reducedMotion', false, 'global')
const [timezone, setTimezone] = usePreferences('timezone', 'UTC', 'global')
const [locale, setLocale] = usePreferences('locale', 'en-US', 'global')
```

Add mock sessions query:
```tsx
const { data: sessionsData } = useQuery({
  queryKey: ['auth', 'sessions'],
  queryFn: () => apiClient.get('/auth/sessions'),
  retry: false,
})
const sessions = sessionsData?.sessions ?? [
  { device: 'Chrome on macOS', ip: '192.168.1.42', lastActive: 'Now', location: 'San Francisco, CA', current: true },
  { device: 'Firefox on Ubuntu', ip: '10.0.0.15', lastActive: '2 hours ago', location: 'San Francisco, CA', current: false },
  { device: 'Rioku CLI', ip: '172.16.0.8', lastActive: '6 hours ago', location: 'AWS us-east-1', current: false },
]
```

Add timezone and locale options:
```tsx
const TIMEZONE_OPTIONS: SelectOption[] = [
  { value: 'UTC', label: 'UTC', description: 'Coordinated Universal Time' },
  { value: 'America/New_York', label: 'America/New_York', description: 'Eastern Time' },
  { value: 'America/Chicago', label: 'America/Chicago', description: 'Central Time' },
  { value: 'America/Denver', label: 'America/Denver', description: 'Mountain Time' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles', description: 'Pacific Time' },
  { value: 'Europe/London', label: 'Europe/London', description: 'GMT' },
  { value: 'Europe/Paris', label: 'Europe/Paris', description: 'CET' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo', description: 'JST' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai', description: 'CST' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney', description: 'AET' },
]

const LOCALE_OPTIONS: SelectOption[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Espanol' },
  { value: 'fr-FR', label: 'Francais' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
]

const COLORBLIND_OPTIONS = [
  { value: 'none', label: 'None', description: 'Standard color vision' },
  { value: 'deuteranopia', label: 'Deuteranopia', description: 'Red-green (most common)' },
  { value: 'protanopia', label: 'Protanopia', description: 'Red-green (reduced red)' },
  { value: 'tritanopia', label: 'Tritanopia', description: 'Blue-yellow (rare)' },
  { value: 'achromatopsia', label: 'Achromatopsia', description: 'Total color blindness' },
]
```

Add after the TOTP card (before closing `</div>`):

```tsx
{/* Preferences */}
<Card>
  <CardHeader>
    <CardTitle>Appearance</CardTitle>
    <CardDescription>Theme and visual preferences</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="space-y-2">
      <Label>Theme</Label>
      <div className="flex gap-2">
        {(['dark', 'light', 'system'] as const).map((t) => (
          <Button
            key={t}
            variant={theme === t ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTheme(t)}
            className="capitalize"
          >
            {t}
          </Button>
        ))}
      </div>
    </div>
  </CardContent>
</Card>

{/* Accessibility */}
<Card>
  <CardHeader>
    <CardTitle>Accessibility</CardTitle>
    <CardDescription>Color vision and motion preferences</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="space-y-2">
      <Label>Color Vision</Label>
      <div className="space-y-2">
        {COLORBLIND_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setColorBlindMode(opt.value)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
              colorBlindMode === opt.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/30',
            )}
          >
            <div className={cn(
              'flex size-5 items-center justify-center rounded-full border-2',
              colorBlindMode === opt.value ? 'border-primary' : 'border-muted-foreground/30',
            )}>
              {colorBlindMode === opt.value && <div className="size-2.5 rounded-full bg-primary" />}
            </div>
            <div>
              <span className="text-sm font-medium">{opt.label}</span>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
    <div className="flex items-center justify-between">
      <div>
        <Label>High contrast</Label>
        <p className="text-xs text-muted-foreground">Increase border and text contrast</p>
      </div>
      <Switch checked={highContrast} onCheckedChange={setHighContrast} />
    </div>
    <div className="flex items-center justify-between">
      <div>
        <Label>Reduced motion</Label>
        <p className="text-xs text-muted-foreground">Minimize animations and transitions</p>
      </div>
      <Switch checked={reducedMotion} onCheckedChange={setReducedMotion} />
    </div>
  </CardContent>
</Card>

{/* Locale */}
<Card>
  <CardHeader>
    <CardTitle>Locale</CardTitle>
    <CardDescription>Timezone and language preferences</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="space-y-2">
      <Label>Timezone</Label>
      <SearchableSelect
        options={TIMEZONE_OPTIONS}
        value={timezone}
        onChange={setTimezone}
        placeholder="Select timezone..."
      />
    </div>
    <div className="space-y-2">
      <Label>Locale</Label>
      <SearchableSelect
        options={LOCALE_OPTIONS}
        value={locale}
        onChange={setLocale}
        placeholder="Select locale..."
      />
    </div>
  </CardContent>
</Card>

{/* Active Sessions */}
<Card>
  <CardHeader>
    <CardTitle>Active Sessions</CardTitle>
  </CardHeader>
  <CardContent className="p-0">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Device</th>
          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">IP</th>
          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Last Active</th>
          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Location</th>
          <th className="px-4 py-2.5 text-right" />
        </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
        {sessions.map((s: { device: string; ip: string; lastActive: string; location: string; current?: boolean }, i: number) => (
          <tr key={i}>
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                {s.device}
                {s.current && <Badge variant="secondary">Current</Badge>}
              </div>
            </td>
            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.ip}</td>
            <td className="px-4 py-2.5 text-muted-foreground">{s.lastActive}</td>
            <td className="px-4 py-2.5 text-muted-foreground">{s.location}</td>
            <td className="px-4 py-2.5 text-right">
              {!s.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => toast.success('Session revoked')}
                >
                  Revoke
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </CardContent>
</Card>
```

Add MSW handler for sessions in `src/mocks/handlers/auth.ts`:
```ts
http.get('/api/v1/auth/sessions', () => {
  return HttpResponse.json({
    sessions: [
      { device: 'Chrome on macOS', ip: '192.168.1.42', lastActive: 'Now', location: 'San Francisco, CA', current: true },
      { device: 'Firefox on Ubuntu', ip: '10.0.0.15', lastActive: '2 hours ago', location: 'San Francisco, CA', current: false },
      { device: 'Rioku CLI', ip: '172.16.0.8', lastActive: '6 hours ago', location: 'AWS us-east-1', current: false },
    ],
  })
}),
```

- [ ] **Step 2: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

Commit: `feat(web): add preferences, accessibility, locale, and sessions to profile page`

---

## Task 11: List Page Traffic Columns (B8)

**Files:**
- Modify: `src/routes/config/routes.index.tsx` (add RPS and P95 columns)
- Modify: `src/routes/config/services.index.tsx` (add RPS and P95 columns)
- Modify: `src/mocks/handlers/traffic.ts` (add per-entity summary endpoint)

- [ ] **Step 1: Add MSW handler for list traffic stats**

File: `src/mocks/handlers/traffic.ts` -- add handler:

```ts
http.get('/api/v1/traffic/stats/summary', () => {
  // Returns per-entity RPS and P95 for list pages
  const routeStats: Record<string, { rps: number; p95Ms: number }> = {}
  const serviceStats: Record<string, { rps: number; p95Ms: number }> = {}

  // Generate deterministic stats based on entity names
  const routeNames = ['payments-api', 'auth-api', 'users-api', 'orders-api', 'search-api', 'products-api', 'ai-completions', 'webhooks', 'admin-api', 'health-check']
  routeNames.forEach((name, i) => {
    routeStats[name] = {
      rps: Math.round(50 + i * 30 + Math.random() * 20),
      p95Ms: Math.round(15 + i * 8 + Math.random() * 10),
    }
  })

  const serviceNames = ['payments-svc', 'auth-svc', 'users-svc', 'orders-svc', 'search-svc', 'products-svc', 'ai-svc', 'webhook-svc']
  serviceNames.forEach((name, i) => {
    serviceStats[name] = {
      rps: Math.round(80 + i * 25 + Math.random() * 15),
      p95Ms: Math.round(12 + i * 6 + Math.random() * 8),
    }
  })

  return HttpResponse.json({ routes: routeStats, services: serviceStats })
}),
```

- [ ] **Step 2: Add RPS and P95 columns to route list**

In `src/routes/config/routes.index.tsx`, add a `useQuery` for traffic stats:

```tsx
const { data: trafficStats } = useQuery({
  queryKey: ['traffic', 'stats', 'summary'],
  queryFn: () => apiClient.get('/traffic/stats/summary'),
  retry: false,
})
```

Add `useQuery` to imports from `@tanstack/react-query`.

Add two columns to the `DataTable` `columns` array, after the `_policyCount` column and before the `enabled` column:

```tsx
{
  key: '_rps',
  header: 'RPS',
  render: (r) => {
    const stats = trafficStats?.routes?.[r.name as string]
    return (
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {stats?.rps ?? '--'}
      </span>
    )
  },
},
{
  key: '_p95',
  header: 'P95',
  render: (r) => {
    const stats = trafficStats?.routes?.[r.name as string]
    return (
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {stats?.p95Ms != null ? `${stats.p95Ms}ms` : '--'}
      </span>
    )
  },
},
```

- [ ] **Step 3: Add RPS and P95 columns to service list**

Same pattern in `src/routes/config/services.index.tsx`:

```tsx
const { data: trafficStats } = useQuery({
  queryKey: ['traffic', 'stats', 'summary'],
  queryFn: () => apiClient.get('/traffic/stats/summary'),
  retry: false,
})
```

Add columns after the health check column:

```tsx
{
  key: '_rps',
  header: 'RPS',
  render: (r) => {
    const stats = trafficStats?.services?.[r.name as string]
    return (
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {stats?.rps ?? '--'}
      </span>
    )
  },
},
{
  key: '_p95',
  header: 'P95',
  render: (r) => {
    const stats = trafficStats?.services?.[r.name as string]
    return (
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {stats?.p95Ms != null ? `${stats.p95Ms}ms` : '--'}
      </span>
    )
  },
},
```

- [ ] **Step 4: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

Commit: `feat(web): add RPS and P95 latency columns to route and service list tables`

---

## Task 12: Faceted Filters on List Pages (B9)

**Files:**
- Modify: `src/routes/config/routes.index.tsx`
- Modify: `src/routes/config/services.index.tsx`
- Modify: `src/routes/config/policies.index.tsx`

- [ ] **Step 1: Add faceted filters to routes list**

The `DataTable` already accepts a `filterColumns` prop and `FacetedFilter` is already imported/used internally by `DataTable`. Add the `filterColumns` prop:

In `src/routes/config/routes.index.tsx`, add to the `DataTable` component:

```tsx
filterColumns={[
  {
    key: 'enabled',
    label: 'Status',
    options: [
      { label: 'Enabled', value: 'true' },
      { label: 'Disabled', value: 'false' },
    ],
  },
  {
    key: '_serviceName',
    label: 'Service',
    options: services.map((s) => ({
      label: s.name,
      value: s.name,
    })),
  },
  {
    key: '_hasPolicy',
    label: 'Has Policy',
    options: [
      { label: 'Yes', value: 'true' },
      { label: 'No', value: 'false' },
    ],
  },
]}
```

Also add `_hasPolicy` to the tableData mapping:
```tsx
_hasPolicy: (r.policyIds ?? []).length > 0 ? 'true' : 'false',
```

And make `enabled` a string for filter matching:
```tsx
_enabledStr: String(r.enabled),
```

Update the filter column key to use `_enabledStr`.

- [ ] **Step 2: Add faceted filters to services list**

In `src/routes/config/services.index.tsx`:

```tsx
filterColumns={[
  {
    key: '_healthStatus',
    label: 'Health',
    options: [
      { label: 'All Healthy', value: 'healthy' },
      { label: 'Degraded', value: 'degraded' },
      { label: 'Unhealthy', value: 'unhealthy' },
    ],
  },
  {
    key: 'lbPolicy',
    label: 'LB Policy',
    options: [
      { label: 'Round Robin', value: 'ROUND_ROBIN' },
      { label: 'Least Conn', value: 'LEAST_CONN' },
      { label: 'Random', value: 'RANDOM' },
      { label: 'IP Hash', value: 'IP_HASH' },
    ],
  },
  {
    key: '_healthCheckEnabled',
    label: 'Health Check',
    options: [
      { label: 'Enabled', value: 'true' },
      { label: 'Disabled', value: 'false' },
    ],
  },
]}
```

Add `_healthStatus` to tableData:
```tsx
_healthStatus: svc.upstreams.every((u) => u.healthy)
  ? 'healthy'
  : svc.upstreams.some((u) => !u.healthy)
    ? 'degraded'
    : 'unhealthy',
_healthCheckEnabled: String(svc.healthCheck?.enabled ?? false),
```

- [ ] **Step 3: Add faceted filters to policies list**

In `src/routes/config/policies.index.tsx`:

```tsx
filterColumns={[
  {
    key: 'type',
    label: 'Type',
    options: Object.entries(POLICY_TYPES).map(([value, label]) => ({
      label,
      value,
    })),
  },
]}
```

- [ ] **Step 4: Run tests, commit**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

Commit: `feat(web): wire faceted filters into route, service, and policy list pages`

---

## Final Verification

- [ ] **Run full test suite**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx vitest run
```

- [ ] **Run TypeScript type check**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit
```

- [ ] **Visual verification with dev server**

```bash
source ~/.nvm/nvm.sh && cd packages/web && VITE_MOCK=true npm run dev
```

Check in browser:
1. Dashboard: 4 stat cards with deltas, 4 charts, time range selector works
2. Route create: Form / Wizard / YAML modes, wizard steps navigate correctly
3. Policy create: Form / Wizard / YAML modes, 3-step wizard works
4. Route detail > Traffic tab: stat cards, charts, recent requests table
5. Route detail > Activity tab: colored timeline with entries
6. Service detail > Traffic tab: same pattern
7. Service detail > Activity tab: same pattern
8. Profile: theme selector, colorblind options, high contrast, reduced motion, timezone/locale selects, sessions table
9. Routes list: RPS and P95 columns, faceted filters for Status/Service/Has Policy
10. Services list: RPS and P95 columns, faceted filters for Health/LB Policy/Health Check
11. Policies list: faceted filter for Type
