# Admin Panel Phase 5: Traffic, Observability & Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete the Traffic, Observability & Infrastructure pages of the admin panel overhaul. This includes the live traffic trace detail slide-out, analytics chart completion, AI workloads page, audit log enhancements, cluster page improvements, a new certificates page, plugin page redesign, and a feature flags system.

**Architecture:** All work builds on the existing `packages/web/` React SPA. Traffic pages use SSE via `useEventSubscription` from `use-events.ts` with exponential backoff reconnection. Charts use Recharts (already installed). New pages follow the existing TanStack Router file-based routing pattern. Feature flags are compile-time constants that tree-shake in production. Backend dependencies are called out per-task; most tasks are frontend-only.

**Tech Stack:** React 19, TanStack Router, TanStack Query, Recharts, react-i18next, Vitest + happy-dom, TypeScript 6+

**Spec:** `docs/superpowers/specs/2026-04-10-admin-panel-overhaul-v2.md` (Sections 13, 14, 22)

**Depends on:** Phases 1-2 (layout shell, component library, detail page patterns, chart infrastructure)

---

## Backend Dependency Summary

| Task | Frontend Only | Needs Backend |
|------|:---:|:---:|
| 1. Live traffic trace detail | Mostly | Trace detail fields (policies, identity, AI, OTEL) require enriched TrafficService responses |
| 2. Analytics dashboard completion | Yes | -- |
| 3. AI workloads page | Mostly | Agent session detail requires ListSessions RPC |
| 4. Audit log enhancements | Yes | -- |
| 5. Cluster page enhancements | Partially | Node metrics, cert status, sync events, remove node require Cluster API |
| 6. Certificates page | No | Certificate list/detail/renew/revoke endpoints not implemented |
| 7. Plugins page redesign | Partially | Plugin admin page registration requires plugin manifest system |
| 8. Feature flags system | Yes | -- |

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `packages/web/src/components/rioku/trace-detail-panel.tsx` | Trace detail slide-out panel with collapsible sections |
| `packages/web/src/components/rioku/__tests__/trace-detail-panel.test.tsx` | Tests for trace detail panel |
| `packages/web/src/components/rioku/chart-tooltip.tsx` | Shared custom tooltip with colored dots |
| `packages/web/src/components/rioku/__tests__/chart-tooltip.test.tsx` | Tests for chart tooltip |
| `packages/web/src/components/rioku/timezone-caption.tsx` | UTC timezone caption below charts |
| `packages/web/src/components/rioku/__tests__/timezone-caption.test.tsx` | Tests for timezone caption |
| `packages/web/src/components/rioku/coming-soon.tsx` | Placeholder for feature-flagged pages |
| `packages/web/src/components/rioku/__tests__/coming-soon.test.tsx` | Tests for ComingSoon component |
| `packages/web/src/routes/certificates.tsx` | Certificates page |
| `packages/web/src/routes/plugins/$pluginId.tsx` | Plugin detail page |
| `packages/web/src/lib/feature-flags.ts` | Compile-time feature flag constants |
| `packages/web/src/lib/__tests__/feature-flags.test.ts` | Tests for feature flags |
| `packages/web/src/lib/export-utils.ts` | CSV/JSON export utilities |
| `packages/web/src/lib/__tests__/export-utils.test.ts` | Tests for export utilities |

### Modified Files

| File | Changes |
|------|---------|
| `packages/web/src/routes/traffic/live.tsx` | Replace basic sheet with TraceDetailPanel, add enriched trace sections |
| `packages/web/src/routes/traffic/analytics.tsx` | Add error rate stacked bar, top routes bar, status code donut, per-route drilldown, chart improvements |
| `packages/web/src/routes/traffic/ai.tsx` | Add stacked area (input/output tokens), cost area chart, agent sessions table, session click-through |
| `packages/web/src/routes/audit.tsx` | Add date range picker, expanded detail with before/after values, CSV/JSON export refactor |
| `packages/web/src/routes/cluster.tsx` | Add expandable node detail (metrics, cert status, sync), remove node action, refresh button |
| `packages/web/src/routes/plugins.tsx` | Convert to card grid with "Configure" button, navigate to plugin detail |
| `packages/web/src/lib/api.ts` | Add TraceDetail, CertificateInfo, NodeDetail, AgentSession, PluginDetail types |
| `packages/web/src/hooks/use-events.ts` | Add jitter to exponential backoff |

---

## Task 1: Live Traffic Trace Detail Slide-Out Panel

**Files:**
- Create: `packages/web/src/components/rioku/trace-detail-panel.tsx`
- Create: `packages/web/src/components/rioku/__tests__/trace-detail-panel.test.tsx`
- Modify: `packages/web/src/routes/traffic/live.tsx`
- Modify: `packages/web/src/lib/api.ts`

**Classification:** `FRONTEND ONLY` for panel rendering. `NEEDS BACKEND` for enriched trace fields (policies, identity, AI, OTEL).

The trace detail panel is a right-side slide-out (Sheet) -- the one place where slide-out is correct per the spec, because you want to keep the live traffic stream visible while inspecting a trace. It has 7 collapsible sections.

- [ ] **Step 1: Add TraceDetail type to api.ts**

Add the enriched trace detail type to `packages/web/src/lib/api.ts`:

```typescript
// --- Trace detail types (enriched from TrafficService) ---

export interface PolicyDecision {
  policyId: string
  policyName: string
  policyType: string
  result: 'pass' | 'fail' | 'skip'
  detail?: string
  rateLimitRemaining?: number
}

export interface TraceIdentity {
  actorType: 'api_key' | 'agent' | 'user' | 'anonymous'
  actorId?: string
  sessionId?: string
  apiKeyPrefix?: string
}

export interface TraceAIFields {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  estimatedCostUsd: number
  finishReason: string
  toolCalls?: string[]
}

export interface TraceOTel {
  traceId: string
  spanId: string
  externalViewerUrl?: string
}

export interface TraceDetail {
  id: string
  timestamp: string
  // REQUEST
  method: string
  path: string
  host: string
  requestHeaders: Record<string, string>
  queryParams: Record<string, string>
  // RESPONSE
  status: number
  responseHeaders: Record<string, string>
  responseSize: number
  // TIMING
  totalDurationMs: number
  upstreamDurationMs: number
  overheadMs: number
  // ROUTING
  routeId: string
  routeName: string
  serviceId: string
  serviceName: string
  upstream: string
  // POLICIES
  policies: PolicyDecision[]
  // IDENTITY
  identity: TraceIdentity | null
  // AI
  ai: TraceAIFields | null
  // OTEL
  otel: TraceOTel | null
}
```

- [ ] **Step 2: Write tests for TraceDetailPanel**

