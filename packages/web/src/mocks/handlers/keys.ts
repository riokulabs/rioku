import { http, HttpResponse } from 'msw'
import { mockApiKeys } from '../data/api-keys'

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
      prefix: 'rku_new_',
      scopes: (body.scopes as string[]) || [],
      expiresAt: (body.expiresAt as string) || '2027-01-01T00:00:00Z',
      createdAt: new Date().toISOString(),
    }
    keys.push(newKey)
    return HttpResponse.json(
      {
        ...newKey,
        rawKey: `rku_new_mock_secret_key_${Date.now()}`,
      },
      { status: 201 },
    )
  }),

  http.delete('/api/v1/keys/:id', ({ params }) => {
    keys = keys.filter((k) => k.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
]
