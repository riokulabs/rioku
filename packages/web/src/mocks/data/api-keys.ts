import type { ApiKey } from '@/lib/api'

export const mockApiKeys: ApiKey[] = [
  {
    id: 'key-prod-1',
    name: 'Production API Key',
    prefix: 'rku_prod_',
    scopes: ['config:read', 'config:write'],
    expiresAt: '2027-01-01T00:00:00Z',
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'key-ci-1',
    name: 'CI/CD Pipeline',
    prefix: 'rku_ci_',
    scopes: ['config:read', 'config:write'],
    expiresAt: '2026-07-01T00:00:00Z',
    createdAt: '2026-03-01T08:00:00Z',
  },
  {
    id: 'key-readonly-1',
    name: 'Monitoring Read-Only',
    prefix: 'rku_mon_',
    scopes: ['config:read', 'traffic:read'],
    expiresAt: '2026-12-31T00:00:00Z',
    createdAt: '2026-02-20T14:00:00Z',
  },
  {
    id: 'key-webhook-1',
    name: 'Webhook Sender',
    prefix: 'rku_wh_',
    scopes: ['config:read'],
    expiresAt: '2026-09-01T00:00:00Z',
    createdAt: '2026-04-01T12:00:00Z',
  },
  {
    id: 'key-dev-1',
    name: 'Dev Testing Key',
    prefix: 'rku_dev_',
    scopes: ['*'],
    expiresAt: '2026-05-01T00:00:00Z',
    createdAt: '2026-04-10T16:00:00Z',
  },
]
