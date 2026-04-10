# Admin Panel Phase 4: Settings Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement all 8 settings sub-pages with fully functional forms, Zod validation, save/reset with toast feedback, loading skeletons, and error boundaries. Almost all fields are `NEEDS BACKEND` -- forms render with realistic defaults and mark unavailable fields. When backend APIs land, forms wire up without UI changes.

**Depends on:** Phase 1 (settings multi-page layout with sub-nav already built).

**Spec:** `docs/superpowers/specs/2026-04-10-admin-panel-overhaul-v2.md` -- Sections 10.1 through 10.9.

**Architecture:** Each settings page is a TanStack Router route under `/settings/`. Pages use `react-hook-form` + `zod` for validation, `@tanstack/react-query` for data fetching/mutations, `sonner` for toast feedback. All user-facing strings go through `react-i18next` (namespace: `settings`). Each page has: save button, reset button, loading skeleton, error boundary. Fields that need backend work render as disabled with a tooltip "Requires backend API".

**Tech Stack:** React 19, TanStack Router, TanStack Query, react-hook-form, zod, sonner, react-i18next, shadcn/ui components, Tailwind CSS.

**TDD approach:** Write component tests first (vitest + @testing-library/react), then implement the component to make tests pass. Each task creates the test file alongside the component.

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `packages/web/src/routes/settings/general.tsx` | General settings page |
| `packages/web/src/routes/settings/network.tsx` | Network settings page |
| `packages/web/src/routes/settings/tls.tsx` | TLS & Certificates settings page |
| `packages/web/src/routes/settings/observability.tsx` | Observability settings page |
| `packages/web/src/routes/settings/config-store.tsx` | Config Store settings page |
| `packages/web/src/routes/settings/authentication.tsx` | Authentication settings page |
| `packages/web/src/routes/settings/pki.tsx` | PKI settings page |
| `packages/web/src/routes/settings/danger-zone.tsx` | Danger Zone settings page |
| `packages/web/src/lib/schemas/settings.ts` | Zod schemas for all settings forms |
| `packages/web/src/lib/schemas/__tests__/settings.test.ts` | Tests for settings Zod schemas |
| `packages/web/src/components/rioku/tag-input.tsx` | Reusable tag input component (add/remove string tags) |
| `packages/web/src/components/rioku/__tests__/tag-input.test.tsx` | Tests for TagInput component |
| `packages/web/src/components/rioku/settings-field.tsx` | Wrapper for fields needing backend, shows disabled + tooltip |
| `packages/web/src/components/rioku/__tests__/settings-field.test.tsx` | Tests for SettingsField component |
| `packages/web/src/components/rioku/typed-confirmation-dialog.tsx` | Confirmation dialog requiring typed phrase |
| `packages/web/src/components/rioku/__tests__/typed-confirmation-dialog.test.tsx` | Tests for TypedConfirmationDialog |
| `packages/web/src/components/rioku/progress-bar.tsx` | Storage usage progress bar component |
| `packages/web/src/components/rioku/__tests__/progress-bar.test.tsx` | Tests for ProgressBar |

### Modified Files

| File | Changes |
|------|---------|
| `packages/web/src/routes/settings.tsx` | Update to redirect `/settings` to `/settings/general`, add settings sub-nav layout |
| `packages/web/src/locales/en/settings.json` | Add all i18n keys for 8 settings pages |
| `packages/web/src/lib/api.ts` | Add settings-related API types and endpoints |

---

## Task 1: Shared Settings Infrastructure (schemas, components, i18n)

**Files:**
- Create: `packages/web/src/lib/schemas/settings.ts`
- Create: `packages/web/src/lib/schemas/__tests__/settings.test.ts`
- Create: `packages/web/src/components/rioku/tag-input.tsx`
- Create: `packages/web/src/components/rioku/__tests__/tag-input.test.tsx`
- Create: `packages/web/src/components/rioku/settings-field.tsx`
- Create: `packages/web/src/components/rioku/__tests__/settings-field.test.tsx`
- Create: `packages/web/src/components/rioku/typed-confirmation-dialog.tsx`
- Create: `packages/web/src/components/rioku/__tests__/typed-confirmation-dialog.test.tsx`
- Create: `packages/web/src/components/rioku/progress-bar.tsx`
- Create: `packages/web/src/components/rioku/__tests__/progress-bar.test.tsx`
- Modify: `packages/web/src/locales/en/settings.json`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Write Zod schemas for all settings forms**

Create `packages/web/src/lib/schemas/settings.ts`:

```typescript
import { z } from 'zod'

// --- General settings ---
export const generalSettingsSchema = z.object({
  instanceName: z.string().min(1, 'Instance name is required').max(128),
  dataDirectory: z.string(), // read-only
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  daemonVersion: z.string(), // read-only
  caddyVersion: z.string(), // read-only
})
export type GeneralSettings = z.infer<typeof generalSettingsSchema>

// --- Network settings ---
const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
export const networkSettingsSchema = z.object({
  trustedProxies: z.array(z.string().regex(cidrRegex, 'Invalid CIDR notation')),
  clientIpHeaders: z.array(z.string().min(1)),
  strictMode: z.boolean(),
  listenAddresses: z.object({
    grpc: z.string(),
    rest: z.string(),
    caddyHttp: z.string(),
    caddyHttps: z.string(),
    admin: z.string(),
  }),
})
export type NetworkSettings = z.infer<typeof networkSettingsSchema>

// --- TLS & Certificates ---
export const tlsSettingsSchema = z.object({
  acmeProvider: z.enum(['letsencrypt', 'zerossl']),
  dnsChallengeProvider: z.enum([
    'none', 'cloudflare', 'route53', 'gcloud', 'azure', 'digitalocean',
  ]),
  dnsChallengeCredentials: z.record(z.string()).optional(),
  onDemandTls: z.boolean(),
  onDemandRateInterval: z.string().optional(),
  onDemandRateBurst: z.number().int().min(0).optional(),
  defaultMinTlsVersion: z.enum(['1.2', '1.3']),
})
export type TlsSettings = z.infer<typeof tlsSettingsSchema>

export const certificateSchema = z.object({
  domain: z.string(),
  issuer: z.string(),
  expiresAt: z.string(),
  status: z.enum(['valid', 'expiring', 'expired', 'revoked']),
})
export type Certificate = z.infer<typeof certificateSchema>

// --- Observability ---
export const observabilitySettingsSchema = z.object({
  traceSamplingRate: z.number().min(1).max(100),
  alwaysTraceErrors: z.boolean(),
  alwaysTraceAi: z.boolean(),
  alwaysTraceSlowRequests: z.boolean(),
  slowRequestThresholdMs: z.number().int().min(0),
  retentionRawTraces: z.string(),
  retentionAggregatedStats: z.string(),
  retentionAiSessions: z.string(),
  storageBackend: z.string(), // read-only
  storageUsedBytes: z.number(), // read-only
  storageMaxBytes: z.number(), // read-only
  ipMasking: z.boolean(),
  ipMaskPrefixLength: z.number().int().min(0).max(128).optional(),
  queryParamRedaction: z.array(z.string()),
  cookieRedaction: z.array(z.string()),
  customPiiRegexes: z.array(z.string()),
  prometheusEnabled: z.boolean(),
  otelExporterEndpoint: z.string().optional(),
})
export type ObservabilitySettings = z.infer<typeof observabilitySettingsSchema>

// --- Config Store ---
export const configStoreSettingsSchema = z.object({
  backendType: z.string(), // read-only
  connectionInfo: z.string(), // read-only, masked
  configVersion: z.number(), // read-only
  storeHealth: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
})
export type ConfigStoreSettings = z.infer<typeof configStoreSettingsSchema>

export const migrationEntrySchema = z.object({
  version: z.number(),
  name: z.string(),
  appliedAt: z.string(),
  status: z.enum(['applied', 'pending', 'failed']),
})
export type MigrationEntry = z.infer<typeof migrationEntrySchema>

// --- Authentication ---
export const authSettingsSchema = z.object({
  sessionCookieLifetime: z.string(),
  sessionIdleTimeout: z.string(),
  maxConcurrentSessions: z.number().int().min(1),
  passwordMinLength: z.number().int().min(8).max(128),
  passwordRequireUppercase: z.boolean(),
  passwordRequireLowercase: z.boolean(),
  passwordRequireNumber: z.boolean(),
  passwordRequireSpecial: z.boolean(),
  passwordMaxAgeDays: z.number().int().min(0),
  lockoutMaxAttempts: z.number().int().min(1),
  lockoutDuration: z.string(),
  lockoutResetWindow: z.string(),
  totpIssuerName: z.string().min(1),
  totpEnforceForAll: z.boolean(),
  bruteForceRateLimit: z.number().int().min(0),
})
export type AuthSettings = z.infer<typeof authSettingsSchema>

// --- PKI ---
export const pkiSettingsSchema = z.object({
  caAlgorithm: z.string(), // read-only
  caValidityDays: z.number(), // read-only
  caExpiresAt: z.string(), // read-only
  caFingerprint: z.string(), // read-only
  nodeCertExpiresAt: z.string(), // read-only
  nodeCertSans: z.array(z.string()), // read-only
  autoRotationThresholdDays: z.number().int().min(1),
  dbClientCertStatus: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
})
export type PkiSettings = z.infer<typeof pkiSettingsSchema>

export const rotationHistoryEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['ca', 'node', 'db-client']),
  rotatedAt: z.string(),
  reason: z.string(),
  actor: z.string(),
})
export type RotationHistoryEntry = z.infer<typeof rotationHistoryEntrySchema>

// --- Danger Zone actions ---
export const dangerZoneActions = [
  {
    id: 'reset-config',
    confirmPhrase: 'reset all configuration',
  },
  {
    id: 'rotate-token',
    confirmPhrase: 'rotate bootstrap token',
  },
  {
    id: 'purge-traces',
    confirmPhrase: 'purge all traces',
  },
  {
    id: 'factory-reset',
    confirmPhrase: 'factory reset rioku',
  },
] as const
```

- [ ] **Step 2: Write tests for Zod schemas**

