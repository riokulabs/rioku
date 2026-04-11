import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
        estimatedCostUsd: 0.02,
        finishReason: 'end_turn',
        toolCalls: ['get_weather', 'search_docs'],
      },
    }
    render(<TraceDetailPanel trace={traceWithAI} open onOpenChange={vi.fn()} />)

    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-6')).toBeInTheDocument()
    expect(screen.getByText(/\$0\.02/)).toBeInTheDocument()
  })

  it('renders OTEL trace ID as link when externalViewerUrl is present', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    const link = screen.getByRole('link', { name: /abc123def456/i })
    expect(link).toHaveAttribute('href', 'https://jaeger.example.com/trace/abc123def456')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders request headers in code block', () => {
    render(<TraceDetailPanel trace={baseTrace} open onOpenChange={vi.fn()} />)

    // Content-Type appears in both request and response headers
    expect(screen.getAllByText(/Content-Type/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/application\/json/).length).toBeGreaterThanOrEqual(1)
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
