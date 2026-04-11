/**
 * Mock data fallback for API endpoints not yet implemented in the backend.
 * When apiClient receives a 404/500, it calls getFallbackData(path, params).
 * If a fallback exists, it's returned instead of throwing.
 * This keeps all pages functional regardless of backend implementation status.
 */

import { generateDashboardData, generateEntityTrafficChart, generateEntityErrorChart, mockRecentRequests, mockRouteActivity, mockServiceActivity } from '@/mocks/data/traffic'
import { mockNodes } from '@/mocks/data/nodes'
import { mockCertificates } from '@/mocks/data/certificates'
import { mockGeneralSettings, mockNetworkSettings, mockTlsSettings, mockObservabilitySettings, mockAuthSettings, mockConfigStoreSettings, mockPkiSettings } from '@/mocks/data/settings'
import { mockSession } from '@/mocks/data/users'

const entityTraffic = (rps: number, rpsDelta: string) => ({
  rps,
  rpsDelta,
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

export function getFallbackData(
  path: string,
  params?: Record<string, string>,
): unknown | undefined {
  const range = (params?.range as '1h' | '6h' | '24h' | '7d' | '30d') ?? '24h'

  // Traffic / dashboard
  if (path === '/traffic/dashboard') return generateDashboardData(range)
  if (path.startsWith('/traffic/routes/')) return entityTraffic(342, '+5.2%')
  if (path.startsWith('/traffic/services/')) return entityTraffic(189, '+2.1%')
  if (path.startsWith('/traffic/stats/routes')) {
    return { routes: generateDashboardData('24h').topRoutesData }
  }
  if (path.startsWith('/traffic/stats')) {
    const d = generateDashboardData(range)
    return { requestRateData: d.requestRateData, errorRateData: d.errorRateData, latencyData: d.latencyData, summary: d.summary }
  }
  if (path.startsWith('/traffic/tokens') || path.startsWith('/traffic/sessions')) {
    return generateDashboardData('24h')
  }

  // Activity / audit per entity
  if (path.startsWith('/audit/routes/')) return mockRouteActivity
  if (path.startsWith('/audit/services/')) return mockServiceActivity

  // Cluster
  if (path === '/cluster' || path === '/cluster/nodes') return { nodes: mockNodes }

  // Certificates
  if (path === '/certificates') return mockCertificates

  // Settings
  if (path === '/settings/general') return mockGeneralSettings
  if (path === '/settings/network') return mockNetworkSettings
  if (path === '/settings/tls') return mockTlsSettings
  if (path === '/settings/observability') return mockObservabilitySettings
  if (path === '/settings/authentication') return mockAuthSettings
  if (path === '/settings/config-store') return mockConfigStoreSettings
  if (path === '/settings/pki') return mockPkiSettings

  // Auth sessions
  if (path === '/auth/sessions') return { sessions: [mockSession] }
  if (path.match(/\/auth\/users\/[^/]+\/sessions/)) return { sessions: [] }

  return undefined
}
