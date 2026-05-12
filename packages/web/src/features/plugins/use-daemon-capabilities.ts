/**
 * Daemon capabilities discovery hook.
 *
 * Wraps `GET /api/v1/capabilities` — a cheap auth-free feature-flag
 * snapshot the admin panel calls once on boot to decide which routes
 * and nav entries to render.
 *
 * Stage-2 contract: when a capability flag is `false`, the daemon
 * returns 404 from the gated endpoint — clients MUST hide the matching
 * UI surface. Returning 404 (not 403) prevents endpoint-existence
 * leakage and lets us treat missing-route + disabled-feature
 * uniformly.
 *
 * The hook is intentionally permissive: while the request is in flight
 * or has failed, all flags default to `false`. UI surfaces guarded by
 * a flag thus stay hidden until the daemon explicitly reports the
 * capability available, which is the safe default.
 */
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';

export interface DaemonCapabilities {
  /** Whether the plugin sideload endpoint is enabled. */
  sideloadEnabled: boolean;
}

interface DaemonCapabilitiesResponse {
  /** snake_case wire shape from `/api/v1/capabilities`. */
  sideload_enabled: boolean;
}

const CAPABILITIES_DEFAULT: DaemonCapabilities = {
  sideloadEnabled: false,
};

export const capabilitiesQueryKey = ['daemon', 'capabilities'] as const;

/**
 * Fetches daemon capabilities once on app boot and caches the result
 * for the duration of the session. Call from any component; the
 * underlying fetch is deduped by react-query.
 *
 * Returns the last-known snapshot OR the safe default while loading.
 */
export function useDaemonCapabilities(): DaemonCapabilities {
  const { data } = useQuery({
    queryKey: capabilitiesQueryKey,
    queryFn: async ({ signal }) => {
      const resp = await customFetch<DaemonCapabilitiesResponse>({
        url: '/capabilities',
        method: 'GET',
        signal,
      });
      const out: DaemonCapabilities = {
        sideloadEnabled: resp.sideload_enabled,
      };
      return out;
    },
    staleTime: Infinity,
    retry: false,
  });
  return data ?? CAPABILITIES_DEFAULT;
}
