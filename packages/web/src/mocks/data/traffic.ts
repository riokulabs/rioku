// Traffic analytics time-series data and live trace samples

export interface TrafficDataPoint {
  timestamp: string
  requests: number
  errors: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export interface AiTrafficDataPoint {
  timestamp: string
  requests: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
}

/** Generate 24 hourly data points for the last 24 hours. */
function generateTimeSeries(): TrafficDataPoint[] {
  const points: TrafficDataPoint[] = []
  const now = new Date('2026-04-11T10:00:00Z')
  for (let i = 23; i >= 0; i--) {
    const ts = new Date(now.getTime() - i * 3600_000)
    const hour = ts.getUTCHours()
    // Simulate day/night traffic pattern
    const multiplier = hour >= 8 && hour <= 20 ? 1.0 : 0.3
    const baseRequests = Math.floor(800 * multiplier + Math.random() * 400 * multiplier)
    points.push({
      timestamp: ts.toISOString(),
      requests: baseRequests,
      errors: Math.floor(baseRequests * (0.005 + Math.random() * 0.01)),
      p50Ms: Math.floor(12 + Math.random() * 8),
      p95Ms: Math.floor(45 + Math.random() * 30),
      p99Ms: Math.floor(120 + Math.random() * 80),
    })
  }
  return points
}

function generateAiTimeSeries(): AiTrafficDataPoint[] {
  const points: AiTrafficDataPoint[] = []
  const now = new Date('2026-04-11T10:00:00Z')
  for (let i = 23; i >= 0; i--) {
    const ts = new Date(now.getTime() - i * 3600_000)
    const hour = ts.getUTCHours()
    const multiplier = hour >= 9 && hour <= 18 ? 1.0 : 0.15
    const requests = Math.floor(50 * multiplier + Math.random() * 30 * multiplier)
    points.push({
      timestamp: ts.toISOString(),
      requests,
      inputTokens: requests * Math.floor(500 + Math.random() * 300),
      outputTokens: requests * Math.floor(200 + Math.random() * 200),
      estimatedCostUsd: requests * (0.003 + Math.random() * 0.002),
    })
  }
  return points
}

export const mockTrafficTimeSeries = generateTimeSeries()
export const mockAiTrafficTimeSeries = generateAiTimeSeries()

// ---------------------------------------------------------------------------
// Range-aware dashboard data generation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Per-entity traffic charts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Recent request traces
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Activity / audit entries for entity detail pages
// ---------------------------------------------------------------------------

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
