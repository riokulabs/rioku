import type { HealthStatus } from '@/lib/api'

export const mockHealthStatus: HealthStatus = {
  overall: 'healthy',
  store: { status: 'healthy', message: 'SQLite store operational' },
  caddy: { status: 'healthy', message: 'Caddy process running (PID 1234)' },
  version: '0.3.0-dev',
  uptimeSeconds: 86400 * 3 + 7200, // 3 days, 2 hours
}
