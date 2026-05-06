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

/**
 * Register a sensitive value with the daemon's opaque-handle store.
 *
 * Returns an opaque handle that can be used in URLs / logs without leaking the
 * underlying value.
 */
export function useOpaqueFilter(value: string, tenantId: string): UseOpaqueFilterResult {
  const query = useQuery<OpaqueRegisterResponse>({
    queryKey: ['opaque-handle', tenantId, value],
    queryFn: ({ signal }) =>
      customFetch<OpaqueRegisterResponse>({
        url: `/t/${encodeURIComponent(tenantId)}/opaque-handles`,
        method: 'POST',
        data: { value },
        signal,
      }),
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
