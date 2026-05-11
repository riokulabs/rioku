/**
 * usePermission — returns whether the current user holds a specific
 * permission key.
 *
 * Stage-2: the daemon's `/auth/me` endpoint returns the resolved
 * permission set for the calling user, with role inheritance and explicit
 * denies already applied server-side. We simply check membership in that
 * set. CEL `when` conditions are also evaluated server-side and surface as
 * presence/absence in the resolved list.
 *
 * Returns false when the user is unauthenticated.
 */

import { useCurrentUser } from '@/features/auth/use-current-user';

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns true if the current user holds the given permission key,
 * false otherwise. Wildcard `*` (the daemon's representation for
 * superadmin/root) grants any specific permission — without this
 * branch, every action button gated by `usePermission(...)` is
 * disabled for root, even though the user has unrestricted access.
 */
export function usePermission(key: string): boolean {
  const me = useCurrentUser().data ?? null;
  if (!me) return false;
  if (me.permissions.includes('*')) return true;
  return me.permissions.includes(key);
}
