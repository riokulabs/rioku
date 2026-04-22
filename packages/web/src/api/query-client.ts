/**
 * Shared QueryClient factory.
 *
 * Defaults:
 *   staleTime: 30 000 ms — don't refetch data that's less than 30 s old
 *   retry: false         — don't retry on error (mock errors are deterministic)
 *   refetchOnWindowFocus: false
 *   refetchOnReconnect: false
 *
 * Export `makeQueryClient()` so tests can spin fresh isolated instances.
 * The singleton `queryClient` is used by providers.tsx and auth-failure.ts.
 */

import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Module-level singleton — used by the app and the auth-failure interceptor. */
export const queryClient = makeQueryClient();
