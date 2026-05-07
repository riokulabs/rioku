/**
 * Tenant identity resolver — small shared hook backed by the daemon
 * `GET /api/v1/t/{tenant}/identity` endpoint (closes #239).
 *
 * SPA surfaces hold tenant ids (UUIDs) in many places where they really
 * want a human-readable slug or display name. Rather than each feature
 * re-implementing slug lookup, they share this hook.
 *
 * The endpoint is tenant-scoped and unauthenticated callers are rejected
 * by the daemon. Callers must be inside the tenant — which is true for
 * every `/t/{slug}/*` admin SPA route.
 */
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';

/**
 * Lean tenant identity DTO. Mirrors the daemon `tenantIdentityResponse`.
 * Sensitive metadata (plan, accent, urlMode, timestamps) is intentionally
 * not exposed by the resolver.
 */
export interface TenantIdentity {
  id: string;
  slug: string;
  name: string;
  parentDomain?: string;
}

export const tenantIdentityKey = (slug: string) => ['tenant-identity', slug] as const;

async function fetchTenantIdentity(slug: string): Promise<TenantIdentity> {
  return customFetch<TenantIdentity>({
    url: `/t/${slug}/identity`,
    method: 'GET',
  });
}

/**
 * Resolve the identity ({id, slug, name, parentDomain?}) of the tenant
 * the caller is authenticated against. Pass an empty/falsy slug to skip
 * the request; the hook returns `undefined` until data arrives.
 *
 * Identity is stable for the lifetime of a session; staleTime is generous
 * to avoid refetch-on-focus thrashing.
 */
export function useTenantIdentity(slug: string | null | undefined): TenantIdentity | undefined {
  const safeSlug = slug ?? '';
  const { data } = useQuery({
    queryKey: tenantIdentityKey(safeSlug),
    queryFn: () => fetchTenantIdentity(safeSlug),
    enabled: !!safeSlug,
    staleTime: 5 * 60_000,
  });
  return data;
}
