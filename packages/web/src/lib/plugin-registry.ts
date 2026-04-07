// Plugin registration and injection zone management.

import { type ComponentType, type LazyExoticComponent, useSyncExternalStore } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string
  icon: string
  path: string
}

export interface PluginRoute {
  path: string
  component: LazyExoticComponent<ComponentType>
}

export interface WidgetProps {
  pluginId: string
}

export interface DashboardWidget {
  title: string
  size: 'sm' | 'md' | 'lg'
  component: ComponentType<WidgetProps>
}

export interface ZoneProps {
  zone: string
  pluginId: string
}

export interface InjectionZone {
  zone: string
  component: ComponentType<ZoneProps>
  priority?: number
}

export interface RiokuWebPlugin {
  id: string
  name: string
  version: string
  navItems?: NavItem[]
  routes?: PluginRoute[]
  dashboardWidgets?: DashboardWidget[]
  configPanel?: ComponentType
  injections?: InjectionZone[]
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type Listener = () => void

class PluginRegistry {
  private plugins = new Map<string, RiokuWebPlugin>()
  private listeners = new Set<Listener>()
  private snapshot = 0

  register(plugin: RiokuWebPlugin): void {
    this.plugins.set(plugin.id, plugin)
    this.notify()
  }

  getNavItems(): NavItem[] {
    const items: NavItem[] = []
    for (const p of this.plugins.values()) {
      if (p.navItems) items.push(...p.navItems)
    }
    return items
  }

  getRoutes(): PluginRoute[] {
    const routes: PluginRoute[] = []
    for (const p of this.plugins.values()) {
      if (p.routes) routes.push(...p.routes)
    }
    return routes
  }

  getDashboardWidgets(): (DashboardWidget & { pluginId: string })[] {
    const widgets: (DashboardWidget & { pluginId: string })[] = []
    for (const p of this.plugins.values()) {
      if (p.dashboardWidgets) {
        for (const w of p.dashboardWidgets) {
          widgets.push({ ...w, pluginId: p.id })
        }
      }
    }
    return widgets
  }

  getInjections(zone: string): (InjectionZone & { pluginId: string })[] {
    const result: (InjectionZone & { pluginId: string })[] = []
    for (const p of this.plugins.values()) {
      if (p.injections) {
        for (const inj of p.injections) {
          if (inj.zone === zone) {
            result.push({ ...inj, pluginId: p.id })
          }
        }
      }
    }
    return result.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  }

  getConfigPanel(pluginId: string): ComponentType | null {
    return this.plugins.get(pluginId)?.configPanel ?? null
  }

  // For useSyncExternalStore
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): number => this.snapshot

  private notify(): void {
    this.snapshot++
    for (const l of this.listeners) l()
  }
}

export const pluginRegistry = new PluginRegistry()

/** React hook that re-renders when plugins change. */
export function usePluginRegistry(): PluginRegistry {
  useSyncExternalStore(pluginRegistry.subscribe, pluginRegistry.getSnapshot)
  return pluginRegistry
}
