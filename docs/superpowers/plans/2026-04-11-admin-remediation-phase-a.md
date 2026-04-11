# Admin Panel Remediation -- Phase A: MSW Mocks, YamlJsonEditor Wiring, SearchableSelect/MultiSelect, KeyValueEditor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a fully functional MSW mock layer so the admin panel can run without a backend, then wire the existing `YamlJsonEditor`, `SearchableSelect`, `SearchableMultiSelect`, and `KvEditor` components into all create/detail pages with bidirectional form/YAML synchronization.

**Architecture:** MSW (Mock Service Worker) intercepts `fetch` requests at the browser/test level. Mock data modules provide realistic, typed data matching the API types in `src/lib/api.ts`. Request handlers return this data for every endpoint the admin panel uses. A form-to-YAML sync utility converts between typed form values and YAML strings for bidirectional editing. All existing placeholder comments in route/service/policy pages are replaced with real component integrations.

**Tech Stack:** React 19, TypeScript 6, MSW 2.x, Vitest 4.x, @testing-library/react, happy-dom, `yaml` (already in `@rioku/ui` deps)

**Working directory:** `packages/web/`

**Depends on:** Phase 1 and Phase 2 must be complete. The following must exist:
- `@rioku/ui` package with `YamlJsonEditor`, `SearchableSelect`, `SearchableMultiSelect` (confirmed in `packages/ui/src/components/`)
- `@/components/rioku/kv-editor.tsx` with `KvEditor` component (confirmed)
- All config route pages: `routes.create.tsx`, `routes.$routeId.tsx`, `services.create.tsx`, `services.$serviceId.tsx`, `policies.create.tsx`, `policies.$policyId.tsx` (confirmed)
- Form schemas: `src/lib/schemas/route.ts`, `src/lib/schemas/service.ts`, `src/lib/schemas/policy-schemas.ts` (confirmed)
- API types in `src/lib/api.ts` (confirmed)

**Key conventions:**
- Conventional Commits required (`feat:`, `fix:`, etc.)
- No AI tool references in commits
- TDD: write tests first
- Vitest + @testing-library/react + happy-dom for testing
- Use `source ~/.nvm/nvm.sh &&` before any node/npx commands
- Button uses `render` prop pattern, NOT `asChild`

---

## Task 1: Install MSW and Scaffold Mock Infrastructure

**Files:**
- Modify: `packages/web/package.json` (add `msw` dev dependency)
- Create: `packages/web/src/mocks/browser.ts`
- Create: `packages/web/src/mocks/server.ts`
- Create: `packages/web/src/mocks/handlers.ts`
- Create: `packages/web/public/mockServiceWorker.js` (via `npx msw init`)
- Modify: `packages/web/src/main.tsx` (conditional MSW startup)

- [ ] **Step 1: Install MSW**

```bash
cd packages/web && source ~/.nvm/nvm.sh && npm install --save-dev msw
```

- [ ] **Step 2: Generate the service worker file**

```bash
cd packages/web && source ~/.nvm/nvm.sh && npx msw init public/ --save
```

This creates `packages/web/public/mockServiceWorker.js`.

- [ ] **Step 3: Create `src/mocks/handlers.ts`**

This is the aggregate handler array. It starts empty and will be populated in Task 3.

Create `packages/web/src/mocks/handlers.ts`:

```typescript
import type { RequestHandler } from 'msw'

// Handlers will be imported and aggregated here in Task 3.
// Start with empty array so browser.ts and server.ts can import it now.
export const handlers: RequestHandler[] = []
```

- [ ] **Step 4: Create `src/mocks/browser.ts`**

Create `packages/web/src/mocks/browser.ts`:

```typescript
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
```

- [ ] **Step 5: Create `src/mocks/server.ts`**

This is used by Vitest (node environment) for tests.

Create `packages/web/src/mocks/server.ts`:

```typescript
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

- [ ] **Step 6: Modify `src/main.tsx` to conditionally start MSW**

The MSW worker starts when `VITE_MOCK=true` is set or when the real API is unreachable.

Replace the entire contents of `packages/web/src/main.tsx` with:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import '@/lib/i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const router = createRouter({
  routeTree,
  context: { queryClient },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface RouterContext {
    queryClient: QueryClient
  }
}

async function startApp() {
  // Start MSW if explicitly requested or if backend is unreachable
  if (import.meta.env.VITE_MOCK === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
    console.info('[MSW] Mock mode enabled via VITE_MOCK=true')
  } else {
    try {
      const res = await fetch('/api/v1/health', { signal: AbortSignal.timeout(2000) })
      if (!res.ok) throw new Error('unhealthy')
    } catch {
      const { worker } = await import('./mocks/browser')
      await worker.start({ onUnhandledRequest: 'bypass' })
      console.info('[MSW] Mock mode enabled (backend unreachable)')
    }
  }

  const root = document.getElementById('root')!
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

startApp()
```

- [ ] **Step 7: Commit**

```
feat(web): scaffold MSW mock infrastructure

Install msw, create browser/server worker setup, add conditional
startup in main.tsx that activates mocks when VITE_MOCK=true or
when the backend API is unreachable.
```

---

## Task 2: Mock Data Modules

**Files:**
- Create: `packages/web/src/mocks/data/routes.ts`
- Create: `packages/web/src/mocks/data/services.ts`
- Create: `packages/web/src/mocks/data/policies.ts`
- Create: `packages/web/src/mocks/data/users.ts`
- Create: `packages/web/src/mocks/data/api-keys.ts`
- Create: `packages/web/src/mocks/data/audit.ts`
- Create: `packages/web/src/mocks/data/nodes.ts`
- Create: `packages/web/src/mocks/data/plugins.ts`
- Create: `packages/web/src/mocks/data/certificates.ts`
- Create: `packages/web/src/mocks/data/traffic.ts`
- Create: `packages/web/src/mocks/data/settings.ts`
- Create: `packages/web/src/mocks/data/health.ts`

All mock data arrays are typed using the interfaces from `@/lib/api`. Each file exports a mutable array (so handlers can perform in-memory CRUD). Timestamps use ISO strings relative to `2026-04-11`.

- [ ] **Step 1: Create `src/mocks/data/routes.ts`**

Create `packages/web/src/mocks/data/routes.ts`:

```typescript
import type { Route } from '@/lib/api'

export const mockRoutes: Route[] = [
  {
    id: 'route-api-v1',
    name: 'api-v1',
    matchers: [
      {
        hosts: ['api.example.com'],
        paths: [{ type: 'TYPE_PREFIX', value: '/v1/' }],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        headers: [],
      },
    ],
    serviceId: 'svc-api-backend',
    policyIds: ['pol-rate-limit-global', 'pol-jwt-auth'],
    enabled: true,
    labels: { team: 'platform', env: 'production' },
    createdAt: '2026-03-15T10:00:00Z',
    updatedAt: '2026-04-10T14:30:00Z',
  },
  {
    id: 'route-api-v2',
    name: 'api-v2',
    matchers: [
      {
        hosts: ['api.example.com'],
        paths: [{ type: 'TYPE_PREFIX', value: '/v2/' }],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        headers: [],
      },
    ],
    serviceId: 'svc-api-backend',
    policyIds: ['pol-rate-limit-global', 'pol-jwt-auth', 'pol-cors-permissive'],
    enabled: true,
    labels: { team: 'platform', env: 'production' },
    createdAt: '2026-04-01T08:00:00Z',
    updatedAt: '2026-04-10T14:30:00Z',
  },
  {
    id: 'route-web-app',
    name: 'web-app',
    matchers: [
      {
        hosts: ['app.example.com'],
        paths: [{ type: 'TYPE_PREFIX', value: '/' }],
        methods: ['GET'],
        headers: [],
      },
    ],
    serviceId: 'svc-web-frontend',
    policyIds: ['pol-cors-permissive'],
    enabled: true,
    labels: { team: 'frontend', env: 'production' },
    createdAt: '2026-02-20T12:00:00Z',
    updatedAt: '2026-04-08T09:15:00Z',
  },
  {
    id: 'route-auth',
    name: 'auth-service',
    matchers: [
      {
        hosts: ['auth.example.com'],
        paths: [{ type: 'TYPE_PREFIX', value: '/oauth/' }],
        methods: ['GET', 'POST'],
        headers: [],
      },
    ],
    serviceId: 'svc-auth',
    policyIds: ['pol-rate-limit-auth'],
    enabled: true,
    labels: { team: 'security', env: 'production' },
    createdAt: '2026-01-10T06:00:00Z',
    updatedAt: '2026-04-05T16:45:00Z',
  },
  {
    id: 'route-webhooks',
    name: 'webhooks',
    matchers: [
      {
        hosts: ['hooks.example.com'],
        paths: [{ type: 'TYPE_EXACT', value: '/ingest' }],
        methods: ['POST'],
        headers: [{ name: 'Content-Type', value: 'application/json', invert: false }],
      },
    ],
    serviceId: 'svc-webhook-processor',
    policyIds: ['pol-api-key-auth'],
    enabled: true,
    labels: { team: 'integrations' },
    createdAt: '2026-03-01T15:00:00Z',
    updatedAt: '2026-04-09T11:20:00Z',
  },
  {
    id: 'route-ai-proxy',
    name: 'ai-proxy',
    matchers: [
      {
        hosts: ['ai.example.com'],
        paths: [{ type: 'TYPE_PREFIX', value: '/chat/completions' }],
        methods: ['POST'],
        headers: [],
      },
    ],
    serviceId: 'svc-llm-proxy',
    policyIds: ['pol-rate-limit-global', 'pol-jwt-auth', 'pol-circuit-breaker-upstream'],
    enabled: true,
    labels: { team: 'ai', env: 'production', tier: 'premium' },
    createdAt: '2026-04-05T09:00:00Z',
    updatedAt: '2026-04-11T08:00:00Z',
  },
  {
    id: 'route-legacy-redirect',
    name: 'legacy-redirect',
    matchers: [
      {
        hosts: ['old.example.com'],
        paths: [{ type: 'TYPE_PREFIX', value: '/' }],
        methods: [],
        headers: [],
      },
    ],
    serviceId: 'svc-web-frontend',
    policyIds: [],
    enabled: false,
    labels: { deprecated: 'true' },
    createdAt: '2025-11-01T00:00:00Z',
    updatedAt: '2026-03-20T10:00:00Z',
  },
  {
    id: 'route-static-assets',
    name: 'static-assets',
    matchers: [
      {
        hosts: ['cdn.example.com'],
        paths: [{ type: 'TYPE_PREFIX', value: '/assets/' }],
        methods: ['GET', 'HEAD'],
        headers: [],
      },
    ],
    serviceId: 'svc-cdn',
    policyIds: ['pol-cache-static'],
    enabled: true,
    labels: { team: 'frontend', cache: 'aggressive' },
    createdAt: '2026-02-15T14:00:00Z',
    updatedAt: '2026-04-07T18:30:00Z',
  },
  {
    id: 'route-graphql',
    name: 'graphql',
    matchers: [
      {
        hosts: ['api.example.com'],
        paths: [{ type: 'TYPE_EXACT', value: '/graphql' }],
        methods: ['POST'],
        headers: [],
      },
    ],
    serviceId: 'svc-graphql',
    policyIds: ['pol-jwt-auth', 'pol-rate-limit-global'],
    enabled: true,
    labels: { team: 'platform' },
    createdAt: '2026-03-20T11:00:00Z',
    updatedAt: '2026-04-10T12:00:00Z',
  },
  {
    id: 'route-health',
    name: 'health-check',
    matchers: [
      {
        hosts: [],
        paths: [{ type: 'TYPE_EXACT', value: '/healthz' }],
        methods: ['GET'],
        headers: [],
      },
    ],
    serviceId: 'svc-api-backend',
    policyIds: [],
    enabled: true,
    labels: { internal: 'true' },
    createdAt: '2026-01-05T08:00:00Z',
    updatedAt: '2026-01-05T08:00:00Z',
  },
]
```

- [ ] **Step 2: Create `src/mocks/data/services.ts`**

Create `packages/web/src/mocks/data/services.ts`:

```typescript
import type { Service } from '@/lib/api'

export const mockServices: Service[] = [
  {
    id: 'svc-api-backend',
    name: 'api-backend',
    upstreams: [
      { id: 'us-1', address: '10.0.1.10:8080', weight: 3, tls: 'TLS_MODE_OFF', healthy: true },
      { id: 'us-2', address: '10.0.1.11:8080', weight: 3, tls: 'TLS_MODE_OFF', healthy: true },
      { id: 'us-3', address: '10.0.1.12:8080', weight: 1, tls: 'TLS_MODE_OFF', healthy: false },
    ],
    lbPolicy: 'LB_POLICY_ROUND_ROBIN',
    healthCheck: {
      enabled: true,
      path: '/health',
      intervalSeconds: 10,
      timeoutSeconds: 5,
    },
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-04-10T14:00:00Z',
  },
  {
    id: 'svc-web-frontend',
    name: 'web-frontend',
    upstreams: [
      { id: 'us-4', address: '10.0.2.10:3000', weight: 1, tls: 'TLS_MODE_OFF', healthy: true },
      { id: 'us-5', address: '10.0.2.11:3000', weight: 1, tls: 'TLS_MODE_OFF', healthy: true },
    ],
    lbPolicy: 'LB_POLICY_ROUND_ROBIN',
    healthCheck: {
      enabled: true,
      path: '/',
      intervalSeconds: 30,
      timeoutSeconds: 5,
    },
    createdAt: '2026-02-01T12:00:00Z',
    updatedAt: '2026-04-08T09:00:00Z',
  },
  {
    id: 'svc-auth',
    name: 'auth-service',
    upstreams: [
      { id: 'us-6', address: '10.0.3.10:9090', weight: 1, tls: 'TLS_MODE_INTERNAL', healthy: true },
    ],
    lbPolicy: 'LB_POLICY_LEAST_CONN',
    healthCheck: {
      enabled: true,
      path: '/healthz',
      intervalSeconds: 15,
      timeoutSeconds: 3,
    },
    createdAt: '2026-01-10T06:00:00Z',
    updatedAt: '2026-04-05T16:00:00Z',
  },
  {
    id: 'svc-webhook-processor',
    name: 'webhook-processor',
    upstreams: [
      { id: 'us-7', address: '10.0.4.10:8081', weight: 1, tls: 'TLS_MODE_OFF', healthy: true },
      { id: 'us-8', address: '10.0.4.11:8081', weight: 1, tls: 'TLS_MODE_OFF', healthy: true },
    ],
    lbPolicy: 'LB_POLICY_RANDOM',
    healthCheck: null,
    createdAt: '2026-03-01T15:00:00Z',
    updatedAt: '2026-04-09T11:00:00Z',
  },
  {
    id: 'svc-llm-proxy',
    name: 'llm-proxy',
    upstreams: [
      { id: 'us-9', address: 'api.openai.com:443', weight: 5, tls: 'TLS_MODE_AUTO', healthy: true },
      { id: 'us-10', address: 'api.anthropic.com:443', weight: 3, tls: 'TLS_MODE_AUTO', healthy: true },
    ],
    lbPolicy: 'LB_POLICY_WEIGHTED_ROUND_ROBIN',
    healthCheck: {
      enabled: false,
      path: '/health',
      intervalSeconds: 30,
      timeoutSeconds: 10,
    },
    createdAt: '2026-04-05T09:00:00Z',
    updatedAt: '2026-04-11T08:00:00Z',
  },
  {
    id: 'svc-cdn',
    name: 'cdn-origin',
    upstreams: [
      { id: 'us-11', address: 'origin.cdn.example.com:443', weight: 1, tls: 'TLS_MODE_AUTO', healthy: true },
    ],
    lbPolicy: 'LB_POLICY_ROUND_ROBIN',
    healthCheck: null,
    createdAt: '2026-02-15T14:00:00Z',
    updatedAt: '2026-04-07T18:00:00Z',
  },
  {
    id: 'svc-graphql',
    name: 'graphql-server',
    upstreams: [
      { id: 'us-12', address: '10.0.5.10:4000', weight: 1, tls: 'TLS_MODE_OFF', healthy: true },
      { id: 'us-13', address: '10.0.5.11:4000', weight: 1, tls: 'TLS_MODE_OFF', healthy: true },
    ],
    lbPolicy: 'LB_POLICY_LEAST_CONN',
    healthCheck: {
      enabled: true,
      path: '/.well-known/apollo/server-health',
      intervalSeconds: 20,
      timeoutSeconds: 5,
    },
    createdAt: '2026-03-20T11:00:00Z',
    updatedAt: '2026-04-10T12:00:00Z',
  },
  {
    id: 'svc-internal-metrics',
    name: 'internal-metrics',
    upstreams: [
      { id: 'us-14', address: '10.0.6.10:9100', weight: 1, tls: 'TLS_MODE_INTERNAL', healthy: true },
    ],
    lbPolicy: 'LB_POLICY_ROUND_ROBIN',
    healthCheck: null,
    createdAt: '2026-04-01T10:00:00Z',
    updatedAt: '2026-04-01T10:00:00Z',
  },
]
```

