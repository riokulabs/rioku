import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getDeviceHash,
  getPreference,
  setPreference,
  removePreference,
  migrateLegacyPreferences,
  getPreferences,
  setPreferenceLegacy,
  resetPreferences,
} from '../preferences'

describe('preferences (scoped API)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ---------------------------------------------------------------------------
  // getDeviceHash
  // ---------------------------------------------------------------------------

  describe('getDeviceHash', () => {
    it('returns a hex string', () => {
      const hash = getDeviceHash()
      expect(hash).toMatch(/^[0-9a-f]{8}$/)
    })

    it('returns a consistent value for the same environment', () => {
      expect(getDeviceHash()).toBe(getDeviceHash())
    })
  })

  // ---------------------------------------------------------------------------
  // Key format
  // ---------------------------------------------------------------------------

  describe('key format', () => {
    it('global scope stores under rioku-pref:global:{userId}:{key}', () => {
      setPreference('global', 'user-123', 'theme', 'dark')
      expect(localStorage.getItem('rioku-pref:global:user-123:theme')).toBe(
        '"dark"',
      )
    })

    it('device scope stores under rioku-pref:device:{userId}:{deviceHash}:{key}', () => {
      const hash = getDeviceHash()
      setPreference('device', 'user-123', 'sidebarCollapsed', true)
      expect(
        localStorage.getItem(
          `rioku-pref:device:user-123:${hash}:sidebarCollapsed`,
        ),
      ).toBe('true')
    })
  })

  // ---------------------------------------------------------------------------
  // getPreference
  // ---------------------------------------------------------------------------

  describe('getPreference', () => {
    it('returns default value when key does not exist', () => {
      expect(getPreference('global', 'u1', 'theme', 'dark')).toBe('dark')
    })

    it('reads stored value from global scope', () => {
      localStorage.setItem(
        'rioku-pref:global:u1:locale',
        JSON.stringify('fr'),
      )
      expect(getPreference('global', 'u1', 'locale', 'en')).toBe('fr')
    })

    it('reads stored value from device scope', () => {
      const hash = getDeviceHash()
      localStorage.setItem(
        `rioku-pref:device:u1:${hash}:pageSize`,
        JSON.stringify(50),
      )
      expect(getPreference('device', 'u1', 'pageSize', 20)).toBe(50)
    })

    it('returns default for invalid JSON', () => {
      localStorage.setItem(
        'rioku-pref:global:u1:theme',
        'not-valid-json{{{',
      )
      expect(getPreference('global', 'u1', 'theme', 'dark')).toBe('dark')
    })

    it('handles complex object values', () => {
      const notifications = { config: false, health: true, plugins: true }
      setPreference('global', 'u1', 'notifications', notifications)
      expect(
        getPreference('global', 'u1', 'notifications', {
          config: true,
          health: true,
          plugins: true,
        }),
      ).toEqual(notifications)
    })

    it('isolates different users on global scope', () => {
      setPreference('global', 'alice', 'theme', 'light')
      setPreference('global', 'bob', 'theme', 'dark')

      expect(getPreference('global', 'alice', 'theme', 'dark')).toBe('light')
      expect(getPreference('global', 'bob', 'theme', 'dark')).toBe('dark')
    })
  })

  // ---------------------------------------------------------------------------
  // setPreference
  // ---------------------------------------------------------------------------

  describe('setPreference', () => {
    it('persists a string', () => {
      setPreference('global', 'u1', 'theme', 'light')
      const raw = localStorage.getItem('rioku-pref:global:u1:theme')
      expect(raw).toBe('"light"')
    })

    it('persists a number', () => {
      setPreference('device', 'u1', 'pageSize', 100)
      const hash = getDeviceHash()
      const raw = localStorage.getItem(
        `rioku-pref:device:u1:${hash}:pageSize`,
      )
      expect(raw).toBe('100')
    })

    it('persists a boolean', () => {
      setPreference('device', 'u1', 'sidebarOpen', false)
      const hash = getDeviceHash()
      const raw = localStorage.getItem(
        `rioku-pref:device:u1:${hash}:sidebarOpen`,
      )
      expect(raw).toBe('false')
    })

    it('overwrites existing value', () => {
      setPreference('global', 'u1', 'theme', 'dark')
      setPreference('global', 'u1', 'theme', 'light')
      expect(getPreference('global', 'u1', 'theme', 'dark')).toBe('light')
    })
  })

  // ---------------------------------------------------------------------------
  // removePreference
  // ---------------------------------------------------------------------------

  describe('removePreference', () => {
    it('removes a global preference', () => {
      setPreference('global', 'u1', 'theme', 'light')
      removePreference('global', 'u1', 'theme')
      expect(getPreference('global', 'u1', 'theme', 'dark')).toBe('dark')
    })

    it('removes a device preference', () => {
      setPreference('device', 'u1', 'sidebar', true)
      removePreference('device', 'u1', 'sidebar')
      expect(getPreference('device', 'u1', 'sidebar', false)).toBe(false)
    })

    it('is a no-op for non-existent keys', () => {
      // Should not throw
      removePreference('global', 'u1', 'nonexistent')
    })
  })

  // ---------------------------------------------------------------------------
  // migrateLegacyPreferences
  // ---------------------------------------------------------------------------

  describe('migrateLegacyPreferences', () => {
    it('migrates theme to global scope', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ theme: 'light' }),
      )
      migrateLegacyPreferences('u1')

      expect(getPreference('global', 'u1', 'theme', 'dark')).toBe('light')
    })

    it('migrates locale to global scope', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ locale: 'fr' }),
      )
      migrateLegacyPreferences('u1')

      expect(getPreference('global', 'u1', 'locale', 'en')).toBe('fr')
    })

    it('migrates sidebarCollapsed to device scope', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ sidebarCollapsed: true }),
      )
      migrateLegacyPreferences('u1')

      expect(
        getPreference('device', 'u1', 'sidebarCollapsed', false),
      ).toBe(true)
    })

    it('migrates tablePageSize to device scope', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ tablePageSize: 50 }),
      )
      migrateLegacyPreferences('u1')

      expect(getPreference('device', 'u1', 'tablePageSize', 20)).toBe(50)
    })

    it('migrates notifications to global scope', () => {
      const notifs = { config: false, health: true, plugins: false }
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ notifications: notifs }),
      )
      migrateLegacyPreferences('u1')

      expect(
        getPreference('global', 'u1', 'notifications', {
          config: true,
          health: true,
          plugins: true,
        }),
      ).toEqual(notifs)
    })

    it('only runs once per userId (idempotent)', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ theme: 'light' }),
      )
      migrateLegacyPreferences('u1')

      // Change the legacy data — migration should NOT re-run
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ theme: 'system' }),
      )
      migrateLegacyPreferences('u1')

      expect(getPreference('global', 'u1', 'theme', 'dark')).toBe('light')
    })

    it('sets migration marker even when no legacy data exists', () => {
      migrateLegacyPreferences('u1')
      expect(localStorage.getItem('rioku-pref:migrated:u1')).toBe('1')
    })

    it('handles corrupt legacy JSON gracefully', () => {
      localStorage.setItem('rioku-preferences', 'broken{{{')
      // Should not throw
      migrateLegacyPreferences('u1')
      expect(localStorage.getItem('rioku-pref:migrated:u1')).toBe('1')
    })

    it('migrates independently for different users', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ theme: 'light', locale: 'de' }),
      )
      migrateLegacyPreferences('alice')
      migrateLegacyPreferences('bob')

      expect(getPreference('global', 'alice', 'theme', 'dark')).toBe('light')
      expect(getPreference('global', 'bob', 'theme', 'dark')).toBe('light')
    })
  })

  // ---------------------------------------------------------------------------
  // Legacy compat API (deprecated)
  // ---------------------------------------------------------------------------

  describe('legacy compat API', () => {
    it('getPreferences returns defaults when localStorage is empty', () => {
      const prefs = getPreferences()
      expect(prefs.theme).toBe('dark')
      expect(prefs.sidebarCollapsed).toBe(false)
      expect(prefs.tablePageSize).toBe(20)
      expect(prefs.notifications).toEqual({
        config: true,
        health: true,
        plugins: true,
      })
      expect(prefs.locale).toBe('en')
    })

    it('getPreferences merges stored values with defaults', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ theme: 'light', tablePageSize: 50 }),
      )
      const prefs = getPreferences()
      expect(prefs.theme).toBe('light')
      expect(prefs.tablePageSize).toBe(50)
      expect(prefs.sidebarCollapsed).toBe(false)
      expect(prefs.locale).toBe('en')
    })

    it('getPreferences deep-merges notification preferences', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ notifications: { config: false } }),
      )
      const prefs = getPreferences()
      expect(prefs.notifications.config).toBe(false)
      expect(prefs.notifications.health).toBe(true)
      expect(prefs.notifications.plugins).toBe(true)
    })

    it('getPreferences returns defaults for invalid JSON', () => {
      localStorage.setItem('rioku-preferences', 'not-json{{{')
      const prefs = getPreferences()
      expect(prefs.theme).toBe('dark')
    })

    it('setPreferenceLegacy persists and returns updated prefs', () => {
      const result = setPreferenceLegacy('theme', 'light')
      expect(result.theme).toBe('light')

      const stored = JSON.parse(localStorage.getItem('rioku-preferences')!)
      expect(stored.theme).toBe('light')
    })

    it('setPreferenceLegacy preserves other preferences', () => {
      setPreferenceLegacy('theme', 'light')
      setPreferenceLegacy('tablePageSize', 50)

      const prefs = getPreferences()
      expect(prefs.theme).toBe('light')
      expect(prefs.tablePageSize).toBe(50)
    })

    it('resetPreferences clears to defaults', () => {
      setPreferenceLegacy('theme', 'light')
      setPreferenceLegacy('tablePageSize', 100)

      const result = resetPreferences()
      expect(result.theme).toBe('dark')
      expect(result.tablePageSize).toBe(20)
    })
  })
})