Create `packages/web/src/components/rioku/__tests__/trace-detail-panel.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TraceDetailPanel } from '../trace-detail-panel'
import type { TraceDetail } from '@/lib/api'

const baseTrace: TraceDetail = {
  id: 'trace-001',
  timestamp: '2026-04-10T12:00:00Z',
  method: 'POST',
  path: '/api/v1/users',
  host: 'api.example.com',
  requestHeaders: { 'Content-Type': 'application/json', Authorization: 'Bearer xxx' },
  queryParams: { page: '1' },
  status: 201,
  responseHeaders: { 'Content-Type': 'application/json' },
  responseSize: 1024,
  totalDurationMs: 45,
  upstreamDurationMs: 38,
  overheadMs: 7,
  routeId: 'route-abc',
  routeName: 'users-api',
  serviceId: 'svc-xyz',
  serviceName: 'users-service',
  upstream: '10.0.0.5:8080',
  policies: [
    { policyId: 'pol-1', policyName: 'rate-limit', policyType: 'rate_limit', result: 'pass', rateLimitRemaining: 98 },
    { policyId: 'pol-2', policyName: 'jwt-auth', policyType: 'auth_jwt', result: 'pass' },
  ],
  identity: { actorType: 'api_key', actorId: 'key-001', apiKeyPrefix: 'rku_abc' },
  ai: null,
  otel: { traceId: 'abc123def456', spanId: 'span-001', externalViewerUrl: 'https://jaeger.example.com/trace/abc123def456' },
}

describe('TraceDetailPanel', () => {
  it('renders all section headers', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    expect(screen.getByText('Request')).toBeInTheDocument()
    expect(screen.getByText('Response')).toBeInTheDocument()
    expect(screen.getByText('Routing')).toBeInTheDocument()
    expect(screen.getByText('Policies')).toBeInTheDocument()
    expect(screen.getByText('Identity')).toBeInTheDocument()
    expect(screen.getByText('OTEL')).toBeInTheDocument()
  })

  it('displays method and path in the header description', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    expect(screen.getByText('POST /api/v1/users')).toBeInTheDocument()
  })

  it('shows status code with color-coded badge', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    expect(screen.getByText('201')).toBeInTheDocument()
  })

  it('displays timing breakdown', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    expect(screen.getByText('45ms')).toBeInTheDocument()
    expect(screen.getByText('38ms')).toBeInTheDocument()
    expect(screen.getByText('7ms')).toBeInTheDocument()
  })

  it('shows policy decisions with pass/fail badges', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    expect(screen.getByText('rate-limit')).toBeInTheDocument()
    expect(screen.getByText('jwt-auth')).toBeInTheDocument()
    expect(screen.getAllByText('pass')).toHaveLength(2)
  })

  it('shows identity section when identity is present', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    expect(screen.getByText('api_key')).toBeInTheDocument()
    expect(screen.getByText('rku_abc')).toBeInTheDocument()
  })

  it('hides AI section when ai is null', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    expect(screen.queryByText('AI')).not.toBeInTheDocument()
  })

  it('shows AI section when ai fields are present', () => {
    const traceWithAI: TraceDetail = {
      ...baseTrace,
      ai: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        inputTokens: 500,
        outputTokens: 200,
        cacheTokens: 100,
        estimatedCostUsd: 0.015,
        finishReason: 'end_turn',
        toolCalls: ['get_weather', 'search_docs'],
      },
    }
    render(<TraceDetailPanel trace={traceWithAI} open onOpenChange={vi.fn()} />)

    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-6')).toBeInTheDocument()
    expect(screen.getByText('$0.02')).toBeInTheDocument()
  })

  it('renders OTEL trace ID as link when externalViewerUrl is present', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    const link = screen.getByRole('link', { name: /abc123def456/i })
    expect(link).toHaveAttribute('href', 'https://jaeger.example.com/trace/abc123def456')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders request headers in code block', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    expect(screen.getByText(/Content-Type/)).toBeInTheDocument()
    expect(screen.getByText(/application\/json/)).toBeInTheDocument()
  })

  it('calls onOpenChange(false) when dismissed', async () => {
    const onOpenChange = vi.fn()
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={onOpenChange} />)

    // The Sheet component handles dismissal via onOpenChange
    // We verify the prop is correctly wired
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('renders nothing when trace is null', () => {
    const { container } = render(
      <TraceDetailPanel trace={null} open={false} onOpenChange={vi.fn()} />,
    )

    // Sheet should be closed, no trace content rendered
    expect(container.querySelector('[data-testid="trace-detail"]')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/components/rioku/__tests__/trace-detail-panel.test.tsx`
Expected: Import error (TraceDetailPanel does not exist yet).

- [ ] **Step 4: Implement TraceDetailPanel component**

Create `packages/web/src/components/rioku/trace-detail-panel.tsx`:

```typescript
import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/rioku/code-block'
import type { TraceDetail } from '@/lib/api'

interface TraceDetailPanelProps {
  trace: TraceDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function statusColorClass(status: number): string {
  if (status < 300) return 'bg-green-500/10 text-green-700 dark:text-green-400'
  if (status < 400) return 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
  if (status < 500) return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
  return 'bg-red-500/10 text-red-700 dark:text-red-400'
}

function policyResultColor(result: string): string {
  if (result === 'pass') return 'bg-green-500/10 text-green-700 dark:text-green-400 border-transparent'
  if (result === 'fail') return 'bg-red-500/10 text-red-700 dark:text-red-400 border-transparent'
  return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-transparent'
}

interface CollapsibleSectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function CollapsibleSection({ title, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50"
        onClick={() => setOpen((o) => !o)}
      >
        {title}
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
      {open && <div className="space-y-2 px-4 pb-3">{children}</div>}
    </div>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  )
}

function TraceDetailPanel({ trace, open, onOpenChange }: TraceDetailPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        {trace && (
          <>
            <SheetHeader className="px-4 pt-4 pb-2 border-b">
              <SheetTitle>Trace Detail</SheetTitle>
              <SheetDescription>
                {trace.method} {trace.path}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-80px)]" data-testid="trace-detail">
              {/* REQUEST */}
              <CollapsibleSection title="Request">
                <KV label="Method">
                  <span className="font-mono font-semibold">{trace.method}</span>
                </KV>
                <KV label="Path">
                  <span className="font-mono text-xs">{trace.path}</span>
                </KV>
                <KV label="Host">
                  <span className="font-mono text-xs">{trace.host}</span>
                </KV>
                {Object.keys(trace.queryParams).length > 0 && (
                  <div className="mt-1">
                    <span className="text-xs font-medium text-muted-foreground">Query params</span>
                    <CodeBlock value={trace.queryParams} maxHeight="120px" />
                  </div>
                )}
                {Object.keys(trace.requestHeaders).length > 0 && (
                  <div className="mt-1">
                    <span className="text-xs font-medium text-muted-foreground">Headers</span>
                    <CodeBlock value={trace.requestHeaders} maxHeight="200px" />
                  </div>
                )}
              </CollapsibleSection>

              {/* RESPONSE */}
              <CollapsibleSection title="Response">
                <KV label="Status">
                  <Badge variant="outline" className={cn('border-transparent', statusColorClass(trace.status))}>
                    {trace.status}
                  </Badge>
                </KV>
                <KV label="Size">
                  <span className="font-mono">{trace.responseSize.toLocaleString()} B</span>
                </KV>
                <KV label="Total">
                  <span className="font-mono">{trace.totalDurationMs}ms</span>
                </KV>
                <KV label="Upstream">
                  <span className="font-mono">{trace.upstreamDurationMs}ms</span>
                </KV>
                <KV label="Overhead">
                  <span className="font-mono">{trace.overheadMs}ms</span>
                </KV>
                {Object.keys(trace.responseHeaders).length > 0 && (
                  <div className="mt-1">
                    <span className="text-xs font-medium text-muted-foreground">Headers</span>
                    <CodeBlock value={trace.responseHeaders} maxHeight="200px" />
                  </div>
                )}
              </CollapsibleSection>

              {/* ROUTING */}
              <CollapsibleSection title="Routing">
                <KV label="Route">
                  <span className="font-mono text-xs">{trace.routeName} ({trace.routeId})</span>
                </KV>
                <KV label="Service">
                  <span className="font-mono text-xs">{trace.serviceName} ({trace.serviceId})</span>
                </KV>
                <KV label="Upstream">
                  <span className="font-mono text-xs">{trace.upstream}</span>
                </KV>
              </CollapsibleSection>

              {/* POLICIES */}
              <CollapsibleSection title="Policies">
                {trace.policies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No policies evaluated</p>
                ) : (
                  <div className="space-y-2">
                    {trace.policies.map((p) => (
                      <div key={p.policyId} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{p.policyName}</span>
                          <Badge variant="secondary" className="text-[10px]">{p.policyType}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={policyResultColor(p.result)}>
                            {p.result}
                          </Badge>
                          {p.rateLimitRemaining != null && (
                            <span className="text-xs text-muted-foreground">
                              {p.rateLimitRemaining} remaining
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>

              {/* IDENTITY */}
              {trace.identity && (
                <CollapsibleSection title="Identity">
                  <KV label="Actor type">
                    <Badge variant="secondary">{trace.identity.actorType}</Badge>
                  </KV>
                  {trace.identity.actorId && (
                    <KV label="Actor ID">
                      <span className="font-mono text-xs">{trace.identity.actorId}</span>
                    </KV>
                  )}
                  {trace.identity.apiKeyPrefix && (
                    <KV label="Key prefix">
                      <span className="font-mono text-xs">{trace.identity.apiKeyPrefix}</span>
                    </KV>
                  )}
                  {trace.identity.sessionId && (
                    <KV label="Session ID">
                      <span className="font-mono text-xs">{trace.identity.sessionId}</span>
                    </KV>
                  )}
                </CollapsibleSection>
              )}

              {/* AI */}
              {trace.ai && (
                <CollapsibleSection title="AI">
                  <KV label="Provider">
                    <span>{trace.ai.provider}</span>
                  </KV>
                  <KV label="Model">
                    <span className="font-mono text-xs">{trace.ai.model}</span>
                  </KV>
                  <KV label="Input tokens">
                    <span className="font-mono">{trace.ai.inputTokens.toLocaleString()}</span>
                  </KV>
                  <KV label="Output tokens">
                    <span className="font-mono">{trace.ai.outputTokens.toLocaleString()}</span>
                  </KV>
                  <KV label="Cache tokens">
                    <span className="font-mono">{trace.ai.cacheTokens.toLocaleString()}</span>
                  </KV>
                  <KV label="Est. cost">
                    <span className="font-mono">${trace.ai.estimatedCostUsd.toFixed(2)}</span>
                  </KV>
                  <KV label="Finish reason">
                    <Badge variant="secondary">{trace.ai.finishReason}</Badge>
                  </KV>
                  {trace.ai.toolCalls && trace.ai.toolCalls.length > 0 && (
                    <KV label="Tool calls">
                      <div className="flex flex-wrap gap-1">
                        {trace.ai.toolCalls.map((tc) => (
                          <Badge key={tc} variant="outline" className="text-[10px]">{tc}</Badge>
                        ))}
                      </div>
                    </KV>
                  )}
                </CollapsibleSection>
              )}

              {/* OTEL */}
              {trace.otel && (
                <CollapsibleSection title="OTEL">
                  <KV label="Trace ID">
                    {trace.otel.externalViewerUrl ? (
                      <a
                        href={trace.otel.externalViewerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                      >
                        {trace.otel.traceId}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="font-mono text-xs">{trace.otel.traceId}</span>
                    )}
                  </KV>
                  <KV label="Span ID">
                    <span className="font-mono text-xs">{trace.otel.spanId}</span>
                  </KV>
                </CollapsibleSection>
              )}
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export { TraceDetailPanel }
export type { TraceDetailPanelProps }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/components/rioku/__tests__/trace-detail-panel.test.tsx`
Expected: All PASS.

