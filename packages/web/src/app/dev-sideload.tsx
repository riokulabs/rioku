/**
 * Dev-mode plugin sideload — Task 1f.114.
 *
 * On app mount (dev builds only), reads `?plugin=./path/plugin.mjs` from the
 * URL search params and sideloads the plugin ESM bundle.
 *
 * Supported query params:
 *   ?plugin=./path/plugin.mjs
 *     → Synthesises a minimal manifest and calls loadDevPluginSideload.
 *   ?plugin=./path/plugin.mjs&manifest=./path/manifest.json
 *     → Fetches the real manifest from `manifest` param, then loads the plugin.
 *
 * This component renders nothing — it is mounted once early in <App> and only
 * runs in DEV builds.  In production the entire effect is a no-op (the
 * `import.meta.env.DEV` guard ensures the module is tree-shaken).
 *
 * spec §9.2 distribution / Task 1f.114
 */

import { useEffect } from 'react';
import {
  loadDevPluginSideload,
  loadPluginFromUrl,
} from '@/host/plugin-loader';
import type { PluginManifest } from '@/host/manifest-schema';

/** Minimal synthetic manifest for dev sideload (no real manifest provided). */
function syntheticManifest(slug: string): PluginManifest {
  return {
    name: slug,
    version: '0.0.0-dev',
    displayName: `Dev Plugin: ${slug}`,
    author: { name: 'dev' },
    abi: { minVersion: 1 },
    parts: {},
    permissions: [],
    zones: [],
    isolation: 'shared',
  };
}

export function DevSideload() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const params = new URLSearchParams(window.location.search);
    const pluginPath = params.get('plugin');
    if (!pluginPath) return;

    const manifestPath = params.get('manifest');
    // Derive a slug from the filename: strip directories and extension.
    const slug = pluginPath.split('/').pop()?.replace(/\.mjs$/, '') ?? 'dev-plugin';

    void (async () => {
      if (manifestPath) {
        // Real manifest path provided — construct an absolute URL relative to
        // the current page and call the standard URL loader.
        const manifestUrl = new URL(manifestPath, window.location.href).href;
        console.info(`[dev-sideload] loading "${slug}" with manifest from ${manifestUrl}`);
        const result = await loadPluginFromUrl(manifestUrl, { enabled: true });
        if (result.ok) {
          console.info(`[dev-sideload] loaded "${slug}" successfully`);
        } else {
          console.error(`[dev-sideload] failed:`, result.errors);
        }
        if (result.warnings?.length) {
          console.warn(`[dev-sideload] warnings:`, result.warnings);
        }
      } else {
        // No manifest — synthesise a minimal one.
        const pluginUrl = new URL(pluginPath, window.location.href).href;
        const manifest = syntheticManifest(slug);
        // Inject the parts.admin so the loader finds the bundle.
        manifest.parts = { admin: pluginUrl };

        console.info(`[dev-sideload] loading "${slug}" from ${pluginUrl} (synthetic manifest)`);
        const result = await loadDevPluginSideload(slug, pluginUrl, manifest);
        if (result.ok) {
          console.info(`[dev-sideload] loaded "${slug}" successfully`);
        } else {
          console.error(`[dev-sideload] failed:`, result.errors);
        }
        if (result.warnings?.length) {
          console.warn(`[dev-sideload] warnings:`, result.warnings);
        }
      }
    })();
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