- [ ] **Step 3: Create `src/mocks/data/policies.ts`**

Create `packages/web/src/mocks/data/policies.ts`:

```typescript
import type { Policy } from '@/lib/api'

export const mockPolicies: Policy[] = [
  {
    id: 'pol-rate-limit-global',
    name: 'Global Rate Limit',
    type: 'POLICY_TYPE_RATE_LIMIT',
    config: {
      requestsPerWindow: 1000,
      windowUnit: 'minute',
      scope: 'per_ip',
      tokenAware: false,
      burstAllowance: 50,
      responseWhenLimited: '429',
    },
    createdAt: '2026-01-10T10:00:00Z',
    updatedAt: '2026-04-05T12:00:00Z',
  },
  {
    id: 'pol-rate-limit-auth',
    name: 'Auth Rate Limit',
    type: 'POLICY_TYPE_RATE_LIMIT',
    config: {
      requestsPerWindow: 20,
      windowUnit: 'minute',
      scope: 'per_ip',
      tokenAware: false,
      burstAllowance: 5,
      responseWhenLimited: '429',
    },
    createdAt: '2026-01-10T10:00:00Z',
    updatedAt: '2026-03-15T14:00:00Z',
  },
  {
    id: 'pol-jwt-auth',
    name: 'JWT Authentication',
    type: 'POLICY_TYPE_AUTHENTICATION',
    config: {
      issuerUrl: 'https://auth.example.com',
      jwksEndpoint: 'https://auth.example.com/.well-known/jwks.json',
      audience: 'api.example.com',
      tokenLocation: 'header',
      clockSkewTolerance: '30s',
    },
    createdAt: '2026-01-15T08:00:00Z',
    updatedAt: '2026-04-01T10:00:00Z',
  },
  {
    id: 'pol-api-key-auth',
    name: 'API Key Auth',
    type: 'POLICY_TYPE_AUTH_API_KEY',
    config: {
      headerName: 'X-API-Key',
      queryParamName: 'api_key',
      prefix: 'rku_',
    },
    createdAt: '2026-02-01T12:00:00Z',
    updatedAt: '2026-03-20T09:00:00Z',
  },
  {
    id: 'pol-cors-permissive',
    name: 'Permissive CORS',
    type: 'POLICY_TYPE_CORS',
    config: {
      allowedOrigins: ['https://app.example.com', 'https://admin.example.com'],
      allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID'],
      maxAge: '86400',
      allowCredentials: true,
    },
    createdAt: '2026-01-20T11:00:00Z',
    updatedAt: '2026-04-02T15:00:00Z',
  },
  {
    id: 'pol-circuit-breaker-upstream',
    name: 'Upstream Circuit Breaker',
    type: 'POLICY_TYPE_CIRCUIT_BREAKER',
    config: {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: '30s',
      maxRequestsHalfOpen: 2,
      monitoredStatusCodes: [500, 502, 503, 504],
    },
    createdAt: '2026-03-10T14:00:00Z',
    updatedAt: '2026-04-08T16:00:00Z',
  },
  {
    id: 'pol-cache-static',
    name: 'Static Asset Cache',
    type: 'POLICY_TYPE_CACHE',
    config: {
      defaultMaxAge: '3600s',
      cacheableStatusCodes: [200, 301],
      cacheableMethods: ['GET', 'HEAD'],
      varyHeaders: ['Accept-Encoding'],
      staleWhileRevalidate: '60s',
    },
    createdAt: '2026-02-15T14:00:00Z',
    updatedAt: '2026-04-07T18:00:00Z',
  },
  {
    id: 'pol-retry-default',
    name: 'Default Retry',
    type: 'POLICY_TYPE_RETRY',
    config: {
      maxAttempts: 3,
      retryOnStatusCodes: [502, 503, 504],
      backoffStrategy: 'exponential',
      initialBackoff: '100ms',
      maxBackoff: '5s',
    },
    createdAt: '2026-03-05T09:00:00Z',
    updatedAt: '2026-04-06T11:00:00Z',
  },
]
```

- [ ] **Step 4: Create `src/mocks/data/users.ts`**

Create `packages/web/src/mocks/data/users.ts`:

```typescript
import type { UserInfo, MeResponse, SessionInfo, Role } from '@/lib/api'

export const mockRoles: Role[] = [
  {
    id: 'role-admin',
    name: 'admin',
    description: 'Full administrative access',
    isBuiltin: true,
    permissions: ['*'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-operator',
    name: 'operator',
    description: 'Manage routes, services, and policies',
    isBuiltin: true,
    permissions: ['config:read', 'config:write', 'traffic:read', 'audit:read'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-viewer',
    name: 'viewer',
    description: 'Read-only access to configuration and traffic',
    isBuiltin: true,
    permissions: ['config:read', 'traffic:read', 'audit:read'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

export const mockUsers: UserInfo[] = [
  {
    id: 'user-admin',
    username: 'admin',
    displayName: 'Root Admin',
    email: 'admin@example.com',
    roles: ['admin'],
    permissions: ['*'],
    totpEnabled: true,
    forcePasswordChange: false,
    status: 'active',
    lastLogin: '2026-04-11T08:30:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'user-alice',
    username: 'alice',
    displayName: 'Alice Chen',
    email: 'alice@example.com',
    roles: ['operator'],
    permissions: ['config:read', 'config:write', 'traffic:read', 'audit:read'],
    totpEnabled: true,
    forcePasswordChange: false,
    status: 'active',
    lastLogin: '2026-04-10T17:00:00Z',
    createdAt: '2026-02-15T10:00:00Z',
  },
  {
    id: 'user-bob',
    username: 'bob',
    displayName: 'Bob Martinez',
    email: 'bob@example.com',
    roles: ['viewer'],
    permissions: ['config:read', 'traffic:read', 'audit:read'],
    totpEnabled: false,
    forcePasswordChange: false,
    status: 'active',
    lastLogin: '2026-04-09T12:00:00Z',
    createdAt: '2026-03-01T14:00:00Z',
  },
  {
    id: 'user-carol',
    username: 'carol',
    displayName: 'Carol Kim',
    email: 'carol@example.com',
    roles: ['operator'],
    permissions: ['config:read', 'config:write', 'traffic:read', 'audit:read'],
    totpEnabled: false,
    forcePasswordChange: true,
    status: 'active',
    lastLogin: null,
    createdAt: '2026-04-08T09:00:00Z',
  },
  {
    id: 'user-dave',
    username: 'dave',
    displayName: 'Dave Singh',
    email: 'dave@example.com',
    roles: ['viewer'],
    permissions: ['config:read', 'traffic:read'],
    totpEnabled: false,
    forcePasswordChange: false,
    status: 'suspended',
    lastLogin: '2026-03-15T10:00:00Z',
    createdAt: '2026-02-01T08:00:00Z',
  },
]

export const mockSession: SessionInfo = {
  id: 'sess-mock-001',
  createdAt: '2026-04-11T08:30:00Z',
  lastActive: '2026-04-11T10:00:00Z',
  expiresAt: '2026-04-11T20:30:00Z',
  ipAddress: '127.0.0.1',
  userAgent: 'MockBrowser/1.0',
}

export const mockMe: MeResponse = {
  session: mockSession,
  user: mockUsers[0],
}
```

- [ ] **Step 5: Create `src/mocks/data/api-keys.ts`**

Create `packages/web/src/mocks/data/api-keys.ts`:

```typescript
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
```

- [ ] **Step 6: Create `src/mocks/data/audit.ts`**

Create `packages/web/src/mocks/data/audit.ts`:

```typescript
import type { AuditEntry } from '@/lib/api'

export const mockAuditEntries: AuditEntry[] = [
  {
    id: 'audit-001',
    actor: 'admin',
    entityType: 'route',
    entityId: 'route-api-v1',
    operation: 'update',
    diff: { name: { from: 'api-v1-old', to: 'api-v1' } },
    configVersion: 42,
    occurredAt: '2026-04-11T09:00:00Z',
  },
  {
    id: 'audit-002',
    actor: 'alice',
    entityType: 'service',
    entityId: 'svc-api-backend',
    operation: 'update',
    diff: { lbPolicy: { from: 'LB_POLICY_RANDOM', to: 'LB_POLICY_ROUND_ROBIN' } },
    configVersion: 41,
    occurredAt: '2026-04-10T17:30:00Z',
  },
  {
    id: 'audit-003',
    actor: 'admin',
    entityType: 'policy',
    entityId: 'pol-rate-limit-global',
    operation: 'update',
    diff: { 'config.requestsPerWindow': { from: 500, to: 1000 } },
    configVersion: 40,
    occurredAt: '2026-04-10T14:00:00Z',
  },
  {
    id: 'audit-004',
    actor: 'alice',
    entityType: 'route',
    entityId: 'route-ai-proxy',
    operation: 'create',
    diff: null,
    configVersion: 39,
    occurredAt: '2026-04-05T09:00:00Z',
  },
  {
    id: 'audit-005',
    actor: 'admin',
    entityType: 'user',
    entityId: 'user-carol',
    operation: 'create',
    diff: null,
    configVersion: 38,
    occurredAt: '2026-04-08T09:00:00Z',
  },
  {
    id: 'audit-006',
    actor: 'admin',
    entityType: 'route',
    entityId: 'route-legacy-redirect',
    operation: 'update',
    diff: { enabled: { from: true, to: false } },
    configVersion: 37,
    occurredAt: '2026-03-20T10:00:00Z',
  },
  {
    id: 'audit-007',
    actor: 'bob',
    entityType: 'api_key',
    entityId: 'key-dev-1',
    operation: 'create',
    diff: null,
    configVersion: 36,
    occurredAt: '2026-04-10T16:00:00Z',
  },
  {
    id: 'audit-008',
    actor: 'admin',
    entityType: 'policy',
    entityId: 'pol-circuit-breaker-upstream',
    operation: 'create',
    diff: null,
    configVersion: 35,
    occurredAt: '2026-03-10T14:00:00Z',
  },
  {
    id: 'audit-009',
    actor: 'alice',
    entityType: 'service',
    entityId: 'svc-llm-proxy',
    operation: 'create',
    diff: null,
    configVersion: 34,
    occurredAt: '2026-04-05T09:00:00Z',
  },
  {
    id: 'audit-010',
    actor: 'admin',
    entityType: 'settings',
    entityId: 'auth',
    operation: 'update',
    diff: { sessionCookieLifetime: { from: '8h', to: '12h' } },
    configVersion: 33,
    occurredAt: '2026-04-03T11:00:00Z',
  },
  {
    id: 'audit-011',
    actor: 'admin',
    entityType: 'certificate',
    entityId: 'cert-api-example',
    operation: 'renew',
    diff: null,
    configVersion: 32,
    occurredAt: '2026-04-01T06:00:00Z',
  },
  {
    id: 'audit-012',
    actor: 'alice',
    entityType: 'route',
    entityId: 'route-graphql',
    operation: 'create',
    diff: null,
    configVersion: 31,
    occurredAt: '2026-03-20T11:00:00Z',
  },
  {
    id: 'audit-013',
    actor: 'admin',
    entityType: 'user',
    entityId: 'user-dave',
    operation: 'update',
    diff: { status: { from: 'active', to: 'suspended' } },
    configVersion: 30,
    occurredAt: '2026-03-15T15:00:00Z',
  },
  {
    id: 'audit-014',
    actor: 'carol',
    entityType: 'service',
    entityId: 'svc-graphql',
    operation: 'update',
    diff: { 'healthCheck.intervalSeconds': { from: 30, to: 20 } },
    configVersion: 29,
    occurredAt: '2026-04-10T12:00:00Z',
  },
  {
    id: 'audit-015',
    actor: 'admin',
    entityType: 'settings',
    entityId: 'pki',
    operation: 'rotate',
    diff: { caFingerprint: { from: 'sha256:old...', to: 'sha256:new...' } },
    configVersion: 28,
    occurredAt: '2026-03-28T08:00:00Z',
  },
]
```

- [ ] **Step 7: Create `src/mocks/data/nodes.ts`**

Create `packages/web/src/mocks/data/nodes.ts`:

```typescript
import type { NodeDetail } from '@/lib/api'

export const mockNodes: NodeDetail[] = [
  {
    name: 'node-primary-01',
    role: 'bootstrap',
    health: 'healthy',
    daemon_version: '0.3.0-dev',
    caddy_version: '2.9.1',
    store_mode: 'sqlite',
    last_seen: '2026-04-11T10:00:00Z',
    address: '10.0.0.10:7777',
    metrics: {
      cpuPercent: 12.5,
      memoryUsedMb: 256,
      memoryTotalMb: 2048,
      goroutines: 142,
      openConnections: 87,
      requestsPerSecond: 245.3,
    },
  },
  {
    name: 'node-member-02',
    role: 'member',
    health: 'healthy',
    daemon_version: '0.3.0-dev',
    caddy_version: '2.9.1',
    store_mode: 'sqlite',
    last_seen: '2026-04-11T09:59:55Z',
    address: '10.0.0.11:7777',
    metrics: {
      cpuPercent: 8.2,
      memoryUsedMb: 198,
      memoryTotalMb: 2048,
      goroutines: 118,
      openConnections: 64,
      requestsPerSecond: 189.7,
    },
  },
  {
    name: 'node-member-03',
    role: 'member',
    health: 'degraded',
    daemon_version: '0.3.0-dev',
    caddy_version: '2.9.1',
    store_mode: 'sqlite',
    last_seen: '2026-04-11T09:58:00Z',
    address: '10.0.0.12:7777',
    metrics: {
      cpuPercent: 78.4,
      memoryUsedMb: 1820,
      memoryTotalMb: 2048,
      goroutines: 340,
      openConnections: 198,
      requestsPerSecond: 412.1,
    },
  },
]
```

- [ ] **Step 8: Create `src/mocks/data/plugins.ts`**

Create `packages/web/src/mocks/data/plugins.ts`:

