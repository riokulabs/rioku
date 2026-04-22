/**
 * Feature flags for stage-1 admin.
 *
 * Flip a flag to `true` when the corresponding daemon endpoint is implemented
 * and the stage-2 wiring is ready. Until then, sections governed by a flag
 * are hidden or kept in their read-only/disabled state so users do not see
 * prominent "Coming soon" teasers.
 *
 * Defaults: OFF (coming-soon sections hidden).
 */
export const FEATURE_FLAGS = {
  /** SSO — OAuth + SAML provider configuration. */
  sso: false,
  /** Passkeys — WebAuthn hardware-key / biometric enrollment. */
  passkeys: false,
  /** OAuth connector cards in the Integrations section. */
  integrationsOAuth: false,
  /** PKI revoke/delete action on certificate authorities. */
  pkiRevoke: false,
  /** Network listen-address editing (stage-2 config write). */
  networkListenAddressesEdit: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/** Returns true when the named feature flag is enabled. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}
