/**
 * useSession — returns the current authentication context from the mock store.
 *
 * Stage-1 stub: currentUserId and currentTenantId are always null until the
 * login flow is implemented in Phase 1e. This hook is intentionally read-only;
 * mutations (login, logout, switch-tenant) land in 1e.
 *
 * spec §7 / Task 1d.68
 */

import { useMockStore } from '../api/mock-store';
import type { ID } from '../api/resources';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionContext {
  currentUserId: ID | null;
  currentTenantId: ID | null;
  isAuthenticated: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSession(): SessionContext {
  const currentUserId = useMockStore((s) => s.currentUserId);
  const currentTenantId = useMockStore((s) => s.currentTenantId);

  return {
    currentUserId,
    currentTenantId,
    isAuthenticated: currentUserId !== null,
  };
}