- [ ] **Step 6: Update live traffic page to use TraceDetailPanel**

Modify `packages/web/src/routes/traffic/live.tsx`:

Replace the `RequestEvent` interface with an enriched version and swap the basic `Sheet` for `TraceDetailPanel`:

1. Update the `RequestEvent` interface to extend with optional enriched fields:

Replace:
```typescript
interface RequestEvent {
  id: string
  timestamp: string
  method: string
  path: string
  status: number
  latency_ms: number
  upstream: string
  route_id: string
  headers?: Record<string, string>
}
```

With:
```typescript
interface RequestEvent {
  id: string
  timestamp: string
  method: string
  path: string
  status: number
  latency_ms: number
  upstream: string
  route_id: string
  route_name?: string
  service_id?: string
  service_name?: string
  headers?: Record<string, string>
  response_headers?: Record<string, string>
  query_params?: Record<string, string>
  host?: string
  response_size?: number
  upstream_duration_ms?: number
  policies?: Array<{
    policy_id: string
    policy_name: string
    policy_type: string
    result: 'pass' | 'fail' | 'skip'
    detail?: string
    rate_limit_remaining?: number
  }>
  identity?: {
    actor_type: 'api_key' | 'agent' | 'user' | 'anonymous'
    actor_id?: string
    session_id?: string
    api_key_prefix?: string
  }
  ai?: {
    provider: string
    model: string
    input_tokens: number
    output_tokens: number
    cache_tokens: number
    estimated_cost_usd: number
    finish_reason: string
    tool_calls?: string[]
  }
  otel?: {
    trace_id: string
    span_id: string
    external_viewer_url?: string
  }
}
```

2. Add an `eventToTraceDetail` helper function that converts the SSE `RequestEvent` to `TraceDetail`.

3. Replace the entire `<Sheet>` block at the bottom with:
```tsx
<TraceDetailPanel
  trace={selectedRequest ? eventToTraceDetail(selectedRequest) : null}
  open={sheetOpen}
  onOpenChange={setSheetOpen}
/>
```

4. Add import for `TraceDetailPanel` and remove now-unused Sheet imports.

- [ ] **Step 7: Add SSE reconnection jitter to use-events.ts**

Modify `packages/web/src/hooks/use-events.ts`:

Replace the backoff calculation:
```typescript
const delay = Math.min(
  BASE_BACKOFF_MS * 2 ** retriesRef.current,
  MAX_BACKOFF_MS,
)
```

With jittered backoff:
```typescript
const baseDelay = Math.min(
  BASE_BACKOFF_MS * 2 ** retriesRef.current,
  MAX_BACKOFF_MS,
)
// Add 0-25% jitter to avoid thundering herd on reconnection
const jitter = baseDelay * Math.random() * 0.25
const delay = baseDelay + jitter
```

- [ ] **Step 8: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`
Expected: Clean (no errors).

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/components/rioku/trace-detail-panel.tsx \
  packages/web/src/components/rioku/__tests__/trace-detail-panel.test.tsx \
  packages/web/src/routes/traffic/live.tsx \
  packages/web/src/hooks/use-events.ts \
  packages/web/src/lib/api.ts
git commit -m "feat(web): trace detail slide-out panel with 7 collapsible sections"
```

---

## Task 2: Analytics Dashboard Completion

**Files:**
- Create: `packages/web/src/components/rioku/chart-tooltip.tsx`
- Create: `packages/web/src/components/rioku/__tests__/chart-tooltip.test.tsx`
- Create: `packages/web/src/components/rioku/timezone-caption.tsx`
- Create: `packages/web/src/components/rioku/__tests__/timezone-caption.test.tsx`
- Modify: `packages/web/src/routes/traffic/analytics.tsx`

**Classification:** `FRONTEND ONLY` -- TrafficService stats endpoints exist. Chart rendering is pure frontend.

The current analytics page has placeholder charts for top routes and status breakdown (empty arrays). This task completes the charts with proper data transformation, adds error rate as a stacked bar chart, and applies the chart quality improvements from the spec: both axes, UTC timezone caption, custom tooltips with colored dots, legends.

- [ ] **Step 1: Write tests for ChartTooltip**

Create `packages/web/src/components/rioku/__tests__/chart-tooltip.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartTooltip } from '../chart-tooltip'

describe('ChartTooltip', () => {
  it('renders nothing when not active', () => {
    const { container } = render(
      <ChartTooltip active={false} payload={[]} label="" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders label and payload values', () => {
    render(
      <ChartTooltip
        active
        label="12:00"
        payload={[
          { name: 'errors', value: 42, color: '#ef4444' },
          { name: 'requests', value: 1200, color: '#3b82f6' },
        ]}
      />,
    )

    expect(screen.getByText('12:00')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('1,200')).toBeInTheDocument()
  })

  it('renders colored dots for each series', () => {
    const { container } = render(
      <ChartTooltip
        active
        label="12:00"
        payload={[
          { name: 'p50', value: 10, color: '#3b82f6' },
          { name: 'p99', value: 80, color: '#ef4444' },
        ]}
      />,
    )

    const dots = container.querySelectorAll('[data-testid="tooltip-dot"]')
    expect(dots).toHaveLength(2)
  })

  it('bolds the series with the highest value', () => {
    render(
      <ChartTooltip
        active
        label="12:00"
        payload={[
          { name: 'low', value: 10, color: '#3b82f6' },
          { name: 'high', value: 999, color: '#ef4444' },
        ]}
      />,
    )

    // The highest value row should be bold
    const highRow = screen.getByText('999').closest('[data-testid="tooltip-row"]')
    expect(highRow).toHaveClass('font-semibold')
  })
})
```

