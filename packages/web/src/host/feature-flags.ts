/**
 * Feature flags for stage-1 admin.
 *
 * Stage-1 mock UIs are now built out for every flag below — flipping them ON
 * exposes the section for design review even though the daemon side is still
 * stage-2. Mutations are persisted in the in-browser mock store.
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
  /** Network listen-address editing (stage-2 config write). */
  networkListenAddressesEdit: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/** Returns true when the named feature flag is enabled. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}
