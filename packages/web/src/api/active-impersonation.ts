/**
 * active-impersonation — module-level holder for the active super-admin
 * impersonation session id.
 *
 * The mutator (`src/api/mutator.ts`) reads this via the
 * `setActiveImpersonationIdAccessor` accessor wired up in `src/main.tsx`,
 * so every daemon-bound request automatically stamps the
 * `X-Impersonation-Id` header while a session is active.
 *
 * The active id lives in a module-local cell. Feature code reads/writes via
 * the helpers below.
 */

let activeImpersonationId: string | null = null;

/** Mirror the daemon-issued impersonation session id into the active holder. */
export function setActiveImpersonationId(id: string | null): void {
  activeImpersonationId = id;
}

/** Read the active impersonation session id, or null if none. */
export function getActiveImpersonationId(): string | null {
  return activeImpersonationId;
}