```typescript
import type { PluginDetail } from '@/lib/api'

export const mockPlugins: PluginDetail[] = [
  {
    id: 'plugin-rate-limit',
    name: 'Rate Limiter',
    type: 'middleware',
    status: 'active',
    version: '1.2.0',
    description: 'Token bucket rate limiting with per-IP, per-key, and per-agent scopes',
    config: [
      { key: 'defaultLimit', type: 'number', label: 'Default Limit', value: 1000 },
      { key: 'windowSize', type: 'select', label: 'Window Size', value: 'minute', options: ['second', 'minute', 'hour', 'day'] },
    ],
    dependentRoutes: [
      { routeId: 'route-api-v1', routeName: 'api-v1', policyId: 'pol-rate-limit-global' },
      { routeId: 'route-ai-proxy', routeName: 'ai-proxy', policyId: 'pol-rate-limit-global' },
    ],
    changelog: [
      { version: '1.2.0', date: '2026-04-01', changes: ['Added per-agent scope', 'Token-aware rate limiting'] },
      { version: '1.1.0', date: '2026-03-01', changes: ['Sliding window support'] },
    ],
    rawConfig: { defaultLimit: 1000, windowSize: 'minute' },
  },
  {
    id: 'plugin-jwt-auth',
    name: 'JWT Authenticator',
    type: 'middleware',
    status: 'active',
    version: '1.0.3',
    description: 'Validate JWT Bearer tokens against JWKS endpoints',
    config: [
      { key: 'clockSkew', type: 'string', label: 'Clock Skew Tolerance', value: '30s' },
    ],
    dependentRoutes: [
      { routeId: 'route-api-v1', routeName: 'api-v1', policyId: 'pol-jwt-auth' },
      { routeId: 'route-api-v2', routeName: 'api-v2', policyId: 'pol-jwt-auth' },
    ],
    changelog: [
      { version: '1.0.3', date: '2026-03-15', changes: ['Fixed JWKS rotation caching'] },
    ],
    rawConfig: { clockSkew: '30s' },
  },
  {
    id: 'plugin-cors',
    name: 'CORS Handler',
    type: 'middleware',
    status: 'active',
    version: '1.0.0',
    description: 'Cross-origin resource sharing rules for browser requests',
    config: [],
    dependentRoutes: [
      { routeId: 'route-api-v2', routeName: 'api-v2', policyId: 'pol-cors-permissive' },
      { routeId: 'route-web-app', routeName: 'web-app', policyId: 'pol-cors-permissive' },
    ],
    changelog: [],
    rawConfig: {},
  },
  {
    id: 'plugin-circuit-breaker',
    name: 'Circuit Breaker',
    type: 'middleware',
    status: 'active',
    version: '1.1.0',
    description: 'Protect upstreams from cascading failures with three-state circuit breaking',
    config: [
      { key: 'failureThreshold', type: 'number', label: 'Failure Threshold', value: 5 },
      { key: 'resetTimeout', type: 'string', label: 'Reset Timeout', value: '30s' },
    ],
    dependentRoutes: [
      { routeId: 'route-ai-proxy', routeName: 'ai-proxy', policyId: 'pol-circuit-breaker-upstream' },
    ],
    changelog: [
      { version: '1.1.0', date: '2026-03-10', changes: ['Half-open state max requests config'] },
    ],
    rawConfig: { failureThreshold: 5, resetTimeout: '30s' },
  },
  {
    id: 'plugin-cache',
    name: 'Response Cache',
    type: 'middleware',
    status: 'active',
    version: '1.0.1',
    description: 'Cache upstream responses with configurable TTL and vary headers',
    config: [
      { key: 'maxAge', type: 'string', label: 'Default Max Age', value: '3600s' },
      { key: 'maxBodySize', type: 'number', label: 'Max Body Size (KB)', value: 1024 },
    ],
    dependentRoutes: [
      { routeId: 'route-static-assets', routeName: 'static-assets', policyId: 'pol-cache-static' },
    ],
    changelog: [
      { version: '1.0.1', date: '2026-04-07', changes: ['Stale-while-revalidate support'] },
    ],
    rawConfig: { maxAge: '3600s', maxBodySize: 1024 },
  },
  {
    id: 'plugin-transform',
    name: 'Request/Response Transform',
    type: 'middleware',
    status: 'active',
    version: '1.0.0',
    description: 'Modify request and response headers, paths, and query parameters',
    config: [],
    dependentRoutes: [],
    changelog: [],
    rawConfig: {},
  },
  {
    id: 'plugin-llm-proxy',
    name: 'LLM Proxy',
    type: 'proxy',
    status: 'active',
    version: '0.5.0',
    description: 'Semantic rate limiting, token counting, and cost tracking for LLM APIs',
    config: [
      { key: 'enableTokenCounting', type: 'boolean', label: 'Enable Token Counting', value: true },
      { key: 'enableCostTracking', type: 'boolean', label: 'Enable Cost Tracking', value: true },
    ],
    dependentRoutes: [
      { routeId: 'route-ai-proxy', routeName: 'ai-proxy' },
    ],
    changelog: [
      { version: '0.5.0', date: '2026-04-05', changes: ['Initial release with OpenAI and Anthropic support'] },
    ],
    rawConfig: { enableTokenCounting: true, enableCostTracking: true },
  },
]
```

- [ ] **Step 9: Create `src/mocks/data/certificates.ts`**

Create `packages/web/src/mocks/data/certificates.ts`:

```typescript
import type { CertificateInfo } from '@/lib/api'

export const mockCertificates: CertificateInfo[] = [
  {
    id: 'cert-api-example',
    domain: 'api.example.com',
    issuer: "Let's Encrypt",
    expiresAt: '2026-07-10T00:00:00Z',
    issuedAt: '2026-04-10T00:00:00Z',
    status: 'valid',
    sans: ['api.example.com', '*.api.example.com'],
    serialNumber: '03:a1:b2:c3:d4:e5:f6:00:01',
    fingerprint: 'sha256:abcdef1234567890',
    acmeProvider: 'letsencrypt',
    autoRenew: true,
  },
  {
    id: 'cert-app-example',
    domain: 'app.example.com',
    issuer: "Let's Encrypt",
    expiresAt: '2026-06-15T00:00:00Z',
    issuedAt: '2026-03-15T00:00:00Z',
    status: 'valid',
    sans: ['app.example.com'],
    serialNumber: '03:a1:b2:c3:d4:e5:f6:00:02',
    fingerprint: 'sha256:fedcba0987654321',
    acmeProvider: 'letsencrypt',
    autoRenew: true,
  },
  {
    id: 'cert-auth-example',
    domain: 'auth.example.com',
    issuer: "Let's Encrypt",
    expiresAt: '2026-04-20T00:00:00Z',
    issuedAt: '2026-01-20T00:00:00Z',
    status: 'expiring',
    sans: ['auth.example.com'],
    serialNumber: '03:a1:b2:c3:d4:e5:f6:00:03',
    fingerprint: 'sha256:112233445566',
    acmeProvider: 'letsencrypt',
    autoRenew: true,
  },
  {
    id: 'cert-hooks-example',
    domain: 'hooks.example.com',
    issuer: 'ZeroSSL',
    expiresAt: '2026-08-01T00:00:00Z',
    issuedAt: '2026-02-01T00:00:00Z',
    status: 'valid',
    sans: ['hooks.example.com'],
    serialNumber: '04:b1:c2:d3:e4:f5:06:00:01',
    fingerprint: 'sha256:aabbccddee',
    acmeProvider: 'zerossl',
    autoRenew: true,
  },
  {
    id: 'cert-old-example',
    domain: 'old.example.com',
    issuer: "Let's Encrypt",
    expiresAt: '2026-02-01T00:00:00Z',
    issuedAt: '2025-11-01T00:00:00Z',
    status: 'expired',
    sans: ['old.example.com'],
    serialNumber: '03:a1:b2:c3:d4:e5:f6:00:04',
    fingerprint: 'sha256:deadbeef0000',
    acmeProvider: 'letsencrypt',
    autoRenew: false,
  },
  {
    id: 'cert-ai-example',
    domain: 'ai.example.com',
    issuer: "Let's Encrypt",
    expiresAt: '2026-07-05T00:00:00Z',
    issuedAt: '2026-04-05T00:00:00Z',
    status: 'valid',
    sans: ['ai.example.com'],
    serialNumber: '03:a1:b2:c3:d4:e5:f6:00:05',
    fingerprint: 'sha256:cafe12345678',
    acmeProvider: 'letsencrypt',
    autoRenew: true,
  },
]
```

- [ ] **Step 10: Create `src/mocks/data/traffic.ts`**

Create `packages/web/src/mocks/data/traffic.ts`:

```typescript
// Traffic analytics time-series data and live trace samples

export interface TrafficDataPoint {
  timestamp: string
  requests: number
  errors: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export interface AiTrafficDataPoint {
  timestamp: string
  requests: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
}

/** Generate 24 hourly data points for the last 24 hours. */
function generateTimeSeries(): TrafficDataPoint[] {
  const points: TrafficDataPoint[] = []
  const now = new Date('2026-04-11T10:00:00Z')
  for (let i = 23; i >= 0; i--) {
    const ts = new Date(now.getTime() - i * 3600_000)
    const hour = ts.getUTCHours()
    // Simulate day/night traffic pattern
    const multiplier = hour >= 8 && hour <= 20 ? 1.0 : 0.3
    const baseRequests = Math.floor(800 * multiplier + Math.random() * 400 * multiplier)
    points.push({
      timestamp: ts.toISOString(),
      requests: baseRequests,
      errors: Math.floor(baseRequests * (0.005 + Math.random() * 0.01)),
      p50Ms: Math.floor(12 + Math.random() * 8),
      p95Ms: Math.floor(45 + Math.random() * 30),
      p99Ms: Math.floor(120 + Math.random() * 80),
    })
  }
  return points
}

function generateAiTimeSeries(): AiTrafficDataPoint[] {
  const points: AiTrafficDataPoint[] = []
  const now = new Date('2026-04-11T10:00:00Z')
  for (let i = 23; i >= 0; i--) {
    const ts = new Date(now.getTime() - i * 3600_000)
    const hour = ts.getUTCHours()
    const multiplier = hour >= 9 && hour <= 18 ? 1.0 : 0.15
    const requests = Math.floor(50 * multiplier + Math.random() * 30 * multiplier)
    points.push({
      timestamp: ts.toISOString(),
      requests,
      inputTokens: requests * Math.floor(500 + Math.random() * 300),
      outputTokens: requests * Math.floor(200 + Math.random() * 200),
      estimatedCostUsd: requests * (0.003 + Math.random() * 0.002),
    })
  }
  return points
}

export const mockTrafficTimeSeries = generateTimeSeries()
export const mockAiTrafficTimeSeries = generateAiTimeSeries()
```

- [ ] **Step 11: Create `src/mocks/data/settings.ts`**

Create `packages/web/src/mocks/data/settings.ts`:

```typescript
import type {
  GeneralSettingsResponse,
  NetworkSettingsResponse,
  TlsSettingsResponse,
  ObservabilitySettingsResponse,
  ConfigStoreSettingsResponse,
  AuthSettingsResponse,
  PkiSettingsResponse,
} from '@/lib/api'

export const mockGeneralSettings: GeneralSettingsResponse = {
  instanceName: 'rioku-dev',
  dataDirectory: '/var/lib/rioku',
  logLevel: 'info',
  daemonVersion: '0.3.0-dev',
  caddyVersion: '2.9.1',
}

export const mockNetworkSettings: NetworkSettingsResponse = {
  trustedProxies: ['10.0.0.0/8', '172.16.0.0/12'],
  clientIpHeaders: ['X-Forwarded-For', 'X-Real-IP'],
  strictMode: false,
  listenAddresses: {
    grpc: ':7777',
    rest: ':7778',
    caddyHttp: ':80',
    caddyHttps: ':443',
    admin: ':2019',
  },
}

export const mockTlsSettings: TlsSettingsResponse = {
  acmeProvider: 'letsencrypt',
  dnsChallengeProvider: '',
  dnsChallengeCredentials: {},
  onDemandTls: false,
  onDemandRateInterval: '10m',
  onDemandRateBurst: 5,
  defaultMinTlsVersion: '1.2',
  certificates: [],  // Certificates are served from their own endpoint
}

export const mockObservabilitySettings: ObservabilitySettingsResponse = {
  traceSamplingRate: 0.1,
  alwaysTraceErrors: true,
  alwaysTraceAi: true,
  alwaysTraceSlowRequests: true,
  slowRequestThresholdMs: 1000,
  retentionRawTraces: '7d',
  retentionAggregatedStats: '90d',
  retentionAiSessions: '30d',
  storageBackend: 'sqlite',
  storageUsedBytes: 524288000,
  storageMaxBytes: 10737418240,
  ipMasking: true,
  ipMaskPrefixLength: 24,
  queryParamRedaction: ['api_key', 'token', 'secret'],
  cookieRedaction: ['session', 'auth_token'],
  customPiiRegexes: [],
  prometheusEnabled: true,
  otelExporterEndpoint: '',
}

export const mockConfigStoreSettings: ConfigStoreSettingsResponse = {
  backendType: 'sqlite',
  connectionInfo: '/var/lib/rioku/config.db',
  configVersion: 42,
  storeHealth: 'healthy',
  migrations: [
    { version: 1, name: 'initial_schema', appliedAt: '2026-01-01T00:00:00Z', status: 'applied' },
    { version: 2, name: 'add_policy_types', appliedAt: '2026-02-01T00:00:00Z', status: 'applied' },
    { version: 3, name: 'add_audit_trail', appliedAt: '2026-03-01T00:00:00Z', status: 'applied' },
    { version: 4, name: 'add_traffic_tables', appliedAt: '2026-04-01T00:00:00Z', status: 'applied' },
  ],
}

export const mockAuthSettings: AuthSettingsResponse = {
  sessionCookieLifetime: '12h',
  sessionIdleTimeout: '30m',
  maxConcurrentSessions: 5,
  passwordMinLength: 12,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireNumber: true,
  passwordRequireSpecial: true,
  passwordMaxAgeDays: 90,
  lockoutMaxAttempts: 5,
  lockoutDuration: '15m',
  lockoutResetWindow: '30m',
  totpIssuerName: 'Rioku',
  totpEnforceForAll: false,
  bruteForceRateLimit: 10,
}

export const mockPkiSettings: PkiSettingsResponse = {
  caAlgorithm: 'ECDSA-P256',
  caValidityDays: 365,
  caExpiresAt: '2027-03-28T00:00:00Z',
  caFingerprint: 'sha256:new1234567890abcdef',
  nodeCertExpiresAt: '2026-10-11T00:00:00Z',
  nodeCertSans: ['node-primary-01', '10.0.0.10'],
  autoRotationThresholdDays: 30,
  dbClientCertStatus: 'healthy',
  rotationHistory: [
    {
      id: 'rot-001',
      type: 'ca',
      rotatedAt: '2026-03-28T08:00:00Z',
      reason: 'Scheduled rotation',
      actor: 'admin',
    },
  ],
}
```

- [ ] **Step 12: Create `src/mocks/data/health.ts`**

Create `packages/web/src/mocks/data/health.ts`:

```typescript
import type { HealthStatus } from '@/lib/api'

export const mockHealthStatus: HealthStatus = {
  overall: 'healthy',
  store: { status: 'healthy', message: 'SQLite store operational' },
  caddy: { status: 'healthy', message: 'Caddy process running (PID 1234)' },
  version: '0.3.0-dev',
  uptimeSeconds: 86400 * 3 + 7200, // 3 days, 2 hours
}
```

- [ ] **Step 13: Commit**

