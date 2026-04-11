import { http, HttpResponse } from 'msw'
import { mockTrafficTimeSeries, mockAiTrafficTimeSeries } from '../data/traffic'

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
]