Create `packages/web/src/lib/schemas/__tests__/settings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  generalSettingsSchema,
  networkSettingsSchema,
  tlsSettingsSchema,
  observabilitySettingsSchema,
  configStoreSettingsSchema,
  authSettingsSchema,
  pkiSettingsSchema,
} from '../settings'

describe('generalSettingsSchema', () => {
  it('accepts valid general settings', () => {
    const result = generalSettingsSchema.safeParse({
      instanceName: 'production-gateway',
      dataDirectory: '/var/lib/rioku',
      logLevel: 'info',
      daemonVersion: '0.3.0',
      caddyVersion: '2.9.1',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty instance name', () => {
    const result = generalSettingsSchema.safeParse({
      instanceName: '',
      dataDirectory: '/var/lib/rioku',
      logLevel: 'info',
      daemonVersion: '0.3.0',
      caddyVersion: '2.9.1',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid log level', () => {
    const result = generalSettingsSchema.safeParse({
      instanceName: 'test',
      dataDirectory: '/var/lib/rioku',
      logLevel: 'trace',
      daemonVersion: '0.3.0',
      caddyVersion: '2.9.1',
    })
    expect(result.success).toBe(false)
  })
})

describe('networkSettingsSchema', () => {
  it('accepts valid CIDR in trustedProxies', () => {
    const result = networkSettingsSchema.safeParse({
      trustedProxies: ['10.0.0.0/8', '172.16.0.0/12'],
      clientIpHeaders: ['X-Forwarded-For'],
      strictMode: false,
      listenAddresses: {
        grpc: ':7777', rest: ':7778',
        caddyHttp: ':80', caddyHttps: ':443', admin: ':2019',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid CIDR notation', () => {
    const result = networkSettingsSchema.safeParse({
      trustedProxies: ['not-a-cidr'],
      clientIpHeaders: ['X-Forwarded-For'],
      strictMode: false,
      listenAddresses: {
        grpc: ':7777', rest: ':7778',
        caddyHttp: ':80', caddyHttps: ':443', admin: ':2019',
      },
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty trustedProxies array', () => {
    const result = networkSettingsSchema.safeParse({
      trustedProxies: [],
      clientIpHeaders: [],
      strictMode: true,
      listenAddresses: {
        grpc: ':7777', rest: ':7778',
        caddyHttp: ':80', caddyHttps: ':443', admin: ':2019',
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('tlsSettingsSchema', () => {
  it('accepts valid TLS settings', () => {
    const result = tlsSettingsSchema.safeParse({
      acmeProvider: 'letsencrypt',
      dnsChallengeProvider: 'cloudflare',
      dnsChallengeCredentials: { apiToken: '***' },
      onDemandTls: false,
      defaultMinTlsVersion: '1.2',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid ACME provider', () => {
    const result = tlsSettingsSchema.safeParse({
      acmeProvider: 'custom',
      dnsChallengeProvider: 'none',
      onDemandTls: false,
      defaultMinTlsVersion: '1.2',
    })
    expect(result.success).toBe(false)
  })
})

describe('observabilitySettingsSchema', () => {
  it('accepts valid observability settings', () => {
    const result = observabilitySettingsSchema.safeParse({
      traceSamplingRate: 50,
      alwaysTraceErrors: true,
      alwaysTraceAi: true,
      alwaysTraceSlowRequests: false,
      slowRequestThresholdMs: 3000,
      retentionRawTraces: '7d',
      retentionAggregatedStats: '90d',
      retentionAiSessions: '30d',
      storageBackend: 'sqlite',
      storageUsedBytes: 104857600,
      storageMaxBytes: 1073741824,
      ipMasking: true,
      ipMaskPrefixLength: 24,
      queryParamRedaction: ['password', 'token'],
      cookieRedaction: ['session_id'],
      customPiiRegexes: [],
      prometheusEnabled: false,
      otelExporterEndpoint: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects sampling rate below 1', () => {
    const result = observabilitySettingsSchema.safeParse({
      traceSamplingRate: 0,
      alwaysTraceErrors: false,
      alwaysTraceAi: false,
      alwaysTraceSlowRequests: false,
      slowRequestThresholdMs: 3000,
      retentionRawTraces: '7d',
      retentionAggregatedStats: '90d',
      retentionAiSessions: '30d',
      storageBackend: 'sqlite',
      storageUsedBytes: 0,
      storageMaxBytes: 0,
      ipMasking: false,
      queryParamRedaction: [],
      cookieRedaction: [],
      customPiiRegexes: [],
      prometheusEnabled: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects sampling rate above 100', () => {
    const result = observabilitySettingsSchema.safeParse({
      traceSamplingRate: 150,
      alwaysTraceErrors: false,
      alwaysTraceAi: false,
      alwaysTraceSlowRequests: false,
      slowRequestThresholdMs: 3000,
      retentionRawTraces: '7d',
      retentionAggregatedStats: '90d',
      retentionAiSessions: '30d',
      storageBackend: 'sqlite',
      storageUsedBytes: 0,
      storageMaxBytes: 0,
      ipMasking: false,
      queryParamRedaction: [],
      cookieRedaction: [],
      customPiiRegexes: [],
      prometheusEnabled: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('authSettingsSchema', () => {
  it('accepts valid authentication settings', () => {
    const result = authSettingsSchema.safeParse({
      sessionCookieLifetime: '24h',
      sessionIdleTimeout: '30m',
      maxConcurrentSessions: 5,
      passwordMinLength: 12,
      passwordRequireUppercase: true,
      passwordRequireLowercase: true,
      passwordRequireNumber: true,
      passwordRequireSpecial: false,
      passwordMaxAgeDays: 90,
      lockoutMaxAttempts: 5,
      lockoutDuration: '15m',
      lockoutResetWindow: '1h',
      totpIssuerName: 'Rioku Gateway',
      totpEnforceForAll: false,
      bruteForceRateLimit: 10,
    })
    expect(result.success).toBe(true)
  })

  it('rejects password min length below 8', () => {
    const result = authSettingsSchema.safeParse({
      sessionCookieLifetime: '24h',
      sessionIdleTimeout: '30m',
      maxConcurrentSessions: 5,
      passwordMinLength: 4,
      passwordRequireUppercase: false,
      passwordRequireLowercase: false,
      passwordRequireNumber: false,
      passwordRequireSpecial: false,
      passwordMaxAgeDays: 0,
      lockoutMaxAttempts: 5,
      lockoutDuration: '15m',
      lockoutResetWindow: '1h',
      totpIssuerName: 'Rioku',
      totpEnforceForAll: false,
      bruteForceRateLimit: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('pkiSettingsSchema', () => {
  it('accepts valid PKI settings', () => {
    const result = pkiSettingsSchema.safeParse({
      caAlgorithm: 'ecdsa-p256',
      caValidityDays: 3650,
      caExpiresAt: '2036-04-10T00:00:00Z',
      caFingerprint: 'SHA256:abc123...',
      nodeCertExpiresAt: '2027-04-10T00:00:00Z',
      nodeCertSans: ['node-1.rioku.local'],
      autoRotationThresholdDays: 30,
      dbClientCertStatus: 'healthy',
    })
    expect(result.success).toBe(true)
  })

  it('rejects auto-rotation threshold below 1', () => {
    const result = pkiSettingsSchema.safeParse({
      caAlgorithm: 'ecdsa-p256',
      caValidityDays: 3650,
      caExpiresAt: '2036-04-10T00:00:00Z',
      caFingerprint: 'SHA256:abc123...',
      nodeCertExpiresAt: '2027-04-10T00:00:00Z',
      nodeCertSans: [],
      autoRotationThresholdDays: 0,
      dbClientCertStatus: 'healthy',
    })
    expect(result.success).toBe(false)
  })
})

describe('configStoreSettingsSchema', () => {
  it('accepts valid config store settings', () => {
    const result = configStoreSettingsSchema.safeParse({
      backendType: 'sqlite',
      connectionInfo: '/var/lib/rioku/store.db',
      configVersion: 42,
      storeHealth: 'healthy',
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 3: Write TagInput component tests**

Create `packages/web/src/components/rioku/__tests__/tag-input.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagInput } from '../tag-input'

