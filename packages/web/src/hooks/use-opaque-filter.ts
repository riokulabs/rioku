import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';

interface OpaqueRegisterResponse {
  handle: string;
}

interface UseOpaqueFilterResult {
  handle: string | null;
  isPending: boolean;
  error: unknown;
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h = (h ^ input.charCodeAt(i)) * 0x01000193;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Register a sensitive value with the daemon's opaque-handle store.
 *
 * Returns an opaque handle that can be used in URLs / logs without leaking the
 * underlying value. Plan 0c ships the daemon endpoint; until then the endpoint
 * returns 501 and this hook falls back to a deterministic local placeholder.
 */
export function useOpaqueFilter(value: string, tenantId: string): UseOpaqueFilterResult {
  const query = useQuery<OpaqueRegisterResponse>({
    queryKey: ['opaque-handle', tenantId, value],
    queryFn: async ({ signal }) => {
      try {
        return await customFetch<OpaqueRegisterResponse>({
          url: `/t/${encodeURIComponent(tenantId)}/opaque-handles`,
          method: 'POST',
          data: { value },
          signal,
        });
      } catch {
        return { handle: `oh_pending_${fnv1a(value)}` };
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  return {
    handle: query.data?.handle ?? null,
    isPending: query.isPending,
    error: query.error,
  };
}
