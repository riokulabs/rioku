// Theme utilities for resolving, applying, and detecting OS preferences.

export type Theme = 'dark' | 'light' | 'system'

/**
 * Resolve a Theme value to a concrete 'dark' | 'light' value.
 * When theme is 'system', uses `window.matchMedia` to detect OS preference.
 * Falls back to 'dark' in non-browser environments.
 */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'dark' || theme === 'light') return theme
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Apply a resolved theme by toggling the `.dark` class on `document.documentElement`.
 */
export function applyTheme(resolved: 'dark' | 'light'): void {
  const el = document.documentElement
  if (resolved === 'dark') {
    el.classList.add('dark')
  } else {
    el.classList.remove('dark')
  }
}

/**
 * Detect OS-level accessibility and appearance preferences.
 * Returns the current OS theme, reduced-motion preference, and high-contrast preference.
 */
export function detectOSPreferences(): {
  theme: 'dark' | 'light'
  reducedMotion: boolean
  highContrast: boolean
} {
  if (typeof window === 'undefined') {
    return { theme: 'dark', reducedMotion: false, highContrast: false }
  }

  const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const highContrast = window.matchMedia('(prefers-contrast: more)').matches

  return { theme, reducedMotion, highContrast } as const
}