```
feat(web): add comprehensive MSW mock data modules

12 mock data files covering routes, services, policies, users,
API keys, audit entries, nodes, plugins, certificates, traffic
time-series, settings, and health status. All typed against the
existing API interfaces.
```

---

## Task 3: MSW Request Handlers

**Files:**
- Create: `packages/web/src/mocks/handlers/config.ts`
- Create: `packages/web/src/mocks/handlers/auth.ts`
- Create: `packages/web/src/mocks/handlers/health.ts`
- Create: `packages/web/src/mocks/handlers/audit.ts`
- Create: `packages/web/src/mocks/handlers/settings.ts`
- Create: `packages/web/src/mocks/handlers/cluster.ts`
- Create: `packages/web/src/mocks/handlers/plugins.ts`
- Create: `packages/web/src/mocks/handlers/certificates.ts`
- Create: `packages/web/src/mocks/handlers/traffic.ts`
- Create: `packages/web/src/mocks/handlers/keys.ts`
- Modify: `packages/web/src/mocks/handlers.ts` (import and aggregate all handler arrays)

All handlers use `http.get`/`http.post`/`http.patch`/`http.delete` from `msw` and return `HttpResponse.json(...)`. The config handler maintains in-memory state for CRUD operations.

- [ ] **Step 1: Create `src/mocks/handlers/config.ts`**

Create `packages/web/src/mocks/handlers/config.ts`:

```typescript
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
    const body = await request.json() as Record<string, unknown>
    configVersion++

    // Route mutations
    if (body.route) {
      const mutation = body.route as { action: string; route?: Record<string, unknown>; id?: string }
      if (mutation.action === 'UPSERT' && mutation.route) {
        const existing = routes.findIndex((r) => r.id === mutation.route!.id)
        const now = new Date().toISOString()
        if (existing >= 0) {
          routes[existing] = { ...routes[existing], ...mutation.route, updatedAt: now } as typeof routes[0]
        } else {
          const newRoute = {
            id: `route-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
            enabled: true,
            policyIds: [],
            labels: null,
            matchers: [{}],
            serviceId: '',
            ...mutation.route,
          }
          routes.push(newRoute as typeof routes[0])
        }
      } else if (mutation.action === 'DELETE' && mutation.id) {
        routes = routes.filter((r) => r.id !== mutation.id)
      }
    }

    // Service mutations
    if (body.service) {
      const mutation = body.service as { action: string; service?: Record<string, unknown>; id?: string }
      if (mutation.action === 'UPSERT' && mutation.service) {
        const existing = services.findIndex((s) => s.id === mutation.service!.id)
        const now = new Date().toISOString()
        if (existing >= 0) {
          services[existing] = { ...services[existing], ...mutation.service, updatedAt: now } as typeof services[0]
        } else {
          const newService = {
            id: `svc-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
            upstreams: [],
            lbPolicy: 'LB_POLICY_ROUND_ROBIN',
            healthCheck: null,
            ...mutation.service,
          }
          services.push(newService as typeof services[0])
        }
      } else if (mutation.action === 'DELETE' && mutation.id) {
        services = services.filter((s) => s.id !== mutation.id)
      }
    }

    // Policy mutations
    if (body.policy) {
      const mutation = body.policy as { action: string; policy?: Record<string, unknown>; id?: string }
      if (mutation.action === 'UPSERT' && mutation.policy) {
        const existing = policies.findIndex((p) => p.id === mutation.policy!.id)
        const now = new Date().toISOString()
        if (existing >= 0) {
          policies[existing] = { ...policies[existing], ...mutation.policy, updatedAt: now } as typeof policies[0]
        } else {
          const newPolicy = {
            id: `pol-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
            config: {},
            ...mutation.policy,
          }
          policies.push(newPolicy as typeof policies[0])
        }
      } else if (mutation.action === 'DELETE' && mutation.id) {
        policies = policies.filter((p) => p.id !== mutation.id)
      }
    }

    return HttpResponse.json(snapshot())
  }),
]
```

- [ ] **Step 2: Create `src/mocks/handlers/auth.ts`**

Create `packages/web/src/mocks/handlers/auth.ts`:

```typescript
import { http, HttpResponse } from 'msw'
import { mockMe, mockUsers, mockRoles } from '../data/users'

export const authHandlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    if (body.username === 'admin' || body.password) {
      return HttpResponse.json({
        token: 'mock-jwt-token',
        user: mockMe.user,
      })
    }
    return HttpResponse.json(
      { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Invalid credentials', instance: '/auth/login' },
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
```

- [ ] **Step 3: Create `src/mocks/handlers/health.ts`**

Create `packages/web/src/mocks/handlers/health.ts`:

```typescript
import { http, HttpResponse } from 'msw'
import { mockHealthStatus } from '../data/health'

export const healthHandlers = [
  http.get('/api/v1/health', () => {
    return HttpResponse.json(mockHealthStatus)
  }),
]
```

- [ ] **Step 4: Create `src/mocks/handlers/audit.ts`**

Create `packages/web/src/mocks/handlers/audit.ts`:

```typescript
import { http, HttpResponse } from 'msw'
import { mockAuditEntries } from '../data/audit'

export const auditHandlers = [
  http.get('/api/v1/audit', ({ request }) => {
    const url = new URL(request.url)
    let entries = [...mockAuditEntries]

    // Filter by actor
    const actor = url.searchParams.get('actor')
    if (actor) {
      entries = entries.filter((e) => e.actor === actor)
    }

    // Filter by entity type
    const entityType = url.searchParams.get('entityType')
    if (entityType) {
      entries = entries.filter((e) => e.entityType === entityType)
    }

    // Filter by operation
    const operation = url.searchParams.get('operation')
    if (operation) {
      entries = entries.filter((e) => e.operation === operation)
    }

    // Filter by date range
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (from) {
      entries = entries.filter((e) => e.occurredAt >= from)
    }
    if (to) {
      entries = entries.filter((e) => e.occurredAt <= to)
    }

    // Sort by occurredAt descending
    entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

    return HttpResponse.json(entries)
  }),
]
```

- [ ] **Step 5: Create `src/mocks/handlers/settings.ts`**

Create `packages/web/src/mocks/handlers/settings.ts`:

```typescript
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
    const body = await request.json() as Record<string, unknown>
    general = { ...general, ...body }
    return HttpResponse.json(general)
  }),

  http.get('/api/v1/settings/network', () => HttpResponse.json(network)),
  http.patch('/api/v1/settings/network', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    network = { ...network, ...body }
    return HttpResponse.json(network)
  }),

  http.get('/api/v1/settings/tls', () => HttpResponse.json(tls)),
  http.patch('/api/v1/settings/tls', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    tls = { ...tls, ...body }
    return HttpResponse.json(tls)
  }),

  http.get('/api/v1/settings/observability', () => HttpResponse.json(observability)),
  http.patch('/api/v1/settings/observability', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    observability = { ...observability, ...body }
    return HttpResponse.json(observability)
  }),

  http.get('/api/v1/settings/config-store', () => HttpResponse.json(configStore)),

  http.get('/api/v1/settings/auth', () => HttpResponse.json(auth)),
  http.patch('/api/v1/settings/auth', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    auth = { ...auth, ...body }
    return HttpResponse.json(auth)
  }),

  http.get('/api/v1/settings/pki', () => HttpResponse.json(pki)),
]
```

- [ ] **Step 6: Create `src/mocks/handlers/cluster.ts`**

Create `packages/web/src/mocks/handlers/cluster.ts`:

```typescript
import { http, HttpResponse } from 'msw'
import { mockNodes } from '../data/nodes'

export const clusterHandlers = [
  http.get('/api/v1/cluster/nodes', () => {
    return HttpResponse.json(mockNodes)
  }),
]
```

- [ ] **Step 7: Create `src/mocks/handlers/plugins.ts`**

Create `packages/web/src/mocks/handlers/plugins.ts`:

```typescript
import { http, HttpResponse } from 'msw'
import { mockPlugins } from '../data/plugins'

export const pluginsHandlers = [
  http.get('/api/v1/plugins', () => {
    return HttpResponse.json(mockPlugins)
  }),

  http.get('/api/v1/plugins/:id', ({ params }) => {
    const plugin = mockPlugins.find((p) => p.id === params.id)
    if (!plugin) {
      return HttpResponse.json(
        { type: 'about:blank', title: 'Not Found', status: 404, detail: 'Plugin not found', instance: `/plugins/${params.id}` },
        { status: 404 },
      )
    }
    return HttpResponse.json(plugin)
  }),
]
```

- [ ] **Step 8: Create `src/mocks/handlers/certificates.ts`**

Create `packages/web/src/mocks/handlers/certificates.ts`:

```typescript
import { http, HttpResponse } from 'msw'
import { mockCertificates } from '../data/certificates'

export const certificatesHandlers = [
  http.get('/api/v1/certificates', () => {
    return HttpResponse.json(mockCertificates)
  }),
]
```

- [ ] **Step 9: Create `src/mocks/handlers/traffic.ts`**

Create `packages/web/src/mocks/handlers/traffic.ts`:

```typescript
import { http, HttpResponse } from 'msw'
import { mockTrafficTimeSeries, mockAiTrafficTimeSeries } from '../data/traffic'

export const trafficHandlers = [
  http.get('/api/v1/traffic/analytics', () => {
    return HttpResponse.json({
      timeSeries: mockTrafficTimeSeries,
      summary: {
        totalRequests: mockTrafficTimeSeries.reduce((sum, p) => sum + p.requests, 0),
        totalErrors: mockTrafficTimeSeries.reduce((sum, p) => sum + p.errors, 0),
        avgP50Ms: Math.floor(mockTrafficTimeSeries.reduce((sum, p) => sum + p.p50Ms, 0) / mockTrafficTimeSeries.length),
        avgP95Ms: Math.floor(mockTrafficTimeSeries.reduce((sum, p) => sum + p.p95Ms, 0) / mockTrafficTimeSeries.length),
      },
    })
  }),

  http.get('/api/v1/traffic/ai', () => {
    return HttpResponse.json({
      timeSeries: mockAiTrafficTimeSeries,
      summary: {
        totalRequests: mockAiTrafficTimeSeries.reduce((sum, p) => sum + p.requests, 0),
        totalInputTokens: mockAiTrafficTimeSeries.reduce((sum, p) => sum + p.inputTokens, 0),
        totalOutputTokens: mockAiTrafficTimeSeries.reduce((sum, p) => sum + p.outputTokens, 0),
        totalEstimatedCostUsd: mockAiTrafficTimeSeries.reduce((sum, p) => sum + p.estimatedCostUsd, 0),
      },
    })
  }),
]
```

- [ ] **Step 10: Create `src/mocks/handlers/keys.ts`**

Create `packages/web/src/mocks/handlers/keys.ts`:

```typescript
import { http, HttpResponse } from 'msw'
import { mockApiKeys } from '../data/api-keys'

let keys = [...mockApiKeys]

