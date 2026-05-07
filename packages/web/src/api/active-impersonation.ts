/**
 * active-impersonation — module-level holder for the active super-admin
 * impersonation session id, decoupling feature code from the mock-store.
 *
 * The mutator (`src/api/mutator.ts`) reads this via the
 * `setActiveImpersonationIdAccessor` accessor wired up in `src/main.tsx`,
 * so every daemon-bound request automatically stamps the
 * `X-Impersonation-Id` header while a session is active.
 *
 * Stage-2 plan-02: the mock-store still owns the canonical id (until
 * plan-11 super-admin lands a real handle source); this helper is a
 * thin wrapper so security-feature callers don't need to import the
 * mock-store directly.
 */

import { useMockStore } from './mock-store';

/** Mirror the daemon-issued impersonation session id into the active holder. */
export function setActiveImpersonationId(id: string | null): void {
  useMockStore.setState({ activeImpersonationId: id });
}

/** Read the active impersonation session id, or null if none. */
export function getActiveImpersonationId(): string | null {
  return useMockStore.getState().activeImpersonationId;
}
