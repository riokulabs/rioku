// Dynamic ES module loading for Rioku web plugins.

import { apiClient } from '@/lib/api'
import { pluginRegistry, type RiokuWebPlugin } from '@/lib/plugin-registry'

interface PluginManifest {
  plugins: { url: string }[]
}

/**
 * Dynamically import an ES module from the given URL and register it
 * with the plugin registry. The module must have a default export
 * conforming to RiokuWebPlugin.
 */
export async function loadPlugin(url: string): Promise<void> {
  try {
    const mod = await import(/* @vite-ignore */ url)
    const plugin: RiokuWebPlugin = mod.default
    if (!plugin?.id || !plugin?.name) {
      console.error(`[plugin-loader] Invalid plugin at ${url}: missing id or name`)
      return
    }
    pluginRegistry.register(plugin)
  } catch (err) {
    console.error(`[plugin-loader] Failed to load plugin from ${url}:`, err)
  }
}

/**
 * Fetch the plugin manifest from the daemon and load all listed plugins.
 */
export async function loadPluginsFromManifest(): Promise<void> {
  try {
    const manifest = await apiClient.get<PluginManifest>('/plugins/manifest')
    const loads = manifest.plugins.map((p) => loadPlugin(p.url))
    await Promise.allSettled(loads)
  } catch (err) {
    console.error('[plugin-loader] Failed to load plugin manifest:', err)
  }
}
