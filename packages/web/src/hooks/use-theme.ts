// Theme management hook backed by scoped user preferences.
// Core theme utilities (resolveTheme, applyTheme) are imported from @rioku/ui
// so they can be shared across packages.

import { useCallback, useEffect, useState } from 'react'
import {
  resolveTheme,
  applyTheme,
  type Theme,
} from '@rioku/ui'
import { usePreferences } from '@/hooks/use-preferences'

interface UseThemeReturn {
  theme: Theme
  setTheme: (t: Theme) => void
  resolvedTheme: 'dark' | 'light'
}

export function useTheme(): UseThemeReturn {
  const [storedTheme, setStoredTheme] = usePreferences<Theme>('theme', 'dark', 'global')
  const [theme, setThemeState] = useState<Theme>(storedTheme)
  const [resolvedTheme, setResolved] = useState<'dark' | 'light'>(() =>
    resolveTheme(storedTheme),
  )

  // Sync when storedTheme changes (e.g. user switch).
  useEffect(() => {
    setThemeState(storedTheme)
    const resolved = resolveTheme(storedTheme)
    setResolved(resolved)
    applyTheme(resolved)
  }, [storedTheme])

  // Apply resolved theme to <html> and persist
  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t)
      setStoredTheme(t)
      const resolved = resolveTheme(t)
      setResolved(resolved)
      applyTheme(resolved)
    },
    [setStoredTheme],
  )

  // Apply on mount
  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  // Listen for OS theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      const r = e.matches ? 'dark' : 'light'
      setResolved(r)
      applyTheme(r)
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme])

  return { theme, setTheme, resolvedTheme }
}
