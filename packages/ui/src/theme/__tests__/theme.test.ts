import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveTheme, applyTheme, detectOSPreferences } from '../index'
import type { Theme } from '../index'

// Helper to mock matchMedia
function mockMatchMedia(overrides: Record<string, boolean> = {}) {
  const results: Record<string, boolean> = {
    '(prefers-color-scheme: dark)': false,
    '(prefers-reduced-motion: reduce)': false,
    '(prefers-contrast: more)': false,
    ...overrides,
  }

  window.matchMedia = vi.fn((query: string) => ({
    matches: results[query] ?? false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

describe('resolveTheme', () => {
  beforeEach(() => {
    mockMatchMedia()
  })

  it('returns "dark" when theme is "dark"', () => {
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('returns "light" when theme is "light"', () => {
    expect(resolveTheme('light')).toBe('light')
  })

  it('returns "dark" when theme is "system" and OS prefers dark', () => {
    mockMatchMedia({ '(prefers-color-scheme: dark)': true })
    expect(resolveTheme('system')).toBe('dark')
  })

  it('returns "light" when theme is "system" and OS prefers light', () => {
    mockMatchMedia({ '(prefers-color-scheme: dark)': false })
    expect(resolveTheme('system')).toBe('light')
  })

  it('does not call matchMedia for explicit dark/light values', () => {
    const spy = vi.spyOn(window, 'matchMedia')
    resolveTheme('dark')
    resolveTheme('light')
    expect(spy).not.toHaveBeenCalled()
  })

  it('calls matchMedia only for "system" theme', () => {
    const spy = vi.spyOn(window, 'matchMedia')
    resolveTheme('system')
    expect(spy).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })

  it('handles all Theme type values exhaustively', () => {
    const themes: Theme[] = ['dark', 'light', 'system']
    for (const t of themes) {
      const result = resolveTheme(t)
      expect(['dark', 'light']).toContain(result)
    }
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
  })

  it('adds "dark" class when resolved is "dark"', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes "dark" class when resolved is "light"', () => {
    document.documentElement.classList.add('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('is idempotent — applying dark twice does not duplicate class', () => {
    applyTheme('dark')
    applyTheme('dark')
    const darkCount = Array.from(document.documentElement.classList).filter(
      (c) => c === 'dark',
    ).length
    expect(darkCount).toBe(1)
  })

  it('is idempotent — applying light when already light is a no-op', () => {
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggles correctly between dark and light', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('does not affect other classes on documentElement', () => {
    document.documentElement.classList.add('custom-class')
    applyTheme('dark')
    expect(document.documentElement.classList.contains('custom-class')).toBe(true)
    applyTheme('light')
    expect(document.documentElement.classList.contains('custom-class')).toBe(true)
  })
})

describe('detectOSPreferences', () => {
  it('returns light theme when OS does not prefer dark', () => {
    mockMatchMedia({ '(prefers-color-scheme: dark)': false })
    const prefs = detectOSPreferences()
    expect(prefs.theme).toBe('light')
  })

  it('returns dark theme when OS prefers dark', () => {
    mockMatchMedia({ '(prefers-color-scheme: dark)': true })
    const prefs = detectOSPreferences()
    expect(prefs.theme).toBe('dark')
  })

  it('detects reduced motion preference', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true })
    const prefs = detectOSPreferences()
    expect(prefs.reducedMotion).toBe(true)
  })

  it('returns false for reduced motion when not set', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': false })
    const prefs = detectOSPreferences()
    expect(prefs.reducedMotion).toBe(false)
  })

  it('detects high contrast preference', () => {
    mockMatchMedia({ '(prefers-contrast: more)': true })
    const prefs = detectOSPreferences()
    expect(prefs.highContrast).toBe(true)
  })

  it('returns false for high contrast when not set', () => {
    mockMatchMedia({ '(prefers-contrast: more)': false })
    const prefs = detectOSPreferences()
    expect(prefs.highContrast).toBe(false)
  })

  it('detects all preferences simultaneously', () => {
    mockMatchMedia({
      '(prefers-color-scheme: dark)': true,
      '(prefers-reduced-motion: reduce)': true,
      '(prefers-contrast: more)': true,
    })
    const prefs = detectOSPreferences()
    expect(prefs).toEqual({
      theme: 'dark',
      reducedMotion: true,
      highContrast: true,
    })
  })

  it('returns defaults when no preferences are active', () => {
    mockMatchMedia()
    const prefs = detectOSPreferences()
    expect(prefs).toEqual({
      theme: 'light',
      reducedMotion: false,
      highContrast: false,
    })
  })
})
