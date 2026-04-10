# Admin Panel Phase 3: Policies & Security/RBAC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the Policies & Security/RBAC phase of the admin panel overhaul (spec Section 9, Section 11). Replace all slide-out sheets and modal-based editing with full-page detail views, structured forms, and the redesigned RBAC model.

**Spec reference:** `docs/superpowers/specs/2026-04-10-admin-panel-overhaul-v2.md` -- Sections 9, 11, 5, 6.

**Depends on:**
- Phase 1 (layout shell, sidebar, command palette, themed checkboxes, toast system) -- MUST be complete
- Phase 2 (detail page pattern, DataTable enhancements, SearchableSelect, SearchableMultiSelect, YamlJsonEditor, FormSection, inline editing, YAML/form bidirectional sync) -- MUST be complete

**Architecture:** All pages follow the full-page detail view pattern (spec Section 5.1). Entity names are clickable links that navigate to `/config/policies/:id`, `/security/users/:id`, etc. Editing is inline on the detail view (spec Section 5.2). Create flows are full pages at `/:section/create`. All user-facing strings go through react-i18next. Tests use Vitest + React Testing Library.

**Tech stack:** React 19, TanStack Router, TanStack Query, react-hook-form + zod, react-i18next, dnd-kit (role hierarchy drag-drop), sonner (toasts), lucide-react (icons), shadcn/ui primitives.

**Test approach:** TDD -- write tests first for each component/page, then implement. Unit tests for form validation logic, component rendering, and user interactions. Integration tests for data flow (API mock -> component -> user action -> mutation). All tests in `__tests__/` directories co-located with source.

---

## Priority Order

Ranked by: dependency chain (components first, then pages that consume them) and user impact.

| Priority | Deliverable | New/Modified files | Backend status |
|----------|------------|-------------------|---------------|
| 1 | Policy list page overhaul | 3 files | FRONTEND ONLY |
| 2 | Policy detail page (tabbed, inline edit) | 5 files | FRONTEND ONLY |
| 3 | Policy create page (type tiles, structured forms) | 6 files | FRONTEND ONLY |
| 4 | Users list + detail page | 7 files | Partial -- expanded user model NEEDS BACKEND |
| 5 | Roles list + detail page (permissions, hierarchy, members) | 6 files | NEEDS BACKEND -- role hierarchy, granular permissions |
| 6 | Access policies page | 5 files | NEEDS BACKEND -- access policy entity |
| 7 | API keys detail page | 4 files | Partial -- usage stats NEEDS BACKEND |
| 8 | Effective permissions panel | 3 files | FRONTEND ONLY (client-side computation) |

---

## File Structure

### New files to create

```
packages/web/src/routes/config/policies.index.tsx          -- Policy list (replaces policies.tsx)
packages/web/src/routes/config/policies.$policyId.tsx      -- Policy detail (full-page, tabbed)
packages/web/src/routes/config/policies.create.tsx         -- Policy create (full-page)
packages/web/src/components/rioku/policy-forms/            -- Directory for type-specific forms
packages/web/src/components/rioku/policy-forms/rate-limit-form.tsx
packages/web/src/components/rioku/policy-forms/auth-jwt-form.tsx
packages/web/src/components/rioku/policy-forms/auth-api-key-form.tsx
packages/web/src/components/rioku/policy-forms/cors-form.tsx
packages/web/src/components/rioku/policy-forms/transform-form.tsx
packages/web/src/components/rioku/policy-forms/circuit-breaker-form.tsx
packages/web/src/components/rioku/policy-forms/cache-form.tsx
packages/web/src/components/rioku/policy-forms/retry-form.tsx
packages/web/src/components/rioku/policy-forms/index.ts    -- Re-export + type->component map
packages/web/src/components/rioku/policy-forms/__tests__/rate-limit-form.test.tsx
packages/web/src/components/rioku/policy-forms/__tests__/cors-form.test.tsx
packages/web/src/components/rioku/policy-forms/__tests__/policy-form-registry.test.ts
packages/web/src/routes/config/__tests__/policies-list.test.tsx
packages/web/src/routes/config/__tests__/policy-detail.test.tsx
packages/web/src/routes/config/__tests__/policy-create.test.tsx
packages/web/src/lib/schemas/policy-schemas.ts             -- Zod schemas for all 8 policy types
packages/web/src/lib/schemas/__tests__/policy-schemas.test.ts

packages/web/src/routes/security/index.tsx                 -- Security section layout
packages/web/src/routes/security/users.index.tsx           -- Users list
packages/web/src/routes/security/users.$userId.tsx         -- User detail (full-page)
packages/web/src/routes/security/roles.index.tsx           -- Roles list
packages/web/src/routes/security/roles.$roleId.tsx         -- Role detail (full-page, tabbed)
packages/web/src/routes/security/access-policies.index.tsx -- Access policies list
packages/web/src/routes/security/access-policies.$policyId.tsx -- Access policy detail
packages/web/src/routes/security/access-policies.create.tsx   -- Access policy create
packages/web/src/routes/security/api-keys.index.tsx        -- API keys list
packages/web/src/routes/security/api-keys.$keyId.tsx       -- API key detail (tabbed)
packages/web/src/routes/security/audit.tsx                 -- Audit log (relocated)
packages/web/src/routes/security/__tests__/users-list.test.tsx
packages/web/src/routes/security/__tests__/user-detail.test.tsx
packages/web/src/routes/security/__tests__/roles-list.test.tsx
packages/web/src/routes/security/__tests__/role-detail.test.tsx
packages/web/src/routes/security/__tests__/access-policies.test.tsx
packages/web/src/routes/security/__tests__/api-key-detail.test.tsx

packages/web/src/components/rioku/effective-permissions.tsx -- Effective permissions panel
packages/web/src/components/rioku/__tests__/effective-permissions.test.tsx
packages/web/src/components/rioku/role-hierarchy-tree.tsx   -- DAG tree with drag-drop
packages/web/src/components/rioku/__tests__/role-hierarchy-tree.test.tsx
packages/web/src/components/rioku/permission-rule-editor.tsx -- Inline rule add/edit/delete
packages/web/src/components/rioku/__tests__/permission-rule-editor.test.tsx
packages/web/src/components/rioku/condition-editor.tsx      -- Access policy condition builder
packages/web/src/components/rioku/__tests__/condition-editor.test.tsx
packages/web/src/components/rioku/type-selector-tiles.tsx   -- Tile grid for policy type selection
packages/web/src/components/rioku/__tests__/type-selector-tiles.test.tsx
packages/web/src/components/rioku/duration-input.tsx        -- Number + unit selector (ms/s/m/h)
packages/web/src/components/rioku/__tests__/duration-input.test.tsx
packages/web/src/components/rioku/tag-input.tsx             -- Tag input with add/remove badges
packages/web/src/components/rioku/__tests__/tag-input.test.tsx
packages/web/src/components/rioku/kv-editor.tsx             -- Dynamic key-value pair row editor
packages/web/src/components/rioku/__tests__/kv-editor.test.tsx

packages/web/src/lib/schemas/user-schemas.ts               -- Zod schemas for user forms
packages/web/src/lib/schemas/role-schemas.ts               -- Zod schemas for role/permission forms
packages/web/src/lib/schemas/access-policy-schemas.ts      -- Zod schemas for access policies
packages/web/src/lib/schemas/api-key-schemas.ts            -- Zod schemas for API key forms
packages/web/src/lib/permissions.ts                        -- Effective permissions computation
packages/web/src/lib/__tests__/permissions.test.ts

packages/web/src/locales/en/users.json                     -- i18n namespace for users/roles
packages/web/src/locales/en/access-policies.json           -- i18n namespace for access policies
packages/web/src/locales/en/api-keys.json                  -- i18n namespace for API keys
```

### Existing files to modify

```
packages/web/src/routes/config/policies.tsx               -- Replaced by policies.index.tsx (delete or redirect)
packages/web/src/routes/settings/users.tsx                 -- Replaced by security/users.index.tsx (delete or redirect)
packages/web/src/routes/settings/roles.tsx                 -- Replaced by security/roles.index.tsx (delete or redirect)
packages/web/src/routes/security.tsx                       -- Replaced by security/api-keys.index.tsx (delete or redirect)
packages/web/src/lib/api.ts                               -- Add expanded types: ExpandedUser, PermissionRule, AccessPolicy, RoleHierarchy, etc.
packages/web/src/components/layout/app-sidebar.tsx         -- Update nav for new SECURITY section routes
packages/web/src/locales/en/security.json                  -- Expand with new strings
packages/web/src/locales/en/policies.json                  -- Expand with type-specific form strings
```

---

## Task 1: Policy List Page Overhaul

**Files:**
- Create: `packages/web/src/routes/config/policies.index.tsx`
- Create: `packages/web/src/routes/config/__tests__/policies-list.test.tsx`
- Modify: `packages/web/src/locales/en/policies.json`

Replaces the current `policies.tsx` page. Converts from sheet-based create/edit to full-page navigation pattern. Entity name is a clickable link to `/config/policies/:id`.

- [ ] **Step 1: Write policy list page tests**

Create `packages/web/src/routes/config/__tests__/policies-list.test.tsx`. Tests needed:

```typescript
// packages/web/src/routes/config/__tests__/policies-list.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// Test wrapper that provides QueryClient, Router, i18n

describe('PoliciesListPage', () => {
  it('renders policy names as clickable links to detail view')
  it('renders type badges with correct colors for each policy type')
  it('renders attached route count for each policy')
  it('shows hover actions (edit, more menu) on row hover')
  it('navigates to /config/policies/create when Create button clicked')
  it('navigates to /config/policies/:id when policy name clicked')
  it('shows delete confirmation dialog from more menu')
  it('shows empty state with create action when no policies exist')
  it('filters policies by search text')
  it('sorts policies by name and updated date columns')
})
```

- [ ] **Step 2: Implement policy list page**

Create `packages/web/src/routes/config/policies.index.tsx`:

