import { http, HttpResponse } from 'msw'
import {
  mockTrafficTimeSeries,
  mockAiTrafficTimeSeries,
  generateDashboardData,
  generateEntityTrafficChart,
  generateEntityErrorChart,
  mockRecentRequests,
  mockRouteActivity,
  mockServiceActivity,
  type TimeRange,
} from '../data/traffic'

export const trafficHandlers = [
  http.get('/api/v1/traffic/analytics', () => {
    return HttpResponse.json({
      timeSeries: mockTrafficTimeSeries,
      summary: {
        totalRequests: mockTrafficTimeSeries.reduce(
          (sum, p) => sum + p.requests,
          0,
        ),
        totalErrors: mockTrafficTimeSeries.reduce(
          (sum, p) => sum + p.errors,
          0,
        ),
        avgP50Ms: Math.floor(
          mockTrafficTimeSeries.reduce((sum, p) => sum + p.p50Ms, 0) /
            mockTrafficTimeSeries.length,
        ),
        avgP95Ms: Math.floor(
          mockTrafficTimeSeries.reduce((sum, p) => sum + p.p95Ms, 0) /
            mockTrafficTimeSeries.length,
        ),
      },
    })
  }),

  http.get('/api/v1/traffic/ai', () => {
    return HttpResponse.json({
      timeSeries: mockAiTrafficTimeSeries,
      summary: {
        totalRequests: mockAiTrafficTimeSeries.reduce(
          (sum, p) => sum + p.requests,
          0,
        ),
        totalInputTokens: mockAiTrafficTimeSeries.reduce(
          (sum, p) => sum + p.inputTokens,
          0,
        ),
        totalOutputTokens: mockAiTrafficTimeSeries.reduce(
          (sum, p) => sum + p.outputTokens,
          0,
        ),
        totalEstimatedCostUsd: mockAiTrafficTimeSeries.reduce(
          (sum, p) => sum + p.estimatedCostUsd,
          0,
        ),
      },
    })
  }),

  // Dashboard endpoint — returns stat cards with deltas and chart data
  http.get('/api/v1/traffic/dashboard', ({ request }) => {
    const url = new URL(request.url)
    const range = (url.searchParams.get('range') ?? '24h') as TimeRange
    const data = generateDashboardData(range)
    return HttpResponse.json(data)
  }),

  // Per-route traffic stats + charts + recent requests
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

  // Per-service traffic stats + charts + recent requests
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

  // Route activity / audit log
  http.get('/api/v1/audit/routes/:routeId', () => {
    return HttpResponse.json(mockRouteActivity)
  }),

  // Service activity / audit log
  http.get('/api/v1/audit/services/:serviceId', () => {
    return HttpResponse.json(mockServiceActivity)
  }),
]
