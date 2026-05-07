/**
 * useCurrentUser — read-through hook for the daemon's `/auth/me` endpoint.
 *
 * Returns `null` (not an error) when the user is not authenticated; this lets
 * router guards fork on `data === null` without catching exceptions. All other
 * errors propagate so the React Query error boundary can surface them.
 *
 * Plan 01 — stage 2 wiring (ported into plan-02 to unblock identity-feature
 * wiring; the canonical home is plan-01's auth surface).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import { AuthFailureError } from '@/api/errors';

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roles: string[];
  permissions: string[];
  status: string;
  forcePasswordChange: boolean;
  totpEnabled: boolean;
}

interface DaemonMeResponse {
  user: {
    id: string;
    username: string;
    displayName?: string;
    email?: string;
    roles: string[];
    permissions: string[];
    status: string;
    forcePasswordChange: boolean;
    totpEnabled: boolean;
  };
  session: { id: string; expiresAt?: string };
}

/** Query key — exported for cache-invalidation from sign-out / login mutations. */
export const currentUserQueryKey = ['current-user'] as const;

export async function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUser | null> {
  try {
    const resp = await customFetch<DaemonMeResponse>(
      signal !== undefined
        ? { url: '/auth/me', method: 'GET', signal }
        : { url: '/auth/me', method: 'GET' },
    );
    return {
      id: resp.user.id,
      username: resp.user.username,
      displayName: resp.user.displayName ?? '',
      email: resp.user.email ?? '',
      roles: resp.user.roles,
      permissions: resp.user.permissions,
      status: resp.user.status,
      forcePasswordChange: resp.user.forcePasswordChange,
      totpEnabled: resp.user.totpEnabled,
    };
  } catch (err) {
    if (err instanceof AuthFailureError) return null;
    throw err;
  }
}

export function useCurrentUser(): UseQueryResult<CurrentUser | null> {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: ({ signal }) => fetchCurrentUser(signal),
    staleTime: 30_000,
    retry: false,
  });
}
