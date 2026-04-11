import { http, HttpResponse } from 'msw'
import { mockMe, mockUsers, mockRoles } from '../data/users'

export const authHandlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    if (body.username === 'admin' || body.password) {
      return HttpResponse.json({
        token: 'mock-jwt-token',
        user: mockMe.user,
      })
    }
    return HttpResponse.json(
      {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid credentials',
        instance: '/auth/login',
      },
      { status: 401 },
    )
  }),

  http.get('/api/v1/auth/me', () => {
    return HttpResponse.json(mockMe)
  }),

  http.get('/api/v1/auth/users', () => {
    return HttpResponse.json(mockUsers)
  }),

  http.get('/api/v1/auth/roles', () => {
    return HttpResponse.json(mockRoles)
  }),

  http.post('/api/v1/auth/logout', () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
