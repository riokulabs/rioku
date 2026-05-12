/**
 * Feature flags for the admin SPA.
 *
 * Flipping a flag ON exposes the corresponding UI section. Mutations made
 * through these UIs are persisted via the active API layer.
 */
export const FEATURE_FLAGS = {
  /** SSO — OAuth + SAML provider configuration. */
  sso: true,
  /** Passkeys — WebAuthn hardware-key / biometric enrollment. */
  passkeys: true,
  /** OAuth connector cards in the Integrations section. */
  integrationsOAuth: true,
  /** PKI revoke/delete action on certificate authorities. */
  pkiRevoke: true,
  /** Network listen-address editing. */
  networkListenAddressesEdit: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/** Returns true when the named feature flag is enabled. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}