```typescript
// packages/web/src/routes/config/policies.index.tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  PlusIcon, PencilIcon, TrashIcon, ShieldIcon, MoreHorizontalIcon,
} from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Policy, Route as RouteType } from '@/lib/api'
import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/config/policies/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: PolicyListPage,
})

const POLICY_TYPES: Record<string, string> = {
  POLICY_TYPE_RATE_LIMIT: 'Rate Limit',
  POLICY_TYPE_AUTH_API_KEY: 'API Key Auth',
  POLICY_TYPE_AUTHENTICATION: 'Authentication',
  POLICY_TYPE_CORS: 'CORS',
  POLICY_TYPE_CIRCUIT_BREAKER: 'Circuit Breaker',
  POLICY_TYPE_RETRY: 'Retry',
  POLICY_TYPE_CACHE: 'Cache',
  POLICY_TYPE_TRANSFORM: 'Transform',
}

const policyTypeColors: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  POLICY_TYPE_RATE_LIMIT: 'default',
  POLICY_TYPE_AUTHENTICATION: 'secondary',
  POLICY_TYPE_CORS: 'outline',
  POLICY_TYPE_CIRCUIT_BREAKER: 'destructive',
  POLICY_TYPE_RETRY: 'secondary',
  POLICY_TYPE_CACHE: 'outline',
  POLICY_TYPE_TRANSFORM: 'default',
}

function PolicyListPage() {
  const { t } = useTranslation('policies')
  // ... state for deleteTarget
  // DataTable with:
  //   - name column: <Link to={`/config/policies/${r.id}`}> styled as primary link
  //   - type column: Badge with policyTypeColors
  //   - attached routes count
  //   - updated: TimeAgo
  //   - hover actions: edit (navigates to detail), more menu (delete)
  // PageHeader with "Create policy" button -> navigates to /config/policies/create
  // ConfirmDialog for delete
  // EmptyState when no policies
}
```

Key differences from current `policies.tsx`:
- **No Sheet component** -- no slide-out panel
- **Policy name is a `<Link>`** to `/config/policies/:id` (primary color, hover underline)
- **Create button navigates** to `/config/policies/create` instead of opening sheet
- **Edit action navigates** to `/config/policies/:id` instead of opening sheet
- **Delete remains as ConfirmDialog** (destructive action stays modal)

- [ ] **Step 3: Update i18n strings**

Add to `packages/web/src/locales/en/policies.json`:
```json
{
  "list": {
    "noRoutes": "No routes",
    "routeCount": "{{count}} route",
    "routeCount_plural": "{{count}} routes"
  },
  "detail": {
    "backToList": "Back to policies",
    "configuration": "Configuration",
    "attachedRoutes": "Attached routes",
    "activity": "Activity"
  },
  "create": {
    "title": "Create policy",
    "selectType": "Select policy type",
    "selectTypeDesc": "Choose the type of policy you want to create."
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/web && npx vitest run src/routes/config/__tests__/policies-list.test.tsx
```

- [ ] **Step 5: Delete old policies.tsx**

Remove `packages/web/src/routes/config/policies.tsx` once the new route is wired and passing.

---

## Task 2: Policy Detail Page (Full-Page, Tabbed)

**Files:**
- Create: `packages/web/src/routes/config/policies.$policyId.tsx`
- Create: `packages/web/src/routes/config/__tests__/policy-detail.test.tsx`
- Modify: `packages/web/src/lib/api.ts` -- add single-policy loader if needed

Full-page detail view with three tabs: Configuration, Attached Routes, Activity.

- [ ] **Step 1: Write policy detail tests**

Create `packages/web/src/routes/config/__tests__/policy-detail.test.tsx`:

```typescript
describe('PolicyDetailPage', () => {
  it('renders policy name in header with back link to /config/policies')
  it('renders type badge next to policy name')
  it('renders Configuration tab as default active tab')
  it('renders Attached Routes tab showing linked routes')
  it('renders Activity tab with change history (placeholder with feature flag)')
  it('shows inline edit mode when Edit button clicked on Configuration tab')
  it('shows Save/Cancel buttons in edit mode')
  it('validates form with zod schema before save')
  it('shows toast on successful save')
  it('shows Code toggle button in edit mode toolbar')
  it('switches to YAML/JSON editor when Code toggle clicked')
  it('syncs YAML changes back to form fields (bidirectional)')
  it('deep-links to tabs via URL param ?tab=routes')
  it('shows delete in danger zone at bottom')
})
```

- [ ] **Step 2: Implement policy detail page**

Create `packages/web/src/routes/config/policies.$policyId.tsx`:

```typescript
// packages/web/src/routes/config/policies.$policyId.tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeftIcon, PencilIcon, CodeIcon, TrashIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Policy, Route as RouteType } from '@/lib/api'
import { policySchemaFor } from '@/lib/schemas/policy-schemas'

import { PageHeader } from '@/components/rioku/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
// Import type-specific form from registry:
import { PolicyFormForType } from '@/components/rioku/policy-forms'
// Import YamlJsonEditor from Phase 2:
// import { YamlJsonEditor } from '@/components/rioku/yaml-json-editor'

export const Route = createFileRoute('/config/policies/$policyId')({
  loader: async ({ context, params }) => {
    const config = await context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    })
    const policy = config.policies.find((p) => p.id === params.policyId)
    if (!policy) throw new Error('Policy not found')
    return { policy, routes: config.routes }
  },
  component: PolicyDetailPage,
})

function PolicyDetailPage() {
  const { t } = useTranslation('policies')
  const { policy, routes } = Route.useLoaderData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Tab state from URL: ?tab=config|routes|activity
  // const [searchParams, setSearchParams] = useSearchParams()
  // const activeTab = searchParams.get('tab') ?? 'config'

  // Edit mode state
  // const [editing, setEditing] = useState(false)
  // const [codeMode, setCodeMode] = useState(false)

  // Configuration tab:
  //   Read mode: display config fields as labeled values in a Card
  //   Edit mode: render PolicyFormForType with the policy type
  //   Code mode: render YamlJsonEditor with bidirectional sync

  // Attached Routes tab:
  //   Filter routes where r.policyIds includes this policy's id
  //   DataTable with route name (link), host, path, status

  // Activity tab:
  //   Feature-flagged (features.entityActivity). Show ComingSoon placeholder
  //   or timestamped change log entries

  // Danger zone card at bottom:
  //   Delete button -> ConfirmDialog -> mutation -> navigate back to list

  return null // Implementation follows the pattern above
}
```

The Configuration tab in **read mode** renders the policy's config as a descriptive card -- field labels and values derived from the policy type. For example, a Rate Limit policy shows "Requests per window: 100/minute", "Scope: per IP", etc.

In **edit mode**, the `PolicyFormForType` component renders the type-specific structured form (built in Task 3). A "Code" toggle switches to the `YamlJsonEditor` (from Phase 2).

- [ ] **Step 3: Run tests**

```bash
cd packages/web && npx vitest run src/routes/config/__tests__/policy-detail.test.tsx
```

---

## Task 3: Policy Create Page + Structured Forms for All 8 Types

**Files:**
- Create: `packages/web/src/routes/config/policies.create.tsx`
- Create: `packages/web/src/routes/config/__tests__/policy-create.test.tsx`
- Create: `packages/web/src/lib/schemas/policy-schemas.ts`
- Create: `packages/web/src/lib/schemas/__tests__/policy-schemas.test.ts`
- Create: `packages/web/src/components/rioku/type-selector-tiles.tsx`
- Create: `packages/web/src/components/rioku/__tests__/type-selector-tiles.test.tsx`
- Create: `packages/web/src/components/rioku/duration-input.tsx`
- Create: `packages/web/src/components/rioku/__tests__/duration-input.test.tsx`
- Create: `packages/web/src/components/rioku/tag-input.tsx`
- Create: `packages/web/src/components/rioku/__tests__/tag-input.test.tsx`
- Create: `packages/web/src/components/rioku/kv-editor.tsx`
- Create: `packages/web/src/components/rioku/__tests__/kv-editor.test.tsx`
- Create: All 8 policy form files + index in `packages/web/src/components/rioku/policy-forms/`
- Create: `packages/web/src/components/rioku/policy-forms/__tests__/rate-limit-form.test.tsx`
- Create: `packages/web/src/components/rioku/policy-forms/__tests__/cors-form.test.tsx`
- Create: `packages/web/src/components/rioku/policy-forms/__tests__/policy-form-registry.test.ts`

This is the largest task. It builds the reusable form primitives (DurationInput, TagInput, KvEditor, TypeSelectorTiles), the Zod schemas for all 8 policy types, the type-specific form components, and the create page.

- [ ] **Step 1: Write Zod schema tests**

Create `packages/web/src/lib/schemas/__tests__/policy-schemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  rateLimitSchema,
  authJwtSchema,
  authApiKeySchema,
  corsSchema,
  transformSchema,
  circuitBreakerSchema,
  cacheSchema,
  retrySchema,
  policySchemaFor,
} from '../policy-schemas'

describe('policy schemas', () => {
  describe('rateLimitSchema', () => {
    it('validates a complete rate limit config', () => {
      const result = rateLimitSchema.safeParse({
        requestsPerWindow: 100,
        windowUnit: 'minute',
        scope: 'per_ip',
        burstAllowance: 10,
        responseWhenLimited: '429',
      })
      expect(result.success).toBe(true)
    })
    it('rejects missing requestsPerWindow', () => {
      const result = rateLimitSchema.safeParse({ windowUnit: 'minute', scope: 'per_ip' })
      expect(result.success).toBe(false)
    })
    it('validates token-aware fields when tokenAware is true', () => {
      const result = rateLimitSchema.safeParse({
        requestsPerWindow: 100,
        windowUnit: 'minute',
        scope: 'per_ip',
        tokenAware: true,
        inputTokenLimit: 10000,
        outputTokenLimit: 50000,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('corsSchema', () => {
    it('validates a complete CORS config')
    it('rejects empty allowedOrigins')
    it('accepts wildcard origin')
  })

  describe('policySchemaFor', () => {
    it('returns rateLimitSchema for POLICY_TYPE_RATE_LIMIT')
    it('returns authJwtSchema for POLICY_TYPE_AUTHENTICATION')
    it('returns corsSchema for POLICY_TYPE_CORS')
    it('throws for unknown policy type')
  })
})
```

