/**
 * useSession — returns the current authentication context.
 *
 * Stage-2: backed by the daemon's `/auth/me` endpoint via `useCurrentUser`.
 * Tenant slug is derived from the active route (`/t/:tenant/...`); no
 * persisted "current tenant id" exists at the session layer because the
 * daemon does not lock a user to one tenant per session.
 */

import { useCurrentUser } from '@/features/auth/use-current-user';
import { useActiveTenantSlug } from './use-tenant';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionContext {
  /** Daemon-issued user id, or null when unauthenticated. */
  currentUserId: string | null;
  /**
   * Active tenant identifier — daemon paths key on the tenant slug, so
   * we surface the slug from the route here rather than a numeric/UUID id.
   */
  currentTenantId: string | null;
  isAuthenticated: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSession(): SessionContext {
  const me = useCurrentUser().data ?? null;
  const tenantSlug = useActiveTenantSlug();

  return {
    currentUserId: me?.id ?? null,
    currentTenantId: tenantSlug,
    isAuthenticated: me !== null,
  };
}
