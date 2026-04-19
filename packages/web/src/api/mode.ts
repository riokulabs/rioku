/**
 * API mode flag.
 *
 * Set VITE_USE_MOCKS=false to switch the admin panel to real daemon calls.
 * Default is `true` (Stage 1 mock mode).
 */

export const USE_MOCKS =
  (import.meta.env.VITE_USE_MOCKS ?? 'true') === 'true';

/**
 * Guard that throws if a Stage-1-only feature is invoked outside mock mode.
 * Call this at the top of mock-only code paths to get an early, clear error.
 */
export function assertMocksOnly(feature: string): void {
  if (!USE_MOCKS) {
    throw new Error(
      `${feature} is stage-1-only and requires VITE_USE_MOCKS=true`,
    );
  }
}
