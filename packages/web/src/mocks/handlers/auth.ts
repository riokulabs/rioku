import { http, HttpResponse } from 'msw'
import { mockMe, mockUsers, mockRoles, mockExpandedRoles } from '../data/users'
import { mockAccessPolicies } from '../data/access-policies'
import { mockUserSessions } from '../data/sessions'
import type { AccessPolicy } from '@/lib/api'

let accessPolicies = [...mockAccessPolicies]
const userSessions = { ...mockUserSessions }

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

  http.get('/api/v1/auth/expanded-roles', () => {
    return HttpResponse.json(mockExpandedRoles)
  }),

  http.put('/api/v1/auth/roles/:roleId', async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>
    const idx = mockExpandedRoles.findIndex((r) => r.id === params.roleId)
    if (idx === -1) {
      return HttpResponse.json({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Role not found', instance: `/auth/roles/${params.roleId as string}` }, { status: 404 })
    }
    if (body.rules) {
      mockExpandedRoles[idx] = { ...mockExpandedRoles[idx], rules: body.rules as typeof mockExpandedRoles[0]['rules'] }
    }
    return HttpResponse.json(mockExpandedRoles[idx])
  }),

  http.get('/api/v1/auth/sessions', () => {
    return HttpResponse.json({
      sessions: [
        { device: 'Chrome on macOS', ip: '192.168.1.42', lastActive: 'Now', location: 'San Francisco, CA', current: true },
        { device: 'Firefox on Ubuntu', ip: '10.0.0.15', lastActive: '2 hours ago', location: 'San Francisco, CA', current: false },
        { device: 'Rioku CLI', ip: '172.16.0.8', lastActive: '6 hours ago', location: 'AWS us-east-1', current: false },
      ],
    })
  }),

  // Per-user sessions
  http.get('/api/v1/auth/users/:userId/sessions', ({ params }) => {
    const sessions = userSessions[params.userId as string] ?? []
    return HttpResponse.json({ sessions })
  }),

  http.delete('/api/v1/auth/users/:userId/sessions/:sessionId', ({ params }) => {
    const userId = params.userId as string
    if (userSessions[userId]) {
      userSessions[userId] = userSessions[userId].filter((s) => s.id !== params.sessionId)
    }
    return new HttpResponse(null, { status: 204 })
  }),

  http.delete('/api/v1/auth/users/:userId/sessions', ({ params }) => {
    const userId = params.userId as string
    if (userSessions[userId]) {
      userSessions[userId] = userSessions[userId].filter((s) => s.current)
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // Access policies CRUD
  http.get('/api/v1/auth/access-policies', () => {
    return HttpResponse.json(accessPolicies)
  }),

  http.get('/api/v1/auth/access-policies/:id', ({ params }) => {
    const policy = accessPolicies.find((p) => p.id === params.id)
    if (!policy) {
      return HttpResponse.json({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Access policy not found', instance: `/auth/access-policies/${params.id as string}` }, { status: 404 })
    }
    return HttpResponse.json(policy)
  }),

  http.post('/api/v1/auth/access-policies', async ({ request }) => {
    const body = (await request.json()) as Omit<AccessPolicy, 'id' | 'createdAt' | 'updatedAt'>
    const newPolicy: AccessPolicy = {
      ...body,
      id: `ap-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    accessPolicies.push(newPolicy)
    return HttpResponse.json(newPolicy, { status: 201 })
  }),

  http.put('/api/v1/auth/access-policies/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<AccessPolicy>
    const idx = accessPolicies.findIndex((p) => p.id === params.id)
    if (idx === -1) {
      return HttpResponse.json({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Access policy not found', instance: `/auth/access-policies/${params.id as string}` }, { status: 404 })
    }
    accessPolicies[idx] = { ...accessPolicies[idx], ...body, updatedAt: new Date().toISOString() }
    return HttpResponse.json(accessPolicies[idx])
  }),

  http.delete('/api/v1/auth/access-policies/:id', ({ params }) => {
    accessPolicies = accessPolicies.filter((p) => p.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),

  // Session refresh
  http.post('/api/v1/auth/refresh', () => {
    const extendedExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    return HttpResponse.json({
      session: {
        ...mockMe.session,
        expiresAt: extendedExpiry,
        lastActive: new Date().toISOString(),
      },
      user: mockMe.user,
    })
  }),

  http.post('/api/v1/auth/logout', () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
