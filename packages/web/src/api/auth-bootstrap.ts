/**
 * Auth bootstrap — sets up session-expiry detection for mock mode.
 *
 * Watches the Zustand mock store: when `currentUserId` transitions from
 * non-null to null (i.e. a logout or session expiry), triggers the auth-failure
 * flow so the user is redirected to the login page.
 *
 * Call `initAuthBootstrap()` once from main.tsx after both the store and the
 * auth-failure router have been initialised.
 */

import { useMockStore } from './mock-store';
import { handleAuthFailure } from './auth-failure';
import { USE_MOCKS } from './mode';

/** Set up the mock-mode session-expiry subscription. No-ops in real mode. */
export function initAuthBootstrap(): () => void {
  if (!USE_MOCKS) {
    // In real mode, session expiry is detected via 401 responses in client.ts.
    return () => undefined;
  }

  let previousUserId = useMockStore.getState().currentUserId;

  const unsubscribe = useMockStore.subscribe((state) => {
    const nextUserId = state.currentUserId;
    if (previousUserId !== null && nextUserId === null) {
      // Session expired — trigger auth-failure flow.
      const currentUrl =
        typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
      handleAuthFailure(currentUrl);
    }
    previousUserId = nextUserId;
  });

  return unsubscribe;
}
