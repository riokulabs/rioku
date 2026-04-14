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
import { mockUsers, mockRoles, mockSession, mockMe, mockExpandedRoles } from '@/mocks/data/users'
import { mockPlugins } from '@/mocks/data/plugins'
import { mockApiKeys } from '@/mocks/data/api-keys'

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

  // ---- Traffic / Dashboard ----
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

  // ---- Activity / Audit per entity ----
  if (path.startsWith('/audit/routes/')) return mockRouteActivity
  if (path.startsWith('/audit/services/')) return mockServiceActivity

  // ---- Cluster ----
  if (path === '/cluster' || path === '/cluster/nodes') return { nodes: mockNodes }

  // ---- Certificates ----
  if (path === '/certificates') return mockCertificates

  // ---- Plugins ----
  if (path === '/plugins') return mockPlugins
  if (path.startsWith('/plugins/')) {
    const id = path.split('/').pop()
    return mockPlugins.find((p: { id: string }) => p.id === id) ?? mockPlugins[0]
  }

  // ---- Settings ----
  if (path === '/settings/general') return mockGeneralSettings
  if (path === '/settings/network') return mockNetworkSettings
  if (path === '/settings/tls') return mockTlsSettings
  if (path === '/settings/observability') return mockObservabilitySettings
  if (path === '/settings/authentication') return mockAuthSettings
  if (path === '/settings/config-store') return mockConfigStoreSettings
  if (path === '/settings/pki') return mockPkiSettings

  // ---- Auth: users, roles, sessions ----
  if (path === '/auth/users') return mockUsers
  if (path === '/auth/roles') return mockRoles
  if (path === '/auth/me') return mockMe
  if (path === '/auth/sessions') return { sessions: [mockSession] }
  if (path.match(/\/auth\/users\/[^/]+\/sessions/)) return { sessions: [] }
  if (path.match(/\/auth\/roles\/.+/)) {
    const id = path.split('/').pop()
    return mockExpandedRoles.find((r: { id: string }) => r.id === id) ?? mockExpandedRoles[0]
  }

  // Access policies are handled inline in the Users & Roles tab — no standalone endpoint needed.

  // ---- API Keys (individual) ----
  if (path.match(/\/keys\/[^/]+\/usage/)) {
    return { requests24h: 1247, requests7d: 8934, requests30d: 34521, lastUsed: '2026-04-11T10:30:00Z' }
  }
  if (path.match(/\/keys\/[^/]+\/activity/)) {
    return [
      { action: 'Key created', user: 'admin', timestamp: '2026-04-01T10:00:00Z', detail: 'API key generated' },
      { action: 'Key used', user: 'system', timestamp: '2026-04-11T10:30:00Z', detail: 'Authenticated request from 10.0.1.5' },
    ]
  }
  if (path.match(/\/keys\/.+/) && !path.includes('/usage') && !path.includes('/activity')) {
    const id = path.split('/').pop()
    return mockApiKeys.find((k: { id: string }) => k.id === id) ?? mockApiKeys[0]
  }

  // No fallback available
  return undefined
}