- [ ] **Step 2: Implement Zod schemas**

Create `packages/web/src/lib/schemas/policy-schemas.ts`:

```typescript
import { z } from 'zod'

// --- Rate Limit ---
export const rateLimitSchema = z.object({
  requestsPerWindow: z.number().int().positive(),
  windowUnit: z.enum(['second', 'minute', 'hour', 'day']),
  scope: z.enum(['per_ip', 'per_api_key', 'per_agent', 'per_route', 'global']),
  tokenAware: z.boolean().optional().default(false),
  inputTokenLimit: z.number().int().positive().optional(),
  outputTokenLimit: z.number().int().positive().optional(),
  totalTokenLimit: z.number().int().positive().optional(),
  costAware: z.boolean().optional().default(false),
  dailyBudgetUsd: z.number().positive().optional(),
  burstAllowance: z.number().int().nonnegative().optional(),
  responseWhenLimited: z.enum(['429', '503', 'drop']).default('429'),
})

// --- Auth JWT ---
export const authJwtSchema = z.object({
  issuerUrl: z.string().url(),
  jwksEndpoint: z.string().url().optional(),
  audience: z.string().min(1),
  requiredClaims: z.record(z.string()).optional(),
  tokenLocation: z.enum(['header', 'cookie', 'query']).default('header'),
  clockSkewTolerance: z.string().optional(), // duration string e.g. "30s"
})

// --- Auth API Key ---
export const authApiKeySchema = z.object({
  headerName: z.string().default('X-API-Key'),
  queryParamName: z.string().optional(),
  prefix: z.string().optional(),
})

// --- CORS ---
export const corsSchema = z.object({
  allowedOrigins: z.array(z.string()).min(1),
  allowedMethods: z.array(z.string()).min(1),
  allowedHeaders: z.array(z.string()).optional(),
  exposedHeaders: z.array(z.string()).optional(),
  maxAge: z.string().optional(), // duration string
  allowCredentials: z.boolean().default(false),
})

// --- Transform ---
export const transformSchema = z.object({
  requestHeaders: z.array(z.object({
    action: z.enum(['set', 'add', 'delete', 'replace']),
    name: z.string().min(1),
    value: z.string().optional(),
  })).optional(),
  responseHeaders: z.array(z.object({
    action: z.enum(['set', 'add', 'delete', 'replace']),
    name: z.string().min(1),
    value: z.string().optional(),
  })).optional(),
  pathRewrite: z.object({
    stripPrefix: z.string().optional(),
    addPrefix: z.string().optional(),
  }).optional(),
  queryOperations: z.array(z.object({
    action: z.enum(['add', 'remove', 'set']),
    key: z.string().min(1),
    value: z.string().optional(),
  })).optional(),
})

// --- Circuit Breaker ---
export const circuitBreakerSchema = z.object({
  failureThreshold: z.number().int().positive(),
  successThreshold: z.number().int().positive(),
  timeout: z.string().min(1), // duration string e.g. "30s"
  maxRequestsHalfOpen: z.number().int().positive().optional(),
  monitoredStatusCodes: z.array(z.number().int()).optional(),
})

// --- Cache ---
export const cacheSchema = z.object({
  defaultMaxAge: z.string().min(1), // duration string
  cacheableStatusCodes: z.array(z.number().int()).default([200, 301, 302]),
  cacheableMethods: z.array(z.string()).default(['GET', 'HEAD']),
  maxBodySize: z.number().int().positive().optional(),
  maxBodySizeUnit: z.enum(['KB', 'MB']).optional(),
  varyHeaders: z.array(z.string()).optional(),
  staleWhileRevalidate: z.string().optional(), // duration string
})

// --- Retry ---
export const retrySchema = z.object({
  maxAttempts: z.number().int().positive(),
  retryOnStatusCodes: z.array(z.number().int()).default([502, 503, 504]),
  backoffStrategy: z.enum(['none', 'constant', 'exponential']).default('none'),
  initialBackoff: z.string().optional(), // duration string
  maxBackoff: z.string().optional(), // duration string
})

// Registry: policy type string -> zod schema
const SCHEMA_MAP: Record<string, z.ZodType> = {
  POLICY_TYPE_RATE_LIMIT: rateLimitSchema,
  POLICY_TYPE_AUTHENTICATION: authJwtSchema,
  POLICY_TYPE_AUTH_API_KEY: authApiKeySchema,
  POLICY_TYPE_CORS: corsSchema,
  POLICY_TYPE_TRANSFORM: transformSchema,
  POLICY_TYPE_CIRCUIT_BREAKER: circuitBreakerSchema,
  POLICY_TYPE_CACHE: cacheSchema,
  POLICY_TYPE_RETRY: retrySchema,
}

export function policySchemaFor(type: string): z.ZodType {
  const schema = SCHEMA_MAP[type]
  if (!schema) throw new Error(`Unknown policy type: ${type}`)
  return schema
}
```

- [ ] **Step 3: Write reusable component tests**

Create tests for the small reusable form primitives needed by policy forms:

**`packages/web/src/components/rioku/__tests__/type-selector-tiles.test.tsx`:**
```typescript
describe('TypeSelectorTiles', () => {
  it('renders a tile for each option with icon, title, description')
  it('highlights the selected tile with primary border')
  it('calls onChange when a tile is clicked')
  it('supports keyboard navigation (arrow keys + Enter)')
  it('applies aria-selected to the active tile')
})
```

**`packages/web/src/components/rioku/__tests__/duration-input.test.tsx`:**
```typescript
describe('DurationInput', () => {
  it('renders number input and unit selector')
  it('defaults to seconds when no unit provided')
  it('calls onChange with combined duration string (e.g. "30s")')
  it('parses initial value string into number and unit')
  it('validates non-negative numbers only')
  it('supports ms, s, m, h units')
})
```

**`packages/web/src/components/rioku/__tests__/tag-input.test.tsx`:**
```typescript
describe('TagInput', () => {
  it('renders existing tags as removable badges')
  it('adds a tag when Enter pressed in input')
  it('removes a tag when X button clicked')
  it('prevents duplicate tags')
  it('calls onChange with updated tag array')
  it('clears input after adding a tag')
  it('supports comma-separated paste to add multiple tags')
})
```

**`packages/web/src/components/rioku/__tests__/kv-editor.test.tsx`:**
```typescript
describe('KvEditor', () => {
  it('renders existing key-value pairs as rows')
  it('adds a new empty row when Add button clicked')
  it('removes a row when delete button clicked')
  it('calls onChange with updated key-value record')
  it('validates that keys are non-empty')
})
```

- [ ] **Step 4: Implement reusable form components**

**`packages/web/src/components/rioku/type-selector-tiles.tsx`:**

```typescript
import { cn } from '@/lib/utils'

interface TileOption {
  value: string
  label: string
  description: string
  icon: React.ReactNode
}

interface TypeSelectorTilesProps {
  options: TileOption[]
  value: string | null
  onChange: (value: string) => void
}

export function TypeSelectorTiles({ options, value, onChange }: TypeSelectorTilesProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
            'hover:border-primary/50 hover:bg-accent',
            value === opt.value && 'border-primary bg-primary/5',
          )}
        >
          <span className="text-muted-foreground">{opt.icon}</span>
          <span className="text-sm font-medium">{opt.label}</span>
          <span className="text-xs text-muted-foreground">{opt.description}</span>
        </button>
      ))}
    </div>
  )
}
```

**`packages/web/src/components/rioku/duration-input.tsx`:**

```typescript
import { useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const UNITS = [
  { value: 'ms', label: 'ms' },
  { value: 's', label: 'sec' },
  { value: 'm', label: 'min' },
  { value: 'h', label: 'hr' },
] as const

type DurationUnit = typeof UNITS[number]['value']

interface DurationInputProps {
  value: string         // e.g. "30s", "100ms"
  onChange: (value: string) => void
  id?: string
  placeholder?: string
}

function parseDuration(raw: string): { num: number; unit: DurationUnit } {
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/)
  if (!match) return { num: 0, unit: 's' }
  return { num: parseFloat(match[1]), unit: match[2] as DurationUnit }
}

export function DurationInput({ value, onChange, id, placeholder }: DurationInputProps) {
  const parsed = parseDuration(value)
  const [num, setNum] = useState(parsed.num)
  const [unit, setUnit] = useState<DurationUnit>(parsed.unit)

  const emit = useCallback((n: number, u: DurationUnit) => {
    onChange(`${n}${u}`)
  }, [onChange])

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min={0}
        value={num}
        onChange={(e) => {
          const n = parseFloat(e.target.value) || 0
          setNum(n)
          emit(n, unit)
        }}
        placeholder={placeholder}
        className="w-24"
      />
      <Select value={unit} onValueChange={(v) => { setUnit(v as DurationUnit); emit(num, v as DurationUnit) }}>
        <SelectTrigger className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

**`packages/web/src/components/rioku/tag-input.tsx`:**

```typescript
import { useState, type KeyboardEvent } from 'react'
import { XIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  id?: string
}

