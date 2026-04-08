import { describe, it, expect, beforeEach } from 'vitest'
import { getPreferences, setPreference, resetPreferences } from '../preferences'

describe('preferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getPreferences', () => {
    it('returns defaults when localStorage is empty', () => {
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

    it('merges stored values with defaults', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ theme: 'light', tablePageSize: 50 }),
      )
      const prefs = getPreferences()
      expect(prefs.theme).toBe('light')
      expect(prefs.tablePageSize).toBe(50)
      // Defaults still present for unset keys
      expect(prefs.sidebarCollapsed).toBe(false)
      expect(prefs.locale).toBe('en')
    })

    it('deep-merges notification preferences', () => {
      localStorage.setItem(
        'rioku-preferences',
        JSON.stringify({ notifications: { config: false } }),
      )
      const prefs = getPreferences()
      expect(prefs.notifications.config).toBe(false)
      expect(prefs.notifications.health).toBe(true)
      expect(prefs.notifications.plugins).toBe(true)
    })

    it('returns defaults for invalid JSON', () => {
      localStorage.setItem('rioku-preferences', 'not-json{{{')
      const prefs = getPreferences()
      expect(prefs.theme).toBe('dark')
    })
  })

  describe('setPreference', () => {
    it('persists a single preference and returns updated prefs', () => {
      const result = setPreference('theme', 'light')
      expect(result.theme).toBe('light')

      // Verify it was actually persisted
      const stored = JSON.parse(localStorage.getItem('rioku-preferences')!)
      expect(stored.theme).toBe('light')
    })

    it('preserves other preferences when setting one', () => {
      setPreference('theme', 'light')
      setPreference('tablePageSize', 50)

      const prefs = getPreferences()
      expect(prefs.theme).toBe('light')
      expect(prefs.tablePageSize).toBe(50)
    })

    it('sets nested notification preferences', () => {
      const result = setPreference('notifications', {
        config: false,
        health: true,
        plugins: false,
      })
      expect(result.notifications.config).toBe(false)
      expect(result.notifications.plugins).toBe(false)
    })
  })

  describe('resetPreferences', () => {
    it('clears to defaults', () => {
      setPreference('theme', 'light')
      setPreference('tablePageSize', 100)

      const result = resetPreferences()
      expect(result.theme).toBe('dark')
      expect(result.tablePageSize).toBe(20)
    })

    it('persists the reset defaults', () => {
      setPreference('theme', 'light')
      resetPreferences()

      const prefs = getPreferences()
      expect(prefs.theme).toBe('dark')
    })
  })
})
