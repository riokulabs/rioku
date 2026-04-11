import { http, HttpResponse } from 'msw'
import { mockApiKeys } from '../data/api-keys'
import { mockApiKeyUsage, mockApiKeyActivity } from '../data/api-key-activity'

let keys = [...mockApiKeys]

export const keysHandlers = [
  http.get('/api/v1/keys', () => {
    return HttpResponse.json(keys)
  }),

  http.post('/api/v1/keys', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    const newKey = {
      id: `key-${Date.now()}`,
      name: (body.name as string) || 'New Key',
      description: (body.description as string) || '',
      prefix: `rku_${Date.now().toString(36).slice(-4)}_`,
      scopes: (body.scopes as string[]) || ['*'],
      expiresAt: (body.expiresAt as string) || '',
      createdAt: new Date().toISOString(),
    }
    keys.push(newKey)
    return HttpResponse.json(
      {
        ...newKey,
        key: `${newKey.prefix}mock_secret_${crypto.randomUUID().slice(0, 16)}`,
      },
      { status: 201 },
    )
  }),

  http.get('/api/v1/keys/:id/usage', ({ params }) => {
    const keyId = params.id as string
    const usage = mockApiKeyUsage[keyId] ?? { requests24h: 0, requests7d: 0, requests30d: 0, lastUsed: null }
    return HttpResponse.json(usage)
  }),

  http.get('/api/v1/keys/:id/activity', ({ params }) => {
    const keyId = params.id as string
    const activity = mockApiKeyActivity[keyId] ?? []
    return HttpResponse.json({ entries: activity })
  }),

  http.delete('/api/v1/keys/:id', ({ params }) => {
    keys = keys.filter((k) => k.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
]
