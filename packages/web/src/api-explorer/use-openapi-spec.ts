import { useQuery } from '@tanstack/react-query';

const FIVE_MINUTES = 5 * 60 * 1000;

export interface OpenAPISpec {
  swagger?: string;
  openapi?: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Minimal stub used when the live `/openapi.json` is unreachable (404 in
 * dev/sandbox before the daemon mounts the spec). The Scalar renderer needs
 * a non-empty `paths` object to mount cleanly; this placeholder keeps the
 * explorer from collapsing into the "Failed to load" alert during local
 * development and unit tests where the network call is absent.
 */
const STATIC_FALLBACK: OpenAPISpec = {
  openapi: '3.1.0',
  info: { title: 'Rioku API (offline placeholder)', version: '0.0.0' },
  paths: {
    '/api/v1/health': {
      get: {
        summary: 'Liveness probe',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
};

async function fetchOpenAPISpec(signal: AbortSignal): Promise<OpenAPISpec> {
  // Use the bare `fetch` rather than `customFetch` because the spec lives at
  // the daemon's root (no `/api/v1` base) and we want to fall back to the
  // static placeholder on 404 instead of throwing.
  const res = await fetch('/openapi.json', { signal });
  if (!res.ok) {
    return STATIC_FALLBACK;
  }
  const text = await res.text();
  if (text === '') return STATIC_FALLBACK;
  try {
    return JSON.parse(text) as OpenAPISpec;
  } catch {
    return STATIC_FALLBACK;
  }
}

export function useOpenAPISpec() {
  return useQuery<OpenAPISpec>({
    queryKey: ['openapi-spec'],
    queryFn: ({ signal }) => fetchOpenAPISpec(signal),
    staleTime: FIVE_MINUTES,
    gcTime: FIVE_MINUTES * 2,
    retry: false,
  });
}