export function TagInput({ value, onChange, placeholder, id }: TagInputProps) {
  const [input, setInput] = useState('')

  function addTag(tag: string) {
    const trimmed = tag.trim()
    if (!trimmed || value.includes(trimmed)) return
    onChange([...value, trimmed])
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(input)
      setInput('')
    }
    if (e.key === 'Backspace' && input === '' && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text')
    if (text.includes(',')) {
      e.preventDefault()
      const tags = text.split(',').map((t) => t.trim()).filter(Boolean)
      const unique = [...new Set([...value, ...tags])]
      onChange(unique)
      setInput('')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="ml-0.5 rounded-full hover:bg-destructive/20"
            aria-label={`Remove ${tag}`}
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <Input
        id={id}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 border-0 p-0 shadow-none focus-visible:ring-0 min-w-[80px]"
      />
    </div>
  )
}
```

**`packages/web/src/components/rioku/kv-editor.tsx`:**

```typescript
import { PlusIcon, TrashIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface KvPair { key: string; value: string }

interface KvEditorProps {
  value: KvPair[]
  onChange: (pairs: KvPair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

export function KvEditor({ value, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value' }: KvEditorProps) {
  function addRow() {
    onChange([...value, { key: '', value: '' }])
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: 'key' | 'value', val: string) {
    const updated = value.map((pair, i) =>
      i === index ? { ...pair, [field]: val } : pair,
    )
    onChange(updated)
  }

  return (
    <div className="space-y-2">
      {value.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={pair.key}
            onChange={(e) => updateRow(i, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            className="flex-1"
          />
          <Input
            value={pair.value}
            onChange={(e) => updateRow(i, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            className="flex-1"
          />
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeRow(i)}>
            <TrashIcon className="size-4" />
            <span className="sr-only">Remove row</span>
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <PlusIcon className="size-4" />
        Add
      </Button>
    </div>
  )
}
```

- [ ] **Step 5: Write policy form component tests**

**`packages/web/src/components/rioku/policy-forms/__tests__/rate-limit-form.test.tsx`:**
```typescript
describe('RateLimitForm', () => {
  it('renders requests per window number input')
  it('renders window unit selector with second/minute/hour/day')
  it('renders scope SearchableSelect with per IP, per API key, etc.')
  it('shows token-aware fields when token-aware toggle enabled')
  it('hides token fields when toggle disabled')
  it('shows cost-aware fields when cost-aware toggle enabled')
  it('renders burst allowance number input')
  it('renders response selector with 429, 503, drop options')
  it('calls onChange with valid rateLimitSchema data')
  it('shows validation errors for missing required fields')
})
```

**`packages/web/src/components/rioku/policy-forms/__tests__/cors-form.test.tsx`:**
```typescript
describe('CorsForm', () => {
  it('renders allowed origins TagInput')
  it('renders allowed methods multiselect')
  it('renders allowed headers TagInput')
  it('renders exposed headers TagInput')
  it('renders max age DurationInput')
  it('renders allow credentials toggle')
  it('calls onChange with valid corsSchema data')
})
```

**`packages/web/src/components/rioku/policy-forms/__tests__/policy-form-registry.test.ts`:**
```typescript
describe('PolicyFormForType', () => {
  it('returns RateLimitForm for POLICY_TYPE_RATE_LIMIT')
  it('returns AuthJwtForm for POLICY_TYPE_AUTHENTICATION')
  it('returns AuthApiKeyForm for POLICY_TYPE_AUTH_API_KEY')
  it('returns CorsForm for POLICY_TYPE_CORS')
  it('returns TransformForm for POLICY_TYPE_TRANSFORM')
  it('returns CircuitBreakerForm for POLICY_TYPE_CIRCUIT_BREAKER')
  it('returns CacheForm for POLICY_TYPE_CACHE')
  it('returns RetryForm for POLICY_TYPE_RETRY')
  it('returns null or fallback for unknown type')
})
```

- [ ] **Step 6: Implement all 8 policy form components**

Each form component follows this interface:

```typescript
// packages/web/src/components/rioku/policy-forms/index.ts
import type { z } from 'zod'

export interface PolicyFormProps {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  errors?: Record<string, string>
  readOnly?: boolean
}
```

Each form uses the primitives (DurationInput, TagInput, KvEditor, SearchableSelect, Toggle, Input, Select) to render its type-specific fields as defined in spec Section 9.2. The forms receive current config values via `value` and emit changes via `onChange`. When `readOnly` is true, all inputs are disabled (used in detail view read mode).

**Rate Limit form fields (spec Section 9.2):**
- `requestsPerWindow` -- number input + `windowUnit` selector (per second/minute/hour/day)
- `scope` -- SearchableSelect: per IP, per API key, per agent, per route, global
- `tokenAware` -- toggle; when enabled shows `inputTokenLimit`, `outputTokenLimit`, `totalTokenLimit` number inputs
- `costAware` -- toggle; when enabled shows `dailyBudgetUsd` number input
- `burstAllowance` -- number input
- `responseWhenLimited` -- native select: 429 with Retry-After, 503, drop connection

**Auth JWT form fields:**
- `issuerUrl` -- text input (URL)
- `jwksEndpoint` -- text input (URL), auto-populated hint from issuer
- `audience` -- text input
- `requiredClaims` -- KvEditor
- `tokenLocation` -- native select: Authorization header, cookie, query param
- `clockSkewTolerance` -- DurationInput

**Auth API Key form fields:**
- `headerName` -- text input (default: X-API-Key)
- `queryParamName` -- text input (optional)
- `prefix` -- text input (e.g., "rku_")

**CORS form fields:**
- `allowedOrigins` -- TagInput
- `allowedMethods` -- multiselect checkboxes (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- `allowedHeaders` -- TagInput
- `exposedHeaders` -- TagInput
- `maxAge` -- DurationInput
- `allowCredentials` -- toggle

**Transform form fields:**
- `requestHeaders` -- dynamic array, each: action select (set/add/delete/replace) + name input + value input
- `responseHeaders` -- same
- `pathRewrite` -- strip prefix input + add prefix input
- `queryOperations` -- dynamic array: action select (add/remove/set) + key + value

**Circuit Breaker form fields:**
- `failureThreshold` -- number input
- `successThreshold` -- number input
- `timeout` -- DurationInput
- `maxRequestsHalfOpen` -- number input
- `monitoredStatusCodes` -- TagInput (numbers)

**Cache form fields:**
- `defaultMaxAge` -- DurationInput
- `cacheableStatusCodes` -- TagInput (numbers, defaults: 200, 301, 302)
- `cacheableMethods` -- multiselect (defaults: GET, HEAD)
- `maxBodySize` -- number + unit select (KB/MB)
- `varyHeaders` -- TagInput
- `staleWhileRevalidate` -- DurationInput

**Retry form fields:**
- `maxAttempts` -- number input
- `retryOnStatusCodes` -- TagInput (numbers, defaults: 502, 503, 504)
- `backoffStrategy` -- native select: none, constant, exponential
- `initialBackoff` -- DurationInput (shown when strategy != none)
- `maxBackoff` -- DurationInput (shown when strategy = exponential)

Registry in `packages/web/src/components/rioku/policy-forms/index.ts`:

```typescript
import { RateLimitForm } from './rate-limit-form'
import { AuthJwtForm } from './auth-jwt-form'
import { AuthApiKeyForm } from './auth-api-key-form'
import { CorsForm } from './cors-form'
import { TransformForm } from './transform-form'
import { CircuitBreakerForm } from './circuit-breaker-form'
import { CacheForm } from './cache-form'
import { RetryForm } from './retry-form'
import type { PolicyFormProps } from './types'

const FORM_MAP: Record<string, React.ComponentType<PolicyFormProps>> = {
  POLICY_TYPE_RATE_LIMIT: RateLimitForm,
  POLICY_TYPE_AUTHENTICATION: AuthJwtForm,
  POLICY_TYPE_AUTH_API_KEY: AuthApiKeyForm,
  POLICY_TYPE_CORS: CorsForm,
  POLICY_TYPE_TRANSFORM: TransformForm,
  POLICY_TYPE_CIRCUIT_BREAKER: CircuitBreakerForm,
  POLICY_TYPE_CACHE: CacheForm,
  POLICY_TYPE_RETRY: RetryForm,
}

export function PolicyFormForType({ type, ...props }: PolicyFormProps & { type: string }) {
  const FormComponent = FORM_MAP[type]
  if (!FormComponent) return <p className="text-sm text-muted-foreground">Unknown policy type.</p>
  return <FormComponent {...props} />
}

export type { PolicyFormProps }
```

- [ ] **Step 7: Implement policy create page**

Create `packages/web/src/routes/config/policies.create.tsx`:

```typescript
// packages/web/src/routes/config/policies.create.tsx
import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon } from 'lucide-react'
import {
  GaugeIcon, ShieldCheckIcon, KeyIcon, GlobeIcon,
  ZapOffIcon, ArrowsUpDownIcon, DatabaseIcon, RefreshCwIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { Policy } from '@/lib/api'
import { policySchemaFor } from '@/lib/schemas/policy-schemas'
import { PageHeader } from '@/components/rioku/page-header'
import { TypeSelectorTiles } from '@/components/rioku/type-selector-tiles'
import { PolicyFormForType } from '@/components/rioku/policy-forms'
// import { YamlJsonEditor } from '@/components/rioku/yaml-json-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/config/policies/create')({
  component: PolicyCreatePage,
})

const TYPE_OPTIONS = [
  { value: 'POLICY_TYPE_RATE_LIMIT', label: 'Rate Limit', description: 'Limit request rate by IP, API key, or agent', icon: <GaugeIcon className="size-6" /> },
  { value: 'POLICY_TYPE_AUTHENTICATION', label: 'Auth (JWT)', description: 'Validate JWT Bearer tokens', icon: <ShieldCheckIcon className="size-6" /> },
  { value: 'POLICY_TYPE_AUTH_API_KEY', label: 'Auth (API Key)', description: 'Validate API keys in headers or query', icon: <KeyIcon className="size-6" /> },
  { value: 'POLICY_TYPE_CORS', label: 'CORS', description: 'Cross-origin resource sharing rules', icon: <GlobeIcon className="size-6" /> },
  { value: 'POLICY_TYPE_CIRCUIT_BREAKER', label: 'Circuit Breaker', description: 'Stop sending to failing upstreams', icon: <ZapOffIcon className="size-6" /> },
  { value: 'POLICY_TYPE_TRANSFORM', label: 'Transform', description: 'Modify request/response headers and paths', icon: <ArrowsUpDownIcon className="size-6" /> },
  { value: 'POLICY_TYPE_CACHE', label: 'Cache', description: 'Cache upstream responses', icon: <DatabaseIcon className="size-6" /> },
  { value: 'POLICY_TYPE_RETRY', label: 'Retry', description: 'Retry failed upstream requests', icon: <RefreshCwIcon className="size-6" /> },
]

function PolicyCreatePage() {
  const { t } = useTranslation('policies')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [codeMode, setCodeMode] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const createMutation = useMutation({
    mutationFn: (payload: { policy: { action: 'UPSERT'; policy: Partial<Policy> } }) =>
      apiClient.post('/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(t('messages.policyCreated'))
      navigate({ to: '/config/policies' })
    },
    onError: () => toast.error('Failed to create policy'),
  })

  function handleSave() {
    if (!selectedType) return
    const schema = policySchemaFor(selectedType)
    const result = schema.safeParse(config)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        fieldErrors[issue.path.join('.')] = issue.message
      }
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    createMutation.mutate({
      policy: { action: 'UPSERT', policy: { name, type: selectedType, config: result.data } },
    })
  }

  // Page layout:
  // 1. PageHeader with back link to /config/policies
  // 2. Name input (always visible)
  // 3. Type selector tiles (always visible, greyed out once selected — click to change)
  // 4. Once type selected: structured form OR YAML/JSON editor (toggle)
  // 5. Save / Cancel buttons

  return null // Implementation follows pattern above
}
```

- [ ] **Step 8: Run all Task 3 tests**

```bash
cd packages/web && npx vitest run \
  src/lib/schemas/__tests__/policy-schemas.test.ts \
  src/components/rioku/__tests__/type-selector-tiles.test.tsx \
  src/components/rioku/__tests__/duration-input.test.tsx \
  src/components/rioku/__tests__/tag-input.test.tsx \
  src/components/rioku/__tests__/kv-editor.test.tsx \
  src/components/rioku/policy-forms/__tests__/rate-limit-form.test.tsx \
  src/components/rioku/policy-forms/__tests__/cors-form.test.tsx \
  src/components/rioku/policy-forms/__tests__/policy-form-registry.test.ts \
  src/routes/config/__tests__/policy-create.test.tsx
```

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(web): policy create page with type tiles and structured forms for all 8 types"
```

---

## Task 4: Users List + User Detail Page

**Files:**
- Create: `packages/web/src/routes/security/users.index.tsx`
- Create: `packages/web/src/routes/security/users.$userId.tsx`
- Create: `packages/web/src/routes/security/__tests__/users-list.test.tsx`
- Create: `packages/web/src/routes/security/__tests__/user-detail.test.tsx`
- Create: `packages/web/src/lib/schemas/user-schemas.ts`
- Create: `packages/web/src/locales/en/users.json`
- Modify: `packages/web/src/lib/api.ts` -- add ExpandedUser type
- Modify: `packages/web/src/components/layout/app-sidebar.tsx` -- update nav

Replaces the current `settings/users.tsx` page. Moves from SETTINGS section to SECURITY section in the sidebar. User names are clickable links to full-page detail views. The edit sheet is replaced by inline editing on the detail view.

**`NEEDS BACKEND` items (build frontend with current API, mark future fields):**
- Expanded user model fields: firstName, lastName, title, department, phone, timezone, locale, ssoProvider, ssoSubject
- These fields render as disabled/placeholder inputs until the backend schema is expanded

- [ ] **Step 1: Add expanded types to api.ts**

Add to `packages/web/src/lib/api.ts`:

```typescript
// Expanded user model (Phase 3 — some fields need backend)
export interface ExpandedUser extends UserInfo {
  firstName?: string | null
  lastName?: string | null
  title?: string | null
  department?: string | null
  phone?: string | null
  timezone?: string | null
  locale?: string | null
  ssoProvider?: string | null
  ssoSubject?: string | null
  loginCount?: number
  lastLoginIp?: string | null
}

// Permission rule for granular RBAC
export interface PermissionRule {
  id: string
  resource: string
  actions: string[]
  scope: 'all' | 'owned' | 'labeled' | 'specific'
  scopeValue?: string
  effect: 'allow' | 'deny'
}

// Expanded role with hierarchy
export interface ExpandedRole extends Role {
  parentRoleIds?: string[]
  childRoleIds?: string[]
  memberCount?: number
  rules?: PermissionRule[]
}

// Access policy (conditional access rules)
export interface AccessPolicy {
  id: string
  name: string
  description: string
  effect: 'allow' | 'deny'
  targetType: 'roles' | 'users'
  targetIds: string[]
  conditions: AccessCondition[]
  priority: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AccessCondition {
  type: 'time' | 'ip' | 'mfa' | 'geo' | 'device' | 'custom'
  config: Record<string, unknown>
}
```

- [ ] **Step 2: Write user list page tests**

Create `packages/web/src/routes/security/__tests__/users-list.test.tsx`:

```typescript
describe('UsersListPage', () => {
  it('renders user table with username as clickable link')
  it('renders first name, last name, email columns')
  it('renders multi-role badges per user')
  it('renders status badge (active/suspended/locked)')
  it('renders MFA status indicator')
  it('renders last login as TimeAgo')
  it('navigates to /security/users/:id when username clicked')
  it('shows Create user button for users with users:create permission')
  it('hides Create user button for unauthorized users')
  it('navigates to /security/users/create on Create button click')
  it('shows suspend confirmation dialog')
  it('filters by role, status, MFA via faceted filters')
})
```

- [ ] **Step 3: Implement user list page**

Create `packages/web/src/routes/security/users.index.tsx`:

Key differences from current `settings/users.tsx`:
- Route path: `/security/users` instead of `/settings/users`
- Username column is a `<Link to={/security/users/${user.id}}>` (primary color, clickable)
- Columns expanded: first name, last name, username, email, roles (badges), status, last login, MFA status, created
- **No create Dialog** -- Create button navigates to a create page or opens inline
- **No EditUserSheet** -- clicking user navigates to detail page
- Faceted filtering by role, status, MFA (using Phase 2 DataTable enhancements)

- [ ] **Step 4: Write user detail page tests**

Create `packages/web/src/routes/security/__tests__/user-detail.test.tsx`:

```typescript
describe('UserDetailPage', () => {
  // Identity card
  it('renders identity card with all user fields')
  it('shows edit button that enables inline editing on identity card')
  it('shows save/cancel buttons in edit mode')
  it('validates fields with zod on save')
  it('shows disabled inputs for NEEDS BACKEND fields (title, department, etc.)')
  it('shows read-only SSO fields when ssoProvider is set')

  // Roles card
  it('renders roles card with SearchableMultiSelect')
  it('shows selected roles as removable badges')
  it('assigns role via SearchableMultiSelect')
  it('removes role via badge X button')

  // Effective permissions panel
  it('renders collapsed effective permissions panel')
  it('shows permission count summary when collapsed')
  it('expands to show permission matrix when clicked')
  it('recalculates permissions when roles changed (before save)')

  // Security card
  it('renders security card with two columns')
  it('renders Change password button in left column')
  it('renders MFA status with enable/disable button')
  it('renders account status with toggle')
  it('renders active sessions list in right column')
  it('renders revoke button per session (not current)')
  it('renders revoke all other sessions button')

  // Metadata sidebar
  it('renders created date, last modified, last login, login count, account ID')
  it('renders account ID as monospace with copy button')

  // Danger zone
  it('renders delete user button in danger zone')
  it('requires typed username confirmation for delete')
  it('navigates back to user list after successful delete')

  // Navigation
  it('renders back link to /security/users')
  it('renders breadcrumbs: Security > Users > {username}')
})
```

- [ ] **Step 5: Implement user detail page**

Create `packages/web/src/routes/security/users.$userId.tsx`:

Layout (spec Section 11.2):

```
+-------------------------------------------+------------------+
|  Identity Card (main column)              |  Metadata sidebar|
|  [Edit] button top-right                  |  - Created       |
|  - First name / Last name (2-col)         |  - Last modified |
|  - Username                               |  - Last login+IP |
|  - Email                                  |  - Login count   |
|  - Title / Department (2-col)             |  - Account ID    |
|  - Phone                                  |                  |
|  - Timezone (SearchableSelect)            |                  |
|  - Locale (SearchableSelect)              |                  |
|  - SSO Provider (read-only if set)        |                  |
|  - SSO Subject (read-only if set)         |                  |
+-------------------------------------------+                  |
|  Roles Card                               |                  |
|  SearchableMultiSelect for roles          |                  |
|  Selected roles as removable badges       |                  |
+-------------------------------------------+------------------+
|  Effective Permissions Panel (collapsed)                     |
|  "X permissions across Y resources"                          |
+--------------------------------------------------------------+
|  Security Card (two columns)                                 |
|  Left: Password, MFA, Status | Right: Active sessions list   |
+--------------------------------------------------------------+
|  Danger Zone (red border)                                    |
|  [Delete user] button                                        |
+--------------------------------------------------------------+
```

Fields marked `NEEDS BACKEND` (title, department, phone, timezone, locale, SSO) render with placeholder styling and a subtle "Coming soon" tooltip. They are present in the form but disabled. The ExpandedUser type includes them as optional, so no runtime error when the API does not return them.

- [ ] **Step 6: Create i18n namespace**

Create `packages/web/src/locales/en/users.json`:

```json
{
  "title": "Users & Access",
  "subtitle": "Manage user accounts, roles, and access policies",
  "list": {
    "createUser": "Create user",
    "searchPlaceholder": "Search users..."
  },
  "detail": {
    "backToList": "Back to users",
    "identityCard": "Identity",
    "rolesCard": "Roles",
    "securityCard": "Security",
    "effectivePermissions": "Effective permissions",
    "dangerZone": "Danger zone",
    "deleteUser": "Delete user",
    "deleteConfirmation": "Type the username to confirm deletion.",
    "changePassword": "Change password",
    "enableMfa": "Enable MFA",
    "disableMfa": "Disable MFA",
    "revokeSession": "Revoke",
    "revokeAllSessions": "Revoke all other sessions",
    "permissionSummary": "{{count}} permission across {{resources}} resources",
    "permissionSummary_plural": "{{count}} permissions across {{resources}} resources"
  },
  "status": {
    "active": "Active",
    "suspended": "Suspended",
    "locked": "Locked"
  },
  "messages": {
    "userCreated": "User created",
    "userUpdated": "User updated",
    "userDeleted": "User deleted",
    "roleSaved": "Roles updated",
    "passwordChanged": "Password changed",
    "sessionRevoked": "Session revoked"
  }
}
```

- [ ] **Step 7: Update sidebar navigation**

Modify `packages/web/src/components/layout/app-sidebar.tsx` to update the SECURITY section:

```
SECURITY
  Users & roles     -> /security/users  (was /settings/users)
  API keys          -> /security/api-keys  (was /security)
  Access policies   -> /security/access-policies  (new)
  Audit log         -> /security/audit  (was /audit)
```

- [ ] **Step 8: Run tests**

```bash
cd packages/web && npx vitest run src/routes/security/__tests__/users-list.test.tsx src/routes/security/__tests__/user-detail.test.tsx
```

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(web): users list and detail page — full-page with identity/roles/security/permissions"
```

---

## Task 5: Roles List + Role Detail Page (Permissions, Hierarchy, Members)

**Files:**
- Create: `packages/web/src/routes/security/roles.index.tsx`
- Create: `packages/web/src/routes/security/roles.$roleId.tsx`
- Create: `packages/web/src/routes/security/__tests__/roles-list.test.tsx`
- Create: `packages/web/src/routes/security/__tests__/role-detail.test.tsx`
- Create: `packages/web/src/components/rioku/permission-rule-editor.tsx`
- Create: `packages/web/src/components/rioku/__tests__/permission-rule-editor.test.tsx`
- Create: `packages/web/src/components/rioku/role-hierarchy-tree.tsx`
- Create: `packages/web/src/components/rioku/__tests__/role-hierarchy-tree.test.tsx`
- Create: `packages/web/src/lib/schemas/role-schemas.ts`

**`NEEDS BACKEND`:** The entire granular RBAC model (multi-role, role hierarchy DAG, permission rules with resource/actions/scope/effect) requires backend proto definitions, database schema, and enforcement middleware. The frontend builds the full UI with mock/placeholder data where the backend does not yet support it.

- [ ] **Step 1: Write permission rule editor tests**

Create `packages/web/src/components/rioku/__tests__/permission-rule-editor.test.tsx`:

```typescript
describe('PermissionRuleEditor', () => {
  it('renders existing rules as card list')
  it('renders resource SearchableSelect per rule')
  it('renders actions multiselect checkboxes per rule')
  it('renders scope native select (all, owned, labeled, specific)')
  it('shows scope value input when scope is labeled or specific')
  it('hides scope value input when scope is all or owned')
  it('renders effect native select (allow, deny)')
  it('adds a new blank rule when Add Rule clicked')
  it('removes a rule when X button clicked')
  it('supports drag-and-drop reordering of rules')
  it('calls onChange with updated PermissionRule array')
})
```

- [ ] **Step 2: Implement permission rule editor**

Create `packages/web/src/components/rioku/permission-rule-editor.tsx`:

Each rule renders as a card with a horizontal layout:

```
+--------------------------------------------------+
| [drag handle] Resource: [SearchableSelect]  [X]  |
|   Actions: [x] view [x] create [ ] update ...    |
|   Scope: [all v]  Effect: [allow v]               |
+--------------------------------------------------+
```

Uses dnd-kit for drag reordering. Resource options: routes, services, policies, keys, users, roles, settings, cluster, plugins, audit, traffic, certificates. Action options vary by resource type (view, create, update, delete, manage).

- [ ] **Step 3: Write role hierarchy tree tests**

Create `packages/web/src/components/rioku/__tests__/role-hierarchy-tree.test.tsx`:

```typescript
describe('RoleHierarchyTree', () => {
  it('renders roles as a visual DAG tree')
  it('highlights the current role')
  it('shows parent roles connected with lines')
  it('shows child roles connected with lines')
  it('renders parent roles SearchableMultiSelect for editing')
  it('renders child roles as read-only list')
  it('supports drag-and-drop for parent assignment')
  it('shows visual indicator (blue line) during drag')
  it('calls onParentChange when parents updated')
})
```

- [ ] **Step 4: Implement role hierarchy tree**

Create `packages/web/src/components/rioku/role-hierarchy-tree.tsx`:

Uses dnd-kit. Renders the role DAG as an indented tree. The current role is highlighted. Parent roles are editable via SearchableMultiSelect. Child roles are read-only. Drag-and-drop within the tree reorders the visual display; dropping onto another role's bottom half creates a parent-child relationship.

**Note:** The backend does not yet support role hierarchy. The component works with the `parentRoleIds` and `childRoleIds` fields on `ExpandedRole`, which default to empty arrays. The UI is fully functional but changes will not persist until the backend implements the hierarchy endpoints.

- [ ] **Step 5: Write role list and detail page tests**

**`packages/web/src/routes/security/__tests__/roles-list.test.tsx`:**
```typescript
describe('RolesListPage', () => {
  it('renders role table with name as clickable link')
  it('renders description, member count, parent roles columns')
  it('shows built-in badge for system roles')
  it('navigates to /security/roles/:id when role name clicked')
  it('shows Create role button for authorized users')
  it('hides delete action for built-in roles')
  it('hides all actions for superadmin role')
})
```

**`packages/web/src/routes/security/__tests__/role-detail.test.tsx`:**
```typescript
describe('RoleDetailPage', () => {
  // Permissions tab
  it('renders Permissions tab as default with permission rules')
  it('shows Add Rule button')
  it('renders PermissionRuleEditor with current rules')
  it('saves updated rules on Save')
  it('shows built-in role rules as read-only')

  // Hierarchy tab
  it('renders Hierarchy tab with role DAG visualization')
  it('renders parent roles SearchableMultiSelect')
  it('renders child roles as read-only list')
  it('updates hierarchy on drag-and-drop')

  // Members tab
  it('renders Members tab with user list')
  it('renders SearchableMultiSelect to add/remove users')
  it('shows user links that navigate to /security/users/:id')

  // Navigation
  it('deep-links to tabs via ?tab=permissions|hierarchy|members')
  it('renders back link to /security/roles')
})
```

- [ ] **Step 6: Implement roles list and detail pages**

**`packages/web/src/routes/security/roles.index.tsx`:** DataTable with name (link), description, member count, parent roles, built-in badge. No inline edit -- click to navigate.

**`packages/web/src/routes/security/roles.$roleId.tsx`:** Three tabs:

**Permissions tab:**
- Renders `PermissionRuleEditor` with the role's rules
- Built-in roles (superadmin, admin, operator, viewer, developer) have read-only rules
- Custom roles allow add/edit/delete of rules
- Save button persists changes

**Hierarchy tab:**
- Renders `RoleHierarchyTree` showing this role's position
- Parent roles editable via SearchableMultiSelect
- Child roles displayed as read-only list with links

**Members tab:**
- DataTable of users assigned to this role
- SearchableMultiSelect to add/remove users
- User names link to `/security/users/:id`

- [ ] **Step 7: Run tests**

```bash
cd packages/web && npx vitest run \
  src/components/rioku/__tests__/permission-rule-editor.test.tsx \
  src/components/rioku/__tests__/role-hierarchy-tree.test.tsx \
  src/routes/security/__tests__/roles-list.test.tsx \
  src/routes/security/__tests__/role-detail.test.tsx
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(web): roles list and detail page — granular permissions, hierarchy DAG, members"
```

---

## Task 6: Access Policies Page

**Files:**
- Create: `packages/web/src/routes/security/access-policies.index.tsx`
- Create: `packages/web/src/routes/security/access-policies.$policyId.tsx`
- Create: `packages/web/src/routes/security/access-policies.create.tsx`
- Create: `packages/web/src/routes/security/__tests__/access-policies.test.tsx`
- Create: `packages/web/src/components/rioku/condition-editor.tsx`
- Create: `packages/web/src/components/rioku/__tests__/condition-editor.test.tsx`
- Create: `packages/web/src/lib/schemas/access-policy-schemas.ts`
- Create: `packages/web/src/locales/en/access-policies.json`

**`NEEDS BACKEND`:** Access policies are a new concept. The entire entity (proto definition, database table, evaluation engine) needs backend implementation. The frontend builds the full UI behind the `features.accessPolicies` feature flag with placeholder/mock data.

- [ ] **Step 1: Write condition editor tests**

Create `packages/web/src/components/rioku/__tests__/condition-editor.test.tsx`:

```typescript
describe('ConditionEditor', () => {
  it('renders existing conditions as a list')
  it('renders condition type selector (time, ip, mfa, geo, device, custom)')
  it('shows time-specific fields when type is time (start, end, days, timezone)')
  it('shows CIDR input and negate toggle when type is ip')
  it('shows required boolean when type is mfa')
  it('shows country codes TagInput and negate toggle when type is geo')
  it('shows user agent TagInput when type is device')
  it('shows CEL expression input when type is custom')
  it('adds a new condition when Add Condition clicked')
  it('removes a condition when delete button clicked')
  it('calls onChange with updated conditions array')
})
```

- [ ] **Step 2: Implement condition editor**

Create `packages/web/src/components/rioku/condition-editor.tsx`:

Each condition renders as a card. The type selector at the top determines which sub-fields appear:

- **time**: start time (time input), end time (time input), days of week (multiselect: Mon-Sun), timezone (SearchableSelect)
- **ip**: CIDR ranges (TagInput), negate toggle
- **mfa**: required (boolean toggle -- user must have MFA enabled)
- **geo**: country codes (TagInput), negate toggle
- **device**: allowed user agents (TagInput, regex patterns)
- **custom**: CEL expression (text input with syntax hint tooltip)

- [ ] **Step 3: Write access policy schemas**

Create `packages/web/src/lib/schemas/access-policy-schemas.ts`:

```typescript
import { z } from 'zod'

export const timeConditionSchema = z.object({
  type: z.literal('time'),
  config: z.object({
    startTime: z.string(),  // HH:MM
    endTime: z.string(),    // HH:MM
    daysOfWeek: z.array(z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])),
    timezone: z.string(),
  }),
})

export const ipConditionSchema = z.object({
  type: z.literal('ip'),
  config: z.object({
    cidrRanges: z.array(z.string()).min(1),
    negate: z.boolean().default(false),
  }),
})

export const mfaConditionSchema = z.object({
  type: z.literal('mfa'),
  config: z.object({
    required: z.boolean(),
  }),
})

export const geoConditionSchema = z.object({
  type: z.literal('geo'),
  config: z.object({
    countryCodes: z.array(z.string()).min(1),
    negate: z.boolean().default(false),
  }),
})

export const deviceConditionSchema = z.object({
  type: z.literal('device'),
  config: z.object({
    allowedUserAgents: z.array(z.string()).min(1),
  }),
})

export const customConditionSchema = z.object({
  type: z.literal('custom'),
  config: z.object({
    expression: z.string().min(1),
  }),
})

export const accessConditionSchema = z.discriminatedUnion('type', [
  timeConditionSchema,
  ipConditionSchema,
  mfaConditionSchema,
  geoConditionSchema,
  deviceConditionSchema,
  customConditionSchema,
])

export const accessPolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  targetType: z.enum(['roles', 'users']),
  targetIds: z.array(z.string()).min(1),
  conditions: z.array(accessConditionSchema).min(1),
  priority: z.number().int().nonnegative(),
  enabled: z.boolean().default(true),
})
```

- [ ] **Step 4: Write access policies page tests**

Create `packages/web/src/routes/security/__tests__/access-policies.test.tsx`:

```typescript
describe('AccessPoliciesListPage', () => {
  it('renders behind feature flag (shows ComingSoon when off)')
  it('renders access policy table when feature flag on')
  it('renders columns: name, target, conditions summary, effect, priority, enabled')
  it('navigates to detail view when name clicked')
  it('shows Create button')
})

describe('AccessPolicyDetailPage', () => {
  it('renders name, description, effect, priority, enabled fields')
  it('renders target section with type selector and SearchableMultiSelect')
  it('renders ConditionEditor with conditions')
  it('validates with accessPolicySchema on save')
  it('shows toast on successful save')
})

describe('AccessPolicyCreatePage', () => {
  it('renders create form with all fields')
  it('validates required fields')
  it('navigates back to list after creation')
})
```

- [ ] **Step 5: Implement access policies pages**

**List page:** DataTable with columns: name (link), target summary (e.g., "2 roles" or "3 users"), conditions count, effect badge (allow=green, deny=red), priority number, enabled toggle.

**Detail page:** Full-page view with inline editing. Sections:
- Name + description
- Effect selector (allow/deny)
- Target: type selector (roles/users) + SearchableMultiSelect for the selected type
- Conditions: ConditionEditor component
- Priority: number input
- Enabled: toggle

**Create page:** Same form as detail edit mode, on `/security/access-policies/create`.

All behind `features.accessPolicies` flag. When the flag is off, show the `ComingSoon` component.

- [ ] **Step 6: Create i18n namespace**

Create `packages/web/src/locales/en/access-policies.json`:

```json
{
  "title": "Access Policies",
  "subtitle": "Conditional access rules beyond role permissions",
  "list": {
    "createPolicy": "Create access policy",
    "searchPlaceholder": "Search access policies..."
  },
  "detail": {
    "backToList": "Back to access policies",
    "conditions": "Conditions",
    "target": "Target",
    "effect": "Effect"
  },
  "conditionTypes": {
    "time": "Time window",
    "ip": "IP range",
    "mfa": "MFA required",
    "geo": "Geolocation",
    "device": "Device type",
    "custom": "Custom (CEL)"
  },
  "messages": {
    "created": "Access policy created",
    "updated": "Access policy updated",
    "deleted": "Access policy deleted"
  }
}
```

- [ ] **Step 7: Run tests**

```bash
cd packages/web && npx vitest run \
  src/components/rioku/__tests__/condition-editor.test.tsx \
  src/routes/security/__tests__/access-policies.test.tsx
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(web): access policies page — conditional access rules with conditions editor"
```

---

## Task 7: API Keys Detail Page

**Files:**
- Create: `packages/web/src/routes/security/api-keys.index.tsx`
- Create: `packages/web/src/routes/security/api-keys.$keyId.tsx`
- Create: `packages/web/src/routes/security/__tests__/api-key-detail.test.tsx`
- Create: `packages/web/src/lib/schemas/api-key-schemas.ts`
- Create: `packages/web/src/locales/en/api-keys.json`

Replaces the current `security.tsx` page's API keys section. API key names become clickable links to full-page detail views with three tabs: Details, Usage, Activity.

- [ ] **Step 1: Write API key detail tests**

Create `packages/web/src/routes/security/__tests__/api-key-detail.test.tsx`:

```typescript
describe('ApiKeyDetailPage', () => {
  // Details tab
  it('renders Details tab as default')
  it('renders key name as editable text input')
  it('renders key prefix as read-only monospace')
  it('renders created date, expires date, last used as read-only')
  it('renders scopes as removable badges')
  it('renders SearchableMultiSelect to add new scopes')
  it('saves updated name and scopes on Save')

  // Usage tab
  it('renders Usage tab with stats cards (24h, 7d, 30d request counts)')
  it('renders scope breakdown bar chart (placeholder with feature flag)')
  it('renders recent requests table (placeholder with feature flag)')

  // Activity tab
  it('renders Activity tab (placeholder with feature flag)')

  // Revoke
  it('renders Revoke button in danger zone')
  it('shows confirmation dialog before revoke')
  it('navigates to API keys list after successful revoke')

  // Navigation
  it('renders back link to /security/api-keys')
  it('deep-links to tabs via ?tab=details|usage|activity')
})
```

- [ ] **Step 2: Implement API keys list page**

Create `packages/web/src/routes/security/api-keys.index.tsx`:

Migrates the API keys section from `security.tsx` into its own page. Key differences:
- Key name column is a `<Link>` to `/security/api-keys/:id`
- Create flow stays as a Dialog (one-time key display requirement makes modal appropriate)
- Session management section moves to the user's profile page
- Certificate status section moves to Settings > TLS & Certificates

- [ ] **Step 3: Implement API key detail page**

Create `packages/web/src/routes/security/api-keys.$keyId.tsx`:

Three tabs:

**Details tab:**
- Name (editable text input)
- Description (editable text area -- new field)
- Key prefix (read-only, monospace)
- Created / Expires / Last used (read-only TimeAgo)
- Scopes: removable badges + SearchableMultiSelect to add. Each scope shows resource type + "all" or specific name.
- Save button persists name + scopes changes

**Usage tab (partially `NEEDS BACKEND`):**
- Stat cards: total requests 24h, 7d, 30d
- Scope breakdown: horizontal bar chart (Recharts) showing request count per scope
- Recent requests: DataTable with timestamp, method, path, status, latency (last 50)
- Stats cards render with placeholder data behind `features` flag if backend unavailable

**Activity tab (`NEEDS BACKEND`):**
- Feature-flagged behind `features.entityActivity`
- Shows timestamped change history (created, scopes modified, etc.)

**Danger zone:**
- Revoke button -> ConfirmDialog -> mutation -> navigate to list

- [ ] **Step 4: Create i18n namespace and schemas**

`packages/web/src/locales/en/api-keys.json`:
```json
{
  "title": "API Keys",
  "subtitle": "Manage API keys for programmatic access",
  "list": {
    "createKey": "Create key",
    "searchPlaceholder": "Search keys..."
  },
  "detail": {
    "backToList": "Back to API keys",
    "details": "Details",
    "usage": "Usage",
    "activity": "Activity",
    "scopes": "Scopes",
    "revokeKey": "Revoke key",
    "dangerZone": "Danger zone"
  },
  "messages": {
    "keyCreated": "API key created",
    "keyUpdated": "API key updated",
    "keyRevoked": "API key revoked",
    "showOnce": "This key will only be shown once. Copy it now."
  }
}
```

`packages/web/src/lib/schemas/api-key-schemas.ts`:
```typescript
import { z } from 'zod'

export const createApiKeySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1),
  expiry: z.enum(['30d', '90d', '1y', 'never']),
})

