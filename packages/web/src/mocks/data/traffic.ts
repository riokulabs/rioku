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