export const keysHandlers = [
  http.get('/api/v1/keys', () => {
    return HttpResponse.json(keys)
  }),

  http.post('/api/v1/keys', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    const newKey = {
      id: `key-${Date.now()}`,
      name: (body.name as string) || 'New Key',
      prefix: 'rku_new_',
      scopes: (body.scopes as string[]) || [],
      expiresAt: (body.expiresAt as string) || '2027-01-01T00:00:00Z',
      createdAt: new Date().toISOString(),
    }
    keys.push(newKey)
    return HttpResponse.json({
      ...newKey,
      rawKey: `rku_new_mock_secret_key_${Date.now()}`,
    }, { status: 201 })
  }),

  http.delete('/api/v1/keys/:id', ({ params }) => {
    keys = keys.filter((k) => k.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
]
```

- [ ] **Step 11: Update `src/mocks/handlers.ts` to aggregate all handlers**

Replace the contents of `packages/web/src/mocks/handlers.ts`:

```typescript
import type { RequestHandler } from 'msw'
import { configHandlers } from './handlers/config'
import { authHandlers } from './handlers/auth'
import { healthHandlers } from './handlers/health'
import { auditHandlers } from './handlers/audit'
import { settingsHandlers } from './handlers/settings'
import { clusterHandlers } from './handlers/cluster'
import { pluginsHandlers } from './handlers/plugins'
import { certificatesHandlers } from './handlers/certificates'
import { trafficHandlers } from './handlers/traffic'
import { keysHandlers } from './handlers/keys'

export const handlers: RequestHandler[] = [
  ...configHandlers,
  ...authHandlers,
  ...healthHandlers,
  ...auditHandlers,
  ...settingsHandlers,
  ...clusterHandlers,
  ...pluginsHandlers,
  ...certificatesHandlers,
  ...trafficHandlers,
  ...keysHandlers,
]
```

- [ ] **Step 12: Commit**

```
feat(web): add MSW request handlers for all API endpoints

10 handler modules covering config CRUD, auth, health, audit
(with filtering), settings (GET+PATCH), cluster nodes, plugins,
certificates, traffic analytics, and API keys. Config handler
maintains in-memory state for create/update/delete operations.
```

---

## Task 4: Form-to-YAML Conversion Utilities

**Files:**
- Create: `packages/web/src/lib/__tests__/form-yaml-sync.test.ts` (TDD: test first)
- Create: `packages/web/src/lib/form-yaml-sync.ts`
- Modify: `packages/web/package.json` (add `yaml` dependency if not already present)

The `yaml` package is already available via `@rioku/ui`, but the web package should have its own explicit dependency for import clarity.

- [ ] **Step 1: Add `yaml` dependency to web package**

```bash
cd packages/web && source ~/.nvm/nvm.sh && npm install yaml
```

- [ ] **Step 2: Write tests first**

Create `packages/web/src/lib/__tests__/form-yaml-sync.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  routeFormToYaml,
  yamlToRouteForm,
  serviceFormToYaml,
  yamlToServiceForm,
  policyConfigToYaml,
  yamlToPolicyConfig,
} from '../form-yaml-sync'
import type { RouteFormValues } from '@/lib/schemas/route'
import type { ServiceFormValues } from '@/lib/schemas/service'

describe('routeFormToYaml', () => {
  it('converts a minimal route form to YAML', () => {
    const values: RouteFormValues = {
      name: 'test-route',
      enabled: true,
      hosts: ['api.test.com'],
      paths: [{ type: 'TYPE_PREFIX', value: '/v1/' }],
      methods: ['GET', 'POST'],
      headers: [],
      targetType: 'service',
      serviceId: 'svc-123',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: ['pol-1'],
      labels: { env: 'test' },
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }

    const yaml = routeFormToYaml(values)
    expect(yaml).toContain('name: test-route')
    expect(yaml).toContain('enabled: true')
    expect(yaml).toContain('api.test.com')
    expect(yaml).toContain('TYPE_PREFIX')
    expect(yaml).toContain('/v1/')
    expect(yaml).toContain('svc-123')
    expect(yaml).toContain('pol-1')
    expect(yaml).toContain('env: test')
  })

  it('handles direct upstream target', () => {
    const values: RouteFormValues = {
      name: 'direct-route',
      enabled: true,
      hosts: [],
      paths: [{ type: 'TYPE_EXACT', value: '/health' }],
      methods: [],
      headers: [],
      targetType: 'direct',
      serviceId: '',
      directAddress: 'localhost:8080',
      directTls: 'TLS_MODE_AUTO',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }

    const yaml = routeFormToYaml(values)
    expect(yaml).toContain('localhost:8080')
    expect(yaml).toContain('TLS_MODE_AUTO')
    expect(yaml).not.toContain('serviceId')
  })

  it('omits empty arrays and empty labels', () => {
    const values: RouteFormValues = {
      name: 'minimal',
      enabled: true,
      hosts: [],
      paths: [{ type: 'TYPE_PREFIX', value: '/' }],
      methods: [],
      headers: [],
      targetType: 'service',
      serviceId: 'svc-1',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }

    const yaml = routeFormToYaml(values)
    // Should not contain empty arrays as "[]" or empty labels
    expect(yaml).not.toContain('hosts:')
    expect(yaml).not.toContain('methods:')
    expect(yaml).not.toContain('headers:')
    expect(yaml).not.toContain('policyIds:')
    expect(yaml).not.toContain('labels:')
  })
})

describe('yamlToRouteForm', () => {
  it('parses YAML back to route form values', () => {
    const yaml = `
name: test-route
enabled: true
matchers:
  - hosts:
      - api.test.com
    paths:
      - type: TYPE_PREFIX
        value: /v1/
    methods:
      - GET
      - POST
serviceId: svc-123
policyIds:
  - pol-1
labels:
  env: test
`
    const form = yamlToRouteForm(yaml)
    expect(form.name).toBe('test-route')
    expect(form.enabled).toBe(true)
    expect(form.hosts).toEqual(['api.test.com'])
    expect(form.paths).toEqual([{ type: 'TYPE_PREFIX', value: '/v1/' }])
    expect(form.methods).toEqual(['GET', 'POST'])
    expect(form.serviceId).toBe('svc-123')
    expect(form.targetType).toBe('service')
    expect(form.policyIds).toEqual(['pol-1'])
    expect(form.labels).toEqual({ env: 'test' })
  })

  it('handles direct upstream YAML', () => {
    const yaml = `
name: direct-route
enabled: true
matchers:
  - paths:
      - type: TYPE_EXACT
        value: /health
upstream:
  address: localhost:8080
  tls: TLS_MODE_AUTO
`
    const form = yamlToRouteForm(yaml)
    expect(form.targetType).toBe('direct')
    expect(form.directAddress).toBe('localhost:8080')
    expect(form.directTls).toBe('TLS_MODE_AUTO')
  })

  it('returns empty defaults for missing fields', () => {
    const yaml = `name: bare-minimum`
    const form = yamlToRouteForm(yaml)
    expect(form.name).toBe('bare-minimum')
    expect(form.hosts).toEqual([])
    expect(form.paths).toEqual([])
    expect(form.methods).toEqual([])
    expect(form.policyIds).toEqual([])
  })
})

describe('serviceFormToYaml', () => {
  it('converts service form to YAML', () => {
    const values: ServiceFormValues = {
      name: 'test-service',
      lbPolicy: 'LB_POLICY_ROUND_ROBIN',
      upstreams: [
        { address: '10.0.0.1:8080', weight: 3, tls: 'TLS_MODE_OFF' },
        { address: '10.0.0.2:8080', weight: 1, tls: 'TLS_MODE_AUTO' },
      ],
      activeHealthCheck: {
        enabled: true,
        path: '/health',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        healthyThreshold: 2,
        unhealthyThreshold: 3,
        expectedStatuses: [200],
      },
      passiveHealthCheck: {
        enabled: false,
        failureWindow: '',
        maxFailures: 5,
        latencyThreshold: '',
        unhealthyStatuses: [],
      },
      timeouts: { dial: '', responseHeader: '', idle: '' },
      retries: { maxAttempts: 0, retryStatuses: [] },
      connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
      labels: { team: 'backend' },
    }

    const yaml = serviceFormToYaml(values)
    expect(yaml).toContain('name: test-service')
    expect(yaml).toContain('LB_POLICY_ROUND_ROBIN')
    expect(yaml).toContain('10.0.0.1:8080')
    expect(yaml).toContain('10.0.0.2:8080')
    expect(yaml).toContain('path: /health')
    expect(yaml).toContain('team: backend')
  })

  it('omits disabled health check', () => {
    const values: ServiceFormValues = {
      name: 'no-health',
      lbPolicy: 'LB_POLICY_RANDOM',
      upstreams: [{ address: '10.0.0.1:8080', weight: 1, tls: 'TLS_MODE_OFF' }],
      activeHealthCheck: {
        enabled: false,
        path: '/health',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        healthyThreshold: 2,
        unhealthyThreshold: 3,
        expectedStatuses: [200],
      },
      passiveHealthCheck: {
        enabled: false,
        failureWindow: '',
        maxFailures: 5,
        latencyThreshold: '',
        unhealthyStatuses: [],
      },
      timeouts: { dial: '', responseHeader: '', idle: '' },
      retries: { maxAttempts: 0, retryStatuses: [] },
      connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
      labels: {},
    }

    const yaml = serviceFormToYaml(values)
    expect(yaml).not.toContain('healthCheck:')
  })
})

describe('yamlToServiceForm', () => {
  it('parses service YAML to form values', () => {
    const yaml = `
name: parsed-service
lbPolicy: LB_POLICY_LEAST_CONN
upstreams:
  - address: "10.0.0.1:8080"
    weight: 2
    tls: TLS_MODE_OFF
healthCheck:
  enabled: true
  path: /ready
  intervalSeconds: 15
  timeoutSeconds: 3
labels:
  env: staging
`
    const form = yamlToServiceForm(yaml)
    expect(form.name).toBe('parsed-service')
    expect(form.lbPolicy).toBe('LB_POLICY_LEAST_CONN')
    expect(form.upstreams).toHaveLength(1)
    expect(form.upstreams![0].address).toBe('10.0.0.1:8080')
    expect(form.activeHealthCheck!.enabled).toBe(true)
    expect(form.activeHealthCheck!.path).toBe('/ready')
    expect(form.labels).toEqual({ env: 'staging' })
  })
})

describe('policyConfigToYaml', () => {
  it('converts policy config to YAML with type and name', () => {
    const yaml = policyConfigToYaml('POLICY_TYPE_RATE_LIMIT', 'Global Rate Limit', {
      requestsPerWindow: 1000,
      windowUnit: 'minute',
      scope: 'per_ip',
    })
    expect(yaml).toContain('name: Global Rate Limit')
    expect(yaml).toContain('type: POLICY_TYPE_RATE_LIMIT')
    expect(yaml).toContain('requestsPerWindow: 1000')
    expect(yaml).toContain('windowUnit: minute')
    expect(yaml).toContain('scope: per_ip')
  })
})

describe('yamlToPolicyConfig', () => {
  it('parses policy YAML to type, name, and config', () => {
    const yaml = `
type: POLICY_TYPE_CORS
name: My CORS Policy
config:
  allowedOrigins:
    - https://example.com
  allowedMethods:
    - GET
    - POST
  allowCredentials: true
`
    const result = yamlToPolicyConfig(yaml)
    expect(result.type).toBe('POLICY_TYPE_CORS')
    expect(result.name).toBe('My CORS Policy')
    expect(result.config).toEqual({
      allowedOrigins: ['https://example.com'],
      allowedMethods: ['GET', 'POST'],
      allowCredentials: true,
    })
  })

  it('returns empty config for minimal YAML', () => {
    const yaml = `name: bare`
    const result = yamlToPolicyConfig(yaml)
    expect(result.name).toBe('bare')
    expect(result.config).toEqual({})
  })
})
```

- [ ] **Step 3: Implement `src/lib/form-yaml-sync.ts`**

Create `packages/web/src/lib/form-yaml-sync.ts`:

```typescript
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml'
import type { RouteFormValues } from '@/lib/schemas/route'
import type { ServiceFormValues } from '@/lib/schemas/service'

// ---------------------------------------------------------------------------
// Route: form -> YAML
// ---------------------------------------------------------------------------

/** Convert route form values to a YAML string suitable for YamlJsonEditor. */
export function routeFormToYaml(values: RouteFormValues): string {
  const doc: Record<string, unknown> = {
    name: values.name,
    enabled: values.enabled,
  }

  // Build matchers object, omitting empty arrays
  const matcher: Record<string, unknown> = {}
  if (values.hosts.length > 0) matcher.hosts = values.hosts
  if (values.paths.length > 0) matcher.paths = values.paths
  if (values.methods.length > 0) matcher.methods = values.methods
  if (values.headers.length > 0) matcher.headers = values.headers

  if (Object.keys(matcher).length > 0) {
    doc.matchers = [matcher]
  }

  // Target
  if (values.targetType === 'service') {
    doc.serviceId = values.serviceId
  } else {
    doc.upstream = {
      address: values.directAddress,
      tls: values.directTls,
    }
  }

  // Optional arrays
  if (values.policyIds.length > 0) {
    doc.policyIds = values.policyIds
  }

  // Labels -- only include if non-empty
  if (Object.keys(values.labels).length > 0) {
    doc.labels = values.labels
  }

  return stringifyYaml(doc, { indent: 2 })
}

// ---------------------------------------------------------------------------
// Route: YAML -> form
// ---------------------------------------------------------------------------

/** Parse a YAML string back to partial route form values. */
export function yamlToRouteForm(yaml: string): Partial<RouteFormValues> & { name: string } {
  const parsed = parseYaml(yaml) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    return { name: '' }
  }

  const matcher = Array.isArray(parsed.matchers) ? (parsed.matchers[0] as Record<string, unknown> | undefined) : undefined

  const hasUpstream = parsed.upstream && typeof parsed.upstream === 'object'
  const upstream = hasUpstream ? (parsed.upstream as Record<string, unknown>) : null

  return {
    name: (parsed.name as string) || '',
    enabled: parsed.enabled !== undefined ? Boolean(parsed.enabled) : true,
    hosts: (matcher?.hosts as string[]) ?? [],
    paths: (matcher?.paths as RouteFormValues['paths']) ?? [],
    methods: (matcher?.methods as RouteFormValues['methods']) ?? [],
    headers: (matcher?.headers as RouteFormValues['headers']) ?? [],
    targetType: upstream ? 'direct' : 'service',
    serviceId: upstream ? '' : ((parsed.serviceId as string) ?? ''),
    directAddress: upstream ? ((upstream.address as string) ?? '') : '',
    directTls: upstream ? ((upstream.tls as RouteFormValues['directTls']) ?? 'TLS_MODE_OFF') : 'TLS_MODE_OFF',
    policyIds: (parsed.policyIds as string[]) ?? [],
    labels: (parsed.labels as Record<string, string>) ?? {},
    forceTls: Boolean(parsed.forceTls),
    minTlsVersion: ((parsed.minTlsVersion as string) ?? '1.2') as RouteFormValues['minTlsVersion'],
    clientAuth: ((parsed.clientAuth as string) ?? 'off') as RouteFormValues['clientAuth'],
  }
}

// ---------------------------------------------------------------------------
// Service: form -> YAML
// ---------------------------------------------------------------------------

/** Convert service form values to a YAML string. */
export function serviceFormToYaml(values: ServiceFormValues): string {
  const doc: Record<string, unknown> = {
    name: values.name,
    lbPolicy: values.lbPolicy,
    upstreams: values.upstreams.map((u) => ({
      address: u.address,
      weight: u.weight,
      tls: u.tls,
    })),
  }

  // Health check -- only include if enabled
  if (values.activeHealthCheck.enabled) {
    doc.healthCheck = {
      enabled: true,
      path: values.activeHealthCheck.path,
      intervalSeconds: values.activeHealthCheck.intervalSeconds,
      timeoutSeconds: values.activeHealthCheck.timeoutSeconds,
      healthyThreshold: values.activeHealthCheck.healthyThreshold,
      unhealthyThreshold: values.activeHealthCheck.unhealthyThreshold,
      expectedStatuses: values.activeHealthCheck.expectedStatuses,
    }
  }

  // Labels -- only include if non-empty
  if (Object.keys(values.labels).length > 0) {
    doc.labels = values.labels
  }

  return stringifyYaml(doc, { indent: 2 })
}

// ---------------------------------------------------------------------------
// Service: YAML -> form
// ---------------------------------------------------------------------------

/** Parse a YAML string back to partial service form values. */
export function yamlToServiceForm(yaml: string): Partial<ServiceFormValues> & { name: string } {
  const parsed = parseYaml(yaml) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    return { name: '' }
  }

  const hc = parsed.healthCheck as Record<string, unknown> | undefined

  return {
    name: (parsed.name as string) || '',
    lbPolicy: (parsed.lbPolicy as ServiceFormValues['lbPolicy']) ?? 'LB_POLICY_ROUND_ROBIN',
    upstreams: Array.isArray(parsed.upstreams)
      ? (parsed.upstreams as Array<Record<string, unknown>>).map((u) => ({
          address: (u.address as string) || '',
          weight: (u.weight as number) ?? 1,
          tls: (u.tls as ServiceFormValues['upstreams'][number]['tls']) ?? 'TLS_MODE_OFF',
        }))
      : [{ address: '', weight: 1, tls: 'TLS_MODE_OFF' as const }],
    activeHealthCheck: hc
      ? {
          enabled: Boolean(hc.enabled),
          path: (hc.path as string) || '/health',
          intervalSeconds: (hc.intervalSeconds as number) || 10,
          timeoutSeconds: (hc.timeoutSeconds as number) || 5,
          healthyThreshold: (hc.healthyThreshold as number) || 2,
          unhealthyThreshold: (hc.unhealthyThreshold as number) || 3,
          expectedStatuses: (hc.expectedStatuses as number[]) || [200],
        }
      : undefined,
    labels: (parsed.labels as Record<string, string>) ?? {},
  }
}

// ---------------------------------------------------------------------------
// Policy: config -> YAML
// ---------------------------------------------------------------------------

/** Convert policy type + name + config to a YAML string. */
export function policyConfigToYaml(
  type: string,
  name: string,
  config: Record<string, unknown>,
): string {
  const doc = {
    type,
    name,
    config,
  }
  return stringifyYaml(doc, { indent: 2 })
}

// ---------------------------------------------------------------------------
// Policy: YAML -> config
// ---------------------------------------------------------------------------

/** Parse a YAML string back to policy type, name, and config. */
export function yamlToPolicyConfig(yaml: string): {
  type?: string
  name?: string
  config: Record<string, unknown>
} {
  const parsed = parseYaml(yaml) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    return { config: {} }
  }

  return {
    type: parsed.type as string | undefined,
    name: parsed.name as string | undefined,
    config: (parsed.config as Record<string, unknown>) ?? {},
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/web && source ~/.nvm/nvm.sh && npx vitest run src/lib/__tests__/form-yaml-sync.test.ts
```

All tests should pass.

- [ ] **Step 5: Commit**

```
feat(web): add form-to-YAML bidirectional conversion utilities

routeFormToYaml/yamlToRouteForm, serviceFormToYaml/yamlToServiceForm,
policyConfigToYaml/yamlToPolicyConfig with full test coverage. Enables
bidirectional sync between form mode and YAML editor mode.
```

---

## Task 5: Wire YamlJsonEditor into Route Create

**Files:**
- Modify: `packages/web/src/routes/config/routes.create.tsx`

This task replaces the "YamlJsonEditor placeholder" in code mode with the actual `YamlJsonEditor` component and adds bidirectional sync between form state and YAML content.

- [ ] **Step 1: Add imports**

At the top of `packages/web/src/routes/config/routes.create.tsx`, add these imports:

**Old (find this block):**
```typescript
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
```

**New (replace with):**
```typescript
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { YamlJsonEditor } from '@rioku/ui'
import { routeFormToYaml, yamlToRouteForm } from '@/lib/form-yaml-sync'
```

- [ ] **Step 2: Add YAML state variables**

Inside the `RouteCreatePage` function, after the `expandedSections` state, add:

**Old (find this line):**
```typescript
  const { isDirty } = useDirtyForm(EMPTY_FORM, formValues)
```

**New (insert before that line):**
```typescript
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')

  const { isDirty } = useDirtyForm(EMPTY_FORM, formValues)
```

- [ ] **Step 3: Add sync logic on mode toggle**

Replace the mode toggle buttons with a version that syncs on switch:

**Old:**
```typescript
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('form')}
        >
          {t('create.formMode')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('code')}
        >
          {t('create.codeMode')}
        </Button>
      </div>