- [ ] **Step 2: Write tests for TimezoneCaption**

Create `packages/web/src/components/rioku/__tests__/timezone-caption.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimezoneCaption } from '../timezone-caption'

describe('TimezoneCaption', () => {
  it('renders UTC timezone caption', () => {
    render(<TimezoneCaption />)
    expect(screen.getByText(/times shown in utc/i)).toBeInTheDocument()
  })

  it('accepts a custom timezone label', () => {
    render(<TimezoneCaption timezone="America/New_York" />)
    expect(screen.getByText(/times shown in america\/new_york/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/components/rioku/__tests__/chart-tooltip.test.tsx src/components/rioku/__tests__/timezone-caption.test.tsx`
Expected: Import errors.

- [ ] **Step 4: Implement ChartTooltip**

Create `packages/web/src/components/rioku/chart-tooltip.tsx`:

```typescript
interface TooltipPayload {
  name: string
  value: number
  color: string
}

interface ChartTooltipProps {
  active?: boolean
  label?: string
  payload?: TooltipPayload[]
}

function ChartTooltip({ active, label, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const maxValue = Math.max(...payload.map((p) => p.value))

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div
            key={entry.name}
            data-testid="tooltip-row"
            className={entry.value === maxValue ? 'font-semibold' : ''}
          >
            <div className="flex items-center gap-2">
              <span
                data-testid="tooltip-dot"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}</span>
              <span className="ml-auto tabular-nums">
                {entry.value.toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export { ChartTooltip }
export type { ChartTooltipProps, TooltipPayload }
```

- [ ] **Step 5: Implement TimezoneCaption**

Create `packages/web/src/components/rioku/timezone-caption.tsx`:

```typescript
interface TimezoneCaptionProps {
  timezone?: string
  className?: string
}

function TimezoneCaption({ timezone = 'UTC', className }: TimezoneCaptionProps) {
  return (
    <p className={`mt-1 text-[10px] text-muted-foreground ${className ?? ''}`}>
      Times shown in {timezone}
    </p>
  )
}

export { TimezoneCaption }
export type { TimezoneCaptionProps }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/components/rioku/__tests__/chart-tooltip.test.tsx src/components/rioku/__tests__/timezone-caption.test.tsx`
Expected: All PASS.

- [ ] **Step 7: Overhaul analytics.tsx**

Modify `packages/web/src/routes/traffic/analytics.tsx`:

Major changes:

1. **Add error rate stacked bar chart** replacing the current error rate area chart:
   - Expand `StatsBucket` to include per-status error counts: `error4xx`, `error502`, `error503`, `error429`, `error5xxOther`.
   - Add a `transformErrorBuckets` function that maps buckets to `{ time, '4xx', '502', '503', '429', '5xx Other' }`.
   - Use Recharts `<BarChart>` with `<Bar stackId="errors">` for each error type.
   - Colors: 4xx = `#eab308` (amber), 502 = `#ef4444` (red), 503 = `#f97316` (orange), 429 = `#a855f7` (purple), 5xx Other = `#991b1b` (dark red).
   - Custom tooltip via `<RTooltip content={<ChartTooltip ... />} />`.
   - `<Legend />` at top.

2. **Add top routes horizontal bar chart** with real data:
   - Add a new query to fetch `/traffic/stats/routes` with `topRoutes: Array<{ route: string; count: number }>`.
   - Use Recharts `<BarChart layout="vertical">` with route names on y-axis.
   - Click a bar to filter analytics by that route (set URL param `?route=<routeId>`).

3. **Status code distribution donut** -- wire to real data:
   - Add a `transformStatusBuckets` function that aggregates `statusBreakdown` from bucketed responses.
   - Donut chart colors: 2xx = `#22c55e`, 3xx = `#3b82f6`, 4xx = `#eab308`, 5xx = `#ef4444`.

4. **Both axes on all charts:** Ensure every chart has `<XAxis>` and `<YAxis>` with tick labels.

5. **Timezone caption:** Add `<TimezoneCaption />` below every chart.

6. **Custom tooltip:** Replace default `<RTooltip />` with custom `<RTooltip content={...} />` on every multi-series chart.

7. **Legends:** Add `<Legend />` to all multi-series charts (error stacked bar, latency line, status donut).

8. **Add latency percentiles line chart** (currently missing):
   - Three lines: p50 (blue `#3b82f6`), p95 (amber `#eab308`), p99 (red `#ef4444`).
   - Use Recharts `<LineChart>` with `<Line>` per percentile.

9. **Shared time range:** Convert from local `Tabs` to reading from shared time range context (depends on Phase 1 TimeRangeSelector being in place; if not, keep local tabs as fallback).

- [ ] **Step 8: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/components/rioku/chart-tooltip.tsx \
  packages/web/src/components/rioku/__tests__/chart-tooltip.test.tsx \
  packages/web/src/components/rioku/timezone-caption.tsx \
  packages/web/src/components/rioku/__tests__/timezone-caption.test.tsx \
  packages/web/src/routes/traffic/analytics.tsx
git commit -m "feat(web): complete analytics dashboard — stacked error bars, top routes, status donut, chart improvements"
```

---

## Task 3: AI Workloads Page Completion

**Files:**
- Modify: `packages/web/src/routes/traffic/ai.tsx`
- Modify: `packages/web/src/lib/api.ts`

**Classification:** `FRONTEND ONLY` for charts and tables. `NEEDS BACKEND` for agent session detail (ListSessions RPC).

The current AI page has a single-series token usage area chart and a cost-by-model pie chart. This task converts token usage to a stacked area chart (input vs output), adds a cost-over-time area chart, adds an agent sessions table, and enables click-through to trace timeline.

- [ ] **Step 1: Add AgentSession type to api.ts**

Add to `packages/web/src/lib/api.ts`:

```typescript
export interface AgentSession {
  sessionId: string
  agentIdentity: string
  turns: number
  totalTokens: number
  estimatedCostUsd: number
  status: 'active' | 'completed' | 'error'
  startedAt: string
  lastActivityAt: string
}
```

- [ ] **Step 2: Overhaul ai.tsx**

Modify `packages/web/src/routes/traffic/ai.tsx`:

1. **Token usage stacked area chart** -- replace single-series area with two stacked areas:
   - Expand `TokenBucket` to expose `inputTokens` and `outputTokens` separately (already in the type).
   - Transform to `{ time, input: b.inputTokens, output: b.outputTokens }`.
   - Two `<Area>` elements with `stackId="tokens"`:
     - Input: `#8b5cf6` (purple)
     - Output: `#3b82f6` (blue)
   - Add `<Legend />`, `<TimezoneCaption />`, custom tooltip.
   - Both axes.

2. **Cost over time area chart** (new):
   - Transform buckets to `{ time, cost: b.estimatedCostUsd }`.
   - Single area, green (`#22c55e`).
   - Y-axis formatted as currency (`$X.XX`).
   - `<TimezoneCaption />`, custom tooltip with `$` formatting.

3. **Model breakdown table** -- already exists, enhance:
   - Add click handler on model row to filter token chart by that model.
   - Add `sortable: true` to numeric columns.

4. **Agent sessions table** (new):
   - Add a query for `/traffic/sessions` (behind feature flag for now, mock data):
     ```typescript
     const { data: sessions, isLoading: sessionsLoading } = useQuery<AgentSession[]>({
       queryKey: ['traffic', 'sessions'],
       queryFn: () => apiClient.get<AgentSession[]>('/traffic/sessions', { since, until }),
       enabled: features.agentSessions,
     })
     ```
   - DataTable with columns: Session ID (mono, truncated), Agent, Turns, Tokens, Cost (`$X.XX`), Status (badge), Started, Last Activity.
   - Click session row to navigate to trace timeline (placeholder for now: link to `/traffic/live?session=<id>`).

