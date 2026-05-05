import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import staticFallback from './openapi-merged.json';

const FIVE_MINUTES = 5 * 60 * 1000;

export interface OpenAPISpec {
  swagger?: string;
  openapi?: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  [k: string]: unknown;
}

export function useOpenAPISpec() {
  return useQuery<OpenAPISpec>({
    queryKey: ['openapi-spec'],
    queryFn: async ({ signal }) => {
      try {
        return await customFetch<OpenAPISpec>({
          url: '/openapi.json',
          method: 'GET',
          signal,
        });
      } catch (err) {
        // PLAN-0C-REMOVE-FALLBACK: Plan 0a ships before Plan 0c (which adds
        // the daemon endpoint). Remove this catch block and the static
        // import in Plan 0c's PR once /openapi.json is live in the daemon.
        console.warn('[api-explorer] /openapi.json unavailable, using static fallback', err);
        return staticFallback as unknown as OpenAPISpec;
      }
    },
    staleTime: FIVE_MINUTES,
    gcTime: FIVE_MINUTES * 2,
    retry: false,
  });
}