export const updateApiKeySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1),
})
```

- [ ] **Step 5: Run tests**

```bash
cd packages/web && npx vitest run src/routes/security/__tests__/api-key-detail.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): API key detail page — tabbed view with scopes, usage stats, revoke"
```

---

## Task 8: Effective Permissions Panel + Profile Page Updates

**Files:**
- Create: `packages/web/src/components/rioku/effective-permissions.tsx`
- Create: `packages/web/src/components/rioku/__tests__/effective-permissions.test.tsx`
- Create: `packages/web/src/lib/permissions.ts`
- Create: `packages/web/src/lib/__tests__/permissions.test.ts`
- Modify: `packages/web/src/routes/settings/profile.tsx` -- add accessibility + appearance sections

The effective permissions panel computes permissions client-side from role data + access policy data. It is used on the user detail page (Task 4) and the profile page.

- [ ] **Step 1: Write permissions computation tests**

Create `packages/web/src/lib/__tests__/permissions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeEffectivePermissions } from '../permissions'
import type { PermissionRule, AccessPolicy, ExpandedRole } from '../api'

describe('computeEffectivePermissions', () => {
  const viewerRole: ExpandedRole = {
    id: 'viewer', name: 'viewer', description: '', isBuiltin: true,
    permissions: [], createdAt: '', updatedAt: '',
    rules: [
      { id: '1', resource: 'routes', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: '2', resource: 'services', actions: ['view'], scope: 'all', effect: 'allow' },
    ],
  }

  const operatorRole: ExpandedRole = {
    id: 'operator', name: 'operator', description: '', isBuiltin: true,
    permissions: [], createdAt: '', updatedAt: '',
    parentRoleIds: ['viewer'],
    rules: [
      { id: '3', resource: 'routes', actions: ['create', 'update', 'delete'], scope: 'all', effect: 'allow' },
      { id: '4', resource: 'services', actions: ['create', 'update', 'delete'], scope: 'all', effect: 'allow' },
    ],
  }

  it('grants no permissions with no roles', () => {
    const result = computeEffectivePermissions([], [], [])
    expect(result.routes.view).toBe(false)
  })

  it('grants view permission from viewer role', () => {
    const result = computeEffectivePermissions([viewerRole], [viewerRole], [])
    expect(result.routes.view).toBe(true)
    expect(result.routes.create).toBe(false)
  })

  it('inherits parent role permissions', () => {
    const result = computeEffectivePermissions(
      [operatorRole],
      [viewerRole, operatorRole],
      [],
    )
    expect(result.routes.view).toBe(true)   // inherited from viewer
    expect(result.routes.create).toBe(true)  // from operator
  })

  it('deny rules override allow rules', () => {
    const denyRole: ExpandedRole = {
      id: 'deny-test', name: 'deny-test', description: '', isBuiltin: false,
      permissions: [], createdAt: '', updatedAt: '',
      rules: [
        { id: '5', resource: 'routes', actions: ['delete'], scope: 'all', effect: 'deny' },
      ],
    }
    const result = computeEffectivePermissions(
      [operatorRole, denyRole],
      [viewerRole, operatorRole, denyRole],
      [],
    )
    expect(result.routes.delete).toBe(false) // denied
    expect(result.routes.create).toBe(true)  // not denied
  })

  it('access policies override role permissions', () => {
    const denyPolicy: AccessPolicy = {
      id: 'ap1', name: 'deny-after-hours', description: '',
      effect: 'deny', targetType: 'roles', targetIds: ['operator'],
      conditions: [{ type: 'time', config: {} }],
      priority: 1, enabled: true, createdAt: '', updatedAt: '',
    }
    // Access policies are applied after roles; matching policy overrides
    const result = computeEffectivePermissions(
      [operatorRole], [viewerRole, operatorRole], [denyPolicy],
      { roleIds: ['operator'], conditionsMet: { 'ap1': true } },
    )
    expect(result.routes.create).toBe(false) // overridden by access policy
  })

  it('returns sources for each permission cell (tooltip data)', () => {
    const result = computeEffectivePermissions([viewerRole], [viewerRole], [])
    expect(result._sources?.routes?.view).toContain('viewer')
  })
})
```

- [ ] **Step 2: Implement permissions computation**

Create `packages/web/src/lib/permissions.ts`:

```typescript
import type { ExpandedRole, AccessPolicy } from './api'

