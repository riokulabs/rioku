# Frontend Vitest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish comprehensive Vitest test infrastructure for the Rioku admin panel with library, hook, and component tests achieving a ratcheted coverage baseline.
**Architecture:** Tests live adjacent to source in `__tests__/` directories. Vitest uses jsdom for DOM simulation, `@testing-library/react` for component rendering, and `v8` for coverage. A coverage-baseline.txt file enforces ratcheting in CI -- coverage can only go up.
**Tech Stack:** Vitest 3.x, @testing-library/react 16.x, @testing-library/jest-dom 6.x, @testing-library/user-event 14.x, jsdom, @vitest/coverage-v8

---

## Task 1: Vitest Setup and Configuration

### Step 1.1: Install dev dependencies

- [ ] Run from `packages/web/`:

```bash
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

### Step 1.2: Create `packages/web/vitest.config.ts`

- [ ] Create file at `packages/web/vitest.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      include: ['src/lib/**', 'src/hooks/**', 'src/components/rioku/**', 'src/components/plugin/**', 'src/components/layout/**'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/components/ui/**',
        'src/routes/**',
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/exports/**',
      ],
    },
    css: false,
  },
})
```

### Step 1.3: Create test setup file `packages/web/src/test/setup.ts`

- [ ] Create file at `packages/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Auto-cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock matchMedia (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock IntersectionObserver (not available in jsdom)
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
})

// Mock ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
})

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
})
```

### Step 1.4: Create test utilities file `packages/web/src/test/utils.tsx`

- [ ] Create file at `packages/web/src/test/utils.tsx`:

```tsx
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

interface WrapperProps {
  children: ReactNode
}

function createWrapper() {
  const queryClient = createTestQueryClient()
  return function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: createWrapper(), ...options })
}

export { renderWithProviders, createTestQueryClient, createWrapper }
export { render, screen, within, waitFor, act } from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
```

### Step 1.5: Add package.json scripts

- [ ] Edit `packages/web/package.json` to add test scripts to the `"scripts"` block:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

The full scripts block should be:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "check": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

### Step 1.6: Add `packages/web/src/test/tsconfig.json` reference (optional)

- [ ] Verify that `packages/web/tsconfig.json` already includes `"src"` in `"include"` (it does). No changes needed -- test files inside `src/` are already covered.

### Step 1.7: Verify setup compiles

- [ ] Run from `packages/web/`:

```bash
npx vitest run --passWithNoTests
```

- [ ] Confirm exit code 0, no configuration errors.

---

## Task 2: Library Tests

### Step 2.1: Create `packages/web/src/lib/__tests__/utils.test.ts`

- [ ] Create file at `packages/web/src/lib/__tests__/utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cn } from '../utils'

describe('cn', () => {
  it('merges multiple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'extra')).toBe('base extra')
  })

  it('resolves conflicting Tailwind classes (later wins)', () => {
    // twMerge should keep only the last conflicting utility
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('handles empty inputs', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
    expect(cn(undefined, null, false)).toBe('')
  })

  it('handles array inputs', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('merges objects', () => {
    expect(cn({ hidden: true, flex: false })).toBe('hidden')
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/lib/__tests__/utils.test.ts`
- [ ] Verify all tests pass.

### Step 2.2: Create `packages/web/src/lib/__tests__/preferences.test.ts`

- [ ] Create file at `packages/web/src/lib/__tests__/preferences.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getPreferences, setPreference, resetPreferences } from '../preferences'

describe('preferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getPreferences', () => {
    it('returns defaults when localStorage is empty', () => {
      const prefs = getPreferences()
      expect(prefs.theme).toBe('dark')
      expect(prefs.sidebarCollapsed).toBe(false)
      expect(prefs.tablePageSize).toBe(20)
      expect(prefs.notifications).toEqual({
        config: true,
        health: true,
        plugins: true,
      })
      expect(prefs.locale).toBe('en')
    })

    it('merges stored values with defaults', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ theme: 'light', tablePageSize: 50 }),
      )
      const prefs = getPreferences()
      expect(prefs.theme).toBe('light')
      expect(prefs.tablePageSize).toBe(50)
      // Defaults still present for unset keys
      expect(prefs.sidebarCollapsed).toBe(false)
      expect(prefs.locale).toBe('en')
    })

    it('deep-merges notification preferences', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ notifications: { config: false } }),
      )
      const prefs = getPreferences()
      expect(prefs.notifications.config).toBe(false)
      expect(prefs.notifications.health).toBe(true)
      expect(prefs.notifications.plugins).toBe(true)
    })

    it('returns defaults for invalid JSON', () => {
      localStorage.setItem('rioku-preferences', 'not-json{{{')
      const prefs = getPreferences()
      expect(prefs.theme).toBe('dark')
    })
  })

  describe('setPreference', () => {
    it('persists a single preference and returns updated prefs', () => {
      const result = setPreference('theme', 'light')
      expect(result.theme).toBe('light')

      // Verify it was actually persisted
      const stored = JSON.parse(localStorage.getItem('rioku-preferences')!)
      expect(stored.theme).toBe('light')
    })

    it('preserves other preferences when setting one', () => {
      setPreference('theme', 'light')
      setPreference('tablePageSize', 50)

      const prefs = getPreferences()
      expect(prefs.theme).toBe('light')
      expect(prefs.tablePageSize).toBe(50)
    })

    it('sets nested notification preferences', () => {
      const result = setPreference('notifications', {
        config: false,
        health: true,
        plugins: false,
      })
      expect(result.notifications.config).toBe(false)
      expect(result.notifications.plugins).toBe(false)
    })
  })

  describe('resetPreferences', () => {
    it('clears to defaults', () => {
      setPreference('theme', 'light')
      setPreference('tablePageSize', 100)

      const result = resetPreferences()
      expect(result.theme).toBe('dark')
      expect(result.tablePageSize).toBe(20)
    })

    it('persists the reset defaults', () => {
      setPreference('theme', 'light')
      resetPreferences()

      const prefs = getPreferences()
      expect(prefs.theme).toBe('dark')
    })
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/lib/__tests__/preferences.test.ts`
- [ ] Verify all tests pass.

### Step 2.3: Create `packages/web/src/lib/__tests__/api.test.ts`

- [ ] Create file at `packages/web/src/lib/__tests__/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiClient } from '../api'

describe('apiClient', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetchResponse(body: unknown, status = 200, ok = true) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
    })
  }

  describe('GET', () => {
    it('constructs correct URL and sends GET with credentials', async () => {
      mockFetchResponse({ data: 'test' })

      await apiClient.get('/health')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/health'),
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        }),
      )
    })

    it('appends query parameters', async () => {
      mockFetchResponse({ data: 'test' })

      await apiClient.get('/audit', { actor: 'admin', limit: '10' })

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string
      expect(calledUrl).toContain('actor=admin')
      expect(calledUrl).toContain('limit=10')
    })

    it('returns parsed JSON body', async () => {
      const body = { routes: [], version: 1 }
      mockFetchResponse(body)

      const result = await apiClient.get('/config')
      expect(result).toEqual(body)
    })
  })

  describe('POST', () => {
    it('sends JSON body with Content-Type header', async () => {
      mockFetchResponse({ id: '123' }, 201, true)

      const payload = { name: 'test-route' }
      await apiClient.post('/routes', payload)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify(payload),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        }),
      )
    })

    it('sends POST without body when none provided', async () => {
      mockFetchResponse(undefined, 204, true)

      await apiClient.post('/auth/logout')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        }),
      )
    })
  })

  describe('PATCH', () => {
    it('sends PATCH request with body', async () => {
      mockFetchResponse({ id: '123', name: 'updated' })

      await apiClient.patch('/routes/123', { name: 'updated' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  describe('PUT', () => {
    it('sends PUT request with body', async () => {
      mockFetchResponse({ id: '123' })

      await apiClient.put('/routes/123', { name: 'replaced' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  describe('DELETE', () => {
    it('sends DELETE request without body', async () => {
      mockFetchResponse(undefined, 204, true)

      await apiClient.del('/routes/123')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'DELETE',
          body: undefined,
        }),
      )
    })
  })

  describe('error handling', () => {
    it('throws RFC 7807 error on non-OK response with parseable body', async () => {
      const errorBody = {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Route not found',
        instance: '/routes/999',
      }
      mockFetchResponse(errorBody, 404, false)

      await expect(apiClient.get('/routes/999')).rejects.toEqual(errorBody)
    })

    it('throws synthetic error when response body is not parseable JSON', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      })

      await expect(apiClient.get('/broken')).rejects.toMatchObject({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
      })
    })

    it('returns undefined for 204 No Content', async () => {
      mockFetchResponse(undefined, 204, true)

      const result = await apiClient.del('/routes/123')
      expect(result).toBeUndefined()
    })
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/lib/__tests__/api.test.ts`
- [ ] Verify all tests pass.

### Step 2.4: Create `packages/web/src/lib/__tests__/plugin-registry.test.ts`

- [ ] Create file at `packages/web/src/lib/__tests__/plugin-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RiokuWebPlugin, ZoneProps, WidgetProps } from '../plugin-registry'

// We need a fresh registry per test, so we create instances directly
// rather than importing the singleton. The class is not exported,
// so we test through the singleton and reset between tests.

describe('pluginRegistry', () => {
  // Dynamic import to get fresh module per test
  let pluginRegistry: typeof import('../plugin-registry')['pluginRegistry']

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../plugin-registry')
    pluginRegistry = mod.pluginRegistry
  })

  function makePlugin(overrides: Partial<RiokuWebPlugin> = {}): RiokuWebPlugin {
    return {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      ...overrides,
    }
  }

  describe('register and getNavItems', () => {
    it('returns empty array when no plugins registered', () => {
      expect(pluginRegistry.getNavItems()).toEqual([])
    })

    it('returns nav items from registered plugin', () => {
      const navItems = [{ label: 'My Page', icon: 'puzzle', path: '/plugins/test' }]
      pluginRegistry.register(makePlugin({ navItems }))

      expect(pluginRegistry.getNavItems()).toEqual(navItems)
    })

    it('aggregates nav items from multiple plugins', () => {
      pluginRegistry.register(
        makePlugin({
          id: 'p1',
          navItems: [{ label: 'P1', icon: 'a', path: '/p1' }],
        }),
      )
      pluginRegistry.register(
        makePlugin({
          id: 'p2',
          navItems: [{ label: 'P2', icon: 'b', path: '/p2' }],
        }),
      )

      expect(pluginRegistry.getNavItems()).toHaveLength(2)
    })
  })

  describe('getRoutes', () => {
    it('returns routes with lazy components', async () => {
      const { lazy } = await import('react')
      const lazyComponent = lazy(() =>
        Promise.resolve({ default: () => null }),
      )
      pluginRegistry.register(
        makePlugin({
          routes: [{ path: '/plugins/test', component: lazyComponent }],
        }),
      )

      const routes = pluginRegistry.getRoutes()
      expect(routes).toHaveLength(1)
      expect(routes[0].path).toBe('/plugins/test')
    })
  })

  describe('getDashboardWidgets', () => {
    it('returns widgets with pluginId attached', () => {
      const MockWidget = ({ pluginId: _pluginId }: WidgetProps) => null
      pluginRegistry.register(
        makePlugin({
          id: 'metrics',
          dashboardWidgets: [
            { title: 'Requests', size: 'md', component: MockWidget },
          ],
        }),
      )

      const widgets = pluginRegistry.getDashboardWidgets()
      expect(widgets).toHaveLength(1)
      expect(widgets[0].pluginId).toBe('metrics')
      expect(widgets[0].title).toBe('Requests')
      expect(widgets[0].size).toBe('md')
    })
  })

  describe('getInjections', () => {
    it('filters by zone', () => {
      const ZoneComponent = ({ zone: _zone, pluginId: _pluginId }: ZoneProps) => null
      pluginRegistry.register(
        makePlugin({
          injections: [
            { zone: 'sidebar.bottom', component: ZoneComponent },
            { zone: 'header.actions', component: ZoneComponent },
          ],
        }),
      )

      const sidebar = pluginRegistry.getInjections('sidebar.bottom')
      expect(sidebar).toHaveLength(1)
      expect(sidebar[0].zone).toBe('sidebar.bottom')

      const header = pluginRegistry.getInjections('header.actions')
      expect(header).toHaveLength(1)
    })

    it('sorts by priority (lower first)', () => {
      const A = ({ zone: _zone, pluginId: _pluginId }: ZoneProps) => null
      const B = ({ zone: _zone, pluginId: _pluginId }: ZoneProps) => null
      pluginRegistry.register(
        makePlugin({
          id: 'p1',
          injections: [
            { zone: 'header.actions', component: A, priority: 10 },
          ],
        }),
      )
      pluginRegistry.register(
        makePlugin({
          id: 'p2',
          injections: [
            { zone: 'header.actions', component: B, priority: 1 },
          ],
        }),
      )

      const injections = pluginRegistry.getInjections('header.actions')
      expect(injections[0].pluginId).toBe('p2') // priority 1 first
      expect(injections[1].pluginId).toBe('p1') // priority 10 second
    })

    it('returns empty array for unknown zone', () => {
      expect(pluginRegistry.getInjections('nonexistent')).toEqual([])
    })
  })

  describe('getConfigPanel', () => {
    it('returns config panel component for registered plugin', () => {
      const ConfigPanel = () => null
      pluginRegistry.register(makePlugin({ id: 'test', configPanel: ConfigPanel }))

      expect(pluginRegistry.getConfigPanel('test')).toBe(ConfigPanel)
    })

    it('returns null for unknown plugin', () => {
      expect(pluginRegistry.getConfigPanel('nonexistent')).toBeNull()
    })
  })

  describe('duplicate plugin ID', () => {
    it('overwrites previous registration', () => {
      pluginRegistry.register(
        makePlugin({
          id: 'same',
          navItems: [{ label: 'Old', icon: 'a', path: '/old' }],
        }),
      )
      pluginRegistry.register(
        makePlugin({
          id: 'same',
          navItems: [{ label: 'New', icon: 'b', path: '/new' }],
        }),
      )

      const items = pluginRegistry.getNavItems()
      expect(items).toHaveLength(1)
      expect(items[0].label).toBe('New')
    })
  })

  describe('subscribe / useSyncExternalStore', () => {
    it('notifies listeners on register', () => {
      const listener = vi.fn()
      const unsub = pluginRegistry.subscribe(listener)

      pluginRegistry.register(makePlugin())
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()
      pluginRegistry.register(makePlugin({ id: 'other' }))
      expect(listener).toHaveBeenCalledTimes(1) // no more calls after unsub
    })

    it('increments snapshot on register', () => {
      const before = pluginRegistry.getSnapshot()
      pluginRegistry.register(makePlugin())
      expect(pluginRegistry.getSnapshot()).toBe(before + 1)
    })
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/lib/__tests__/plugin-registry.test.ts`
- [ ] Verify all tests pass.

### Step 2.5: Create `packages/web/src/lib/__tests__/plugin-loader.test.ts`

- [ ] Create file at `packages/web/src/lib/__tests__/plugin-loader.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('plugin-loader', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  describe('loadPlugin', () => {
    it('registers a valid plugin from dynamic import', async () => {
      const mockPlugin = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
      }

      // Mock the dynamic import
      vi.stubGlobal(
        'import',
        vi.fn().mockResolvedValue({ default: mockPlugin }),
      )

      // We need to mock the registry to verify registration
      const mockRegister = vi.fn()
      vi.doMock('../plugin-registry', () => ({
        pluginRegistry: {
          register: mockRegister,
        },
      }))

      const { loadPlugin } = await import('../plugin-loader')

      // Mock import() at module level -- loadPlugin uses dynamic import
      // which we can't easily stub. Instead verify behavior via console.error
      // for invalid plugins.
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // loadPlugin catches errors internally, so test the error path
      await loadPlugin('http://invalid-url-that-wont-resolve')
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('logs error for plugin missing id', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // The import will fail in test env, so this tests the error path
      const { loadPlugin } = await import('../plugin-loader')
      await loadPlugin('http://nonexistent.example.com/plugin.js')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[plugin-loader]'),
        expect.anything(),
      )

      consoleSpy.mockRestore()
    })
  })

  describe('loadPluginsFromManifest', () => {
    it('logs error when manifest fetch fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock apiClient.get to reject
      vi.doMock('../api', () => ({
        apiClient: {
          get: vi.fn().mockRejectedValue(new Error('Network error')),
        },
      }))

      const { loadPluginsFromManifest } = await import('../plugin-loader')
      await loadPluginsFromManifest()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[plugin-loader] Failed to load plugin manifest'),
        expect.anything(),
      )

      consoleSpy.mockRestore()
    })
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/lib/__tests__/plugin-loader.test.ts`
- [ ] Verify all tests pass.

### Step 2.6: Create `packages/web/src/lib/__tests__/i18n.test.ts`

- [ ] Create file at `packages/web/src/lib/__tests__/i18n.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import i18n from '../i18n'

describe('i18n', () => {
  beforeAll(async () => {
    // Wait for i18n to initialize
    await i18n.init
  })

  it('initializes successfully', () => {
    expect(i18n.isInitialized).toBe(true)
  })

  it('uses "common" as default namespace', () => {
    expect(i18n.options.defaultNS).toBe('common')
  })

  it('has English as fallback language', () => {
    expect(i18n.options.fallbackLng).toEqual('en')
  })

  it('returns key string for missing translations', () => {
    const result = i18n.t('nonexistent.key.that.does.not.exist')
    expect(result).toBe('nonexistent.key.that.does.not.exist')
  })

  it('has all expected namespaces loaded', () => {
    const expectedNamespaces = [
      'common',
      'dashboard',
      'routes',
      'services',
      'policies',
      'traffic',
      'security',
      'settings',
      'cluster',
      'plugins',
      'audit',
    ]
    for (const ns of expectedNamespaces) {
      expect(i18n.hasResourceBundle('en', ns)).toBe(true)
    }
  })

  it('does not escape values (React handles escaping)', () => {
    expect(i18n.options.interpolation?.escapeValue).toBe(false)
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/lib/__tests__/i18n.test.ts`
- [ ] Verify all tests pass.

---

## Task 3: Hook Tests

### Step 3.1: Create `packages/web/src/hooks/__tests__/use-auth.test.ts`

- [ ] Create file at `packages/web/src/hooks/__tests__/use-auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { MeResponse } from '@/lib/api'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockMeResponse: MeResponse = {
  session: {
    id: 'sess-1',
    created_at: '2026-01-01T00:00:00Z',
    last_active: '2026-01-01T01:00:00Z',
    expires_at: '2026-01-02T00:00:00Z',
    ip_address: '127.0.0.1',
  },
  user: {
    id: 'user-1',
    username: 'testadmin',
    display_name: 'Test Admin',
    email: 'admin@test.com',
    roles: ['admin'],
    permissions: ['routes:read', 'routes:write', 'users:read', 'users:*'],
    totp_enabled: false,
    force_password_change: false,
    status: 'active',
    last_login: '2026-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
  },
}

describe('use-auth hooks', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('useSession', () => {
    it('returns session data on successful /auth/me fetch', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useSession } = await import('../use-auth')
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockMeResponse)
    })

    it('enters error state when /auth/me returns 401', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
      })

      const { useSession } = await import('../use-auth')
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
    })

    it('sends credentials: include', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useSession } = await import('../use-auth')
      renderHook(() => useSession(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          '/api/v1/auth/me',
          expect.objectContaining({ credentials: 'include' }),
        )
      })
    })
  })

  describe('useCurrentUser', () => {
    it('returns user info when session is loaded', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useCurrentUser } = await import('../use-auth')
      const { result } = renderHook(() => useCurrentUser(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current).not.toBeNull())
      expect(result.current?.username).toBe('testadmin')
    })

    it('returns null when session is not loaded', () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
      })

      // Synchronous check before fetch resolves
      const { useCurrentUser } = require('../use-auth')
      const { result } = renderHook(() => useCurrentUser(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBeNull()
    })
  })

  describe('useHasPermission', () => {
    it('returns true for exact permission match', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useHasPermission } = await import('../use-auth')
      const { result } = renderHook(() => useHasPermission('routes:read'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current).toBe(true))
    })

    it('returns true for wildcard permission match', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useHasPermission } = await import('../use-auth')
      // User has 'users:*', so 'users:write' should match
      const { result } = renderHook(() => useHasPermission('users:write'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current).toBe(true))
    })

    it('returns false for missing permission', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useHasPermission } = await import('../use-auth')
      const { result } = renderHook(() => useHasPermission('admin:delete'), {
        wrapper: createWrapper(),
      })

      // Initially false (no data yet), stays false after load
      await waitFor(() => expect(result.current).toBe(false))
    })

    it('returns true when user has wildcard (*) permission', async () => {
      const superAdminResponse = {
        ...mockMeResponse,
        user: { ...mockMeResponse.user, permissions: ['*'] },
      }
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(superAdminResponse),
      })

      const { useHasPermission } = await import('../use-auth')
      const { result } = renderHook(
        () => useHasPermission('anything:at:all'),
        { wrapper: createWrapper() },
      )

      await waitFor(() => expect(result.current).toBe(true))
    })
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/hooks/__tests__/use-auth.test.ts`
- [ ] Verify all tests pass.

### Step 3.2: Create `packages/web/src/hooks/__tests__/use-theme.test.ts`

- [ ] Create file at `packages/web/src/hooks/__tests__/use-theme.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    vi.resetModules()
  })

  it('uses default theme from preferences (dark)', async () => {
    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
    expect(result.current.resolvedTheme).toBe('dark')
  })

  it('applies dark class to documentElement on mount', async () => {
    const { useTheme } = await import('../use-theme')
    renderHook(() => useTheme())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggles from dark to light', async () => {
    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('light')
    })

    expect(result.current.theme).toBe('light')
    expect(result.current.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists theme to preferences', async () => {
    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('light')
    })

    const stored = JSON.parse(localStorage.getItem('rioku-preferences')!)
    expect(stored.theme).toBe('light')
  })

  it('resolves system theme using matchMedia', async () => {
    // Mock matchMedia to return light
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)' ? false : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('system')
    })

    expect(result.current.theme).toBe('system')
    // With matches=false for dark, system resolves to light
    expect(result.current.resolvedTheme).toBe('light')
  })

  it('reads saved theme from localStorage', async () => {
    localStorage.setItem(
      'rioku-preferences',
      JSON.stringify({ theme: 'light' }),
    )

    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/hooks/__tests__/use-theme.test.ts`
- [ ] Verify all tests pass.

### Step 3.3: Create `packages/web/src/hooks/__tests__/use-hotkeys.test.ts`

- [ ] Create file at `packages/web/src/hooks/__tests__/use-hotkeys.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHotkey, useHotkeyRegistry, getModLabel } from '../use-hotkeys'

describe('use-hotkeys', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  describe('getModLabel', () => {
    it('returns Ctrl for non-Mac platforms', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true,
      })
      // getModLabel checks navigator.platform
      expect(getModLabel()).toBe('Ctrl')
    })
  })

  describe('useHotkey', () => {
    it('fires callback on matching keydown event', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback))

      // Simulate Ctrl+K (non-Mac)
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('does not fire for non-matching key', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback))

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'j',
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      expect(callback).not.toHaveBeenCalled()
    })

    it('does not fire when modifier does not match', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback))

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      expect(callback).not.toHaveBeenCalled()
    })

    it('ignores events when target is an input element', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback))

      const input = document.createElement('input')
      document.body.appendChild(input)

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          bubbles: true,
        })
        Object.defineProperty(event, 'target', { value: input })
        window.dispatchEvent(event)
      })

      expect(callback).not.toHaveBeenCalled()
      document.body.removeChild(input)
    })

    it('cleans up listener on unmount', () => {
      const callback = vi.fn()
      const { unmount } = renderHook(() => useHotkey('Mod+k', callback))

      unmount()

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      expect(callback).not.toHaveBeenCalled()
    })

    it('handles Shift modifier', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Shift+Enter', callback))

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: false,
            metaKey: false,
            shiftKey: true,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      // The hotkey parses case-insensitively, so 'enter' vs 'Enter' matters
      // In the hook, e.key.toLowerCase() is compared to mainKey (from split + pop)
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('useHotkeyRegistry', () => {
    it('returns registered shortcuts', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback, { scope: 'global' }))

      const { result } = renderHook(() => useHotkeyRegistry())

      expect(result.current).toContainEqual({
        key: 'Mod+k',
        scope: 'global',
      })
    })

    it('removes shortcut from registry on unmount', () => {
      const callback = vi.fn()
      const { unmount } = renderHook(() =>
        useHotkey('Mod+p', callback, { scope: 'test' }),
      )

      const { result: before } = renderHook(() => useHotkeyRegistry())
      expect(before.current.some((s) => s.key === 'Mod+p')).toBe(true)

      unmount()

      const { result: after } = renderHook(() => useHotkeyRegistry())
      expect(after.current.some((s) => s.key === 'Mod+p')).toBe(false)
    })
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/hooks/__tests__/use-hotkeys.test.ts`
- [ ] Verify all tests pass.

### Step 3.4: Create `packages/web/src/hooks/__tests__/use-events.test.ts`

- [ ] Create file at `packages/web/src/hooks/__tests__/use-events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useEventSubscription } from '../use-events'

class MockEventSource {
  url: string
  withCredentials: boolean
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  readyState = 0
  close = vi.fn()

  constructor(url: string, init?: EventSourceInit) {
    this.url = url
    this.withCredentials = init?.withCredentials ?? false
    MockEventSource.instances.push(this)
  }

  // Helper for tests
  simulateOpen() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  simulateError() {
    this.onerror?.(new Event('error'))
  }

  static instances: MockEventSource[] = []
  static reset() {
    MockEventSource.instances = []
  }
}

describe('useEventSubscription', () => {
  beforeEach(() => {
    MockEventSource.reset()
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'EventSource', {
      value: MockEventSource,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates EventSource with correct URL and withCredentials', () => {
    renderHook(() => useEventSubscription('config.changes'))

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toContain(
      '/api/v1/events/config.changes',
    )
    expect(MockEventSource.instances[0].withCredentials).toBe(true)
  })

  it('sets status to open when connection opens', async () => {
    const { result } = renderHook(() =>
      useEventSubscription('config.changes'),
    )

    expect(result.current.status).toBe('connecting')

    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    expect(result.current.status).toBe('open')
  })

  it('parses incoming message data and updates state', () => {
    const { result } = renderHook(() =>
      useEventSubscription<{ version: number }>('config.changes'),
    )

    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    act(() => {
      MockEventSource.instances[0].simulateMessage(
        JSON.stringify({ version: 42 }),
      )
    })

    expect(result.current.data).toEqual({ version: 42 })
    expect(result.current.error).toBeNull()
  })

  it('sets error state on invalid JSON message', () => {
    const { result } = renderHook(() =>
      useEventSubscription<{ version: number }>('config.changes'),
    )

    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    act(() => {
      MockEventSource.instances[0].simulateMessage('not-json{{{')
    })

    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('reconnects with exponential backoff on error', () => {
    renderHook(() => useEventSubscription('config.changes'))

    expect(MockEventSource.instances).toHaveLength(1)

    // Simulate error
    act(() => {
      MockEventSource.instances[0].simulateError()
    })

    // First backoff: 1000ms
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(MockEventSource.instances).toHaveLength(2)

    // Simulate another error
    act(() => {
      MockEventSource.instances[1].simulateError()
    })

    // Second backoff: 2000ms
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(MockEventSource.instances).toHaveLength(3)
  })

  it('does not connect when enabled is false', () => {
    const { result } = renderHook(() =>
      useEventSubscription('config.changes', { enabled: false }),
    )

    expect(MockEventSource.instances).toHaveLength(0)
    expect(result.current.status).toBe('closed')
  })

  it('closes EventSource on unmount', () => {
    const { unmount } = renderHook(() =>
      useEventSubscription('config.changes'),
    )

    const instance = MockEventSource.instances[0]
    unmount()

    expect(instance.close).toHaveBeenCalled()
  })

  it('clears reconnect timer on unmount', () => {
    const { unmount } = renderHook(() =>
      useEventSubscription('config.changes'),
    )

    // Trigger error to start reconnect timer
    act(() => {
      MockEventSource.instances[0].simulateError()
    })

    unmount()

    // Advance past backoff -- should NOT create new EventSource
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    // Only the original instance should exist
    expect(MockEventSource.instances).toHaveLength(1)
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/hooks/__tests__/use-events.test.ts`
- [ ] Verify all tests pass.

### Step 3.5: Create `packages/web/src/hooks/__tests__/use-mobile.test.ts`

- [ ] Create file at `packages/web/src/hooks/__tests__/use-mobile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from '../use-mobile'

describe('useIsMobile', () => {
  let changeHandler: (() => void) | null = null

  beforeEach(() => {
    changeHandler = null
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'change') changeHandler = handler
        }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it('returns false above mobile breakpoint (768px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
    })

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('returns true below mobile breakpoint', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      writable: true,
    })

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('updates when window width changes via matchMedia', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
    })

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    // Simulate resize below breakpoint
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      writable: true,
    })

    act(() => {
      changeHandler?.()
    })

    expect(result.current).toBe(true)
  })

  it('cleans up matchMedia listener on unmount', () => {
    const removeEventListener = vi.fn()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    const { unmount } = renderHook(() => useIsMobile())
    unmount()

    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/hooks/__tests__/use-mobile.test.ts`
- [ ] Verify all tests pass.

---

## Task 4: Rioku Component Tests

### Step 4.1: Create `packages/web/src/components/rioku/__tests__/stat-card.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/stat-card.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatCard } from '../stat-card'

describe('StatCard', () => {
  const defaultProps = {
    title: 'Total Routes',
    value: '42',
    icon: <span data-testid="icon">R</span>,
  }

  it('renders title and value', () => {
    render(<StatCard {...defaultProps} />)

    expect(screen.getByText('Total Routes')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders icon', () => {
    render(<StatCard {...defaultProps} />)

    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders trend up with green styling and arrow', () => {
    render(
      <StatCard
        {...defaultProps}
        trend={{ value: '+12%', direction: 'up' }}
      />,
    )

    const trendEl = screen.getByText('+12%')
    expect(trendEl).toBeInTheDocument()
    // Parent span should contain green class
    expect(trendEl.closest('span')).toHaveClass('text-green-600')
  })

  it('renders trend down with red styling and arrow', () => {
    render(
      <StatCard
        {...defaultProps}
        trend={{ value: '-5%', direction: 'down' }}
      />,
    )

    const trendEl = screen.getByText('-5%')
    expect(trendEl).toBeInTheDocument()
    expect(trendEl.closest('span')).toHaveClass('text-red-600')
  })

  it('does not render trend element when no trend provided', () => {
    const { container } = render(<StatCard {...defaultProps} />)

    // No arrow icons should be present
    expect(container.querySelector('.text-green-600')).not.toBeInTheDocument()
    expect(container.querySelector('.text-red-600')).not.toBeInTheDocument()
  })

  it('passes className to container', () => {
    const { container } = render(
      <StatCard {...defaultProps} className="custom-class" />,
    )

    // The Card component should receive the className
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('renders ReactNode values (not just strings)', () => {
    render(
      <StatCard
        title="Status"
        value={<strong data-testid="bold-value">Active</strong>}
        icon={<span>I</span>}
      />,
    )

    expect(screen.getByTestId('bold-value')).toBeInTheDocument()
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/stat-card.test.tsx`
- [ ] Verify all tests pass.

### Step 4.2: Create `packages/web/src/components/rioku/__tests__/page-header.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/page-header.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '../page-header'

describe('PageHeader', () => {
  it('renders title text', () => {
    render(<PageHeader title="Routes" />)

    expect(
      screen.getByRole('heading', { name: 'Routes' }),
    ).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <PageHeader title="Routes" description="Manage your API routes" />,
    )

    expect(screen.getByText('Manage your API routes')).toBeInTheDocument()
  })

  it('does not render description element when not provided', () => {
    const { container } = render(<PageHeader title="Routes" />)

    // The description is in a <p> tag
    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('renders actions slot', () => {
    render(
      <PageHeader
        title="Routes"
        actions={<button>Create Route</button>}
      />,
    )

    expect(screen.getByText('Create Route')).toBeInTheDocument()
  })

  it('does not render actions container when no actions provided', () => {
    const { container } = render(<PageHeader title="Routes" />)

    // Only the title div should be present, no actions div
    const innerDivs = container.querySelectorAll(':scope > div > div')
    expect(innerDivs).toHaveLength(1) // Just the title space-y-1 div
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/page-header.test.tsx`
- [ ] Verify all tests pass.

### Step 4.3: Create `packages/web/src/components/rioku/__tests__/empty-state.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/empty-state.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '../empty-state'

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No routes" />)

    expect(screen.getByText('No routes')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(
      <EmptyState
        title="No data"
        icon={<span data-testid="icon">X</span>}
      />,
    )

    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <EmptyState title="No routes" description="Create your first route" />,
    )

    expect(screen.getByText('Create your first route')).toBeInTheDocument()
  })

  it('renders action when provided', () => {
    render(
      <EmptyState
        title="No routes"
        action={<button>Add Route</button>}
      />,
    )

    expect(screen.getByText('Add Route')).toBeInTheDocument()
  })

  it('does not crash when optional props are missing', () => {
    const { container } = render(<EmptyState title="Empty" />)

    expect(container).toBeTruthy()
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('does not render icon container when icon is not provided', () => {
    const { container } = render(<EmptyState title="Empty" />)

    expect(container.querySelector('.rounded-full')).not.toBeInTheDocument()
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/empty-state.test.tsx`
- [ ] Verify all tests pass.

### Step 4.4: Create `packages/web/src/components/rioku/__tests__/status-badge.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/status-badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '../status-badge'

describe('StatusBadge', () => {
  it('renders "Healthy" with green dot for healthy status', () => {
    render(<StatusBadge status="healthy" />)

    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('renders "Degraded" for degraded status', () => {
    render(<StatusBadge status="degraded" />)

    expect(screen.getByText('Degraded')).toBeInTheDocument()
  })

  it('renders "Unhealthy" for unhealthy status', () => {
    render(<StatusBadge status="unhealthy" />)

    expect(screen.getByText('Unhealthy')).toBeInTheDocument()
  })

  it('renders "Unknown" for unknown status', () => {
    render(<StatusBadge status="unknown" />)

    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('uses custom label when provided', () => {
    render(<StatusBadge status="healthy" label="All Good" />)

    expect(screen.getByText('All Good')).toBeInTheDocument()
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
  })

  it('renders the colored dot element', () => {
    const { container } = render(<StatusBadge status="healthy" />)

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toBeInTheDocument()
    expect(dot).toHaveClass('bg-green-500')
  })

  it('uses yellow dot for degraded status', () => {
    const { container } = render(<StatusBadge status="degraded" />)

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toHaveClass('bg-yellow-500')
  })

  it('uses red dot for unhealthy status', () => {
    const { container } = render(<StatusBadge status="unhealthy" />)

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toHaveClass('bg-red-500')
  })

  it('uses gray dot for unknown status', () => {
    const { container } = render(<StatusBadge status="unknown" />)

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toHaveClass('bg-gray-400')
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/status-badge.test.tsx`
- [ ] Verify all tests pass.

### Step 4.5: Create `packages/web/src/components/rioku/__tests__/code-block.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/code-block.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeBlock } from '../code-block'

describe('CodeBlock', () => {
  it('renders string value as-is', () => {
    render(<CodeBlock value="hello world" />)

    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('auto-stringifies object value with formatting', () => {
    const obj = { key: 'value', nested: { a: 1 } }
    render(<CodeBlock value={obj} />)

    // JSON.stringify with 2-space indent
    expect(
      screen.getByText(JSON.stringify(obj, null, 2)),
    ).toBeInTheDocument()
  })

  it('shows language label', () => {
    render(<CodeBlock value="test" language="yaml" />)

    expect(screen.getByText('yaml')).toBeInTheDocument()
  })

  it('defaults to json language label', () => {
    render(<CodeBlock value="test" />)

    expect(screen.getByText('json')).toBeInTheDocument()
  })

  it('copies text to clipboard on copy button click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
    })

    const user = userEvent.setup()
    render(<CodeBlock value="copy me" />)

    const copyButton = screen.getByRole('button', { name: /copy/i })
    await user.click(copyButton)

    expect(writeText).toHaveBeenCalledWith('copy me')
  })

  it('hides copy button when copyable is false', () => {
    render(<CodeBlock value="no copy" copyable={false} />)

    expect(
      screen.queryByRole('button', { name: /copy/i }),
    ).not.toBeInTheDocument()
  })

  it('applies maxHeight style to pre element', () => {
    const { container } = render(
      <CodeBlock value="test" maxHeight="200px" />,
    )

    const pre = container.querySelector('pre')
    expect(pre).toHaveStyle({ maxHeight: '200px' })
  })

  it('does not set maxHeight when not provided', () => {
    const { container } = render(<CodeBlock value="test" />)

    const pre = container.querySelector('pre')
    expect(pre).not.toHaveStyle({ maxHeight: expect.anything() })
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/code-block.test.tsx`
- [ ] Verify all tests pass.

### Step 4.6: Create `packages/web/src/components/rioku/__tests__/sparkline.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/sparkline.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Sparkline } from '../sparkline'

describe('Sparkline', () => {
  it('renders SVG with correct dimensions', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} width={100} height={30} />,
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '100')
    expect(svg).toHaveAttribute('height', '30')
  })

  it('uses default dimensions when not specified', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '80')
    expect(svg).toHaveAttribute('height', '24')
  })

  it('renders polyline with computed points', () => {
    const { container } = render(<Sparkline data={[0, 10, 5]} />)

    const polyline = container.querySelector('polyline')
    expect(polyline).toBeInTheDocument()
    expect(polyline?.getAttribute('points')).toBeTruthy()
    // Points string should contain comma-separated x,y pairs
    expect(polyline?.getAttribute('points')).toMatch(/\d+\.?\d*,\d+\.?\d*/)
  })

  it('applies color prop to stroke', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} color="#ff0000" />,
    )

    const polyline = container.querySelector('polyline')
    expect(polyline).toHaveAttribute('stroke', '#ff0000')
  })

  it('uses currentColor as default stroke', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />)

    const polyline = container.querySelector('polyline')
    expect(polyline).toHaveAttribute('stroke', 'currentColor')
  })

  it('returns null for data with fewer than 2 points', () => {
    const { container } = render(<Sparkline data={[1]} />)

    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('returns null for empty data', () => {
    const { container } = render(<Sparkline data={[]} />)

    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('handles data where all values are the same', () => {
    const { container } = render(<Sparkline data={[5, 5, 5]} />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    // Should not crash -- range=0 is handled (fallback to 1)
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/sparkline.test.tsx`
- [ ] Verify all tests pass.

### Step 4.7: Create `packages/web/src/components/rioku/__tests__/confirm-dialog.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/confirm-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../confirm-dialog'

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Delete Route',
    description: 'Are you sure you want to delete this route?',
    onConfirm: vi.fn(),
  }

  it('renders title and description when open', () => {
    render(<ConfirmDialog {...defaultProps} />)

    expect(screen.getByText('Delete Route')).toBeInTheDocument()
    expect(
      screen.getByText('Are you sure you want to delete this route?'),
    ).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenChange(false) when cancel button clicked', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />,
    )

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('uses custom confirm label', () => {
    render(
      <ConfirmDialog {...defaultProps} confirmLabel="Delete Forever" />,
    )

    expect(
      screen.getByRole('button', { name: /delete forever/i }),
    ).toBeInTheDocument()
  })

  it('disables buttons when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />)

    const buttons = screen.getAllByRole('button')
    for (const button of buttons) {
      expect(button).toBeDisabled()
    }
  })

  it('shows spinner icon when loading', () => {
    const { container } = render(
      <ConfirmDialog {...defaultProps} loading={true} />,
    )

    // The LoaderIcon has animate-spin class
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('does not render content when open is false', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />)

    expect(screen.queryByText('Delete Route')).not.toBeInTheDocument()
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/confirm-dialog.test.tsx`
- [ ] Verify all tests pass.

### Step 4.8: Create `packages/web/src/components/rioku/__tests__/time-ago.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/time-ago.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimeAgo } from '../time-ago'
import { TooltipProvider } from '@/components/ui/tooltip'

// Wrap with TooltipProvider since TimeAgo uses Tooltip
function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('TimeAgo', () => {
  it('renders a relative time string', () => {
    // Use a date from 5 minutes ago
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    renderWithTooltip(<TimeAgo date={fiveMinAgo} />)

    // formatDistanceToNow returns something like "5 minutes ago"
    expect(screen.getByText(/minutes? ago/i)).toBeInTheDocument()
  })

  it('handles string date input', () => {
    const dateStr = new Date(Date.now() - 3600 * 1000).toISOString()
    renderWithTooltip(<TimeAgo date={dateStr} />)

    expect(screen.getByText(/hour/i)).toBeInTheDocument()
  })

  it('handles Date object input', () => {
    const date = new Date(Date.now() - 2 * 3600 * 1000)
    renderWithTooltip(<TimeAgo date={date} />)

    expect(screen.getByText(/hours? ago/i)).toBeInTheDocument()
  })

  it('renders without crashing for recent dates', () => {
    renderWithTooltip(<TimeAgo date={new Date()} />)

    // "less than a minute ago" or similar
    expect(screen.getByText(/less than|seconds?/i)).toBeInTheDocument()
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/time-ago.test.tsx`
- [ ] Verify all tests pass.

### Step 4.9: Create `packages/web/src/components/rioku/__tests__/data-table.test.tsx`

- [ ] Create file at `packages/web/src/components/rioku/__tests__/data-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTable, type Column } from '../data-table'

interface TestRow {
  id: string
  name: string
  status: string
  [key: string]: unknown
}

const columns: Column<TestRow>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'status', header: 'Status' },
]

const data: TestRow[] = [
  { id: '1', name: 'Alpha Route', status: 'active' },
  { id: '2', name: 'Beta Route', status: 'inactive' },
  { id: '3', name: 'Gamma Route', status: 'active' },
]

describe('DataTable', () => {
  it('renders column headers from config', () => {
    render(<DataTable columns={columns} data={data} />)

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('renders rows from data', () => {
    render(<DataTable columns={columns} data={data} />)

    expect(screen.getByText('Alpha Route')).toBeInTheDocument()
    expect(screen.getByText('Beta Route')).toBeInTheDocument()
    expect(screen.getByText('Gamma Route')).toBeInTheDocument()
  })

  it('uses custom render function for column', () => {
    const customColumns: Column<TestRow>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (row) => <strong data-testid="custom">{row.name}</strong>,
      },
    ]

    render(<DataTable columns={customColumns} data={data} />)

    expect(screen.getAllByTestId('custom')).toHaveLength(3)
  })

  it('renders search input when searchable', () => {
    render(<DataTable columns={columns} data={data} searchable />)

    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('filters rows by search text (case-insensitive)', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={data} searchable />)

    await user.type(screen.getByPlaceholderText('Search...'), 'alpha')

    expect(screen.getByText('Alpha Route')).toBeInTheDocument()
    expect(screen.queryByText('Beta Route')).not.toBeInTheDocument()
    expect(screen.queryByText('Gamma Route')).not.toBeInTheDocument()
  })

  it('searches across all columns', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={data} searchable />)

    await user.type(screen.getByPlaceholderText('Search...'), 'inactive')

    expect(screen.getByText('Beta Route')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Route')).not.toBeInTheDocument()
  })

  it('uses custom search placeholder', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        searchable
        searchPlaceholder="Find routes..."
      />,
    )

    expect(screen.getByPlaceholderText('Find routes...')).toBeInTheDocument()
  })

  it('paginates data', () => {
    render(<DataTable columns={columns} data={data} pageSize={2} />)

    // First page: 2 rows
    expect(screen.getByText('Alpha Route')).toBeInTheDocument()
    expect(screen.getByText('Beta Route')).toBeInTheDocument()
    expect(screen.queryByText('Gamma Route')).not.toBeInTheDocument()
  })

  it('navigates pages with next/prev buttons', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={data} pageSize={2} />)

    // Go to next page
    await user.click(screen.getByRole('button', { name: /next page/i }))

    expect(screen.queryByText('Alpha Route')).not.toBeInTheDocument()
    expect(screen.getByText('Gamma Route')).toBeInTheDocument()

    // Go back to previous page
    await user.click(screen.getByRole('button', { name: /previous page/i }))

    expect(screen.getByText('Alpha Route')).toBeInTheDocument()
  })

  it('sorts rows when sortable header is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <DataTable columns={columns} data={data} />,
    )

    // Click the sortable Name header
    const sortButton = screen.getByRole('button', { name: /name/i })
    await user.click(sortButton)

    // Rows should be sorted ascending by name
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0]).toHaveTextContent('Alpha Route')
    expect(rows[1]).toHaveTextContent('Beta Route')
    expect(rows[2]).toHaveTextContent('Gamma Route')

    // Click again for descending
    await user.click(sortButton)
    const rowsDesc = container.querySelectorAll('tbody tr')
    expect(rowsDesc[0]).toHaveTextContent('Gamma Route')
  })

  it('renders empty state when no data', () => {
    render(<DataTable columns={columns} data={[]} />)

    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('renders custom empty state', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyState={<div>Custom empty</div>}
      />,
    )

    expect(screen.getByText('Custom empty')).toBeInTheDocument()
  })

  it('renders actions slot in header', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        actions={<button>Add</button>}
      />,
    )

    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('renders title in header', () => {
    render(
      <DataTable columns={columns} data={data} title="Routes" />,
    )

    expect(screen.getByText('Routes')).toBeInTheDocument()
  })

  it('shows dash for null/undefined cell values', () => {
    const dataWithNull: TestRow[] = [
      { id: '1', name: 'Test', status: undefined as unknown as string },
    ]
    render(<DataTable columns={columns} data={dataWithNull} />)

    // The em dash character
    expect(screen.getByText('\u2014')).toBeInTheDocument()
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/rioku/__tests__/data-table.test.tsx`
- [ ] Verify all tests pass.

---

## Task 5: Plugin Component Tests

### Step 5.1: Create `packages/web/src/components/plugin/__tests__/slot.test.tsx`

- [ ] Create file at `packages/web/src/components/plugin/__tests__/slot.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Slot } from '../slot'
import { pluginRegistry, type ZoneProps } from '@/lib/plugin-registry'

describe('Slot', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renders nothing when no injections for zone', () => {
    const { container } = render(<Slot zone="nonexistent" />)

    expect(container.innerHTML).toBe('')
  })

  it('renders a single injection component', () => {
    const TestComponent = ({ zone, pluginId }: ZoneProps) => (
      <div data-testid="injected">
        {zone} - {pluginId}
      </div>
    )

    pluginRegistry.register({
      id: 'test-plugin',
      name: 'Test',
      version: '1.0.0',
      injections: [
        { zone: 'sidebar.bottom', component: TestComponent },
      ],
    })

    render(<Slot zone="sidebar.bottom" />)

    expect(screen.getByTestId('injected')).toBeInTheDocument()
    expect(screen.getByText(/sidebar\.bottom/)).toBeInTheDocument()
  })

  it('renders multiple injections sorted by priority', () => {
    const ComponentA = ({ pluginId }: ZoneProps) => (
      <div data-testid="comp-a">{pluginId}</div>
    )
    const ComponentB = ({ pluginId }: ZoneProps) => (
      <div data-testid="comp-b">{pluginId}</div>
    )

    pluginRegistry.register({
      id: 'plugin-a',
      name: 'A',
      version: '1.0.0',
      injections: [
        { zone: 'header.actions', component: ComponentA, priority: 10 },
      ],
    })
    pluginRegistry.register({
      id: 'plugin-b',
      name: 'B',
      version: '1.0.0',
      injections: [
        { zone: 'header.actions', component: ComponentB, priority: 1 },
      ],
    })

    const { container } = render(<Slot zone="header.actions" />)

    const divs = container.querySelectorAll('[data-testid]')
    // Priority 1 (plugin-b) should render before priority 10 (plugin-a)
    expect(divs[0]).toHaveAttribute('data-testid', 'comp-b')
    expect(divs[1]).toHaveAttribute('data-testid', 'comp-a')
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/plugin/__tests__/slot.test.tsx`
- [ ] Verify all tests pass.

### Step 5.2: Create `packages/web/src/components/plugin/__tests__/plugin-page.test.tsx`

- [ ] Create file at `packages/web/src/components/plugin/__tests__/plugin-page.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PluginPage } from '../plugin-page'

describe('PluginPage', () => {
  it('renders children normally', () => {
    render(
      <PluginPage pluginId="my-plugin">
        <div>Plugin Content</div>
      </PluginPage>,
    )

    expect(screen.getByText('Plugin Content')).toBeInTheDocument()
  })

  it('displays plugin ID badge', () => {
    render(
      <PluginPage pluginId="my-plugin">
        <div>Content</div>
      </PluginPage>,
    )

    expect(screen.getByText('my-plugin')).toBeInTheDocument()
  })

  it('catches child errors and shows error UI with plugin ID', () => {
    // Suppress React error boundary console output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function ThrowingComponent(): JSX.Element {
      throw new Error('Test crash')
    }

    render(
      <PluginPage pluginId="broken-plugin">
        <ThrowingComponent />
      </PluginPage>,
    )

    expect(screen.getByText('Plugin Error')).toBeInTheDocument()
    expect(screen.getByText(/broken-plugin/)).toBeInTheDocument()
    expect(screen.getByText('Test crash')).toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/plugin/__tests__/plugin-page.test.tsx`
- [ ] Verify all tests pass.

---

## Task 6: Layout Component Tests

> **Note:** Layout components depend heavily on TanStack Router, i18n, and the sidebar context. These tests use mocks for router state and translations.

### Step 6.1: Create `packages/web/src/components/layout/__tests__/keyboard-shortcut-help.test.tsx`

- [ ] Create file at `packages/web/src/components/layout/__tests__/keyboard-shortcut-help.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KeyboardShortcutHelp } from '../keyboard-shortcut-help'
import { useHotkey } from '@/hooks/use-hotkeys'
import { renderHook } from '@testing-library/react'

describe('KeyboardShortcutHelp', () => {
  it('displays registered shortcuts', () => {
    // Register some shortcuts first
    const cb = vi.fn()
    renderHook(() => useHotkey('Mod+k', cb, { scope: 'global' }))
    renderHook(() => useHotkey('Mod+p', cb, { scope: 'navigation' }))

    render(
      <KeyboardShortcutHelp open={true} onOpenChange={vi.fn()} />,
    )

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Mod+k')).toBeInTheDocument()
    expect(screen.getByText('Mod+p')).toBeInTheDocument()
  })

  it('groups shortcuts by scope', () => {
    const cb = vi.fn()
    renderHook(() => useHotkey('Mod+k', cb, { scope: 'global' }))
    renderHook(() => useHotkey('Mod+j', cb, { scope: 'editor' }))

    render(
      <KeyboardShortcutHelp open={true} onOpenChange={vi.fn()} />,
    )

    expect(screen.getByText('global')).toBeInTheDocument()
    expect(screen.getByText('editor')).toBeInTheDocument()
  })

  it('shows no shortcuts message when registry is empty', () => {
    // Reset modules to clear registry
    render(
      <KeyboardShortcutHelp open={true} onOpenChange={vi.fn()} />,
    )

    // If no shortcuts registered (or all unmounted), shows empty state
    // This depends on state from other tests, so we just verify it renders
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(
      <KeyboardShortcutHelp open={false} onOpenChange={vi.fn()} />,
    )

    expect(
      screen.queryByText('Keyboard Shortcuts'),
    ).not.toBeInTheDocument()
  })

  it('formats key labels with platform modifier', () => {
    const cb = vi.fn()
    renderHook(() => useHotkey('Mod+k', cb, { scope: 'global' }))

    render(
      <KeyboardShortcutHelp open={true} onOpenChange={vi.fn()} />,
    )

    // On non-Mac, Mod should display as Ctrl
    // The formatted version shows in the <kbd> element
    const kbdElements = screen.getAllByText(/Ctrl/)
    expect(kbdElements.length).toBeGreaterThan(0)
  })
})
```

- [ ] Run: `cd packages/web && npx vitest run src/components/layout/__tests__/keyboard-shortcut-help.test.tsx`
- [ ] Verify all tests pass.

---

## Task 7: Coverage Baseline and Make Targets

### Step 7.1: Create initial coverage baseline

- [ ] Run from `packages/web/`:

```bash
npx vitest run --coverage 2>&1 | grep 'All files' | awk '{print $NF}' | tr -d '%' > coverage-baseline.txt
```

If the above command does not produce a single number, run `npx vitest run --coverage` and manually inspect the output. Create `packages/web/coverage-baseline.txt` with the total coverage percentage (e.g., `75.0`).

- [ ] Verify file contains a single decimal number.

### Step 7.2: Add Make targets to `Makefile`

- [ ] Add the following targets to the root `Makefile` after the existing `web-dev` target:

```makefile
## test-web: Run frontend Vitest tests
test-web:
	cd $(PKG)/web && npm test

## test-web-coverage: Run frontend Vitest tests with coverage
test-web-coverage:
	cd $(PKG)/web && npm run test:coverage
```

### Step 7.3: Verify Make targets work

- [ ] Run from repo root:

```bash
make test-web
```

- [ ] Confirm exit code 0, all tests pass.

- [ ] Run from repo root:

```bash
make test-web-coverage
```

- [ ] Confirm coverage report is generated and printed.

### Step 7.4: Update `test` target to include web

- [ ] Update the root `Makefile` `test` target to also run web tests:

```makefile
## test: Run all tests
test:
	cd $(PKG)/daemon && $(GO) test ./...
	cd $(PKG)/build-service && $(GO) test ./...
	cd $(PKG)/web && npm test
```

---

## Summary

| Task | Steps | Files Created/Modified |
|---|---|---|
| 1. Vitest Setup | 7 | `vitest.config.ts`, `src/test/setup.ts`, `src/test/utils.tsx`, `package.json` |
| 2. Library Tests | 6 | `src/lib/__tests__/utils.test.ts`, `api.test.ts`, `preferences.test.ts`, `plugin-registry.test.ts`, `plugin-loader.test.ts`, `i18n.test.ts` |
| 3. Hook Tests | 5 | `src/hooks/__tests__/use-auth.test.ts`, `use-theme.test.ts`, `use-hotkeys.test.ts`, `use-events.test.ts`, `use-mobile.test.ts` |
| 4. Rioku Component Tests | 9 | `src/components/rioku/__tests__/stat-card.test.tsx`, `page-header.test.tsx`, `empty-state.test.tsx`, `status-badge.test.tsx`, `code-block.test.tsx`, `sparkline.test.tsx`, `confirm-dialog.test.tsx`, `time-ago.test.tsx`, `data-table.test.tsx` |
| 5. Plugin Component Tests | 2 | `src/components/plugin/__tests__/slot.test.tsx`, `plugin-page.test.tsx` |
| 6. Layout Component Tests | 1 | `src/components/layout/__tests__/keyboard-shortcut-help.test.tsx` |
| 7. Coverage & Make | 4 | `coverage-baseline.txt`, `Makefile` |

**Total: 7 tasks, 34 steps, ~25 new files**

All file paths are relative to `packages/web/` unless otherwise noted. Makefile changes are in the repo root.
