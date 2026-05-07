/**
 * useBootstrapStatus — fetches `/auth/bootstrap-status`.
 *
 * `required: true` means no users exist and the SPA must redirect to /bootstrap.
 *
 * Plan 01 — stage 2 wiring.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchBootstrapStatus } from './api';

export const bootstrapStatusQueryKey = ['bootstrap-status'] as const;

export function useBootstrapStatus(): UseQueryResult<{ required: boolean }> {
  return useQuery({
    queryKey: bootstrapStatusQueryKey,
    queryFn: () => fetchBootstrapStatus(),
    staleTime: 0,
    retry: false,
  });
}
