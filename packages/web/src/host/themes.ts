/**
 * Plugin-theme registry — spec §9.5.5
 *
 * Complements `src/theme/index.ts` which owns BUILTIN_THEMES.
 * Plugins call `host.themes.register(...)` to add themes discoverable by the
 * theme picker (wired in Task 1f.108).
 *
 * Duplicate-name policy: overwrite with a warning in dev.
 * Theme names are natural keys — no id factory needed.
 */

import { create } from 'zustand';
import type { RegisteredTheme } from '@/theme';

// ─── Store ────────────────────────────────────────────────────────────────────

interface ThemeStore {
  themes: RegisteredTheme[];
}

const useThemeStore = create<ThemeStore>()(() => ({ themes: [] }));

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Register a plugin-contributed theme.
 * Overwrites a theme with the same name (warns in dev).
 * Returns the theme name for tracking.
 */
export function registerPluginTheme(theme: RegisteredTheme): string {
  useThemeStore.setState((state) => {
    const existing = state.themes.find((t) => t.name === theme.name);
    if (existing && import.meta.env.DEV) {
      console.warn(
        `[host.themes] Theme "${theme.name}" already registered — overwriting.`,
      );
    }
    const themes = existing
      ? state.themes.map((t) => (t.name === theme.name ? theme : t))
      : [...state.themes, theme];
    return { themes };
  });
  return theme.name;
}

/** Unregister a plugin theme by name. No-op if not found. */
export function unregisterPluginTheme(name: string): void {
  useThemeStore.setState((state) => ({
    themes: state.themes.filter((t) => t.name !== name),
  }));
}

/** Return all plugin-registered themes (excludes built-ins). */
export function listPluginThemes(): RegisteredTheme[] {
  return useThemeStore.getState().themes;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React hook — re-renders when plugin themes change. */
export function usePluginThemes(): RegisteredTheme[] {
  return useThemeStore((state) => state.themes);
}
