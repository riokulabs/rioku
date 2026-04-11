export interface ApiKeyUsageStats {
  requests24h: number
  requests7d: number
  requests30d: number
  lastUsed: string | null
}

export interface ApiKeyActivityEntry {
  action: string
  user: string
  timestamp: string
  detail: string
}

export const mockApiKeyUsage: Record<string, ApiKeyUsageStats> = {
  'key-prod-1': {
    requests24h: 12847,
    requests7d: 89234,
    requests30d: 345612,
    lastUsed: '2026-04-11T10:30:00Z',
  },
  'key-ci-1': {
    requests24h: 456,
    requests7d: 3201,
    requests30d: 14500,
    lastUsed: '2026-04-11T09:15:00Z',
  },
  'key-readonly-1': {
    requests24h: 2340,
    requests7d: 16780,
    requests30d: 71200,
    lastUsed: '2026-04-11T08:45:00Z',
  },
  'key-webhook-1': {
    requests24h: 89,
    requests7d: 623,
    requests30d: 2800,
    lastUsed: '2026-04-10T22:00:00Z',
  },
  'key-dev-1': {
    requests24h: 34,
    requests7d: 156,
    requests30d: 420,
    lastUsed: '2026-04-10T16:30:00Z',
  },
}

export const mockApiKeyActivity: Record<string, ApiKeyActivityEntry[]> = {
  'key-prod-1': [
    { action: 'Key created', user: 'admin', timestamp: '2026-01-15T10:00:00Z', detail: 'Production API Key created with config:read, config:write scopes' },
    { action: 'Scopes updated', user: 'admin', timestamp: '2026-02-01T14:00:00Z', detail: 'Added traffic:read scope' },
    { action: 'Key rotated', user: 'admin', timestamp: '2026-03-15T09:00:00Z', detail: 'Key rotated, new prefix issued' },
    { action: 'Scopes updated', user: 'alice', timestamp: '2026-04-01T11:00:00Z', detail: 'Removed traffic:read scope' },
  ],
  'key-ci-1': [
    { action: 'Key created', user: 'admin', timestamp: '2026-03-01T08:00:00Z', detail: 'CI/CD Pipeline key created' },
    { action: 'Key used', user: 'system', timestamp: '2026-04-11T09:15:00Z', detail: 'Authenticated via CI pipeline' },
  ],
  'key-readonly-1': [
    { action: 'Key created', user: 'alice', timestamp: '2026-02-20T14:00:00Z', detail: 'Monitoring Read-Only key created' },
    { action: 'Scopes updated', user: 'admin', timestamp: '2026-03-10T10:00:00Z', detail: 'Added audit:read scope' },
    { action: 'Scopes updated', user: 'admin', timestamp: '2026-03-10T10:05:00Z', detail: 'Reverted: removed audit:read scope' },
  ],
  'key-webhook-1': [
    { action: 'Key created', user: 'bob', timestamp: '2026-04-01T12:00:00Z', detail: 'Webhook Sender key created with config:read scope' },
  ],
  'key-dev-1': [
    { action: 'Key created', user: 'admin', timestamp: '2026-04-10T16:00:00Z', detail: 'Dev Testing Key created with wildcard scope' },
    { action: 'Key used', user: 'system', timestamp: '2026-04-10T16:30:00Z', detail: 'First use from local development environment' },
  ],
}