```

**New:**
```typescript
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if (mode === 'code') {
              // YAML -> form sync
              const parsed = yamlToRouteForm(yamlContent)
              setFormValues((prev) => ({ ...prev, ...parsed }))
            }
            setMode('form')
          }}
        >
          {t('create.formMode')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if (mode === 'form') {
              // form -> YAML sync
              setYamlContent(routeFormToYaml(formValues))
            }
            setMode('code')
          }}
        >
          {t('create.codeMode')}
        </Button>
      </div>
```

- [ ] **Step 4: Replace the YAML placeholder with actual YamlJsonEditor**

**Old:**
```typescript
      ) : (
        /* YAML/JSON mode -- delegates to YamlJsonEditor from Phase 1 */
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              YAML/JSON mode uses the YamlJsonEditor component from Phase 1.
              Paste or edit route configuration in YAML or JSON format.
            </p>
            {/* <YamlJsonEditor value={...} onChange={...} schema={routeFormSchema} /> */}
            <div className="mt-4 rounded-md border p-8 text-center text-sm text-muted-foreground">
              YamlJsonEditor placeholder -- Phase 1 component required
            </div>
          </CardContent>
        </Card>
      )}
```

**New:**
```typescript
      ) : (
        /* YAML/JSON mode */
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              {t('create.codeDescription', 'Edit route configuration in YAML or JSON format. Changes sync back to the form when you switch modes.')}
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="400px"
              showDownload
              downloadFilename="route"
            />
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 5: Commit**

```
feat(web): wire YamlJsonEditor into route create page

Replace placeholder with actual YamlJsonEditor component. Form state
syncs to YAML when switching to code mode, and YAML parses back to
form state when switching to form mode.
```

---

## Task 6: Wire YamlJsonEditor into Route Detail (Edit Mode)

**Files:**
- Modify: `packages/web/src/routes/config/routes.$routeId.tsx`

This adds a YAML toggle in edit mode so users can switch between form and YAML views.

- [ ] **Step 1: Add imports**

At the top of `packages/web/src/routes/config/routes.$routeId.tsx`, add:

**Old (find this line):**
```typescript
import { EmptyState } from '@/components/rioku/empty-state'
```

**New (replace with):**
```typescript
import { EmptyState } from '@/components/rioku/empty-state'

import { YamlJsonEditor } from '@rioku/ui'
import { routeFormToYaml, yamlToRouteForm } from '@/lib/form-yaml-sync'
```

- [ ] **Step 2: Add state for YAML mode**

Inside `RouteDetailPage`, after the existing state declarations:

**Old (find this line):**
```typescript
  const initialValues = useMemo(() => routeToFormValues(route), [route])
```

**New (insert before that line):**
```typescript
  const [yamlMode, setYamlMode] = useState(false)
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')

  const initialValues = useMemo(() => routeToFormValues(route), [route])
```

- [ ] **Step 3: Add YAML toggle button in the edit mode header**

In the header section, add a YAML toggle when editing. Find this block:

**Old:**
```typescript
          {isEditing && (
            <>
              <Button variant="outline" onClick={cancelEditing}>
                <XIcon className="size-4" />
                {t('detail.cancelEdit')}
              </Button>
              <Button onClick={openReview} disabled={!isDirty || saveMutation.isPending}>
                <CheckIcon className="size-4" />
                {t('detail.reviewChanges')}
              </Button>
            </>
          )}
```

**New:**
```typescript
          {isEditing && (
            <>
              <Button
                variant={yamlMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!yamlMode) {
                    // form -> YAML
                    setYamlContent(routeFormToYaml(formValues))
                    setYamlMode(true)
                  } else {
                    // YAML -> form
                    const parsed = yamlToRouteForm(yamlContent)
                    setFormValues((prev) => ({ ...prev, ...parsed }))
                    setYamlMode(false)
                  }
                }}
              >
                {yamlMode ? t('detail.formMode', 'Form') : t('detail.yamlMode', 'YAML')}
              </Button>
              <Button variant="outline" onClick={() => { cancelEditing(); setYamlMode(false) }}>
                <XIcon className="size-4" />
                {t('detail.cancelEdit')}
              </Button>
              <Button onClick={openReview} disabled={!isDirty || saveMutation.isPending}>
                <CheckIcon className="size-4" />
                {t('detail.reviewChanges')}
              </Button>
            </>
          )}
```

- [ ] **Step 4: Add YAML editor view when in YAML mode**

After the Tabs opening tag and before the TabsList, add a conditional that replaces tabs content with a YAML editor when `yamlMode` is true:

**Old (find this block):**
```typescript
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
```

**New (replace with):**
```typescript
      {/* YAML mode replaces the tabs entirely */}
      {isEditing && yamlMode ? (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Edit the route configuration in YAML or JSON. Switch back to Form mode to use the structured editor.
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="500px"
              showDownload
              downloadFilename={route.name}
            />
          </CardContent>
        </Card>
      ) : (
      /* Tabs */
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
```

And close the conditional after the closing `</Tabs>`:

**Old (find this line):**
```typescript
      </Tabs>
```

**New (replace with):**
```typescript
      </Tabs>
      )}
```

Note: The YAML mode syncs form -> YAML when entering YAML mode and YAML -> form when exiting. Also ensure `cancelEditing` resets `yamlMode`.

- [ ] **Step 5: Update cancelEditing to reset YAML state**

**Old:**
```typescript
  function cancelEditing() {
    setFormValues(initialValues)
    setIsEditing(false)
  }
```

**New:**
```typescript
  function cancelEditing() {
    setFormValues(initialValues)
    setIsEditing(false)
    setYamlMode(false)
    setYamlContent('')
  }
```

- [ ] **Step 6: Sync YAML back to form before review**

Update `openReview` to sync YAML -> form if in YAML mode:

**Old:**
```typescript
  function openReview() {
    const validation = routeFormSchema.safeParse(formValues)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    setReviewOpen(true)
  }
```

**New:**
```typescript
  function openReview() {
    let valuesToValidate = formValues
    if (yamlMode) {
      const parsed = yamlToRouteForm(yamlContent)
      valuesToValidate = { ...formValues, ...parsed }
      setFormValues(valuesToValidate)
      setYamlMode(false)
    }
    const validation = routeFormSchema.safeParse(valuesToValidate)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    setReviewOpen(true)
  }
```

- [ ] **Step 7: Commit**

```
feat(web): wire YamlJsonEditor into route detail edit mode

Add YAML/Form toggle button in edit mode header. YAML editor
replaces the tab layout when active. Bidirectional sync occurs
on mode toggle and before review.
```

---

## Task 7: Wire YamlJsonEditor into Service Create + Service Detail

**Files:**
- Modify: `packages/web/src/routes/config/services.create.tsx`
- Modify: `packages/web/src/routes/config/services.$serviceId.tsx`

Same pattern as Tasks 5 and 6, applied to services.

- [ ] **Step 1: Service Create -- add imports**

At the top of `packages/web/src/routes/config/services.create.tsx`, add:

**Old (find this line):**
```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
```

**New (add after):**
```typescript

import { YamlJsonEditor } from '@rioku/ui'
import { serviceFormToYaml, yamlToServiceForm } from '@/lib/form-yaml-sync'
```

- [ ] **Step 2: Service Create -- add YAML state**

Inside `ServiceCreatePage`, after the `expandedSections` state:

**Old:**
```typescript
  const { isDirty } = useDirtyForm(EMPTY_FORM, formValues)
```

**New (insert before):**
```typescript
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')

  const { isDirty } = useDirtyForm(EMPTY_FORM, formValues)
```

- [ ] **Step 3: Service Create -- update mode toggle with sync**

**Old:**
```typescript
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('form')}
        >
          {t('create.formMode')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('code')}
        >
          {t('create.codeMode')}
        </Button>
      </div>
```

**New:**
```typescript
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if (mode === 'code') {
              const parsed = yamlToServiceForm(yamlContent)
              setFormValues((prev) => ({ ...prev, ...parsed }))
            }
            setMode('form')
          }}
        >
          {t('create.formMode')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if (mode === 'form') {
              setYamlContent(serviceFormToYaml(formValues))
            }
            setMode('code')
          }}
        >
          {t('create.codeMode')}
        </Button>
      </div>
```

- [ ] **Step 4: Service Create -- replace YAML placeholder**

**Old:**
```typescript
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              YAML/JSON mode uses the YamlJsonEditor component from Phase 1.
            </p>
            <div className="mt-4 rounded-md border p-8 text-center text-sm text-muted-foreground">
              YamlJsonEditor placeholder -- Phase 1 component required
            </div>
          </CardContent>
        </Card>
```

**New:**
```typescript
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              {t('create.codeDescription', 'Edit service configuration in YAML or JSON format. Changes sync back to the form when you switch modes.')}
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="400px"
              showDownload
              downloadFilename="service"
            />
          </CardContent>
        </Card>
```

- [ ] **Step 5: Service Detail -- add imports**

At the top of `packages/web/src/routes/config/services.$serviceId.tsx`, add after existing imports:

**Old (find this line):**
```typescript
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'
```

**New (replace with):**
```typescript
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'

import { YamlJsonEditor } from '@rioku/ui'
import { serviceFormToYaml, yamlToServiceForm } from '@/lib/form-yaml-sync'
```

- [ ] **Step 6: Service Detail -- add YAML state**

Inside `ServiceDetailPage`, after the `reviewOpen` state:

**Old:**
```typescript
  const initialValues = useMemo(() => serviceToFormValues(service), [service])
```

**New (insert before):**
```typescript
  const [yamlMode, setYamlMode] = useState(false)
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')

  const initialValues = useMemo(() => serviceToFormValues(service), [service])
```

- [ ] **Step 7: Service Detail -- add YAML toggle button in edit mode header**

**Old:**
```typescript
          {!isEditing ? (
            <Button variant="outline" onClick={startEditing}>
              <PencilIcon className="size-4" />
              {t('detail.editSection')}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={cancelEditing}>
                <XIcon className="size-4" />
                {t('detail.cancelEdit')}
              </Button>
              <Button onClick={openReview} disabled={!isDirty || saveMutation.isPending}>
                <CheckIcon className="size-4" />
                {t('detail.reviewChanges')}
              </Button>
            </>
          )}
```

**New:**
```typescript
          {!isEditing ? (
            <Button variant="outline" onClick={startEditing}>
              <PencilIcon className="size-4" />
              {t('detail.editSection')}
            </Button>
          ) : (
            <>
              <Button
                variant={yamlMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!yamlMode) {
                    setYamlContent(serviceFormToYaml(formValues))
                    setYamlMode(true)
                  } else {
                    const parsed = yamlToServiceForm(yamlContent)
                    setFormValues((prev) => ({ ...prev, ...parsed }))
                    setYamlMode(false)
                  }
                }}
              >
                {yamlMode ? t('detail.formMode', 'Form') : t('detail.yamlMode', 'YAML')}
              </Button>
              <Button variant="outline" onClick={() => { cancelEditing(); setYamlMode(false) }}>
                <XIcon className="size-4" />
                {t('detail.cancelEdit')}
              </Button>
              <Button onClick={openReview} disabled={!isDirty || saveMutation.isPending}>
                <CheckIcon className="size-4" />
                {t('detail.reviewChanges')}
              </Button>
            </>
          )}
```

- [ ] **Step 8: Service Detail -- add YAML editor view**

Wrap the `<Tabs>` block with a conditional like in route detail:

**Old (find this line):**
```typescript
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
```

**New (replace with):**
```typescript
      {isEditing && yamlMode ? (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Edit the service configuration in YAML or JSON. Switch back to Form mode to use the structured editor.
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="500px"
              showDownload
              downloadFilename={service.name}
            />
          </CardContent>
        </Card>
      ) : (
      <Tabs value={activeTab} onValueChange={setActiveTab}>
```

And close after `</Tabs>`:

**Old:**
```typescript
      </Tabs>
```

**New:**
```typescript
      </Tabs>
      )}
```

- [ ] **Step 9: Service Detail -- update cancelEditing and openReview**

**Old:**
```typescript
  function cancelEditing() {
    setFormValues(initialValues)
    setIsEditing(false)
  }
```

**New:**
```typescript
  function cancelEditing() {
    setFormValues(initialValues)
    setIsEditing(false)
    setYamlMode(false)
    setYamlContent('')
  }
```

**Old:**
```typescript
  function openReview() {
    const validation = serviceFormSchema.safeParse(formValues)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    setReviewOpen(true)
  }
```

**New:**
```typescript
  function openReview() {
    let valuesToValidate = formValues
    if (yamlMode) {
      const parsed = yamlToServiceForm(yamlContent)
      valuesToValidate = { ...formValues, ...parsed }
      setFormValues(valuesToValidate)
      setYamlMode(false)
    }
    const validation = serviceFormSchema.safeParse(valuesToValidate)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    setReviewOpen(true)
  }
```

- [ ] **Step 10: Commit**

```
feat(web): wire YamlJsonEditor into service create and detail pages

Service create replaces placeholder with real YamlJsonEditor.
Service detail gains YAML toggle in edit mode with bidirectional
form/YAML sync on mode switch and before review.
```

---

## Task 8: Wire YamlJsonEditor into Policy Create + Policy Detail

**Files:**
- Modify: `packages/web/src/routes/config/policies.create.tsx`
- Modify: `packages/web/src/routes/config/policies.$policyId.tsx`

Policy pages have a different structure (type selector + config form) so the YAML integration is adapted.

- [ ] **Step 1: Policy Create -- add imports and mode state**

At the top of `packages/web/src/routes/config/policies.create.tsx`, add:

**Old (find this line):**
```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
```

**New (replace with):**
```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { YamlJsonEditor } from '@rioku/ui'
import { policyConfigToYaml, yamlToPolicyConfig } from '@/lib/form-yaml-sync'
```

- [ ] **Step 2: Policy Create -- add mode state and YAML state**

Inside `PolicyCreatePage`, after the `errors` state:

**Old (find this line):**
```typescript
  const [errors, setErrors] = useState<Record<string, string>>({})
```

**New (add after):**
```typescript

  const [mode, setMode] = useState<'form' | 'code'>('form')
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')
```

- [ ] **Step 3: Policy Create -- add mode toggle after the title**

**Old (find this block):**
```typescript
        <h1 className="text-2xl font-semibold tracking-tight">{t('create.title')}</h1>
      </div>

      {/* Name */}
```

**New (replace with):**
```typescript
        <h1 className="text-2xl font-semibold tracking-tight">{t('create.title')}</h1>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if (mode === 'code') {
              const parsed = yamlToPolicyConfig(yamlContent)
              if (parsed.type) setSelectedType(parsed.type)
              if (parsed.name) setName(parsed.name)
              setConfig(parsed.config)
            }
            setMode('form')
          }}
        >
          {t('create.formMode', 'Form')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if (mode === 'form' && selectedType) {
              setYamlContent(policyConfigToYaml(selectedType, name, config))
            }
            setMode('code')
          }}
        >
          {t('create.codeMode', 'YAML')}
        </Button>
      </div>

      {/* Name */}
```

- [ ] **Step 4: Policy Create -- wrap form sections in mode conditional, add YAML editor**

Wrap the Name card, Type selector card, and Type-specific form card in a `mode === 'form'` conditional, and add a YAML editor for code mode.

**Old (find the entire block from `{/* Name */}` to `{/* Actions */}`):**
```typescript
      {/* Name */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label htmlFor="policy-name">{t('create.policyName')}</Label>
            <Input
              id="policy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.policyNamePlaceholder')}
            />
          </div>
        </CardContent>
      </Card>

      {/* Type selector */}
      <Card>
        <CardHeader>
          <CardTitle>{t('create.selectType')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('create.selectTypeDesc')}</p>
        </CardHeader>
        <CardContent>
          <TypeSelectorTiles
            options={TYPE_OPTIONS}
            value={selectedType}
            onChange={setSelectedType}
          />
        </CardContent>
      </Card>

      {/* Type-specific form */}
      {selectedType && (
        <Card>
          <CardHeader>
            <CardTitle>{t('create.configuration')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PolicyFormForType
              type={selectedType}
              value={config}
              onChange={setConfig}
              errors={errors}
            />
          </CardContent>
        </Card>
      )}
```

**New (replace with):**
```typescript
      {mode === 'form' ? (
        <>
          {/* Name */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <Label htmlFor="policy-name">{t('create.policyName')}</Label>
                <Input
                  id="policy-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('create.policyNamePlaceholder')}
                />
              </div>
            </CardContent>
          </Card>

          {/* Type selector */}
          <Card>
            <CardHeader>
              <CardTitle>{t('create.selectType')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('create.selectTypeDesc')}</p>
            </CardHeader>
            <CardContent>
              <TypeSelectorTiles
                options={TYPE_OPTIONS}
                value={selectedType}
                onChange={setSelectedType}
              />
            </CardContent>
          </Card>

          {/* Type-specific form */}
          {selectedType && (
            <Card>
              <CardHeader>
                <CardTitle>{t('create.configuration')}</CardTitle>
              </CardHeader>
              <CardContent>
                <PolicyFormForType
                  type={selectedType}
                  value={config}
                  onChange={setConfig}
                  errors={errors}
                />
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Edit the policy configuration in YAML or JSON format. The type, name, and config fields are all editable.
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="400px"
              showDownload
              downloadFilename="policy"
            />
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 5: Policy Detail -- add imports**

At the top of `packages/web/src/routes/config/policies.$policyId.tsx`, add:

**Old (find this line):**
```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
```

**New (replace with):**
```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { YamlJsonEditor } from '@rioku/ui'
import { policyConfigToYaml, yamlToPolicyConfig } from '@/lib/form-yaml-sync'
```

- [ ] **Step 6: Policy Detail -- add YAML state**

Inside `PolicyDetailPage`, after the `activeTab` state:

**Old:**
```typescript
  const [activeTab, setActiveTab] = useState('config')
```

**New:**
```typescript
  const [activeTab, setActiveTab] = useState('config')
  const [yamlMode, setYamlMode] = useState(false)
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')
```

- [ ] **Step 7: Policy Detail -- add YAML toggle in config tab header**

In the configuration tab's CardHeader, add a YAML toggle alongside the edit button:

**Old:**
```typescript
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(true)}
                    >
                      <PencilIcon className="size-4" />
                      {t('detail.editConfig')}
                    </Button>
                  )}