export interface PermissionMatrix {
  [resource: string]: {
    [action: string]: boolean
  }
  _sources?: {
    [resource: string]: {
      [action: string]: string  // role or policy name that granted/denied
    }
  }
}

const ALL_RESOURCES = [
  'routes', 'services', 'policies', 'keys', 'users', 'roles',
  'settings', 'cluster', 'plugins', 'audit', 'traffic', 'certificates',
]

const ALL_ACTIONS = ['view', 'create', 'update', 'delete', 'manage']

interface ComputeContext {
  roleIds?: string[]
  conditionsMet?: Record<string, boolean>  // access policy ID -> conditions matched
}

export function computeEffectivePermissions(
  assignedRoles: ExpandedRole[],
  allRoles: ExpandedRole[],
  accessPolicies: AccessPolicy[],
  context?: ComputeContext,
): PermissionMatrix {
  // 1. Start with deny-by-default
  // 2. Walk role hierarchy (BFS up parentRoleIds) collecting all rules
  // 3. Apply allow rules (grant permissions)
  // 4. Apply deny rules (revoke permissions) — deny takes precedence
  // 5. Apply access policies in priority order (lowest first)
  //    For each matching policy where conditions are met, apply its effect
  // 6. Record source (role/policy name) for each cell for tooltips
  // Return PermissionMatrix
}
```

Algorithm:
1. Build a set of all effective role IDs by walking `parentRoleIds` up the DAG from each assigned role (BFS, dedup).
2. Collect all `rules` from all effective roles.
3. Initialize all resources x actions as `false`.
4. Apply allow rules: for each rule with `effect: 'allow'`, set `matrix[resource][action] = true` for each action in the rule.
5. Apply deny rules: for each rule with `effect: 'deny'`, set `matrix[resource][action] = false`.
6. Apply access policies in priority order. If the policy's `targetIds` includes any of the user's role IDs (for `targetType: 'roles'`) or user ID (for `targetType: 'users'`), and conditions are met (from `context.conditionsMet`), apply the policy's effect to all permissions.
7. Record the source name for each final permission state.

- [ ] **Step 3: Write effective permissions panel tests**

Create `packages/web/src/components/rioku/__tests__/effective-permissions.test.tsx`:

```typescript
describe('EffectivePermissionsPanel', () => {
  it('renders collapsed by default with summary text')
  it('shows permission count in summary: "X permissions across Y resources"')
  it('expands when header clicked')
  it('renders permission matrix: resources as rows, actions as columns')
  it('renders green checkmark for allowed permissions')
  it('renders red X for denied permissions')
  it('renders gray dash for no-rule permissions')
  it('shows tooltip on cell hover with granting role/policy name')
  it('recalculates when assignedRoles prop changes')
  it('uses aria-expanded for accessibility')
})
```

- [ ] **Step 4: Implement effective permissions panel**

Create `packages/web/src/components/rioku/effective-permissions.tsx`:

```typescript
import { useState, useMemo } from 'react'
import { ChevronDownIcon, CheckIcon, XIcon, MinusIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { computeEffectivePermissions } from '@/lib/permissions'
import type { ExpandedRole, AccessPolicy } from '@/lib/api'
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip'

interface EffectivePermissionsPanelProps {
  assignedRoles: ExpandedRole[]
  allRoles: ExpandedRole[]
  accessPolicies: AccessPolicy[]
  context?: { roleIds?: string[]; conditionsMet?: Record<string, boolean> }
}

export function EffectivePermissionsPanel({
  assignedRoles, allRoles, accessPolicies, context,
}: EffectivePermissionsPanelProps) {
  const [open, setOpen] = useState(false)

  const matrix = useMemo(
    () => computeEffectivePermissions(assignedRoles, allRoles, accessPolicies, context),
    [assignedRoles, allRoles, accessPolicies, context],
  )

  // Count allowed permissions for summary
  const { count, resources } = useMemo(() => {
    let c = 0
    const res = new Set<string>()
    for (const [resource, actions] of Object.entries(matrix)) {
      if (resource === '_sources') continue
      for (const allowed of Object.values(actions)) {
        if (allowed) { c++; res.add(resource) }
      }
    }
    return { count: c, resources: res.size }
  }, [matrix])

  // Render:
  // Collapsible card
  // Header: "Effective permissions" + summary + chevron
  // Content: table with resources as rows, actions as columns
  // Each cell: green check / red X / gray dash, with tooltip
}
```

- [ ] **Step 5: Update profile page**

Modify `packages/web/src/routes/settings/profile.tsx` to add:

**Accessibility section (new card below TOTP card):**
- Color Vision selector: native select with None, Deuteranopia, Protanopia, Tritanopia, Achromatopsia
- High Contrast toggle
- Reduced Motion toggle
- Font Size multiplier: segmented buttons 90% / 100% / 110% / 120% / 130%

All preferences persist to localStorage via `usePreferences` hook (from Phase 1). Applied immediately via CSS variables and SVG `feColorMatrix` filter on the root element.

**Appearance section (new card):**
- Theme selector: native select with Dark, Light, System

**Read-only effective permissions panel:**
- Collapsed by default, shows current user's computed permissions
- Uses `EffectivePermissionsPanel` component with `readOnly` behavior (no editing)

- [ ] **Step 6: Run tests**

```bash
cd packages/web && npx vitest run \
  src/lib/__tests__/permissions.test.ts \
  src/components/rioku/__tests__/effective-permissions.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(web): effective permissions panel — client-side computation from role hierarchy + access policies"
```

---

## Cleanup Tasks (After All Main Tasks)

- [ ] **Remove old route files** once new routes are wired and tested:
  - `packages/web/src/routes/config/policies.tsx` -> replaced by `policies.index.tsx`
  - `packages/web/src/routes/settings/users.tsx` -> replaced by `security/users.index.tsx`
  - `packages/web/src/routes/settings/roles.tsx` -> replaced by `security/roles.index.tsx`
  - `packages/web/src/routes/security.tsx` -> replaced by `security/api-keys.index.tsx`

- [ ] **Update route tree** by running TanStack Router's codegen:
  ```bash
  cd packages/web && npx tsr generate
  ```

- [ ] **Update app-sidebar.tsx** navigation items for all new routes.

- [ ] **Run full test suite:**
  ```bash
  cd packages/web && npx vitest run
  ```

- [ ] **Final commit:**
  ```bash
  git commit -m "refactor(web): remove old route files, update route tree for Phase 3"
  ```

---

## Backend Work Items (Create GitHub Issues)

The following items require backend implementation before the frontend can be fully wired. Create GitHub issues for each:

| Issue title | Scope | Priority |
|-------------|-------|----------|
| `feat(auth): expand user model — firstName, lastName, title, department, phone, timezone, locale, SSO fields` | Proto + migration + REST endpoints | High |
| `feat(auth): multi-role assignment — many-to-many user-role relationship` | Schema change + API update | High |
| `feat(rbac): role hierarchy DAG — parent role relationships with inheritance resolution` | Proto + database + middleware | High |
| `feat(rbac): granular permission rules — resource/actions/scope/effect model` | Proto + database + enforcement | High |
| `feat(rbac): access policies — conditional access rules with evaluation engine` | New entity + proto + evaluation | Medium |
| `feat(rbac): effective permissions API — server-side permission computation` | REST endpoint | Medium |
| `feat(keys): API key usage stats — request counting per key, per scope` | TrafficService integration | Low |
| `feat(audit): per-entity activity logs — structured change tracking with diffs` | Audit system extension | Medium |
