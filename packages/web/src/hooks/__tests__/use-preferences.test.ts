import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock useCurrentUser so we control the userId without needing react-query.
vi.mock('@/hooks/use-auth', () => ({
  useCurrentUser: vi.fn(() => ({ id: 'test-user' })),
}))

import { useCurrentUser } from '@/hooks/use-auth'
import { usePreferences } from '../use-preferences'
import { getDeviceHash, getPreference } from '@/lib/preferences'

const mockedUseCurrentUser = vi.mocked(useCurrentUser)

describe('usePreferences', () => {
  beforeEach(() => {
    localStorage.clear()
    mockedUseCurrentUser.mockReturnValue({ id: 'test-user' } as ReturnType<typeof useCurrentUser>)
  })

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------

  describe('defaults', () => {
    it('returns the default value when nothing is stored', () => {
      const { result } = renderHook(() =>
        usePreferences('theme', 'dark', 'global'),
      )
      expect(result.current[0]).toBe('dark')
    })

    it('returns a complex default value', () => {
      const def = { config: true, health: true }
      const { result } = renderHook(() =>
        usePreferences('notifications', def, 'global'),
      )
      expect(result.current[0]).toEqual(def)
    })
  })

  // ---------------------------------------------------------------------------
  // Read stored values
  // ---------------------------------------------------------------------------

  describe('reading stored values', () => {
    it('reads a global preference from localStorage', () => {
      localStorage.setItem(
        'rioku-pref:global:test-user:theme',
        JSON.stringify('light'),
      )
      const { result } = renderHook(() =>
        usePreferences('theme', 'dark', 'global'),
      )
      expect(result.current[0]).toBe('light')
    })

    it('reads a device preference from localStorage', () => {
      const hash = getDeviceHash()
      localStorage.setItem(
        `rioku-pref:device:test-user:${hash}:pageSize`,
        JSON.stringify(50),
      )
      const { result } = renderHook(() =>
        usePreferences('pageSize', 20, 'device'),
      )
      expect(result.current[0]).toBe(50)
    })
  })

  // ---------------------------------------------------------------------------
  // Write (setter)
  // ---------------------------------------------------------------------------

  describe('setter', () => {
    it('updates state and persists to localStorage', () => {
      const { result } = renderHook(() =>
        usePreferences('theme', 'dark', 'global'),
      )

      act(() => {
        result.current[1]('light')
      })

      expect(result.current[0]).toBe('light')
      expect(
        getPreference('global', 'test-user', 'theme', 'dark'),
      ).toBe('light')
    })

    it('persists device-scoped preference', () => {
      const { result } = renderHook(() =>
        usePreferences('sidebarCollapsed', false, 'device'),
      )

      act(() => {
        result.current[1](true)
      })

      expect(result.current[0]).toBe(true)
      expect(
        getPreference('device', 'test-user', 'sidebarCollapsed', false),
      ).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Scope
  // ---------------------------------------------------------------------------

  describe('scope', () => {
    it('defaults to global scope when omitted', () => {
      const { result } = renderHook(() =>
        usePreferences('locale', 'en'),
      )

      act(() => {
        result.current[1]('fr')
      })

      expect(
        localStorage.getItem('rioku-pref:global:test-user:locale'),
      ).toBe('"fr"')
    })

    it('isolates global and device scopes for same key', () => {
      const { result: globalResult } = renderHook(() =>
        usePreferences('shared-key', 'global-default', 'global'),
      )
      const { result: deviceResult } = renderHook(() =>
        usePreferences('shared-key', 'device-default', 'device'),
      )

      act(() => {
        globalResult.current[1]('global-val')
      })
      act(() => {
        deviceResult.current[1]('device-val')
      })

      expect(globalResult.current[0]).toBe('global-val')
      expect(deviceResult.current[0]).toBe('device-val')
    })
  })

  // ---------------------------------------------------------------------------
  // Anonymous fallback
  // ---------------------------------------------------------------------------

  describe('anonymous fallback', () => {
    it('uses "anonymous" userId when not authenticated', () => {
      mockedUseCurrentUser.mockReturnValue(null)

      const { result } = renderHook(() =>
        usePreferences('theme', 'dark', 'global'),
      )

      act(() => {
        result.current[1]('light')
      })

      expect(
        localStorage.getItem('rioku-pref:global:anonymous:theme'),
      ).toBe('"light"')
    })
  })

  // ---------------------------------------------------------------------------
  // Legacy migration
  // ---------------------------------------------------------------------------

  describe('legacy migration', () => {
    it('migrates old rioku-preferences on first render', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ theme: 'light', locale: 'de' }),
      )

      const { result } = renderHook(() =>
        usePreferences('theme', 'dark', 'global'),
      )

      expect(result.current[0]).toBe('light')
    })

    it('migrates device-scoped legacy preferences', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ sidebarCollapsed: true }),
      )

      const { result } = renderHook(() =>
        usePreferences('sidebarCollapsed', false, 'device'),
      )

      expect(result.current[0]).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Re-read on userId change
  // ---------------------------------------------------------------------------

  describe('userId change', () => {
    it('re-reads preference when user changes', () => {
      // Set preferences for two different users
      localStorage.setItem(
        'rioku-pref:global:user-a:theme',
        JSON.stringify('light'),
      )
      localStorage.setItem(
        'rioku-pref:global:user-b:theme',
        JSON.stringify('system'),
      )

      mockedUseCurrentUser.mockReturnValue({ id: 'user-a' } as ReturnType<typeof useCurrentUser>)
      const { result, rerender } = renderHook(() =>
        usePreferences('theme', 'dark', 'global'),
      )
      expect(result.current[0]).toBe('light')

      mockedUseCurrentUser.mockReturnValue({ id: 'user-b' } as ReturnType<typeof useCurrentUser>)
      rerender()
      expect(result.current[0]).toBe('system')
    })
  })
})