describe('TagInput', () => {
  it('renders existing tags', () => {
    render(
      <TagInput
        value={['X-Forwarded-For', 'X-Real-IP']}
        onChange={vi.fn()}
        label="Client IP Headers"
      />,
    )
    expect(screen.getByText('X-Forwarded-For')).toBeInTheDocument()
    expect(screen.getByText('X-Real-IP')).toBeInTheDocument()
  })

  it('adds a tag when Enter is pressed', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TagInput value={[]} onChange={onChange} label="Headers" />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'X-Custom-Header{enter}')
    expect(onChange).toHaveBeenCalledWith(['X-Custom-Header'])
  })

  it('removes a tag when remove button is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TagInput
        value={['tag-a', 'tag-b']}
        onChange={onChange}
        label="Tags"
      />,
    )

    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await user.click(removeButtons[0])
    expect(onChange).toHaveBeenCalledWith(['tag-b'])
  })

  it('does not add duplicate tags', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TagInput value={['existing']} onChange={onChange} label="Tags" />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'existing{enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not add empty tags', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TagInput value={[]} onChange={onChange} label="Tags" />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, '   {enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders as disabled', () => {
    render(
      <TagInput value={['tag']} onChange={vi.fn()} label="Tags" disabled />,
    )

    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('shows placeholder text', () => {
    render(
      <TagInput
        value={[]}
        onChange={vi.fn()}
        label="Tags"
        placeholder="Add a CIDR range..."
      />,
    )

    expect(screen.getByPlaceholderText('Add a CIDR range...')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Implement TagInput component**

Create `packages/web/src/components/rioku/tag-input.tsx`:

```tsx
import { useState, type KeyboardEvent } from 'react'
import { XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface TagInputProps {
  value: string[]
  onChange: (value: string[]) => void
  label: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

function TagInput({
  value,
  onChange,
  label,
  placeholder = 'Type and press Enter...',
  disabled = false,
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('')

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = inputValue.trim()
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed])
        setInputValue('')
      }
    }
  }

  const handleRemove = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="gap-1 pr-1"
          >
            <span className="font-mono text-xs">{tag}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => handleRemove(tag)}
                className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${tag}`}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  )
}

export { TagInput }
export type { TagInputProps }
```

- [ ] **Step 5: Write SettingsField component tests**

Create `packages/web/src/components/rioku/__tests__/settings-field.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsField } from '../settings-field'

describe('SettingsField', () => {
  it('renders children when backend is available', () => {
    render(
      <SettingsField label="Instance name" needsBackend={false}>
        <input data-testid="child-input" />
      </SettingsField>,
    )
    expect(screen.getByTestId('child-input')).toBeInTheDocument()
    expect(screen.queryByText(/requires backend/i)).not.toBeInTheDocument()
  })

  it('renders disabled state with backend notice', () => {
    render(
      <SettingsField label="Trace sampling" needsBackend>
        <input data-testid="child-input" />
      </SettingsField>,
    )
    expect(screen.getByText(/requires backend/i)).toBeInTheDocument()
  })

  it('renders read-only badge for read-only fields', () => {
    render(
      <SettingsField label="Data directory" readOnly>
        <input data-testid="child-input" />
      </SettingsField>,
    )
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('renders the label', () => {
    render(
      <SettingsField label="Log level" needsBackend={false}>
        <input />
      </SettingsField>,
    )
    expect(screen.getByText('Log level')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <SettingsField
        label="Strict mode"
        description="Reject requests from untrusted proxies"
        needsBackend={false}
      >
        <input />
      </SettingsField>,
    )
    expect(
      screen.getByText('Reject requests from untrusted proxies'),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Implement SettingsField component**

Create `packages/web/src/components/rioku/settings-field.tsx`:

```tsx
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface SettingsFieldProps {
  label: string
  description?: string
  needsBackend?: boolean
  readOnly?: boolean
  children: React.ReactNode
  className?: string
}

function SettingsField({
  label,
  description,
  needsBackend = false,
  readOnly = false,
  children,
  className,
}: SettingsFieldProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-1.5">
        <Label>{label}</Label>
        {readOnly && (
          <Badge variant="outline" className="text-xs">
            Read-only
          </Badge>
        )}
        {needsBackend && (
          <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">
            Requires backend API
          </Badge>
        )}
      </div>
      {description && (
        <p className="text-sm text-muted-foreground mb-2">{description}</p>
      )}
      <div className={needsBackend ? 'opacity-60 pointer-events-none' : ''}>
        {children}
      </div>
    </div>
  )
}

export { SettingsField }
export type { SettingsFieldProps }
```

- [ ] **Step 7: Write TypedConfirmationDialog tests**

Create `packages/web/src/components/rioku/__tests__/typed-confirmation-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TypedConfirmationDialog } from '../typed-confirmation-dialog'

describe('TypedConfirmationDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Factory Reset',
    description: 'This will erase all data.',
    confirmPhrase: 'factory reset rioku',
    onConfirm: vi.fn(),
  }

  it('renders title and description', () => {
    render(<TypedConfirmationDialog {...defaultProps} />)
    expect(screen.getByText('Factory Reset')).toBeInTheDocument()
    expect(screen.getByText('This will erase all data.')).toBeInTheDocument()
  })

  it('shows the required phrase', () => {
    render(<TypedConfirmationDialog {...defaultProps} />)
    expect(screen.getByText(/factory reset rioku/)).toBeInTheDocument()
  })

  it('disables confirm button until phrase is typed correctly', () => {
    render(<TypedConfirmationDialog {...defaultProps} />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn).toBeDisabled()
  })

  it('enables confirm button when phrase matches', async () => {
    const user = userEvent.setup()
    render(<TypedConfirmationDialog {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'factory reset rioku')

    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn).not.toBeDisabled()
  })

  it('calls onConfirm when phrase matches and button clicked', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    render(
      <TypedConfirmationDialog {...defaultProps} onConfirm={onConfirm} />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'factory reset rioku')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not call onConfirm when phrase is wrong', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    render(
      <TypedConfirmationDialog {...defaultProps} onConfirm={onConfirm} />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'wrong phrase')

    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn).toBeDisabled()
  })

  it('resets input when closed and reopened', () => {
    const { rerender } = render(
      <TypedConfirmationDialog {...defaultProps} open={false} />,
    )
    rerender(<TypedConfirmationDialog {...defaultProps} open={true} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('')
  })
})
```

- [ ] **Step 8: Implement TypedConfirmationDialog component**

Create `packages/web/src/components/rioku/typed-confirmation-dialog.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { LoaderIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TypedConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmPhrase: string
  confirmLabel?: string
  onConfirm: () => void
  loading?: boolean
}

function TypedConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel = 'Confirm',
  onConfirm,
  loading = false,
}: TypedConfirmationDialogProps) {
  const [typed, setTyped] = useState('')
  const matches = typed === confirmPhrase

  useEffect(() => {
    if (open) setTyped('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label>
            Type{' '}
            <span className="font-mono font-semibold text-destructive">
              {confirmPhrase}
            </span>{' '}
            to confirm
          </Label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmPhrase}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!matches || loading}
          >
            {loading && <LoaderIcon className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TypedConfirmationDialog }
export type { TypedConfirmationDialogProps }
```

- [ ] **Step 9: Write ProgressBar tests**

Create `packages/web/src/components/rioku/__tests__/progress-bar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from '../progress-bar'

describe('ProgressBar', () => {
  it('renders with correct percentage', () => {
    render(<ProgressBar value={75} max={100} label="Storage" />)
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
  })

  it('renders formatted byte values', () => {
    render(
      <ProgressBar
        value={536870912}
        max={1073741824}
        label="Trace storage"
        formatValue={(v) => `${(v / 1073741824).toFixed(1)} GB`}
      />,
    )
    expect(screen.getByText('0.5 GB')).toBeInTheDocument()
    expect(screen.getByText('1.0 GB')).toBeInTheDocument()
  })

  it('renders with warning color when above threshold', () => {
    const { container } = render(
      <ProgressBar value={90} max={100} label="Storage" warningThreshold={80} />
    )
    const bar = container.querySelector('[data-slot="progress-fill"]')
    expect(bar?.className).toContain('bg-amber')
  })

  it('renders with danger color when above danger threshold', () => {
    const { container } = render(
      <ProgressBar value={96} max={100} label="Storage" dangerThreshold={95} />
    )
    const bar = container.querySelector('[data-slot="progress-fill"]')
    expect(bar?.className).toContain('bg-red')
  })

  it('handles zero max gracefully', () => {
    render(<ProgressBar value={0} max={0} label="Empty" />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('has correct aria attributes', () => {
    render(<ProgressBar value={50} max={100} label="Storage" />)
    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow', '50')
    expect(progressbar).toHaveAttribute('aria-valuemin', '0')
    expect(progressbar).toHaveAttribute('aria-valuemax', '100')
  })
})
```

- [ ] **Step 10: Implement ProgressBar component**

Create `packages/web/src/components/rioku/progress-bar.tsx`:

```tsx
import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number
  max: number
  label: string
  formatValue?: (value: number) => string
  warningThreshold?: number
  dangerThreshold?: number
  className?: string
}

function ProgressBar({
  value,
  max,
  label,
  formatValue,
  warningThreshold = 80,
  dangerThreshold = 95,
  className,
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.round((value / max) * 100) : 0
  const normalizedPercentage = Math.min(percentage, 100)

  const fillColor =
    percentage >= dangerThreshold
      ? 'bg-red-500'
      : percentage >= warningThreshold
        ? 'bg-amber-500'
        : 'bg-primary'

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{percentage}%</span>
      </div>
      <div
        className="h-2.5 w-full rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          data-slot="progress-fill"
          className={cn('h-full rounded-full transition-all duration-300', fillColor)}
          style={{ width: `${normalizedPercentage}%` }}
        />
      </div>
      {formatValue && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-muted-foreground">
            {formatValue(value)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatValue(max)}
          </span>
        </div>
      )}
    </div>
  )
}

export { ProgressBar }
export type { ProgressBarProps }
```

- [ ] **Step 11: Update i18n settings locale**

Replace `packages/web/src/locales/en/settings.json` with expanded keys for all 8 sub-pages:

```json
{
  "title": "Settings",
  "subtitle": "Daemon and platform configuration",
  "nav": {
    "general": "General",
    "network": "Network",
    "tls": "TLS & Certificates",
    "observability": "Observability",
    "configStore": "Config Store",
    "authentication": "Authentication",
    "pki": "PKI",
    "dangerZone": "Danger Zone"
  },
  "general": {
    "title": "General Settings",
    "description": "Core instance configuration and version information.",
    "instanceName": "Instance name",
    "instanceNameDescription": "A friendly name for this Rioku instance",
    "dataDirectory": "Data directory",
    "logLevel": "Log level",
    "daemonVersion": "Daemon version",
    "caddyVersion": "Caddy version"
  },
  "network": {
    "title": "Network Settings",
    "description": "Proxy trust, client IP detection, and listening addresses.",
    "trustedProxies": "Trusted proxies",
    "trustedProxiesDescription": "CIDR ranges of trusted reverse proxies",
    "trustedProxiesPlaceholder": "Add CIDR range (e.g., 10.0.0.0/8)...",
    "clientIpHeaders": "Client IP headers",
    "clientIpHeadersDescription": "HTTP headers to extract the real client IP from",
    "clientIpHeadersPlaceholder": "Add header name...",
    "strictMode": "Strict mode",
    "strictModeDescription": "Reject requests from addresses not in the trusted proxy list",
    "listenAddresses": "Listening addresses",
    "grpc": "gRPC",
    "rest": "REST API",
    "caddyHttp": "Caddy HTTP",
    "caddyHttps": "Caddy HTTPS",
    "admin": "Admin API"
  },
  "tls": {
    "title": "TLS & Certificates",
    "description": "ACME providers, DNS challenges, on-demand TLS, and certificate management.",
    "acmeProvider": "ACME provider",
    "dnsChallengeProvider": "DNS challenge provider",
    "dnsChallengeCredentials": "DNS provider credentials",
    "onDemandTls": "On-demand TLS",
    "onDemandTlsDescription": "Automatically provision certificates on first request",
    "onDemandRateInterval": "Rate limit interval",
    "onDemandRateBurst": "Rate limit burst",
    "defaultMinTlsVersion": "Default minimum TLS version",
    "certificates": "Active certificates",
    "domain": "Domain",
    "issuer": "Issuer",
    "expires": "Expires",
    "status": "Status",
    "actions": "Actions",
    "forceRenew": "Force renew",
    "revoke": "Revoke",
    "noCertificates": "No certificates found."
  },
  "observability": {
    "title": "Observability",
    "description": "Trace sampling, retention, PII filters, and metric exporters.",
    "traceSampling": "Trace sampling rate",
    "alwaysTraceErrors": "Always trace errors",
    "alwaysTraceAi": "Always trace AI requests",
    "alwaysTraceSlowRequests": "Always trace slow requests",
    "slowRequestThreshold": "Slow request threshold (ms)",
    "retention": "Retention",
    "retentionRawTraces": "Raw traces",
    "retentionAggregatedStats": "Aggregated stats",
    "retentionAiSessions": "AI sessions",
    "storage": "Trace storage",
    "storageBackend": "Backend",
    "storageUsage": "Storage usage",
    "piiFilters": "PII log filters",
    "ipMasking": "IP masking",
    "ipMaskPrefixLength": "IP mask prefix length",
    "queryParamRedaction": "Query parameter redaction",
    "queryParamRedactionPlaceholder": "Add parameter name...",
    "cookieRedaction": "Cookie redaction",
    "cookieRedactionPlaceholder": "Add cookie name...",
    "customPiiRegexes": "Custom PII regex patterns",
    "customPiiRegexesPlaceholder": "Add regex pattern...",
    "prometheus": "Prometheus endpoint",
    "prometheusDescription": "Expose /metrics for Prometheus scraping",
    "otelExporter": "OpenTelemetry exporter endpoint",
    "otelExporterPlaceholder": "http://otel-collector:4318"
  },
  "configStore": {
    "title": "Config Store",
    "description": "Database backend status, versioning, and migration history.",
    "backendType": "Backend type",
    "connectionInfo": "Connection info",
    "configVersion": "Config version",
    "storeHealth": "Store health",
    "migrations": "Migration history",
    "migrationVersion": "Version",
    "migrationName": "Name",
    "migrationAppliedAt": "Applied at",
    "migrationStatus": "Status",
    "noMigrations": "No migrations found.",
    "exportConfig": "Export config",
    "importConfig": "Import config"
  },
  "authentication": {
    "title": "Authentication",
    "description": "Session policies, password rules, lockout, and two-factor settings.",
    "ssoNote": "Third-party SSO provider management (OIDC, SAML, OAuth2, LDAP) is planned in a separate spec.",
    "sessions": "Session settings",
    "cookieLifetime": "Cookie lifetime",
    "idleTimeout": "Idle timeout",
    "maxConcurrentSessions": "Max concurrent sessions",
    "passwordPolicy": "Password policy",
    "minLength": "Minimum length",
    "requireUppercase": "Require uppercase",
    "requireLowercase": "Require lowercase",
    "requireNumber": "Require number",
    "requireSpecial": "Require special character",
    "maxAgeDays": "Max password age (days)",
    "lockout": "Account lockout",
    "maxAttempts": "Max failed attempts",
    "lockoutDuration": "Lockout duration",
    "resetWindow": "Reset window",
    "totp": "TOTP two-factor authentication",
    "totpIssuerName": "Issuer name",
    "totpEnforceForAll": "Enforce TOTP for all users",
    "bruteForce": "Brute-force protection",
    "bruteForceRateLimit": "Max login attempts per minute"
  },
  "pki": {
    "title": "PKI (Internal)",
    "description": "Certificate authority, node certificates, and key rotation.",
    "caStatus": "Certificate Authority",
    "caAlgorithm": "Algorithm",
    "caValidity": "Validity",
    "caExpires": "Expires",
    "caFingerprint": "Fingerprint",
    "nodeCert": "Node certificate",
    "nodeCertExpires": "Expires",
    "nodeCertSans": "SANs",
    "autoRotationThreshold": "Auto-rotation threshold (days)",
    "dbClientCert": "DB client certificate",
    "dbClientCertStatus": "Status",
    "rotationHistory": "Rotation history",
    "rotationType": "Type",
    "rotatedAt": "Rotated at",
    "rotationReason": "Reason",
    "rotationActor": "Actor",
    "noRotations": "No rotation history.",
    "forceRotation": "Force certificate rotation",
    "forceRotationDescription": "Immediately rotate all certificates. Connected nodes will re-enroll.",
    "downloadCaCert": "Download CA certificate"
  },
  "dangerZone": {
    "title": "Danger Zone",
    "description": "Destructive operations. These actions cannot be undone.",
    "resetConfig": "Reset all configuration",
    "resetConfigDescription": "Delete all routes, services, and policies. Returns to factory defaults.",
    "resetConfigPhrase": "reset all configuration",
    "rotateToken": "Rotate bootstrap token",
    "rotateTokenDescription": "Invalidate the current bootstrap token. All CLI sessions using it will disconnect.",
    "rotateTokenPhrase": "rotate bootstrap token",
    "purgeTraces": "Purge all traces",
    "purgeTracesDescription": "Delete all stored traces, analytics, and AI session data.",
    "purgeTracesPhrase": "purge all traces",
    "factoryReset": "Factory reset",
    "factoryResetDescription": "Erase all data including users, certificates, and configuration. The instance will restart in setup mode.",
    "factoryResetPhrase": "factory reset rioku"
  },
  "actions": {
    "save": "Save changes",
    "reset": "Reset",
    "saving": "Saving..."
  },
  "sections": {
    "general": "General",
    "store": "Store",
    "pki": "PKI",
    "ai": "AI",
    "logging": "Logging"
  },
  "labels": {
    "daemonAddress": "Daemon address",
    "dataDirectory": "Data directory",
    "driver": "Driver",
    "connectionString": "Connection string",
    "caAlgorithm": "CA algorithm",
    "rotationThreshold": "Rotation threshold",
    "certStatus": "Certificate status",
    "traceStore": "Trace store",
    "retentionPeriod": "Retention period",
    "logLevel": "Log level"
  }
}
```

- [ ] **Step 12: Add settings API types to api.ts**

Append the following type exports to `packages/web/src/lib/api.ts` (before the `apiClient` object):

```typescript
// --- Settings types ---

export interface GeneralSettingsResponse {
  instanceName: string
  dataDirectory: string
  logLevel: string
  daemonVersion: string
  caddyVersion: string
}

export interface NetworkSettingsResponse {
  trustedProxies: string[]
  clientIpHeaders: string[]
  strictMode: boolean
  listenAddresses: {
    grpc: string
    rest: string
    caddyHttp: string
    caddyHttps: string
    admin: string
  }
}

export interface CertificateInfo {
  domain: string
  issuer: string
  expiresAt: string
  status: 'valid' | 'expiring' | 'expired' | 'revoked'
}

export interface TlsSettingsResponse {
  acmeProvider: string
  dnsChallengeProvider: string
  dnsChallengeCredentials: Record<string, string>
  onDemandTls: boolean
  onDemandRateInterval: string
  onDemandRateBurst: number
  defaultMinTlsVersion: string
  certificates: CertificateInfo[]
}

export interface ObservabilitySettingsResponse {
  traceSamplingRate: number
  alwaysTraceErrors: boolean
  alwaysTraceAi: boolean
  alwaysTraceSlowRequests: boolean
  slowRequestThresholdMs: number
  retentionRawTraces: string
  retentionAggregatedStats: string
  retentionAiSessions: string
  storageBackend: string
  storageUsedBytes: number
  storageMaxBytes: number
  ipMasking: boolean
  ipMaskPrefixLength: number
  queryParamRedaction: string[]
  cookieRedaction: string[]
  customPiiRegexes: string[]
  prometheusEnabled: boolean
  otelExporterEndpoint: string
}

export interface MigrationInfo {
  version: number
  name: string
  appliedAt: string
  status: 'applied' | 'pending' | 'failed'
}

export interface ConfigStoreSettingsResponse {
  backendType: string
  connectionInfo: string
  configVersion: number
  storeHealth: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  migrations: MigrationInfo[]
}

export interface AuthSettingsResponse {
  sessionCookieLifetime: string
  sessionIdleTimeout: string
  maxConcurrentSessions: number
  passwordMinLength: number
  passwordRequireUppercase: boolean
  passwordRequireLowercase: boolean
  passwordRequireNumber: boolean
  passwordRequireSpecial: boolean
  passwordMaxAgeDays: number
  lockoutMaxAttempts: number
  lockoutDuration: string
  lockoutResetWindow: string
  totpIssuerName: string
  totpEnforceForAll: boolean
  bruteForceRateLimit: number
}

export interface RotationHistoryInfo {
  id: string
  type: 'ca' | 'node' | 'db-client'
  rotatedAt: string
  reason: string
  actor: string
}

export interface PkiSettingsResponse {
  caAlgorithm: string
  caValidityDays: number
  caExpiresAt: string
  caFingerprint: string
  nodeCertExpiresAt: string
  nodeCertSans: string[]
  autoRotationThresholdDays: number
  dbClientCertStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  rotationHistory: RotationHistoryInfo[]
}
```

- [ ] **Step 13: Run schema and component tests**

```bash
cd packages/web && npx vitest run src/lib/schemas/__tests__/settings.test.ts src/components/rioku/__tests__/tag-input.test.tsx src/components/rioku/__tests__/settings-field.test.tsx src/components/rioku/__tests__/typed-confirmation-dialog.test.tsx src/components/rioku/__tests__/progress-bar.test.tsx
```

Expected: All tests pass.

- [ ] **Step 14: Commit**

```bash
git commit -m "feat(web): settings infrastructure — Zod schemas, TagInput, SettingsField, TypedConfirmationDialog, ProgressBar, i18n"
```

---

## Task 2: Update Settings Layout and Route `/settings` to Redirect to `/settings/general`

**Files:**
- Modify: `packages/web/src/routes/settings.tsx`

The current `settings.tsx` renders all settings inline when on `/settings`. This task changes it to:
1. When path is `/settings`, redirect to `/settings/general`
2. Render a settings layout with a left sub-nav listing all 8 sub-pages
3. Render `<Outlet />` for the active sub-page

- [ ] **Step 1: Rewrite settings.tsx**

Replace `packages/web/src/routes/settings.tsx` with:

```tsx
import { createFileRoute, Outlet, Link, redirect, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  SettingsIcon,
  NetworkIcon,
  ShieldIcon,
  LockIcon,
  DatabaseIcon,
  EyeIcon,
  KeyIcon,
  AlertTriangleIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { Slot } from '@/components/plugin/slot'
import { cn } from '@/lib/utils'

const settingsNavItems = [
  { path: '/settings/general', i18nKey: 'nav.general', icon: SettingsIcon },
  { path: '/settings/network', i18nKey: 'nav.network', icon: NetworkIcon },
  { path: '/settings/tls', i18nKey: 'nav.tls', icon: ShieldIcon },
  { path: '/settings/observability', i18nKey: 'nav.observability', icon: EyeIcon },
  { path: '/settings/config-store', i18nKey: 'nav.configStore', icon: DatabaseIcon },
  { path: '/settings/authentication', i18nKey: 'nav.authentication', icon: LockIcon },
  { path: '/settings/pki', i18nKey: 'nav.pki', icon: KeyIcon },
  { path: '/settings/danger-zone', i18nKey: 'nav.dangerZone', icon: AlertTriangleIcon },
] as const

export const Route = createFileRoute('/settings')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/settings' || location.pathname === '/settings/') {
      throw redirect({ to: '/settings/general' })
    }
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  const { t } = useTranslation('settings')
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Profile, users, and roles pages use full-width layout (no sub-nav)
  const fullWidthPaths = ['/settings/profile', '/settings/users', '/settings/roles']
  if (fullWidthPaths.some((p) => pathname.startsWith(p))) {
    return <Outlet />
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sub-navigation */}
        <nav className="w-full shrink-0 lg:w-56">
          <ul className="space-y-1">
            {settingsNavItems.map((item) => {
              const isActive = pathname === item.path
              const Icon = item.icon
              const isDanger = item.path === '/settings/danger-zone'
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      isDanger && !isActive && 'text-red-500 dark:text-red-400',
                      isDanger && isActive && 'bg-red-500/10 text-red-600 dark:text-red-400',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {t(item.i18nKey)}
                  </Link>
                </li>
              )
            })}
          </ul>
          <Slot zone="settings.nav" />
        </nav>

        {/* Page content */}
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the route works (manual or type check)**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): settings sub-nav layout with redirect to /settings/general"
```

---

## Task 3: General Settings Page

**Files:**
- Create: `packages/web/src/routes/settings/general.tsx`

- [ ] **Step 1: Implement general settings page**

Create `packages/web/src/routes/settings/general.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SaveIcon, RotateCcwIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { GeneralSettingsResponse } from '@/lib/api'
import {
  generalSettingsSchema,
  type GeneralSettings,
} from '@/lib/schemas/settings'
import { SettingsField } from '@/components/rioku/settings-field'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

// Realistic defaults for when backend API is not wired
const defaults: GeneralSettings = {
  instanceName: 'rioku-gateway',
  dataDirectory: '/var/lib/rioku',
  logLevel: 'info',
  daemonVersion: '0.3.0',
  caddyVersion: '2.9.1',
}

export const Route = createFileRoute('/settings/general')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'general'],
        queryFn: () => apiClient.get<GeneralSettingsResponse>('/settings/general'),
      })
      .catch(() => defaults),
  component: GeneralSettingsPage,
})

function GeneralSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as GeneralSettings
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<GeneralSettings>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: data,
  })

  const saveMutation = useMutation({
    mutationFn: (values: GeneralSettings) =>
      apiClient.patch('/settings/general', {
        instanceName: values.instanceName,
        logLevel: values.logLevel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'general'] })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('general.title')}</CardTitle>
          <CardDescription>{t('general.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Instance name */}
            <SettingsField
              label={t('general.instanceName')}
              description={t('general.instanceNameDescription')}
              needsBackend
            >
              <Controller
                name="instanceName"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    aria-invalid={!!errors.instanceName}
                  />
                )}
              />
              {errors.instanceName && (
                <p className="text-sm text-destructive mt-1">
                  {errors.instanceName.message}
                </p>
              )}
            </SettingsField>

            {/* Log level */}
            <SettingsField label={t('general.logLevel')}>
              <Controller
                name="logLevel"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="debug">debug</SelectItem>
                      <SelectItem value="info">info</SelectItem>
                      <SelectItem value="warn">warn</SelectItem>
                      <SelectItem value="error">error</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </SettingsField>
          </div>

          {/* Read-only fields */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <SettingsField label={t('general.dataDirectory')} readOnly>
              <Input value={data.dataDirectory} readOnly className="font-mono" />
            </SettingsField>

            <SettingsField label={t('general.daemonVersion')} readOnly>
              <Input value={data.daemonVersion} readOnly className="font-mono" />
            </SettingsField>

            <SettingsField label={t('general.caddyVersion')} readOnly>
              <Input value={data.caddyVersion} readOnly className="font-mono" />
            </SettingsField>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(data)}
          disabled={!isDirty}
        >
          <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
          {t('actions.reset')}
        </Button>
        <Button type="submit" disabled={!isDirty || saveMutation.isPending}>
          <SaveIcon className="size-3.5" data-icon="inline-start" />
          {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Verify type check**

```bash
cd packages/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): general settings page — instance name, log level, version info"
```

---

## Task 4: Network Settings Page

**Files:**
- Create: `packages/web/src/routes/settings/network.tsx`

- [ ] **Step 1: Implement network settings page**

Create `packages/web/src/routes/settings/network.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SaveIcon, RotateCcwIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { NetworkSettingsResponse } from '@/lib/api'
import {
  networkSettingsSchema,
  type NetworkSettings,
} from '@/lib/schemas/settings'
import { SettingsField } from '@/components/rioku/settings-field'
import { TagInput } from '@/components/rioku/tag-input'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const defaults: NetworkSettings = {
  trustedProxies: [],
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

export const Route = createFileRoute('/settings/network')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'network'],
        queryFn: () =>
          apiClient.get<NetworkSettingsResponse>('/settings/network'),
      })
      .catch(() => defaults),
  component: NetworkSettingsPage,
})

function NetworkSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as NetworkSettings
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<NetworkSettings>({
    resolver: zodResolver(networkSettingsSchema),
    defaultValues: data,
  })

  const saveMutation = useMutation({
    mutationFn: (values: NetworkSettings) =>
      apiClient.patch('/settings/network', {
        trustedProxies: values.trustedProxies,
        clientIpHeaders: values.clientIpHeaders,
        strictMode: values.strictMode,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'network'] })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save network settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('network.title')}</CardTitle>
          <CardDescription>{t('network.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Trusted proxies */}
          <SettingsField
            label={t('network.trustedProxies')}
            description={t('network.trustedProxiesDescription')}
            needsBackend
          >
            <Controller
              name="trustedProxies"
              control={control}
              render={({ field }) => (
                <TagInput
                  value={field.value}
                  onChange={field.onChange}
                  label={t('network.trustedProxies')}
                  placeholder={t('network.trustedProxiesPlaceholder')}
                />
              )}
            />
            {errors.trustedProxies && (
              <p className="text-sm text-destructive mt-1">
                {typeof errors.trustedProxies.message === 'string'
                  ? errors.trustedProxies.message
                  : 'Invalid CIDR entries'}
              </p>
            )}
          </SettingsField>

          {/* Client IP headers */}
          <SettingsField
            label={t('network.clientIpHeaders')}
            description={t('network.clientIpHeadersDescription')}
            needsBackend
          >
            <Controller
              name="clientIpHeaders"
              control={control}
              render={({ field }) => (
                <TagInput
                  value={field.value}
                  onChange={field.onChange}
                  label={t('network.clientIpHeaders')}
                  placeholder={t('network.clientIpHeadersPlaceholder')}
                />
              )}
            />
          </SettingsField>

          {/* Strict mode */}
          <SettingsField
            label={t('network.strictMode')}
            description={t('network.strictModeDescription')}
            needsBackend
          >
            <Controller
              name="strictMode"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Label className="text-sm text-muted-foreground">
                    {field.value ? 'Enabled' : 'Disabled'}
                  </Label>
                </div>
              )}
            />
          </SettingsField>

          {/* Listening addresses (read-only) */}
          <SettingsField label={t('network.listenAddresses')} readOnly>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ['grpc', t('network.grpc')],
                  ['rest', t('network.rest')],
                  ['caddyHttp', t('network.caddyHttp')],
                  ['caddyHttps', t('network.caddyHttps')],
                  ['admin', t('network.admin')],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <Input
                    value={data.listenAddresses[key]}
                    readOnly
                    className="font-mono"
                  />
                </div>
              ))}
            </div>
          </SettingsField>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(data)}
          disabled={!isDirty}
        >
          <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
          {t('actions.reset')}
        </Button>
        <Button type="submit" disabled={!isDirty || saveMutation.isPending}>
          <SaveIcon className="size-3.5" data-icon="inline-start" />
          {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Verify type check**

```bash
cd packages/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): network settings page — trusted proxies, client IP headers, strict mode"
```

---

## Task 5: TLS & Certificates Settings Page

**Files:**
- Create: `packages/web/src/routes/settings/tls.tsx`

- [ ] **Step 1: Implement TLS settings page**

Create `packages/web/src/routes/settings/tls.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  SaveIcon,
  RotateCcwIcon,
  RefreshCwIcon,
  ShieldOffIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { TlsSettingsResponse, CertificateInfo } from '@/lib/api'
import {
  tlsSettingsSchema,
  type TlsSettings,
} from '@/lib/schemas/settings'
import { SettingsField } from '@/components/rioku/settings-field'
import { StatusBadge } from '@/components/rioku/status-badge'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// DNS challenge provider credential fields
const dnsProviderFields: Record<string, { label: string; placeholder: string }[]> = {
  cloudflare: [
    { label: 'API Token', placeholder: 'CF API token' },
  ],
  route53: [
    { label: 'Access Key ID', placeholder: 'AWS access key' },
    { label: 'Secret Access Key', placeholder: 'AWS secret key' },
    { label: 'Region', placeholder: 'us-east-1' },
  ],
  gcloud: [
    { label: 'Project ID', placeholder: 'my-gcp-project' },
    { label: 'Service Account JSON', placeholder: 'Paste JSON key...' },
  ],
  azure: [
    { label: 'Tenant ID', placeholder: 'Azure tenant ID' },
    { label: 'Client ID', placeholder: 'Azure client ID' },
    { label: 'Client Secret', placeholder: 'Azure client secret' },
    { label: 'Subscription ID', placeholder: 'Azure subscription ID' },
    { label: 'Resource Group', placeholder: 'DNS resource group' },
  ],
  digitalocean: [
    { label: 'API Token', placeholder: 'DO API token' },
  ],
}

const defaults: TlsSettings & { certificates: CertificateInfo[] } = {
  acmeProvider: 'letsencrypt',
  dnsChallengeProvider: 'none',
  dnsChallengeCredentials: {},
  onDemandTls: false,
  onDemandRateInterval: '2m',
  onDemandRateBurst: 5,
  defaultMinTlsVersion: '1.2',
  certificates: [
    {
      domain: '*.example.com',
      issuer: "Let's Encrypt",
      expiresAt: '2026-07-10T00:00:00Z',
      status: 'valid',
    },
    {
      domain: 'api.example.com',
      issuer: "Let's Encrypt",
      expiresAt: '2026-05-01T00:00:00Z',
      status: 'expiring',
    },
  ],
}

export const Route = createFileRoute('/settings/tls')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'tls'],
        queryFn: () => apiClient.get<TlsSettingsResponse>('/settings/tls'),
      })
      .catch(() => defaults),
  component: TlsSettingsPage,
})

const certStatusMap: Record<
  CertificateInfo['status'],
  'healthy' | 'degraded' | 'unhealthy' | 'unknown'
> = {
  valid: 'healthy',
  expiring: 'degraded',
  expired: 'unhealthy',
  revoked: 'unhealthy',
}

function TlsSettingsPage() {
  const { t } = useTranslation('settings')
  const rawData = Route.useLoaderData() as TlsSettings & {
    certificates: CertificateInfo[]
  }
  const { certificates, ...formData } = rawData
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<TlsSettings>({
    resolver: zodResolver(tlsSettingsSchema),
    defaultValues: formData,
  })

  const selectedDnsProvider = watch('dnsChallengeProvider')
  const onDemandEnabled = watch('onDemandTls')

  const saveMutation = useMutation({
    mutationFn: (values: TlsSettings) =>
      apiClient.patch('/settings/tls', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'tls'] })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save TLS settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* ACME & TLS settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t('tls.title')}</CardTitle>
          <CardDescription>{t('tls.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SettingsField label={t('tls.acmeProvider')} needsBackend>
              <Controller
                name="acmeProvider"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="letsencrypt">Let&apos;s Encrypt</SelectItem>
                      <SelectItem value="zerossl">ZeroSSL</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </SettingsField>

            <SettingsField label={t('tls.defaultMinTlsVersion')} needsBackend>
              <Controller
                name="defaultMinTlsVersion"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1.2">TLS 1.2</SelectItem>
                      <SelectItem value="1.3">TLS 1.3</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </SettingsField>
          </div>

          {/* DNS challenge provider */}
          <SettingsField label={t('tls.dnsChallengeProvider')} needsBackend>
            <Controller
              name="dnsChallengeProvider"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="cloudflare">Cloudflare</SelectItem>
                    <SelectItem value="route53">AWS Route 53</SelectItem>
                    <SelectItem value="gcloud">Google Cloud DNS</SelectItem>
                    <SelectItem value="azure">Azure DNS</SelectItem>
                    <SelectItem value="digitalocean">DigitalOcean</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </SettingsField>

          {/* DNS provider credentials (conditional) */}
          {selectedDnsProvider !== 'none' &&
            dnsProviderFields[selectedDnsProvider] && (
              <SettingsField
                label={t('tls.dnsChallengeCredentials')}
                needsBackend
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {dnsProviderFields[selectedDnsProvider].map((cred) => (
                    <div key={cred.label} className="space-y-1">
                      <Label className="text-xs">{cred.label}</Label>
                      <Input
                        type="password"
                        placeholder={cred.placeholder}
                        disabled
                      />
                    </div>
                  ))}
                </div>
              </SettingsField>
            )}

          {/* On-demand TLS */}
          <SettingsField
            label={t('tls.onDemandTls')}
            description={t('tls.onDemandTlsDescription')}
            needsBackend
          >
            <Controller
              name="onDemandTls"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Label className="text-sm text-muted-foreground">
                    {field.value ? 'Enabled' : 'Disabled'}
                  </Label>
                </div>
              )}
            />
          </SettingsField>

          {onDemandEnabled && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pl-4 border-l-2 border-muted">
              <SettingsField label={t('tls.onDemandRateInterval')} needsBackend>
                <Controller
                  name="onDemandRateInterval"
                  control={control}
                  render={({ field }) => (
                    <Input {...field} value={field.value ?? ''} />
                  )}
                />
              </SettingsField>
              <SettingsField label={t('tls.onDemandRateBurst')} needsBackend>
                <Controller
                  name="onDemandRateBurst"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value ? Number(e.target.value) : undefined,
                        )
                      }
                    />
                  )}
                />
              </SettingsField>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active certificates table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('tls.certificates')}</CardTitle>
        </CardHeader>
        <CardContent>
          {certificates.length === 0 ? (
            <EmptyState
              icon={<ShieldOffIcon className="size-5" />}
              title={t('tls.noCertificates')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('tls.domain')}</TableHead>
                    <TableHead>{t('tls.issuer')}</TableHead>
                    <TableHead>{t('tls.expires')}</TableHead>
                    <TableHead>{t('tls.status')}</TableHead>
                    <TableHead className="text-right">{t('tls.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certificates.map((cert) => (
                    <TableRow key={cert.domain}>
                      <TableCell className="font-mono text-sm">
                        {cert.domain}
                      </TableCell>
                      <TableCell>{cert.issuer}</TableCell>
                      <TableCell>
                        <TimeAgo date={cert.expiresAt} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={certStatusMap[cert.status]}
                          label={cert.status}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" title={t('tls.forceRenew')}>
                            <RefreshCwIcon className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t('tls.revoke')}
                            className="text-destructive hover:text-destructive"
                          >
                            <ShieldOffIcon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(formData)}
          disabled={!isDirty}
        >
          <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
          {t('actions.reset')}
        </Button>
        <Button type="submit" disabled={!isDirty || saveMutation.isPending}>
          <SaveIcon className="size-3.5" data-icon="inline-start" />
          {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): TLS & certificates settings — ACME, DNS challenge, on-demand TLS, cert table"
```

---

## Task 6: Observability Settings Page

**Files:**
- Create: `packages/web/src/routes/settings/observability.tsx`

- [ ] **Step 1: Implement observability settings page**

Create `packages/web/src/routes/settings/observability.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SaveIcon, RotateCcwIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ObservabilitySettingsResponse } from '@/lib/api'
import {
  observabilitySettingsSchema,
  type ObservabilitySettings,
} from '@/lib/schemas/settings'
import { SettingsField } from '@/components/rioku/settings-field'
import { TagInput } from '@/components/rioku/tag-input'
import { ProgressBar } from '@/components/rioku/progress-bar'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

const defaults: ObservabilitySettings = {
  traceSamplingRate: 100,
  alwaysTraceErrors: true,
  alwaysTraceAi: true,
  alwaysTraceSlowRequests: false,
  slowRequestThresholdMs: 3000,
  retentionRawTraces: '7d',
  retentionAggregatedStats: '90d',
  retentionAiSessions: '30d',
  storageBackend: 'sqlite',
  storageUsedBytes: 536870912,
  storageMaxBytes: 2147483648,
  ipMasking: false,
  ipMaskPrefixLength: 24,
  queryParamRedaction: ['password', 'token', 'secret'],
  cookieRedaction: ['session_id'],
  customPiiRegexes: [],
  prometheusEnabled: false,
  otelExporterEndpoint: '',
}

export const Route = createFileRoute('/settings/observability')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'observability'],
        queryFn: () =>
          apiClient.get<ObservabilitySettingsResponse>(
            '/settings/observability',
          ),
      })
      .catch(() => defaults),
  component: ObservabilitySettingsPage,
})

function ObservabilitySettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as ObservabilitySettings
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<ObservabilitySettings>({
    resolver: zodResolver(observabilitySettingsSchema),
    defaultValues: data,
  })

  const ipMaskingEnabled = watch('ipMasking')

  const saveMutation = useMutation({
    mutationFn: (values: ObservabilitySettings) =>
      apiClient.patch('/settings/observability', values),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['settings', 'observability'],
      })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save observability settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Trace sampling */}
      <Card>
        <CardHeader>
          <CardTitle>{t('observability.title')}</CardTitle>
          <CardDescription>{t('observability.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sampling rate slider */}
          <SettingsField label={t('observability.traceSampling')} needsBackend>
            <Controller
              name="traceSamplingRate"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={field.value}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="w-12 text-right font-mono text-sm">
                    {field.value}%
                  </span>
                </div>
              )}
            />
            {errors.traceSamplingRate && (
              <p className="text-sm text-destructive mt-1">
                {errors.traceSamplingRate.message}
              </p>
            )}
          </SettingsField>

          {/* Always-trace toggles */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(
              [
                ['alwaysTraceErrors', t('observability.alwaysTraceErrors')],
                ['alwaysTraceAi', t('observability.alwaysTraceAi')],
                [
                  'alwaysTraceSlowRequests',
                  t('observability.alwaysTraceSlowRequests'),
                ],
              ] as const
            ).map(([name, label]) => (
              <SettingsField key={name} label={label} needsBackend>
                <Controller
                  name={name}
                  control={control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </SettingsField>
            ))}
          </div>

          {/* Slow request threshold */}
          <SettingsField
            label={t('observability.slowRequestThreshold')}
            needsBackend
          >
            <Controller
              name="slowRequestThresholdMs"
              control={control}
              render={({ field }) => (
                <Input
                  type="number"
                  className="max-w-xs"
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              )}
            />
          </SettingsField>

          <Separator />

          {/* Retention settings */}
          <SettingsField label={t('observability.retention')} needsBackend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(
                [
                  ['retentionRawTraces', t('observability.retentionRawTraces')],
                  [
                    'retentionAggregatedStats',
                    t('observability.retentionAggregatedStats'),
                  ],
                  [
                    'retentionAiSessions',
                    t('observability.retentionAiSessions'),
                  ],
                ] as const
              ).map(([name, label]) => (
                <div key={name} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <Controller
                    name={name}
                    control={control}
                    render={({ field }) => <Input {...field} />}
                  />
                </div>
              ))}
            </div>
          </SettingsField>

          {/* Storage usage */}
          <SettingsField label={t('observability.storageUsage')} readOnly>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t('observability.storageBackend')}: {data.storageBackend}
              </div>
              <ProgressBar
                value={data.storageUsedBytes}
                max={data.storageMaxBytes}
                label={t('observability.storage')}
                formatValue={formatBytes}
              />
            </div>
          </SettingsField>

          <Separator />

          {/* PII Filters */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">
              {t('observability.piiFilters')}
            </h3>

            <SettingsField label={t('observability.ipMasking')} needsBackend>
              <Controller
                name="ipMasking"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </SettingsField>

            {ipMaskingEnabled && (
              <SettingsField
                label={t('observability.ipMaskPrefixLength')}
                needsBackend
                className="pl-4 border-l-2 border-muted"
              >
                <Controller
                  name="ipMaskPrefixLength"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      className="max-w-xs"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value ? Number(e.target.value) : undefined,
                        )
                      }
                    />
                  )}
                />
              </SettingsField>
            )}

            <SettingsField
              label={t('observability.queryParamRedaction')}
              needsBackend
            >
              <Controller
                name="queryParamRedaction"
                control={control}
                render={({ field }) => (
                  <TagInput
                    value={field.value}
                    onChange={field.onChange}
                    label={t('observability.queryParamRedaction')}
                    placeholder={t(
                      'observability.queryParamRedactionPlaceholder',
                    )}
                  />
                )}
              />
            </SettingsField>

            <SettingsField
              label={t('observability.cookieRedaction')}
              needsBackend
            >
              <Controller
                name="cookieRedaction"
                control={control}
                render={({ field }) => (
                  <TagInput
                    value={field.value}
                    onChange={field.onChange}
                    label={t('observability.cookieRedaction')}
                    placeholder={t(
                      'observability.cookieRedactionPlaceholder',
                    )}
                  />
                )}
              />
            </SettingsField>

            <SettingsField
              label={t('observability.customPiiRegexes')}
              needsBackend
            >
              <Controller
                name="customPiiRegexes"
                control={control}
                render={({ field }) => (
                  <TagInput
                    value={field.value}
                    onChange={field.onChange}
                    label={t('observability.customPiiRegexes')}
                    placeholder={t(
                      'observability.customPiiRegexesPlaceholder',
                    )}
                  />
                )}
              />
            </SettingsField>
          </div>

          <Separator />

          {/* Prometheus & OTEL */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SettingsField
              label={t('observability.prometheus')}
              description={t('observability.prometheusDescription')}
              needsBackend
            >
              <Controller
                name="prometheusEnabled"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </SettingsField>

            <SettingsField
              label={t('observability.otelExporter')}
              needsBackend
            >
              <Controller
                name="otelExporterEndpoint"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    placeholder={t(
                      'observability.otelExporterPlaceholder',
                    )}
                  />
                )}
              />
            </SettingsField>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(data)}
          disabled={!isDirty}
        >
          <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
          {t('actions.reset')}
        </Button>
        <Button type="submit" disabled={!isDirty || saveMutation.isPending}>
          <SaveIcon className="size-3.5" data-icon="inline-start" />
          {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): observability settings — sampling, retention, PII filters, Prometheus, OTEL"
```

---

## Task 7: Config Store Settings Page

**Files:**
- Create: `packages/web/src/routes/settings/config-store.tsx`

- [ ] **Step 1: Implement config store settings page**

Create `packages/web/src/routes/settings/config-store.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DownloadIcon,
  UploadIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigStoreSettingsResponse, MigrationInfo } from '@/lib/api'
import { SettingsField } from '@/components/rioku/settings-field'
import { StatusBadge } from '@/components/rioku/status-badge'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const defaults: ConfigStoreSettingsResponse = {
  backendType: 'sqlite',
  connectionInfo: '/var/lib/rioku/store.db',
  configVersion: 42,
  storeHealth: 'healthy',
  migrations: [
    {
      version: 1,
      name: 'initial_schema',
      appliedAt: '2026-01-15T10:30:00Z',
      status: 'applied',
    },
    {
      version: 2,
      name: 'add_api_keys',
      appliedAt: '2026-02-01T14:00:00Z',
      status: 'applied',
    },
    {
      version: 3,
      name: 'add_audit_log',
      appliedAt: '2026-03-10T09:15:00Z',
      status: 'applied',
    },
  ],
}

export const Route = createFileRoute('/settings/config-store')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'config-store'],
        queryFn: () =>
          apiClient.get<ConfigStoreSettingsResponse>('/settings/config-store'),
      })
      .catch(() => defaults),
  component: ConfigStoreSettingsPage,
})

const migrationStatusVariant: Record<
  MigrationInfo['status'],
  'default' | 'secondary' | 'destructive'
> = {
  applied: 'default',
  pending: 'secondary',
  failed: 'destructive',
}

function ConfigStoreSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as ConfigStoreSettingsResponse

  const exportMutation = useMutation({
    mutationFn: () => apiClient.get<Blob>('/config/export'),
    onSuccess: () => toast.info('Config exported'),
    onError: () => toast.error('Export not yet available (needs backend)'),
  })

  const healthMap: Record<string, 'healthy' | 'degraded' | 'unhealthy' | 'unknown'> = {
    healthy: 'healthy',
    degraded: 'degraded',
    unhealthy: 'unhealthy',
    unknown: 'unknown',
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('configStore.title')}</CardTitle>
          <CardDescription>{t('configStore.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SettingsField label={t('configStore.backendType')} readOnly>
              <Input value={data.backendType} readOnly className="font-mono" />
            </SettingsField>

            <SettingsField label={t('configStore.connectionInfo')} readOnly>
              <Input
                value={data.connectionInfo}
                readOnly
                className="font-mono"
                type="password"
              />
            </SettingsField>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SettingsField label={t('configStore.configVersion')} readOnly>
              <Input
                value={`v${data.configVersion}`}
                readOnly
                className="font-mono"
              />
            </SettingsField>

            <SettingsField label={t('configStore.storeHealth')} readOnly>
              <div className="flex h-9 items-center">
                <StatusBadge
                  status={healthMap[data.storeHealth] ?? 'unknown'}
                />
              </div>
            </SettingsField>
          </div>
        </CardContent>
      </Card>

      {/* Migration history */}
      <Card>
        <CardHeader>
          <CardTitle>{t('configStore.migrations')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.migrations.length === 0 ? (
            <EmptyState title={t('configStore.noMigrations')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('configStore.migrationVersion')}</TableHead>
                    <TableHead>{t('configStore.migrationName')}</TableHead>
                    <TableHead>{t('configStore.migrationAppliedAt')}</TableHead>
                    <TableHead>{t('configStore.migrationStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.migrations.map((m) => (
                    <TableRow key={m.version}>
                      <TableCell className="font-mono text-sm">
                        {m.version}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {m.name}
                      </TableCell>
                      <TableCell>
                        <TimeAgo date={m.appliedAt} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={migrationStatusVariant[m.status]}>
                          {m.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export / Import */}
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
        >
          <DownloadIcon className="size-3.5" data-icon="inline-start" />
          {t('configStore.exportConfig')}
        </Button>
        <Button variant="outline" disabled>
          <UploadIcon className="size-3.5" data-icon="inline-start" />
          {t('configStore.importConfig')}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): config store settings — backend info, health, migration history, export/import"
```

---

## Task 8: Authentication Settings Page

**Files:**
- Create: `packages/web/src/routes/settings/authentication.tsx`

- [ ] **Step 1: Implement authentication settings page**

Create `packages/web/src/routes/settings/authentication.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SaveIcon, RotateCcwIcon, InfoIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { AuthSettingsResponse } from '@/lib/api'
import {
  authSettingsSchema,
  type AuthSettings,
} from '@/lib/schemas/settings'
import { SettingsField } from '@/components/rioku/settings-field'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'

const defaults: AuthSettings = {
  sessionCookieLifetime: '24h',
  sessionIdleTimeout: '30m',
  maxConcurrentSessions: 5,
  passwordMinLength: 12,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireNumber: true,
  passwordRequireSpecial: false,
  passwordMaxAgeDays: 90,
  lockoutMaxAttempts: 5,
  lockoutDuration: '15m',
  lockoutResetWindow: '1h',
  totpIssuerName: 'Rioku Gateway',
  totpEnforceForAll: false,
  bruteForceRateLimit: 10,
}

export const Route = createFileRoute('/settings/authentication')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'authentication'],
        queryFn: () =>
          apiClient.get<AuthSettingsResponse>('/settings/authentication'),
      })
      .catch(() => defaults),
  component: AuthenticationSettingsPage,
})

function AuthenticationSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as AuthSettings
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<AuthSettings>({
    resolver: zodResolver(authSettingsSchema),
    defaultValues: data,
  })

  const saveMutation = useMutation({
    mutationFn: (values: AuthSettings) =>
      apiClient.patch('/settings/authentication', values),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['settings', 'authentication'],
      })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save authentication settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('authentication.title')}</CardTitle>
          <CardDescription>
            {t('authentication.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* SSO notice */}
          <Alert>
            <InfoIcon className="size-4" />
            <AlertDescription>
              {t('authentication.ssoNote')}
            </AlertDescription>
          </Alert>

          {/* Session settings */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.sessions')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SettingsField
                label={t('authentication.cookieLifetime')}
                needsBackend
              >
                <Controller
                  name="sessionCookieLifetime"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.idleTimeout')}
                needsBackend
              >
                <Controller
                  name="sessionIdleTimeout"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.maxConcurrentSessions')}
                needsBackend
              >
                <Controller
                  name="maxConcurrentSessions"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  )}
                />
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* Password policy */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.passwordPolicy')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SettingsField
                label={t('authentication.minLength')}
                needsBackend
              >
                <Controller
                  name="passwordMinLength"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  )}
                />
                {errors.passwordMinLength && (
                  <p className="text-sm text-destructive mt-1">
                    {errors.passwordMinLength.message}
                  </p>
                )}
              </SettingsField>
              <SettingsField
                label={t('authentication.maxAgeDays')}
                needsBackend
              >
                <Controller
                  name="passwordMaxAgeDays"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  )}
                />
              </SettingsField>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4 sm:grid-cols-4">
              {(
                [
                  ['passwordRequireUppercase', t('authentication.requireUppercase')],
                  ['passwordRequireLowercase', t('authentication.requireLowercase')],
                  ['passwordRequireNumber', t('authentication.requireNumber')],
                  ['passwordRequireSpecial', t('authentication.requireSpecial')],
                ] as const
              ).map(([name, label]) => (
                <SettingsField key={name} label={label} needsBackend>
                  <Controller
                    name={name}
                    control={control}
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </SettingsField>
              ))}
            </div>
          </div>

          <Separator />

          {/* Account lockout */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.lockout')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SettingsField
                label={t('authentication.maxAttempts')}
                needsBackend
              >
                <Controller
                  name="lockoutMaxAttempts"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  )}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.lockoutDuration')}
                needsBackend
              >
                <Controller
                  name="lockoutDuration"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.resetWindow')}
                needsBackend
              >
                <Controller
                  name="lockoutResetWindow"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* TOTP 2FA */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.totp')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SettingsField
                label={t('authentication.totpIssuerName')}
                needsBackend
              >
                <Controller
                  name="totpIssuerName"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.totpEnforceForAll')}
                needsBackend
              >
                <Controller
                  name="totpEnforceForAll"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* Brute-force protection */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.bruteForce')}
            </h3>
            <SettingsField
              label={t('authentication.bruteForceRateLimit')}
              needsBackend
            >
              <Controller
                name="bruteForceRateLimit"
                control={control}
                render={({ field }) => (
                  <Input
                    type="number"
                    className="max-w-xs"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                )}
              />
            </SettingsField>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(data)}
          disabled={!isDirty}
        >
          <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
          {t('actions.reset')}
        </Button>
        <Button type="submit" disabled={!isDirty || saveMutation.isPending}>
          <SaveIcon className="size-3.5" data-icon="inline-start" />
          {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): authentication settings — sessions, password policy, lockout, TOTP, brute-force"
```

---

## Task 9: PKI Settings Page

**Files:**
- Create: `packages/web/src/routes/settings/pki.tsx`

- [ ] **Step 1: Implement PKI settings page**

Create `packages/web/src/routes/settings/pki.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  SaveIcon,
  RotateCcwIcon,
  DownloadIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { z } from 'zod'

import { apiClient } from '@/lib/api'
import type { PkiSettingsResponse, RotationHistoryInfo } from '@/lib/api'
import { SettingsField } from '@/components/rioku/settings-field'
import { StatusBadge } from '@/components/rioku/status-badge'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'
import { TypedConfirmationDialog } from '@/components/rioku/typed-confirmation-dialog'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const editableSchema = z.object({
  autoRotationThresholdDays: z.number().int().min(1),
})
type EditablePki = z.infer<typeof editableSchema>

const defaults: PkiSettingsResponse = {
  caAlgorithm: 'ecdsa-p256',
  caValidityDays: 3650,
  caExpiresAt: '2036-04-10T00:00:00Z',
  caFingerprint: 'SHA256:2c:f3:a1:...:9e:b4',
  nodeCertExpiresAt: '2027-04-10T00:00:00Z',
  nodeCertSans: ['node-1.rioku.local', '127.0.0.1'],
  autoRotationThresholdDays: 30,
  dbClientCertStatus: 'healthy',
  rotationHistory: [
    {
      id: 'rot-1',
      type: 'ca',
      rotatedAt: '2026-01-15T10:00:00Z',
      reason: 'Initial CA creation',
      actor: 'system',
    },
    {
      id: 'rot-2',
      type: 'node',
      rotatedAt: '2026-03-01T08:30:00Z',
      reason: 'Auto-rotation threshold reached',
      actor: 'system',
    },
  ],
}

export const Route = createFileRoute('/settings/pki')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'pki'],
        queryFn: () => apiClient.get<PkiSettingsResponse>('/settings/pki'),
      })
      .catch(() => defaults),
  component: PkiSettingsPage,
})

const rotationTypeLabels: Record<RotationHistoryInfo['type'], string> = {
  ca: 'CA',
  node: 'Node',
  'db-client': 'DB Client',
}

function PkiSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as PkiSettingsResponse
  const queryClient = useQueryClient()
  const [forceRotateOpen, setForceRotateOpen] = useState(false)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<EditablePki>({
    resolver: zodResolver(editableSchema),
    defaultValues: {
      autoRotationThresholdDays: data.autoRotationThresholdDays,
    },
  })

  const saveMutation = useMutation({
    mutationFn: (values: EditablePki) =>
      apiClient.patch('/settings/pki', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'pki'] })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save PKI settings'),
  })

  const rotateMutation = useMutation({
    mutationFn: () => apiClient.post('/pki/rotate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'pki'] })
      toast.success('Certificate rotation initiated')
      setForceRotateOpen(false)
    },
    onError: () => toast.error('Failed to initiate rotation (needs backend)'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  const healthMap: Record<string, 'healthy' | 'degraded' | 'unhealthy' | 'unknown'> = {
    healthy: 'healthy', degraded: 'degraded',
    unhealthy: 'unhealthy', unknown: 'unknown',
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('pki.title')}</CardTitle>
          <CardDescription>{t('pki.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* CA Status */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('pki.caStatus')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SettingsField label={t('pki.caAlgorithm')} readOnly>
                <Input value={data.caAlgorithm} readOnly className="font-mono" />
              </SettingsField>
              <SettingsField label={t('pki.caValidity')} readOnly>
                <Input
                  value={`${data.caValidityDays} days`}
                  readOnly
                  className="font-mono"
                />
              </SettingsField>
              <SettingsField label={t('pki.caExpires')} readOnly>
                <div className="flex h-9 items-center">
                  <TimeAgo date={data.caExpiresAt} />
                </div>
              </SettingsField>
              <SettingsField label={t('pki.caFingerprint')} readOnly>
                <Input
                  value={data.caFingerprint}
                  readOnly
                  className="font-mono text-xs"
                />
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* Node cert */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('pki.nodeCert')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SettingsField label={t('pki.nodeCertExpires')} readOnly>
                <div className="flex h-9 items-center">
                  <TimeAgo date={data.nodeCertExpiresAt} />
                </div>
              </SettingsField>
              <SettingsField label={t('pki.nodeCertSans')} readOnly>
                <div className="flex flex-wrap gap-1.5">
                  {data.nodeCertSans.map((san) => (
                    <Badge key={san} variant="secondary" className="font-mono text-xs">
                      {san}
                    </Badge>
                  ))}
                </div>
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* Auto-rotation threshold (editable) */}
          <SettingsField
            label={t('pki.autoRotationThreshold')}
            needsBackend
          >
            <Controller
              name="autoRotationThresholdDays"
              control={control}
              render={({ field }) => (
                <Input
                  type="number"
                  className="max-w-xs"
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              )}
            />
          </SettingsField>

          {/* DB client cert */}
          <SettingsField label={t('pki.dbClientCertStatus')} readOnly>
            <div className="flex h-9 items-center">
              <StatusBadge
                status={healthMap[data.dbClientCertStatus] ?? 'unknown'}
              />
            </div>
          </SettingsField>
        </CardContent>
      </Card>

      {/* Rotation history */}
      <Card>
        <CardHeader>
          <CardTitle>{t('pki.rotationHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.rotationHistory.length === 0 ? (
            <EmptyState title={t('pki.noRotations')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('pki.rotationType')}</TableHead>
                    <TableHead>{t('pki.rotatedAt')}</TableHead>
                    <TableHead>{t('pki.rotationReason')}</TableHead>
                    <TableHead>{t('pki.rotationActor')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rotationHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge variant="secondary">
                          {rotationTypeLabels[entry.type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <TimeAgo date={entry.rotatedAt} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.reason}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {entry.actor}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setForceRotateOpen(true)}
          >
            <RefreshCwIcon className="size-3.5" data-icon="inline-start" />
            {t('pki.forceRotation')}
          </Button>
          <Button type="button" variant="outline" disabled>
            <DownloadIcon className="size-3.5" data-icon="inline-start" />
            {t('pki.downloadCaCert')}
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              reset({ autoRotationThresholdDays: data.autoRotationThresholdDays })
            }
            disabled={!isDirty}
          >
            <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
            {t('actions.reset')}
          </Button>
          <Button type="submit" disabled={!isDirty || saveMutation.isPending}>
            <SaveIcon className="size-3.5" data-icon="inline-start" />
            {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
          </Button>
        </div>
      </div>

      <TypedConfirmationDialog
        open={forceRotateOpen}
        onOpenChange={setForceRotateOpen}
        title={t('pki.forceRotation')}
        description={t('pki.forceRotationDescription')}
        confirmPhrase="rotate certificates"
        confirmLabel="Rotate now"
        onConfirm={() => rotateMutation.mutate()}
        loading={rotateMutation.isPending}
      />
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): PKI settings — CA status, node certs, rotation history, force rotation"
```

---

## Task 10: Danger Zone Settings Page

**Files:**
- Create: `packages/web/src/routes/settings/danger-zone.tsx`

- [ ] **Step 1: Implement danger zone settings page**

Create `packages/web/src/routes/settings/danger-zone.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  TrashIcon,
  KeyIcon,
  EyeOffIcon,
  BombIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import { TypedConfirmationDialog } from '@/components/rioku/typed-confirmation-dialog'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface DangerAction {
  id: string
  titleKey: string
  descriptionKey: string
  phraseKey: string
  icon: React.ElementType
  endpoint: string
}

const dangerActions: DangerAction[] = [
  {
    id: 'reset-config',
    titleKey: 'dangerZone.resetConfig',
    descriptionKey: 'dangerZone.resetConfigDescription',
    phraseKey: 'dangerZone.resetConfigPhrase',
    icon: TrashIcon,
    endpoint: '/danger/reset-config',
  },
  {
    id: 'rotate-token',
    titleKey: 'dangerZone.rotateToken',
    descriptionKey: 'dangerZone.rotateTokenDescription',
    phraseKey: 'dangerZone.rotateTokenPhrase',
    icon: KeyIcon,
    endpoint: '/danger/rotate-token',
  },
  {
    id: 'purge-traces',
    titleKey: 'dangerZone.purgeTraces',
    descriptionKey: 'dangerZone.purgeTracesDescription',
    phraseKey: 'dangerZone.purgeTracesPhrase',
    icon: EyeOffIcon,
    endpoint: '/danger/purge-traces',
  },
  {
    id: 'factory-reset',
    titleKey: 'dangerZone.factoryReset',
    descriptionKey: 'dangerZone.factoryResetDescription',
    phraseKey: 'dangerZone.factoryResetPhrase',
    icon: BombIcon,
    endpoint: '/danger/factory-reset',
  },
]

export const Route = createFileRoute('/settings/danger-zone')({
  component: DangerZonePage,
})

function DangerZonePage() {
  const { t } = useTranslation('settings')
  const [activeAction, setActiveAction] = useState<DangerAction | null>(null)

  const dangerMutation = useMutation({
    mutationFn: (endpoint: string) => apiClient.post(endpoint),
    onSuccess: () => {
      toast.success('Action completed')
      setActiveAction(null)
    },
    onError: () =>
      toast.error('Action failed (backend endpoint not yet available)'),
  })

  return (
    <div className="space-y-6">
      <Card className="border-red-500/30 dark:border-red-500/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-red-500" />
            <CardTitle className="text-red-600 dark:text-red-400">
              {t('dangerZone.title')}
            </CardTitle>
          </div>
          <CardDescription>{t('dangerZone.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {dangerActions.map((action) => {
            const Icon = action.icon
            return (
              <div
                key={action.id}
                className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-4"
              >
                <div className="flex items-start gap-3">
                  <Icon className="size-5 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-red-600 dark:text-red-400">
                      {t(action.titleKey)}
                    </h4>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {t(action.descriptionKey)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setActiveAction(action)}
                  className="shrink-0 ml-4"
                >
                  {t(action.titleKey)}
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {activeAction && (
        <TypedConfirmationDialog
          open={activeAction !== null}
          onOpenChange={(open) => {
            if (!open) setActiveAction(null)
          }}
          title={t(activeAction.titleKey)}
          description={t(activeAction.descriptionKey)}
          confirmPhrase={t(activeAction.phraseKey)}
          confirmLabel={t(activeAction.titleKey)}
          onConfirm={() => dangerMutation.mutate(activeAction.endpoint)}
          loading={dangerMutation.isPending}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): danger zone settings — 4 destructive actions with typed confirmation"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run full type check**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 2: Run all new tests**

```bash
cd packages/web && npx vitest run src/lib/schemas/__tests__/settings.test.ts src/components/rioku/__tests__/tag-input.test.tsx src/components/rioku/__tests__/settings-field.test.tsx src/components/rioku/__tests__/typed-confirmation-dialog.test.tsx src/components/rioku/__tests__/progress-bar.test.tsx
```

Expected: All tests pass.

- [ ] **Step 3: Run full test suite to verify no regressions**

```bash
cd packages/web && npx vitest run
```

Expected: All existing tests still pass.

- [ ] **Step 4: Verify route generation**

```bash
cd packages/web && npx tsr generate
```

Expected: TanStack Router generates route tree including all 8 new settings routes.

- [ ] **Step 5: Final commit (if needed)**

```bash
git commit -m "test(web): verify settings pages — type check, tests, route generation"
```

---

## Summary

| Task | Files created | Scope |
|------|--------------|-------|
| 1: Infrastructure | 10 new, 2 modified | Zod schemas, TagInput, SettingsField, TypedConfirmationDialog, ProgressBar, i18n, API types |
| 2: Layout | 1 modified | Settings layout with sub-nav, redirect to /settings/general |
| 3: General | 1 new | Instance name, log level, version info |
| 4: Network | 1 new | Trusted proxies, client IP headers, strict mode, listen addresses |
| 5: TLS | 1 new | ACME, DNS challenge, on-demand TLS, certificates table |
| 6: Observability | 1 new | Sampling, retention, PII filters, Prometheus, OTEL |
| 7: Config Store | 1 new | Backend info, health, migration history, export/import |
| 8: Authentication | 1 new | Sessions, passwords, lockout, TOTP, brute-force |
| 9: PKI | 1 new | CA status, node certs, rotation history, force rotation |
| 10: Danger Zone | 1 new | 4 destructive actions with typed confirmation |
| 11: Verification | 0 | Type check, tests, route generation |

**Total new files:** 18 (8 route pages, 4 components, 5 test files, 1 schema file)
**Total modified files:** 3 (settings.tsx, settings.json, api.ts)

**Backend dependency:** Almost all form fields are `NEEDS BACKEND`. Forms render with realistic defaults via the `SettingsField` component's `needsBackend` prop (disabled + amber badge). When backend endpoints ship, remove the `needsBackend` prop and the forms wire up without UI changes.