```

**New:**
```typescript
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setYamlContent(policyConfigToYaml(policy.type, policy.name, policy.config))
                          setYamlMode(true)
                          setEditing(true)
                        }}
                      >
                        <CodeIcon className="size-4" />
                        YAML
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(true)}
                      >
                        <PencilIcon className="size-4" />
                        {t('detail.editConfig')}
                      </Button>
                    </>
                  )}
```

Note: `CodeIcon` is already imported at the top of the file.

- [ ] **Step 8: Policy Detail -- show YAML editor when yamlMode is active**

In the configuration tab's CardContent, conditionally show YAML editor:

**Old:**
```typescript
            <CardContent>
              <ConfigReadView config={policy.config} />
            </CardContent>
```

**New:**
```typescript
            <CardContent>
              {editing && yamlMode ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Edit the policy configuration in YAML or JSON format.
                  </p>
                  <YamlJsonEditor
                    value={yamlContent}
                    onChange={setYamlContent}
                    format={yamlFormat}
                    onFormatChange={setYamlFormat}
                    height="400px"
                    showDownload
                    downloadFilename={policy.name}
                  />
                </div>
              ) : (
                <ConfigReadView config={policy.config} />
              )}
            </CardContent>
```

- [ ] **Step 9: Policy Detail -- update save to handle YAML mode**

Update the save button's onClick to sync YAML before saving:

**Old:**
```typescript
                      <Button
                        size="sm"
                        disabled={saveMutation.isPending}
                        onClick={() => {
                          saveMutation.mutate({
                            policy: {
                              action: 'UPSERT',
                              policy: { id: policy.id, config: policy.config },
                            },
                          })
                        }}
                      >
                        {t('detail.saveConfig')}
                      </Button>
```

**New:**
```typescript
                      <Button
                        size="sm"
                        disabled={saveMutation.isPending}
                        onClick={() => {
                          let configToSave = policy.config
                          if (yamlMode) {
                            const parsed = yamlToPolicyConfig(yamlContent)
                            configToSave = parsed.config
                          }
                          saveMutation.mutate({
                            policy: {
                              action: 'UPSERT',
                              policy: { id: policy.id, config: configToSave },
                            },
                          })
                          setYamlMode(false)
                        }}
                      >
                        {t('detail.saveConfig')}
                      </Button>
```

- [ ] **Step 10: Policy Detail -- update cancel to reset YAML state**

**Old:**
```typescript
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(false)}
                      >
                        {t('detail.cancelEdit')}
                      </Button>
```

**New:**
```typescript
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setEditing(false); setYamlMode(false); setYamlContent('') }}
                      >
                        {t('detail.cancelEdit')}
                      </Button>
```

- [ ] **Step 11: Commit**

```
feat(web): wire YamlJsonEditor into policy create and detail pages

