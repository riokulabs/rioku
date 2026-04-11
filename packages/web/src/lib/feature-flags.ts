/**
 * Compile-time feature flags for the Rioku admin panel.
 *
 * Flags are resolved at build time via Vite's import.meta.env.
 * Tree-shaking eliminates dead code paths in production builds.
 *
 * Environment variables:
 *   RIOKU_FEATURES=all           -- enable all flags (demo mode)
 *   RIOKU_FEATURES=none          -- disable all flags (default, Playwright)
 *   RIOKU_FEATURE_CERT_MANAGEMENT=true  -- enable individual flag
 */

function envFlag(name: string): boolean {
  const allMode = import.meta.env.VITE_RIOKU_FEATURES
  if (allMode === 'all') return true
  if (allMode === 'none') return false

  const envKey = `VITE_RIOKU_FEATURE_${name.replace(/([A-Z])/g, '_$1').toUpperCase()}`
  return import.meta.env[envKey] === 'true'
}

export const features = {
  clusterTopology: envFlag('clusterTopology'),
  pluginMarketplace: envFlag('pluginMarketplace'),
  pluginAdminPages: envFlag('pluginAdminPages'),
  aiAssistant: envFlag('aiAssistant'),
  certManagement: envFlag('certManagement'),
  l4Routes: envFlag('l4Routes'),
  agentSessions: envFlag('agentSessions'),
  piiFilters: envFlag('piiFilters'),
  webhookAlerts: envFlag('webhookAlerts'),
  customDashboard: envFlag('customDashboard'),
  accessPolicies: envFlag('accessPolicies'),
  effectivePermissions: envFlag('effectivePermissions'),
  entityActivity: envFlag('entityActivity'),
  colorblindMode: envFlag('colorblindMode'),
} as const

export type FeatureKey = keyof typeof features

export const FEATURE_KEYS = Object.keys(features) as FeatureKey[]

export function isFeatureEnabled(key: FeatureKey): boolean {
  return features[key]
}
