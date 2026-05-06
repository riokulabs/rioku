import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';

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
    queryFn: ({ signal }) =>
      customFetch<OpenAPISpec>({
        url: '/openapi.json',
        method: 'GET',
        signal,
      }),
    staleTime: FIVE_MINUTES,
    gcTime: FIVE_MINUTES * 2,
    retry: false,
  });
}
