/**
 * api/mode — single switch governing whether the SPA reads from the
 * Zustand mock store or talks to the daemon via Orval-generated hooks.
 *
 * Default is mock mode. Set `VITE_USE_MOCKS=false` to flip to real
 * daemon mode. The flag is read once per import; consumers do not
 * need to re-render on a flip (mode flips happen at SPA boot).
 */

const FLAG = (import.meta.env.VITE_USE_MOCKS as string | undefined) ?? 'true';

/**
 * Returns true when the SPA should call the real daemon instead of
 * reading the Zustand mock store. False (the default) keeps the
 * in-browser mock behaviour.
 */
export function isRealApi(): boolean {
  return FLAG === 'false';
}

/**
 * Inverse helper for readability — `useMocks()` matches the env-flag
 * naming (`VITE_USE_MOCKS`).
 */
export function useMocks(): boolean {
  return !isRealApi();
}
