import { describe, it, expect, beforeAll } from 'vitest'
import i18n from '../i18n'

describe('i18n', () => {
  beforeAll(async () => {
    // Wait for i18n to initialize
    await i18n.init
  })

  it('initializes successfully', () => {
    expect(i18n.isInitialized).toBe(true)
  })

  it('uses "common" as default namespace', () => {
    expect(i18n.options.defaultNS).toBe('common')
  })

  it('has English as fallback language', () => {
    // fallbackLng can be a string or array depending on i18next version
    const fallback = i18n.options.fallbackLng
    if (Array.isArray(fallback)) {
      expect(fallback).toContain('en')
    } else {
      expect(fallback).toBe('en')
    }
  })

  it('returns key string for missing translations', () => {
    const result = i18n.t('nonexistent.key.that.does.not.exist')
    expect(result).toBe('nonexistent.key.that.does.not.exist')
  })

  it('has all expected namespaces loaded', () => {
    const expectedNamespaces = [
      'common',
      'dashboard',
      'routes',
      'services',
      'policies',
      'traffic',
      'security',
      'settings',
      'cluster',
      'plugins',
      'audit',
    ]
    for (const ns of expectedNamespaces) {
      expect(i18n.hasResourceBundle('en', ns)).toBe(true)
    }
  })

  it('does not escape values (React handles escaping)', () => {
    expect(i18n.options.interpolation?.escapeValue).toBe(false)
  })
})