5. **Replace pie chart with horizontal bar** for cost by model:
   - Horizontal bar chart is more readable than a pie chart when models > 4.
   - Y-axis = model names, X-axis = cost in `$`.

6. **Shared time range:** Use shared time range context if available, else keep local 24h default.

- [ ] **Step 3: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/routes/traffic/ai.tsx packages/web/src/lib/api.ts
git commit -m "feat(web): AI workloads — stacked token area, cost chart, agent sessions table"
```

---

## Task 4: Audit Log Page Enhancements

**Files:**
- Create: `packages/web/src/lib/export-utils.ts`
- Create: `packages/web/src/lib/__tests__/export-utils.test.ts`
- Modify: `packages/web/src/routes/audit.tsx`

**Classification:** `FRONTEND ONLY` -- audit log endpoint exists.

The current audit page already has filters, a detail sheet, and CSV/JSON export. This task enhances it with date range picker, expanded before/after detail, and extracts the export logic into a reusable utility.

- [ ] **Step 1: Write tests for export utilities**

Create `packages/web/src/lib/__tests__/export-utils.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToCsv, exportToJson } from '../export-utils'

describe('exportToCsv', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:test')
    revokeObjectURL = vi.fn()
    Object.defineProperty(globalThis, 'URL', {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates CSV with headers and rows', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]

    const result = exportToCsv(data, ['name', 'age'], 'test.csv')

    expect(result).toContain('name,age')
    expect(result).toContain('"Alice","30"')
    expect(result).toContain('"Bob","25"')
  })

  it('escapes double quotes in CSV values', () => {
    const data = [{ name: 'O"Brien', value: 'test' }]

    const result = exportToCsv(data, ['name', 'value'], 'test.csv')

    expect(result).toContain('"O""Brien"')
  })
})

