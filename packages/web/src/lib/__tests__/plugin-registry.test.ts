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
