import { http, HttpResponse } from 'msw'
import {
  mockGeneralSettings,
  mockNetworkSettings,
  mockTlsSettings,
  mockObservabilitySettings,
  mockConfigStoreSettings,
  mockAuthSettings,
  mockPkiSettings,
} from '../data/settings'

// Mutable copies for PATCH support
let general = { ...mockGeneralSettings }
let network = { ...mockNetworkSettings }
let tls = { ...mockTlsSettings }
let observability = { ...mockObservabilitySettings }
let configStore = { ...mockConfigStoreSettings }
let auth = { ...mockAuthSettings }
let pki = { ...mockPkiSettings }

export const settingsHandlers = [
  http.get('/api/v1/settings/general', () => HttpResponse.json(general)),
  http.patch('/api/v1/settings/general', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    general = { ...general, ...body }
    return HttpResponse.json(general)
  }),

  http.get('/api/v1/settings/network', () => HttpResponse.json(network)),
  http.patch('/api/v1/settings/network', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    network = { ...network, ...body }
    return HttpResponse.json(network)
  }),

  http.get('/api/v1/settings/tls', () => HttpResponse.json(tls)),
  http.patch('/api/v1/settings/tls', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    tls = { ...tls, ...body }
    return HttpResponse.json(tls)
  }),

  http.get('/api/v1/settings/observability', () =>
    HttpResponse.json(observability),
  ),
  http.patch('/api/v1/settings/observability', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    observability = { ...observability, ...body }
    return HttpResponse.json(observability)
  }),

  http.get('/api/v1/settings/config-store', () =>
    HttpResponse.json(configStore),
  ),

  http.get('/api/v1/settings/auth', () => HttpResponse.json(auth)),
  http.patch('/api/v1/settings/auth', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    auth = { ...auth, ...body }
    return HttpResponse.json(auth)
  }),

  http.get('/api/v1/settings/pki', () => HttpResponse.json(pki)),
]
