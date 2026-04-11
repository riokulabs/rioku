import { http, HttpResponse } from 'msw'
import { mockRoutes } from '../data/routes'
import { mockServices } from '../data/services'
import { mockPolicies } from '../data/policies'
import type { ConfigSnapshot } from '@/lib/api'

// In-memory state for CRUD operations
let routes = [...mockRoutes]
let services = [...mockServices]
let policies = [...mockPolicies]
let configVersion = 42

function snapshot(): ConfigSnapshot {
  return {
    version: String(configVersion),
    routes,
    services,
    policies,
  }
}

export const configHandlers = [
  // GET /api/v1/config -- return full config snapshot
  http.get('/api/v1/config', () => {
    return HttpResponse.json(snapshot())
  }),

  // POST /api/v1/config -- handles UPSERT and DELETE mutations
  // The payload shape is: { route?: { action, route?, id? }, service?: { action, service?, id? }, policy?: { action, policy?, id? } }
  http.post('/api/v1/config', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    configVersion++

    // Route mutations
    if (body.route) {
      const mutation = body.route as {
        action: string
        route?: Record<string, unknown>
        id?: string
      }
      if (mutation.action === 'UPSERT' && mutation.route) {
        const existing = routes.findIndex((r) => r.id === mutation.route!.id)
        const now = new Date().toISOString()
        if (existing >= 0) {
          routes[existing] = {
            ...routes[existing],
            ...mutation.route,
            updatedAt: now,
          } as (typeof routes)[0]
        } else {
          const newRoute = {
            id: `route-${Date.now()}`,
            name: '',
            createdAt: now,
            updatedAt: now,
            enabled: true,
            policyIds: [],
            labels: null,
            matchers: [{}],
            serviceId: '',
            ...mutation.route,
          }
          routes.push(newRoute as unknown as (typeof routes)[0])
        }
      } else if (mutation.action === 'DELETE' && mutation.id) {
        routes = routes.filter((r) => r.id !== mutation.id)
      }
    }

    // Service mutations
    if (body.service) {
      const mutation = body.service as {
        action: string
        service?: Record<string, unknown>
        id?: string
      }
      if (mutation.action === 'UPSERT' && mutation.service) {
        const existing = services.findIndex(
          (s) => s.id === mutation.service!.id,
        )
        const now = new Date().toISOString()
        if (existing >= 0) {
          services[existing] = {
            ...services[existing],
            ...mutation.service,
            updatedAt: now,
          } as (typeof services)[0]
        } else {
          const newService = {
            id: `svc-${Date.now()}`,
            name: '',
            createdAt: now,
            updatedAt: now,
            upstreams: [],
            lbPolicy: 'LB_POLICY_ROUND_ROBIN',
            healthCheck: null,
            ...mutation.service,
          }
          services.push(newService as unknown as (typeof services)[0])
        }
      } else if (mutation.action === 'DELETE' && mutation.id) {
        services = services.filter((s) => s.id !== mutation.id)
      }
    }

    // Policy mutations
    if (body.policy) {
      const mutation = body.policy as {
        action: string
        policy?: Record<string, unknown>
        id?: string
      }
      if (mutation.action === 'UPSERT' && mutation.policy) {
        const existing = policies.findIndex(
          (p) => p.id === mutation.policy!.id,
        )
        const now = new Date().toISOString()
        if (existing >= 0) {
          policies[existing] = {
            ...policies[existing],
            ...mutation.policy,
            updatedAt: now,
          } as (typeof policies)[0]
        } else {
          const newPolicy = {
            id: `pol-${Date.now()}`,
            name: '',
            type: '',
            createdAt: now,
            updatedAt: now,
            config: {},
            ...mutation.policy,
          }
          policies.push(newPolicy as unknown as (typeof policies)[0])
        }
      } else if (mutation.action === 'DELETE' && mutation.id) {
        policies = policies.filter((p) => p.id !== mutation.id)
      }
    }

    return HttpResponse.json(snapshot())
  }),
]