Policy create gains Form/YAML mode toggle for editing type, name,
and config as YAML. Policy detail gains YAML button in config tab
with bidirectional sync on save.
```

---

## Task 9: Wire SearchableSelect into Service Selectors

**Files:**
- Modify: `packages/web/src/routes/config/routes.create.tsx`
- Modify: `packages/web/src/routes/config/routes.$routeId.tsx`
- Modify: `packages/web/src/routes/config/services.create.tsx`
- Modify: `packages/web/src/routes/config/services.$serviceId.tsx`

Replace plain `<Select>` for service selection and LB policy with `SearchableSelect`.

- [ ] **Step 1: Route Create -- add SearchableSelect import**

In `packages/web/src/routes/config/routes.create.tsx`, the `YamlJsonEditor` import from `@rioku/ui` already exists from Task 5. Expand it:

**Old:**
```typescript
import { YamlJsonEditor } from '@rioku/ui'
```

**New:**
```typescript
import { YamlJsonEditor, SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

- [ ] **Step 2: Route Create -- replace service Select with SearchableSelect**

**Old:**
```typescript
                  <div className="space-y-2">
                    <Label>
                      {t('form.targetService')} <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={formValues.serviceId}
                      onValueChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val ?? '' }))
                      }
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select a service" /></SelectTrigger>
                      <SelectContent>
                        {services.map((svc: Service) => (
                          <SelectItem key={svc.id} value={svc.id}>
                            {svc.name} ({svc.upstreams.length} upstreams)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
```

**New:**
```typescript
                  <div className="space-y-2">
                    <Label>
                      {t('form.targetService')} <span className="text-destructive">*</span>
                    </Label>
                    <SearchableSelect
                      options={services.map((svc: Service): SelectOption => ({
                        value: svc.id,
                        label: svc.name,
                        description: `${svc.upstreams.length} upstream${svc.upstreams.length !== 1 ? 's' : ''} - ${svc.lbPolicy.replace('LB_POLICY_', '').toLowerCase().replace(/_/g, ' ')}`,
                        badge: `${svc.upstreams.length}`,
                      }))}
                      value={formValues.serviceId}
                      onChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val }))
                      }
                      placeholder={t('form.selectService', 'Search services...')}
                    />
                  </div>
```

- [ ] **Step 3: Route Detail -- add SearchableSelect import**

In `packages/web/src/routes/config/routes.$routeId.tsx`:

**Old:**
```typescript
import { YamlJsonEditor } from '@rioku/ui'
```

**New:**
```typescript
import { YamlJsonEditor, SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

- [ ] **Step 4: Route Detail -- replace service Select in edit mode**

In the overview tab's service target editing section:

**Old:**
```typescript
                  {isEditing ? (
                    <Select
                      value={formValues.serviceId}
                      onValueChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val ?? '' }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a service" />
                      </SelectTrigger>
                      <SelectContent>
                        {services.map((svc: Service) => (
                          <SelectItem key={svc.id} value={svc.id}>
                            {svc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
```

**New:**
```typescript
                  {isEditing ? (
                    <SearchableSelect
                      options={services.map((svc: Service): SelectOption => ({
                        value: svc.id,
                        label: svc.name,
                        description: `${svc.upstreams.length} upstream${svc.upstreams.length !== 1 ? 's' : ''}`,
                        badge: `${svc.upstreams.length}`,
                      }))}
                      value={formValues.serviceId}
                      onChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val }))
                      }
                      placeholder="Search services..."
                    />
```

- [ ] **Step 5: Service Create -- add SearchableSelect import and replace LB Policy Select**

In `packages/web/src/routes/config/services.create.tsx`:

**Old:**
```typescript
import { YamlJsonEditor } from '@rioku/ui'
```

**New:**
```typescript
import { YamlJsonEditor, SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

Replace the LB Policy Select in the General section:

**Old:**
```typescript
                <div className="space-y-2">
                  <Label>{t('form.lbPolicy')}</Label>
                  <Select
                    value={formValues.lbPolicy}
                    onValueChange={(val) =>
                      setFormValues((prev) => ({ ...prev, lbPolicy: val as ServiceFormValues['lbPolicy'] }))
                    }
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(LB_POLICY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
```

**New:**
```typescript
                <div className="space-y-2">
                  <Label>{t('form.lbPolicy')}</Label>
                  <SearchableSelect
                    options={Object.entries(LB_POLICY_LABELS).map(([value, label]): SelectOption => ({
                      value,
                      label,
                    }))}
                    value={formValues.lbPolicy}
                    onChange={(val) =>
                      setFormValues((prev) => ({ ...prev, lbPolicy: val as ServiceFormValues['lbPolicy'] }))
                    }
                    placeholder={t('form.selectLbPolicy', 'Search load balancing policies...')}
                  />
                </div>
```

- [ ] **Step 6: Service Detail -- add SearchableSelect import and replace LB Policy Select**

In `packages/web/src/routes/config/services.$serviceId.tsx`:

**Old:**
```typescript
import { YamlJsonEditor } from '@rioku/ui'
```

**New:**
```typescript
import { YamlJsonEditor, SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

Replace the LB policy Select in the overview tab's edit mode:

**Old:**
```typescript
                    {isEditing ? (
                      <Select
                        value={formValues.lbPolicy}
                        onValueChange={(val) =>
                          setFormValues((prev) => ({ ...prev, lbPolicy: val as ServiceFormValues['lbPolicy'] }))
                        }
                      >
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(LB_POLICY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
```

**New:**
```typescript
                    {isEditing ? (
                      <SearchableSelect
                        options={Object.entries(LB_POLICY_LABELS).map(([value, label]): SelectOption => ({
                          value,
                          label,
                        }))}
                        value={formValues.lbPolicy}
                        onChange={(val) =>
                          setFormValues((prev) => ({ ...prev, lbPolicy: val as ServiceFormValues['lbPolicy'] }))
                        }
                        placeholder="Search policies..."
                      />
```

- [ ] **Step 7: Commit**

```
feat(web): replace plain selects with SearchableSelect

Route create/detail use SearchableSelect for service picker with
upstream count badges. Service create/detail use SearchableSelect
for LB policy picker.
```

---

## Task 10: Wire SearchableMultiSelect into Policy Selectors

**Files:**
- Modify: `packages/web/src/routes/config/routes.create.tsx`
- Modify: `packages/web/src/routes/config/routes.$routeId.tsx`
- Modify: `packages/web/src/routes/config/policies.$policyId.tsx`

Replace policy placeholders/badges with `SearchableMultiSelect`.

- [ ] **Step 1: Route Create -- add SearchableMultiSelect import**

In `packages/web/src/routes/config/routes.create.tsx`:

**Old:**
```typescript
import { YamlJsonEditor, SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

**New:**
```typescript
import { YamlJsonEditor, SearchableSelect, SearchableMultiSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

- [ ] **Step 2: Route Create -- replace policies section content**

**Old:**
```typescript
            {expandedSections.policies && (
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t('policies.attachedDescription')}
                </p>
                {/* Placeholder -- SearchableMultiSelect from Phase 1 goes here */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {formValues.policyIds.map((pid) => {
                    const policy = policies.find((p: Policy) => p.id === pid)
                    return (
                      <Badge key={pid} variant="secondary" className="gap-1">
                        {policy?.name ?? pid}
                        <button
                          onClick={() =>
                            setFormValues((prev) => ({
                              ...prev,
                              policyIds: prev.policyIds.filter((id) => id !== pid),
                            }))
                          }
                          className="ml-1"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              </CardContent>
            )}
```

**New:**
```typescript
            {expandedSections.policies && (
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  {t('policies.attachedDescription')}
                </p>
                <SearchableMultiSelect
                  options={policies.map((p: Policy): SelectOption => ({
                    value: p.id,
                    label: p.name,
                    description: p.type.replace('POLICY_TYPE_', '').toLowerCase().replace(/_/g, ' '),
                    badge: p.type.replace('POLICY_TYPE_', '').replace(/_/g, ' '),
                  }))}
                  value={formValues.policyIds}
                  onChange={(ids) =>
                    setFormValues((prev) => ({ ...prev, policyIds: ids }))
                  }
                  placeholder={t('policies.searchPolicies', 'Search policies...')}
                />
              </CardContent>
            )}
```

- [ ] **Step 3: Route Detail -- add SearchableMultiSelect import**

In `packages/web/src/routes/config/routes.$routeId.tsx`:

**Old:**
```typescript
import { YamlJsonEditor, SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

**New:**
```typescript
import { YamlJsonEditor, SearchableSelect, SearchableMultiSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

- [ ] **Step 4: Route Detail -- replace policies tab content**

**Old:**
```typescript
        {/* --- Policies Tab --- */}
        <TabsContent value="policies">
          <Card>
            <CardHeader>
              <CardTitle>{t('policies.attached')}</CardTitle>
            </CardHeader>
            <CardContent>
              {(route.policyIds ?? []).length > 0 ? (
                <div className="space-y-2">
                  {(route.policyIds ?? []).map((pid) => (
                    <div key={pid} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <span className="font-mono text-sm">{getPolicyName(pid)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{pid}</span>
                      </div>
                      {isEditing && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            setFormValues((prev) => ({
                              ...prev,
                              policyIds: prev.policyIds.filter((id) => id !== pid),
                            }))
                          }
                        >
                          {t('policies.detach')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={t('policies.noPolicies')}
                  description={t('policies.noPoliciesDescription')}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
```

**New:**
```typescript
        {/* --- Policies Tab --- */}
        <TabsContent value="policies">
          <Card>
            <CardHeader>
              <CardTitle>{t('policies.attached')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t('policies.attachedDescription', 'Select policies to attach to this route.')}</p>
                  <SearchableMultiSelect
                    options={policies.map((p: Policy): SelectOption => ({
                      value: p.id,
                      label: p.name,
                      description: p.type.replace('POLICY_TYPE_', '').toLowerCase().replace(/_/g, ' '),
                      badge: p.type.replace('POLICY_TYPE_', '').replace(/_/g, ' '),
                    }))}
                    value={formValues.policyIds}
                    onChange={(ids) =>
                      setFormValues((prev) => ({ ...prev, policyIds: ids }))
                    }
                    placeholder="Search policies..."
                  />
                </div>
              ) : (route.policyIds ?? []).length > 0 ? (
                <div className="space-y-2">
                  {(route.policyIds ?? []).map((pid) => (
                    <div key={pid} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <span className="font-mono text-sm">{getPolicyName(pid)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{pid}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={t('policies.noPolicies')}
                  description={t('policies.noPoliciesDescription')}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
```

- [ ] **Step 5: Policy Detail -- add SearchableMultiSelect for route attachment**

In `packages/web/src/routes/config/policies.$policyId.tsx`, add import:

**Old:**
```typescript
import { YamlJsonEditor } from '@rioku/ui'
```

**New:**
```typescript
import { YamlJsonEditor, SearchableMultiSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
```

Then in the Attached Routes tab, add a SearchableMultiSelect when editing to allow attaching new routes:

**Old (the DataTable in the routes tab):**
```typescript
        <TabsContent value="routes">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.attachedRoutes')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
```

**New (add a note above the DataTable):**
```typescript
        <TabsContent value="routes">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.attachedRoutes')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Routes that reference this policy. To attach/detach, edit the route directly.
                  </p>
                </div>
              )}
              <DataTable
```

- [ ] **Step 6: Commit**

```
feat(web): wire SearchableMultiSelect into policy selectors

Route create and detail use SearchableMultiSelect for policy
attachment with type badges. Policy detail shows attached routes
as a read-only DataTable with guidance text in edit mode.
```

---

## Task 11: Wire KeyValueEditor into Labels Sections

**Files:**
- Modify: `packages/web/src/routes/config/routes.create.tsx`
- Modify: `packages/web/src/routes/config/routes.$routeId.tsx`
- Modify: `packages/web/src/routes/config/services.create.tsx`
- Modify: `packages/web/src/routes/config/services.$serviceId.tsx`

Replace label placeholders and add labels editing to pages that don't have it yet.

The `KvEditor` component uses `KvPair[]` (array of `{key, value}`) but form state uses `Record<string, string>`. Helper functions convert between them.

- [ ] **Step 1: Create labels conversion helpers**

In `packages/web/src/lib/form-yaml-sync.ts`, add at the bottom (or create a small utility -- here we add to the existing file):

Add to the end of `packages/web/src/lib/form-yaml-sync.ts`:

```typescript
// ---------------------------------------------------------------------------
// Labels: Record<string, string> <-> KvPair[]
// ---------------------------------------------------------------------------

export interface KvPair { key: string; value: string }

/** Convert a labels record to an array of KvPairs. */
export function labelsToKvPairs(labels: Record<string, string>): KvPair[] {
  return Object.entries(labels).map(([key, value]) => ({ key, value }))
}

/** Convert KvPairs back to a labels record. Ignores pairs with empty keys. */
export function kvPairsToLabels(pairs: KvPair[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of pairs) {
    if (pair.key.trim()) {
      result[pair.key.trim()] = pair.value
    }
  }
  return result
}
```

- [ ] **Step 2: Route Create -- add labels section**

In `packages/web/src/routes/config/routes.create.tsx`, add import:

**Old (find this line, it should already be there from Task 5):**
```typescript
import { routeFormToYaml, yamlToRouteForm } from '@/lib/form-yaml-sync'
```

**New:**
```typescript
import { routeFormToYaml, yamlToRouteForm, labelsToKvPairs, kvPairsToLabels } from '@/lib/form-yaml-sync'
```

Also add:
```typescript
import { KvEditor } from '@/components/rioku/kv-editor'
```

In the `expandedSections` initial state, add a `labels` section:

**Old:**
```typescript
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basics: true,
    matching: true,
    target: true,
    policies: false,
    tls: false,
    advanced: false,
  })
```

**New:**
```typescript
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basics: true,
    matching: true,
    target: true,
    policies: false,
    labels: false,
    tls: false,
    advanced: false,
  })
```

Add a new Labels card section before the TLS section (after the Policies card's closing `</Card>`):

Insert before `{/* TLS section (collapsed, NEEDS BACKEND) */}`:

```typescript
          {/* Labels section */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('labels')}
            >
              <CardTitle className="text-base">{t('create.sectionLabels', 'Labels')}</CardTitle>
            </CardHeader>
            {expandedSections.labels && (
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  {t('labels.description', 'Key-value labels for organizing and filtering routes.')}
                </p>
                <KvEditor
                  value={labelsToKvPairs(formValues.labels)}
                  onChange={(pairs) =>
                    setFormValues((prev) => ({ ...prev, labels: kvPairsToLabels(pairs) }))
                  }
                  keyPlaceholder="Label key"
                  valuePlaceholder="Label value"
                />
              </CardContent>
            )}
          </Card>

```

- [ ] **Step 3: Route Detail -- add labels section in overview tab**

In `packages/web/src/routes/config/routes.$routeId.tsx`, add imports:

**Old:**
```typescript
import { routeFormToYaml, yamlToRouteForm } from '@/lib/form-yaml-sync'
```

**New:**
```typescript
import { routeFormToYaml, yamlToRouteForm, labelsToKvPairs, kvPairsToLabels } from '@/lib/form-yaml-sync'
import { KvEditor } from '@/components/rioku/kv-editor'
```

In the overview tab, after the metadata sidebar Card (still inside `TabsContent value="overview"`), add a labels card:

Find the closing of the overview TabsContent:
```typescript
        </TabsContent>

        {/* --- Matching Tab --- */}
```

Insert before that `</TabsContent>`:

```typescript
          {/* Labels */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-sm">Labels</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <KvEditor
                  value={labelsToKvPairs(formValues.labels)}
                  onChange={(pairs) =>
                    setFormValues((prev) => ({ ...prev, labels: kvPairsToLabels(pairs) }))
                  }
                  keyPlaceholder="Label key"
                  valuePlaceholder="Label value"
                />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(route.labels ?? {}).map(([k, v]) => (
                    <Badge key={k} variant="outline">
                      <span className="font-mono text-xs">{k}</span>
                      <span className="mx-1 text-muted-foreground">=</span>
                      <span className="font-mono text-xs">{v}</span>
                    </Badge>
                  ))}
                  {Object.keys(route.labels ?? {}).length === 0 && (
                    <span className="text-sm text-muted-foreground">No labels</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
```

- [ ] **Step 4: Service Create -- replace KeyValueEditor placeholder**

In `packages/web/src/routes/config/services.create.tsx`, add imports:

**Old:**
```typescript
import { serviceFormToYaml, yamlToServiceForm } from '@/lib/form-yaml-sync'
```

**New:**
```typescript
import { serviceFormToYaml, yamlToServiceForm, labelsToKvPairs, kvPairsToLabels } from '@/lib/form-yaml-sync'
import { KvEditor } from '@/components/rioku/kv-editor'
```

Replace the labels placeholder:

**Old:**
```typescript
            {expandedSections.labels && (
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Key-value labels for organizing and filtering services.
                </p>
                {/* TagInput / KeyValueEditor from Phase 1 goes here */}
                <div className="mt-2 rounded-md border p-4 text-center text-sm text-muted-foreground">
                  KeyValueEditor placeholder -- Phase 1 component required
                </div>
              </CardContent>
            )}
```

**New:**
```typescript
            {expandedSections.labels && (
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Key-value labels for organizing and filtering services.
                </p>
                <KvEditor
                  value={labelsToKvPairs(formValues.labels)}
                  onChange={(pairs) =>
                    setFormValues((prev) => ({ ...prev, labels: kvPairsToLabels(pairs) }))
                  }
                  keyPlaceholder="Label key"
                  valuePlaceholder="Label value"
                />
              </CardContent>
            )}
```

- [ ] **Step 5: Service Detail -- add labels in overview tab**

In `packages/web/src/routes/config/services.$serviceId.tsx`, add imports:

**Old:**
```typescript
import { serviceFormToYaml, yamlToServiceForm } from '@/lib/form-yaml-sync'
```

**New:**
```typescript
import { serviceFormToYaml, yamlToServiceForm, labelsToKvPairs, kvPairsToLabels } from '@/lib/form-yaml-sync'
import { KvEditor } from '@/components/rioku/kv-editor'
```

In the overview tab, after the metadata sidebar, add a labels card. Find:

```typescript
        </TabsContent>

        {/* --- Health Checks Tab --- */}
```

Insert before that `</TabsContent>`:

```typescript
          {/* Labels */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-sm">Labels</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <KvEditor
                  value={labelsToKvPairs(formValues.labels)}
                  onChange={(pairs) =>
                    setFormValues((prev) => ({ ...prev, labels: kvPairsToLabels(pairs) }))
                  }
                  keyPlaceholder="Label key"
                  valuePlaceholder="Label value"
                />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(service.labels ?? {}).map(([k, v]) => (
                    <Badge key={k} variant="outline">
                      <span className="font-mono text-xs">{k}</span>
                      <span className="mx-1 text-muted-foreground">=</span>
                      <span className="font-mono text-xs">{v}</span>
                    </Badge>
                  ))}
                  {Object.keys(service.labels ?? {}).length === 0 && (
                    <span className="text-sm text-muted-foreground">No labels</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
```

Note: The Service API type does not expose `labels` directly, but the form values and payload support it. The mock data includes labels on services now. If the `Service` type in `api.ts` does not have a `labels` field, it may need to be accessed from the form values or added. Since `serviceToFormValues` already handles `labels`, this should work through the form values path. In read mode, use `(service as Record<string, unknown>).labels` or check if the API type needs updating. If the `Service` type in `api.ts` is missing a `labels` field, add `labels?: Record<string, string> | null` to the `Service` interface.

- [ ] **Step 6: Ensure Service type has labels field**

Check `packages/web/src/lib/api.ts` - the `Service` interface. If it does NOT have `labels`, add it:

In `packages/web/src/lib/api.ts`, the `Service` interface:

**Old:**
```typescript
export interface Service {
  id: string
  name: string
  upstreams: Upstream[]
  lbPolicy: string
  healthCheck: HealthCheck | null
  createdAt: string
  updatedAt: string
}
```

**New:**
```typescript
export interface Service {
  id: string
  name: string
  upstreams: Upstream[]
  lbPolicy: string
  healthCheck: HealthCheck | null
  labels: Record<string, string> | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 7: Add labels conversion helper tests**

In `packages/web/src/lib/__tests__/form-yaml-sync.test.ts`, add at the end:

```typescript
describe('labelsToKvPairs', () => {
  it('converts labels record to KvPair array', () => {
    const { labelsToKvPairs } = await import('../form-yaml-sync')
    const pairs = labelsToKvPairs({ env: 'prod', team: 'platform' })
    expect(pairs).toEqual([
      { key: 'env', value: 'prod' },
      { key: 'team', value: 'platform' },
    ])
  })
})

describe('kvPairsToLabels', () => {
  it('converts KvPair array to labels record', () => {
    const { kvPairsToLabels } = await import('../form-yaml-sync')
    const labels = kvPairsToLabels([
      { key: 'env', value: 'prod' },
      { key: 'team', value: 'platform' },
    ])
    expect(labels).toEqual({ env: 'prod', team: 'platform' })
  })

  it('ignores pairs with empty keys', () => {
    const { kvPairsToLabels } = await import('../form-yaml-sync')
    const labels = kvPairsToLabels([
      { key: '', value: 'ignored' },
      { key: 'valid', value: 'kept' },
      { key: '  ', value: 'also-ignored' },
    ])
    expect(labels).toEqual({ valid: 'kept' })
  })
})
```

**Important:** Since the tests already use static imports at the top, these new tests should also use static imports. Replace the `await import` pattern with:

```typescript
import {
  routeFormToYaml,
  yamlToRouteForm,
  serviceFormToYaml,
  yamlToServiceForm,
  policyConfigToYaml,
  yamlToPolicyConfig,
  labelsToKvPairs,
  kvPairsToLabels,
} from '../form-yaml-sync'
```

And the new test blocks:

```typescript
describe('labelsToKvPairs', () => {
  it('converts labels record to KvPair array', () => {
    const pairs = labelsToKvPairs({ env: 'prod', team: 'platform' })
    expect(pairs).toEqual([
      { key: 'env', value: 'prod' },
      { key: 'team', value: 'platform' },
    ])
  })
})

describe('kvPairsToLabels', () => {
  it('converts KvPair array to labels record', () => {
    const labels = kvPairsToLabels([
      { key: 'env', value: 'prod' },
      { key: 'team', value: 'platform' },
    ])
    expect(labels).toEqual({ env: 'prod', team: 'platform' })
  })

  it('ignores pairs with empty keys', () => {
    const labels = kvPairsToLabels([
      { key: '', value: 'ignored' },
      { key: 'valid', value: 'kept' },
      { key: '  ', value: 'also-ignored' },
    ])
    expect(labels).toEqual({ valid: 'kept' })
  })
})
```

- [ ] **Step 8: Commit**

```
feat(web): wire KeyValueEditor into labels sections

Route create/detail, service create/detail all use KvEditor for
label editing with labelsToKvPairs/kvPairsToLabels conversion.
Add labels field to Service API type.
```

---

## Task 12: Final Verification

**Files:** No new files. This task runs verification commands.

- [ ] **Step 1: Run the form-yaml-sync test suite**

```bash
cd packages/web && source ~/.nvm/nvm.sh && npx vitest run src/lib/__tests__/form-yaml-sync.test.ts
```

All tests must pass.

- [ ] **Step 2: Run the full test suite**

```bash
cd packages/web && source ~/.nvm/nvm.sh && npx vitest run
```

All tests must pass. If any existing tests fail due to the `Service` type change (added `labels` field), update mock data in those test files to include `labels: null`.

- [ ] **Step 3: Run TypeScript check**

```bash
cd packages/web && source ~/.nvm/nvm.sh && npx tsc --noEmit
```

Must complete with zero errors.

- [ ] **Step 4: Run vite build**

```bash
cd packages/web && source ~/.nvm/nvm.sh && npx vite build
```

Must complete successfully. Build output goes to `build/`.

- [ ] **Step 5: Verify MSW mock mode**

```bash
cd packages/web && source ~/.nvm/nvm.sh && VITE_MOCK=true npx vite --open
```

The admin panel should load with full mock data. Navigate through:
- Dashboard (health, traffic)
- Config > Routes (list, create, detail with YAML toggle)
- Config > Services (list, create, detail with YAML toggle)
- Config > Policies (list, create with YAML toggle, detail with YAML toggle)
- Verify SearchableSelect works for service picker
- Verify SearchableMultiSelect works for policy picker
- Verify KvEditor works for labels
- Verify bidirectional form/YAML sync works

Shut down the dev server when done.

- [ ] **Step 6: Commit (if any fixes were needed)**

If Step 1-4 required any fixes, commit them:

```
fix(web): address verification issues from Phase A integration
```

- [ ] **Step 7: Final summary commit (if no fixes needed, skip this)**

No additional commit needed if all verifications passed cleanly.
