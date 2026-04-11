import { describe, it, expect } from 'vitest'
import { features, isFeatureEnabled, FEATURE_KEYS } from '../feature-flags'

describe('feature-flags', () => {
  it('exports a features object with boolean values', () => {
    for (const key of FEATURE_KEYS) {
      expect(typeof features[key]).toBe('boolean')
    }
  })

  it('all flags default to false', () => {
    // Unless env overrides are active, all flags should be false
    for (const key of FEATURE_KEYS) {
      expect(features[key]).toBe(false)
    }
  })

  it('isFeatureEnabled returns the flag value', () => {
    for (const key of FEATURE_KEYS) {
      expect(isFeatureEnabled(key)).toBe(features[key])
    }
  })

  it('FEATURE_KEYS contains all expected flags', () => {
    expect(FEATURE_KEYS).toContain('certManagement')
    expect(FEATURE_KEYS).toContain('agentSessions')
    expect(FEATURE_KEYS).toContain('pluginAdminPages')
    expect(FEATURE_KEYS).toContain('clusterTopology')
    expect(FEATURE_KEYS).toContain('accessPolicies')
    expect(FEATURE_KEYS).toContain('effectivePermissions')
    expect(FEATURE_KEYS).toContain('entityActivity')
    expect(FEATURE_KEYS).toContain('colorblindMode')
  })
})
