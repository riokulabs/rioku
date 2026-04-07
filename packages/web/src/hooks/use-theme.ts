// Theme management hook backed by user preferences.

import { useCallback, useEffect, useState } from 'react'
import { getPreferences, setPreference } from '@/lib/preferences'

type Theme = 'dark' | 'light' | 'system'

interface UseThemeReturn {
  theme: Theme
  setTheme: (t: Theme) => void
  resolvedTheme: 'dark' | 'light'
}

function resolveSystem(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(resolved: 'dark' | 'light'): void {
  const el = document.documentElement
  if (resolved === 'dark') {
    el.classList.add('dark')
  } else {
    el.classList.remove('dark')
  }
}

export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<Theme>(() => getPreferences().theme)
  const [resolvedTheme, setResolved] = useState<'dark' | 'light'>(() =>
    theme === 'system' ? resolveSystem() : theme,
  )

  // Apply resolved theme to <html> and persist
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    setPreference('theme', t)
    const resolved = t === 'system' ? resolveSystem() : t
    setResolved(resolved)
    applyTheme(resolved)
  }, [])

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