describe('exportToJson', () => {
  it('generates pretty-printed JSON', () => {
    const data = [{ name: 'Alice' }]

    const result = exportToJson(data, 'test.json')

    expect(result).toBe(JSON.stringify(data, null, 2))
  })

  it('handles empty array', () => {
    const result = exportToJson([], 'test.json')

    expect(result).toBe('[]')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/lib/__tests__/export-utils.test.ts`
Expected: Import errors.

- [ ] **Step 3: Implement export utilities**

Create `packages/web/src/lib/export-utils.ts`:

```typescript
/**
 * Generate a CSV string from an array of objects and trigger a download.
 * Returns the CSV string for testing.
 */
export function exportToCsv<T extends Record<string, unknown>>(
  data: T[],
  columns: string[],
  filename: string,
): string {
  const escape = (val: unknown): string => {
    const str = String(val ?? '')
    return `"${str.replace(/"/g, '""')}"`
  }

  const rows = data.map((row) => columns.map((col) => escape(row[col])).join(','))
  const content = [columns.join(','), ...rows].join('\n')

  triggerDownload(content, 'text/csv', filename)
  return content
}

/**
 * Generate a pretty-printed JSON string and trigger a download.
 * Returns the JSON string for testing.
 */
export function exportToJson<T>(data: T[], filename: string): string {
  const content = JSON.stringify(data, null, 2)

  triggerDownload(content, 'application/json', filename)
  return content
}

function triggerDownload(content: string, mimeType: string, filename: string): void {
  if (typeof document === 'undefined') return

  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/lib/__tests__/export-utils.test.ts`
Expected: All PASS.

- [ ] **Step 5: Enhance audit.tsx**

Modify `packages/web/src/routes/audit.tsx`:

1. **Date range filter:** Replace the simple time range select with a start/end date input pair:
   - Add `startDate` and `endDate` state (default: endDate = now, startDate = now - 24h).
   - Use two `<Input type="datetime-local" />` fields side by side.
   - Keep the quick-range buttons (1h, 6h, 24h, 7d, 30d) that set start/end programmatically.
   - Pass `since` and `until` as ISO strings to the API.

2. **Action type filter:** The `operationFilter` already exists. Add an `actionTypeFilter` that maps to specific grouped actions:
   - "Configuration changes" = create, update, delete
   - "Access events" = login, refresh
   - "Status changes" = enable, disable

3. **Expandable detail per entry:** Enhance the existing Sheet detail to show before/after values:
   - Expand the `AuditEntry` type in `api.ts` to include:
     ```typescript
     beforeValues?: Record<string, unknown>
     afterValues?: Record<string, unknown>
     ```
   - In the detail sheet, render a side-by-side diff when both `beforeValues` and `afterValues` are present:
     - Left column: "Before" with red-tinted background for changed fields
     - Right column: "After" with green-tinted background for changed fields
   - When only `afterValues` is present (create), show "Created with:" followed by the values.
   - When only `beforeValues` is present (delete), show "Deleted:" followed by the values.

4. **Refactor export:** Replace the inline `handleExport` with calls to `exportToCsv` and `exportToJson` from `@/lib/export-utils`.

- [ ] **Step 6: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/export-utils.ts \
  packages/web/src/lib/__tests__/export-utils.test.ts \
  packages/web/src/routes/audit.tsx \
  packages/web/src/lib/api.ts
git commit -m "feat(web): audit log — date range, before/after detail, export refactor"
```

---

## Task 5: Cluster Page Enhancements

**Files:**
- Modify: `packages/web/src/routes/cluster.tsx`
- Modify: `packages/web/src/lib/api.ts`

**Classification:** `FRONTEND ONLY` for UI structure. `NEEDS BACKEND` for node metrics, cert status, sync events, and remove node endpoint.

The current cluster page shows basic node cards with an expandable section. This task adds richer node detail (metrics, cert status, sync events), a remove node action, and a refresh button.

- [ ] **Step 1: Add NodeDetail types to api.ts**

Add to `packages/web/src/lib/api.ts`:

```typescript
export interface NodeMetrics {
  cpuPercent: number
  memoryUsedMb: number
  memoryTotalMb: number
  goroutines: number
  openConnections: number
  requestsPerSecond: number
}

export interface NodeCertStatus {
  domain: string
  issuer: string
  expiresAt: string
  daysUntilExpiry: number
  status: 'valid' | 'expiring' | 'expired'
}

export interface SyncEvent {
  timestamp: string
  type: 'config_push' | 'config_pull' | 'cert_sync' | 'health_check'
  status: 'success' | 'failure'
  detail?: string
}

export interface NodeDetail {
  name: string
  role: 'bootstrap' | 'member'
  health: string
  daemon_version: string
  caddy_version: string
  store_mode: string
  last_seen: string
  address?: string
  metrics?: NodeMetrics
  certificates?: NodeCertStatus[]
  recentSyncEvents?: SyncEvent[]
}
```

- [ ] **Step 2: Enhance cluster.tsx**

Modify `packages/web/src/routes/cluster.tsx`:

1. **Add refresh button** in PageHeader actions:
   ```tsx
   <PageHeader
     title={t('title')}
     description={t('subtitle')}
     actions={
       <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['cluster'] })}>
         <RefreshCw className="size-3.5" data-icon="inline-start" />
         {t('actions.refresh')}
       </Button>
     }
   />
   ```

2. **Expandable node detail** -- replace the current minimal expanded section with three sub-sections:

   a. **Metrics section** (when `node.metrics` is present):
      - CPU usage progress bar with percentage
      - Memory usage progress bar (`usedMb / totalMb`)
      - Goroutine count
      - Open connections
      - RPS

   b. **Certificate status** (when `node.certificates` is present):
      - Mini table: domain, issuer, expires, status badge
      - Status badge colors: valid = green, expiring (< 14 days) = amber, expired = red

   c. **Recent sync events** (when `node.recentSyncEvents` is present):
      - Timeline list: timestamp, type badge, status badge, detail text
      - Last 5 events shown
      - Sync types: config_push (blue), config_pull (purple), cert_sync (green), health_check (gray)

3. **Remove node action** -- add a "Remove node" button (red, danger style) at the bottom of the expanded section:
   - Only visible on non-bootstrap nodes
   - Wrapped in a `ConfirmDialog` with text: "Remove node {name} from the cluster? This cannot be undone."
   - On confirm, call `apiClient.del('/cluster/nodes/${node.name}')` and invalidate the cluster query
   - Show success/error toast

4. **Switch to useQuery** with refetch capability instead of loader-only pattern:
   ```typescript
   const { data, isLoading, refetch } = useQuery<ClusterData>({
     queryKey: ['cluster'],
     queryFn: () => apiClient.get<ClusterData>('/cluster'),
     refetchInterval: 30000,
   })
   ```

- [ ] **Step 3: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/routes/cluster.tsx packages/web/src/lib/api.ts
git commit -m "feat(web): cluster page — expandable node detail, remove node, refresh"
```

---

## Task 6: Certificates Page (New)

**Files:**
- Create: `packages/web/src/routes/certificates.tsx`
- Modify: `packages/web/src/lib/api.ts`

**Classification:** `NEEDS BACKEND` -- Certificate list/detail/renew/revoke endpoints are not yet implemented. This task builds the UI shell with feature flag support.

- [ ] **Step 1: Add CertificateInfo type to api.ts**

Add to `packages/web/src/lib/api.ts`:

```typescript
export interface CertificateInfo {
  id: string
  domain: string
  issuer: string
  expiresAt: string
  issuedAt: string
  status: 'valid' | 'expiring' | 'expired' | 'revoked' | 'pending'
  sans: string[]
  serialNumber: string
  fingerprint: string
  acmeProvider?: string
  autoRenew: boolean
}

export interface AcmeConfig {
  provider: 'letsencrypt' | 'zerossl'
  email: string
  dnsProvider?: string
  onDemandEnabled: boolean
}
```

- [ ] **Step 2: Create certificates.tsx**

Create `packages/web/src/routes/certificates.tsx`:

```typescript
import { useState, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, RefreshCw, Ban } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { StatusBadge, type Status } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'
import { ComingSoon } from '@/components/rioku/coming-soon'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { CodeBlock } from '@/components/rioku/code-block'
import { apiClient, type CertificateInfo } from '@/lib/api'
import { features } from '@/lib/feature-flags'

export const Route = createFileRoute('/certificates')({
  component: Certificates,
})

function certStatusToHealth(status: string): Status {
  switch (status) {
    case 'valid': return 'healthy'
    case 'expiring': return 'degraded'
    case 'expired': return 'unhealthy'
    case 'revoked': return 'unhealthy'
    case 'pending': return 'unknown'
    default: return 'unknown'
  }
}

function Certificates() {
  const { t } = useTranslation('certificates')
  const queryClient = useQueryClient()

  if (!features.certManagement) {
    return (
      <div className="space-y-6">
        <PageHeader title="Certificates" description="Manage TLS certificates" />
        <ComingSoon
          feature="Certificate Management"
          description="Certificate listing, renewal, revocation, and ACME configuration. Requires backend implementation."
        />
      </div>
    )
  }

  const [selectedCert, setSelectedCert] = useState<CertificateInfo | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [confirmRenew, setConfirmRenew] = useState<CertificateInfo | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<CertificateInfo | null>(null)

  const { data: certs, isLoading } = useQuery<CertificateInfo[]>({
    queryKey: ['certificates'],
    queryFn: () => apiClient.get<CertificateInfo[]>('/certificates'),
    refetchInterval: 60000,
  })

  const renewMutation = useMutation({
    mutationFn: (certId: string) => apiClient.post(`/certificates/${certId}/renew`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['certificates'] }),
  })

  const revokeMutation = useMutation({
    mutationFn: (certId: string) => apiClient.post(`/certificates/${certId}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['certificates'] }),
  })

  const handleRowClick = useCallback((cert: CertificateInfo) => {
    setSelectedCert(cert)
    setDetailOpen(true)
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificates"
        description="Manage TLS certificates and ACME configuration"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['certificates'] })}
          >
            <RefreshCw className="size-3.5" data-icon="inline-start" />
            Refresh
          </Button>
        }
      />

      <DataTable
        columns={[
          {
            key: 'domain',
            header: 'Domain',
            sortable: true,
            render: (row) => (
              <button
                type="button"
                className="font-mono text-primary hover:underline"
                onClick={() => handleRowClick(row as unknown as CertificateInfo)}
              >
                {row.domain as string}
              </button>
            ),
          },
          {
            key: 'issuer',
            header: 'Issuer',
          },
          {
            key: 'expiresAt',
            header: 'Expires',
            sortable: true,
            render: (row) => <TimeAgo date={row.expiresAt as string} />,
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <StatusBadge status={certStatusToHealth(row.status as string)} />
            ),
          },
          {
            key: 'sans',
            header: 'SANs',
            render: (row) => {
              const sans = (row.sans as string[]) ?? []
              return (
                <div className="flex flex-wrap gap-1">
                  {sans.slice(0, 3).map((san) => (
                    <Badge key={san} variant="secondary" className="text-[10px]">
                      {san}
                    </Badge>
                  ))}
                  {sans.length > 3 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{sans.length - 3}
                    </Badge>
                  )}
                </div>
              )
            },
          },
          {
            key: 'actions',
            header: '',
            render: (row) => {
              const cert = row as unknown as CertificateInfo
              return (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmRenew(cert)
                    }}
                    aria-label="Renew certificate"
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmRevoke(cert)
                    }}
                    aria-label="Revoke certificate"
                  >
                    <Ban className="size-3 text-destructive" />
                  </Button>
                </div>
              )
            },
          },
        ]}
        data={(certs ?? []) as unknown as Record<string, unknown>[]}
        searchable
        searchPlaceholder="Search certificates..."
        pageSize={20}
      />

      {/* Certificate detail sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Certificate Detail</SheetTitle>
            {selectedCert && (
              <SheetDescription>{selectedCert.domain}</SheetDescription>
            )}
          </SheetHeader>
          {selectedCert && (
            <div className="space-y-4 overflow-auto px-4 pb-4">
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-muted-foreground">Domain</span>
                <span className="font-mono">{selectedCert.domain}</span>

                <span className="text-muted-foreground">Issuer</span>
                <span>{selectedCert.issuer}</span>

                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={certStatusToHealth(selectedCert.status)} />

                <span className="text-muted-foreground">Serial</span>
                <span className="font-mono text-xs">{selectedCert.serialNumber}</span>

                <span className="text-muted-foreground">Fingerprint</span>
                <span className="font-mono text-xs">{selectedCert.fingerprint}</span>

                <span className="text-muted-foreground">Issued</span>
                <TimeAgo date={selectedCert.issuedAt} />

                <span className="text-muted-foreground">Expires</span>
                <TimeAgo date={selectedCert.expiresAt} />

                <span className="text-muted-foreground">Auto-renew</span>
                <span>{selectedCert.autoRenew ? 'Yes' : 'No'}</span>
              </div>

              {selectedCert.sans.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Subject Alternative Names</h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedCert.sans.map((san) => (
                      <Badge key={san} variant="secondary">{san}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedCert.acmeProvider && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">ACME</h4>
                  <span className="text-sm">{selectedCert.acmeProvider}</span>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm dialogs */}
      {confirmRenew && (
        <ConfirmDialog
          open
          title="Renew Certificate"
          description={`Force renewal of the certificate for ${confirmRenew.domain}?`}
          confirmLabel="Renew"
          onConfirm={() => {
            renewMutation.mutate(confirmRenew.id)
            setConfirmRenew(null)
          }}
          onCancel={() => setConfirmRenew(null)}
        />
      )}

      {confirmRevoke && (
        <ConfirmDialog
          open
          title="Revoke Certificate"
          description={`Revoke the certificate for ${confirmRevoke.domain}? This cannot be undone.`}
          confirmLabel="Revoke"
          variant="destructive"
          onConfirm={() => {
            revokeMutation.mutate(confirmRevoke.id)
            setConfirmRevoke(null)
          }}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`
Expected: Clean (may require feature-flags.ts from Task 8 to exist first -- if so, create a stub).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/routes/certificates.tsx packages/web/src/lib/api.ts
git commit -m "feat(web): certificates page — cert table, detail sheet, renew/revoke actions"
```

---

## Task 7: Plugins Page Redesign

**Files:**
- Create: `packages/web/src/routes/plugins/$pluginId.tsx`
- Modify: `packages/web/src/routes/plugins.tsx`
- Modify: `packages/web/src/lib/api.ts`

**Classification:** `FRONTEND ONLY` for card grid and plugin detail UI. `NEEDS BACKEND` for plugin admin page registration.

The current plugins page shows a simple card grid with name, status toggle, and badges. This task adds a "Configure" button per card that navigates to a dedicated plugin detail page with configuration, dependent routes, changelog, and YAML/JSON view.

- [ ] **Step 1: Add PluginDetail type to api.ts**

Add to `packages/web/src/lib/api.ts`:

```typescript
export interface PluginConfig {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select'
  label: string
  description?: string
  value: unknown
  options?: string[] // for select type
}

export interface PluginRoute {
  routeId: string
  routeName: string
  policyId?: string
}

export interface PluginChangelogEntry {
  version: string
  date: string
  changes: string[]
}

export interface PluginDetail {
  id: string
  name: string
  type: string
  status: 'active' | 'disabled'
  version: string
  description: string
  config: PluginConfig[]
  dependentRoutes: PluginRoute[]
  changelog: PluginChangelogEntry[]
  rawConfig: Record<string, unknown>
}
```

- [ ] **Step 2: Update plugins.tsx with "Configure" button**

Modify `packages/web/src/routes/plugins.tsx`:

1. Add `useNavigate` import from TanStack Router.
2. In `PluginCard`, add a "Configure" button below the badges:
   ```tsx
   <Button
     variant="outline"
     size="sm"
     className="mt-2 w-full"
     onClick={() => navigate({ to: '/plugins/$pluginId', params: { pluginId: plugin.id } })}
   >
     Configure
   </Button>
   ```

3. Add dynamic sidebar nav items section. If `features.pluginAdminPages` is enabled:
   - Query the plugin registry for `getNavItems()`.
   - Render any plugin-provided nav items as additional cards or a separate section.

- [ ] **Step 3: Create plugin detail page**

Create `packages/web/src/routes/plugins/$pluginId.tsx`:

```typescript
import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Settings, GitBranch, History, FileCode } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { CodeBlock } from '@/components/rioku/code-block'
import { StatusBadge, type Status } from '@/components/rioku/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient, type PluginDetail, type PluginConfig } from '@/lib/api'

export const Route = createFileRoute('/plugins/$pluginId')({
  component: PluginDetailPage,
})

function PluginDetailPage() {
  const { pluginId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('config')
  const [yamlFormat, setYamlFormat] = useState<'json' | 'yaml'>('json')

  const { data: plugin, isLoading } = useQuery<PluginDetail>({
    queryKey: ['plugins', pluginId],
    queryFn: () => apiClient.get<PluginDetail>(`/plugins/${pluginId}`),
  })

  const updateConfigMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      apiClient.patch(`/plugins/${pluginId}/config`, config),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plugins', pluginId] }),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!plugin) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/plugins' })}>
          <ArrowLeft className="size-3.5" data-icon="inline-start" />
          Back to Plugins
        </Button>
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Plugin not found. It may have been uninstalled.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/plugins' })}>
        <ArrowLeft className="size-3.5" data-icon="inline-start" />
        Back to Plugins
      </Button>

      <PageHeader
        title={plugin.name}
        description={plugin.description}
        actions={
          <div className="flex items-center gap-3">
            <Badge variant={plugin.status === 'active' ? 'default' : 'secondary'}>
              {plugin.status}
            </Badge>
            <Badge variant="outline">{plugin.version}</Badge>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config">
            <Settings className="mr-1.5 size-3.5" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="routes">
            <GitBranch className="mr-1.5 size-3.5" />
            Dependent Routes
          </TabsTrigger>
          <TabsTrigger value="changelog">
            <History className="mr-1.5 size-3.5" />
            Changelog
          </TabsTrigger>
          <TabsTrigger value="raw">
            <FileCode className="mr-1.5 size-3.5" />
            YAML/JSON
          </TabsTrigger>
        </TabsList>

        {/* Configuration tab */}
        <TabsContent value="config">
          <Card>
            <CardHeader>
              <CardTitle>Plugin Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {plugin.config.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This plugin has no configurable options.
                </p>
              ) : (
                plugin.config.map((field) => (
                  <ConfigField key={field.key} field={field} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dependent Routes tab */}
        <TabsContent value="routes">
          <DataTable
            title="Routes using this plugin"
            columns={[
              {
                key: 'routeName',
                header: 'Route',
                render: (row) => (
                  <span className="font-mono text-primary hover:underline">
                    {row.routeName as string}
                  </span>
                ),
              },
              {
                key: 'routeId',
                header: 'Route ID',
                render: (row) => (
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.routeId as string}
                  </span>
                ),
              },
              {
                key: 'policyId',
                header: 'Policy',
                render: (row) =>
                  row.policyId ? (
                    <span className="font-mono text-xs">{row.policyId as string}</span>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  ),
              },
            ]}
            data={plugin.dependentRoutes as unknown as Record<string, unknown>[]}
            pageSize={20}
          />
        </TabsContent>

        {/* Changelog tab */}
        <TabsContent value="changelog">
          <div className="space-y-4">
            {plugin.changelog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changelog entries.</p>
            ) : (
              plugin.changelog.map((entry) => (
                <Card key={entry.version}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Badge variant="outline">{entry.version}</Badge>
                      <span className="text-muted-foreground">{entry.date}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc space-y-1 pl-4 text-sm">
                      {entry.changes.map((change, i) => (
                        <li key={i}>{change}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* YAML/JSON tab */}
        <TabsContent value="raw">
          <CodeBlock
            value={plugin.rawConfig}
            language={yamlFormat}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ConfigField({ field }: { field: PluginConfig }) {
  switch (field.type) {
    case 'boolean':
      return (
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{field.label}</Label>
            {field.description && (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            )}
          </div>
          <Switch checked={field.value as boolean} />
        </div>
      )
    case 'select':
      return (
        <div className="space-y-1.5">
          <Label>{field.label}</Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
          <Select value={String(field.value)}>
            <SelectTrigger size="sm" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case 'number':
      return (
        <div className="space-y-1.5">
          <Label>{field.label}</Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
          <Input type="number" value={String(field.value)} className="w-64" />
        </div>
      )
    default:
      return (
        <div className="space-y-1.5">
          <Label>{field.label}</Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
          <Input value={String(field.value)} className="w-64" />
        </div>
      )
  }
}
```

- [ ] **Step 4: Handle disabled plugin 404**

In the plugin detail page, when a plugin is fetched and its status is `disabled`, or the API returns 404, render:

```tsx
<div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center">
  <Puzzle className="size-8 text-muted-foreground" />
  <h2 className="text-lg font-medium">Plugin Unavailable</h2>
  <p className="max-w-md text-sm text-muted-foreground">
    This page is provided by the <strong>{pluginId}</strong> plugin,
    which is currently disabled or not installed.
  </p>
  <Button variant="outline" onClick={() => navigate({ to: '/plugins' })}>
    Back to Plugins
  </Button>
</div>
```

- [ ] **Step 5: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/routes/plugins.tsx \
  packages/web/src/routes/plugins/\$pluginId.tsx \
  packages/web/src/lib/api.ts
git commit -m "feat(web): plugin detail page — config form, dependent routes, changelog, YAML/JSON"
```

---

## Task 8: Feature Flags System

**Files:**
- Create: `packages/web/src/lib/feature-flags.ts`
- Create: `packages/web/src/lib/__tests__/feature-flags.test.ts`
- Create: `packages/web/src/components/rioku/coming-soon.tsx`
- Create: `packages/web/src/components/rioku/__tests__/coming-soon.test.tsx`

**Classification:** `FRONTEND ONLY`

Feature flags are compile-time constants (tree-shaken in production). A `ComingSoon` component renders a styled placeholder for unimplemented features. Demo mode (`RIOKU_FEATURES=all`) enables all flags.

- [ ] **Step 1: Write tests for feature flags**

Create `packages/web/src/lib/__tests__/feature-flags.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { features, isFeatureEnabled, FEATURE_KEYS } from '../feature-flags'

describe('feature-flags', () => {
  it('exports a features object with boolean values', () => {
    for (const key of FEATURE_KEYS) {
      expect(typeof features[key]).toBe('boolean')
    }
  })

  it('all flags default to false', () => {
    // Unless env overrides are active, all flags should be false
    for (const key of FEATURE_KEYS) {
      expect(features[key]).toBe(false)
    }
  })

  it('isFeatureEnabled returns the flag value', () => {
    for (const key of FEATURE_KEYS) {
      expect(isFeatureEnabled(key)).toBe(features[key])
    }
  })

  it('FEATURE_KEYS contains all expected flags', () => {
    expect(FEATURE_KEYS).toContain('certManagement')
    expect(FEATURE_KEYS).toContain('agentSessions')
    expect(FEATURE_KEYS).toContain('pluginAdminPages')
    expect(FEATURE_KEYS).toContain('clusterTopology')
    expect(FEATURE_KEYS).toContain('accessPolicies')
    expect(FEATURE_KEYS).toContain('effectivePermissions')
    expect(FEATURE_KEYS).toContain('entityActivity')
    expect(FEATURE_KEYS).toContain('colorblindMode')
  })
})
```

- [ ] **Step 2: Write tests for ComingSoon**

Create `packages/web/src/components/rioku/__tests__/coming-soon.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComingSoon } from '../coming-soon'

describe('ComingSoon', () => {
  it('renders the feature name', () => {
    render(<ComingSoon feature="Certificate Management" />)

    expect(screen.getByText('Certificate Management')).toBeInTheDocument()
  })

  it('renders the description when provided', () => {
    render(
      <ComingSoon
        feature="Plugin Marketplace"
        description="Browse and install plugins from the registry."
      />,
    )

    expect(screen.getByText(/browse and install/i)).toBeInTheDocument()
  })

  it('renders a "Coming Soon" label', () => {
    render(<ComingSoon feature="AI Assistant" />)

    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })

  it('renders a GitHub issue link when provided', () => {
    render(
      <ComingSoon
        feature="AI Assistant"
        issueUrl="https://github.com/riokulabs/rioku/issues/42"
      />,
    )

    const link = screen.getByRole('link', { name: /track progress/i })
    expect(link).toHaveAttribute('href', 'https://github.com/riokulabs/rioku/issues/42')
  })

  it('does not render a link when no issueUrl', () => {
    render(<ComingSoon feature="AI Assistant" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/lib/__tests__/feature-flags.test.ts src/components/rioku/__tests__/coming-soon.test.tsx`
Expected: Import errors.

- [ ] **Step 4: Implement feature-flags.ts**

Create `packages/web/src/lib/feature-flags.ts`:

```typescript
/**
 * Compile-time feature flags for the Rioku admin panel.
 *
 * Flags are resolved at build time via Vite's import.meta.env.
 * Tree-shaking eliminates dead code paths in production builds.
 *
 * Environment variables:
 *   RIOKU_FEATURES=all           -- enable all flags (demo mode)
 *   RIOKU_FEATURES=none          -- disable all flags (default, Playwright)
 *   RIOKU_FEATURE_CERT_MANAGEMENT=true  -- enable individual flag
 */

function envFlag(name: string): boolean {
  const allMode = import.meta.env.VITE_RIOKU_FEATURES
  if (allMode === 'all') return true
  if (allMode === 'none') return false

  const envKey = `VITE_RIOKU_FEATURE_${name.replace(/([A-Z])/g, '_$1').toUpperCase()}`
  return import.meta.env[envKey] === 'true'
}

export const features = {
  clusterTopology: envFlag('clusterTopology'),
  pluginMarketplace: envFlag('pluginMarketplace'),
  pluginAdminPages: envFlag('pluginAdminPages'),
  aiAssistant: envFlag('aiAssistant'),
  certManagement: envFlag('certManagement'),
  l4Routes: envFlag('l4Routes'),
  agentSessions: envFlag('agentSessions'),
  piiFilters: envFlag('piiFilters'),
  webhookAlerts: envFlag('webhookAlerts'),
  customDashboard: envFlag('customDashboard'),
  accessPolicies: envFlag('accessPolicies'),
  effectivePermissions: envFlag('effectivePermissions'),
  entityActivity: envFlag('entityActivity'),
  colorblindMode: envFlag('colorblindMode'),
} as const

export type FeatureKey = keyof typeof features

export const FEATURE_KEYS = Object.keys(features) as FeatureKey[]

export function isFeatureEnabled(key: FeatureKey): boolean {
  return features[key]
}
```

- [ ] **Step 5: Implement ComingSoon component**

Create `packages/web/src/components/rioku/coming-soon.tsx`:

```typescript
import { Construction } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface ComingSoonProps {
  feature: string
  description?: string
  issueUrl?: string
}

function ComingSoon({ feature, description, issueUrl }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Construction className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-medium">{feature}</h2>
        <Badge variant="secondary">Coming Soon</Badge>
      </div>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {issueUrl && (
        <a
          href={issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          Track progress on GitHub
        </a>
      )}
    </div>
  )
}

export { ComingSoon }
export type { ComingSoonProps }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx vitest run src/lib/__tests__/feature-flags.test.ts src/components/rioku/__tests__/coming-soon.test.tsx`
Expected: All PASS.

- [ ] **Step 7: Verify build compiles**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/feature-flags.ts \
  packages/web/src/lib/__tests__/feature-flags.test.ts \
  packages/web/src/components/rioku/coming-soon.tsx \
  packages/web/src/components/rioku/__tests__/coming-soon.test.tsx
git commit -m "feat(web): feature flags system with ComingSoon placeholder component"
```

---

## Execution Order

Tasks can be partially parallelized. The dependency graph:

```
Task 8 (Feature Flags) ----+
                            |
Task 1 (Trace Detail)  ----+---> Task 6 (Certificates, uses features + ComingSoon)
                            |
Task 2 (Analytics)     ----+---> Task 3 (AI Workloads, uses ChartTooltip + TimezoneCaption)
                            |
Task 4 (Audit Log)          |
                            |
Task 5 (Cluster)            |
                            |
Task 7 (Plugins)       ----+
```

**Recommended order:**
1. Task 8 (Feature Flags) -- no dependencies, provides `features` and `ComingSoon` used by other tasks
2. Task 1 (Trace Detail) and Task 2 (Analytics) -- independent, can run in parallel
3. Task 3 (AI Workloads) -- depends on Task 2 for ChartTooltip/TimezoneCaption
4. Task 4 (Audit Log) -- independent
5. Task 5 (Cluster) -- independent
6. Task 6 (Certificates) -- depends on Task 8 for feature flags and ComingSoon
7. Task 7 (Plugins) -- independent but benefits from Task 8

**Parallel batches for subagent-driven-development:**
- Batch 1: Task 8
- Batch 2: Task 1, Task 2, Task 4, Task 5 (all independent)
- Batch 3: Task 3, Task 6, Task 7 (depend on batch 1-2 outputs)

---

## Verification Checklist

After all tasks complete:

1. `cd packages/web && npx tsc --noEmit` -- zero type errors
2. `cd packages/web && npx vitest run` -- all tests pass
3. `cd packages/web && npx vite build` -- production build succeeds
4. Manual verification in browser:
   - Live traffic page: click a row, trace detail panel opens with sections
   - Analytics page: all 5 charts render with both axes, tooltips, legends, timezone captions
   - AI page: stacked token area, cost chart, model table, sessions table (behind flag)
   - Audit page: date range filter, expanded detail with before/after, export works
   - Cluster page: expandable node detail, refresh button, remove node (behind API)
   - Certificates page: shows ComingSoon (flag off) or cert table (flag on)
   - Plugins page: card grid with Configure button, plugin detail page with tabs
5. `VITE_RIOKU_FEATURES=all npx vite build` -- demo mode build succeeds with all flags on
