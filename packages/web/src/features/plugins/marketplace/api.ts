/**
 * Marketplace API — Stage-2 (real daemon endpoints).
 *
 * Routes:
 *   GET  /api/v1/t/{tenant}/plugin-marketplace        — curated catalog
 *   GET  /api/v1/t/{tenant}/plugin-marketplace/{id}   — single entry
 *   POST /api/v1/t/{tenant}/plugins/install-from-marketplace — kick install
 *
 * The daemon serves a curated list (`marketplace.json`); fields are
 * normalised into the frontend's MarketplaceListing shape.
 */
import { useQuery, useMutation } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import type { MarketplaceListing } from '@/api/resources';
import type { MarketplaceFilter } from './types';

interface DaemonMarketplaceResponse {
  items: DaemonMarketplaceEntry[];
  total: number;
}

interface DaemonMarketplaceEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  signer_fingerprint?: string;
  manifest_url?: string;
  author: string;
  tags?: string[];
  verified?: boolean;
  installs?: number;
}

function daemonToListing(d: DaemonMarketplaceEntry): MarketplaceListing {
  return {
    id: d.id,
    slug: d.id,
    display_name: d.name,
    author: d.author,
    description: d.description,
    version: d.version,
    tags: d.tags ?? [],
    installs: typeof d.installs === 'number' ? d.installs : 0,
    verified: d.verified ?? false,
  };
}

export const marketplaceQueryKeys = {
  list: (tenantId: string) => ['marketplace', 'list', tenantId] as const,
  entry: (tenantId: string, id: string) => ['marketplace', 'entry', tenantId, id] as const,
} as const;

/**
 * Returns marketplace listings sorted by install count (desc), filtered
 * by search (name/author/slug) and tag intersection. Uses the
 * tenant-scoped curated catalog endpoint.
 */
export function useMarketplaceListings(
  filter: MarketplaceFilter,
  tenantId = '',
): MarketplaceListing[] {
  const { data } = useQuery({
    queryKey: marketplaceQueryKeys.list(tenantId),
    queryFn: async ({ signal }) => {
      const url =
        tenantId !== ''
          ? `/t/${tenantId}/plugin-marketplace`
          : `/plugin-marketplace`;
      const resp = await customFetch<DaemonMarketplaceResponse>({
        url,
        method: 'GET',
        signal,
      });
      return resp.items.map(daemonToListing);
    },
    staleTime: 60_000,
  });
  const listings = data ?? [];

  const search = filter.search.toLowerCase().trim();
  const tagFilter = filter.tags;

  const results: MarketplaceListing[] = [];
  for (const listing of listings) {
    if (search) {
      const nameMatch = listing.display_name.toLowerCase().includes(search);
      const authorMatch = listing.author.toLowerCase().includes(search);
      const slugMatch = listing.slug.toLowerCase().includes(search);
      if (!nameMatch && !authorMatch && !slugMatch) continue;
    }
    if (tagFilter.length > 0) {
      const hasAll = tagFilter.every((t) => listing.tags.includes(t));
      if (!hasAll) continue;
    }
    results.push(listing);
  }
  return results.sort((a, b) => b.installs - a.installs);
}

/** Returns the de-duplicated sorted tag universe across all listings. */
export function useMarketplaceTags(tenantId = ''): string[] {
  const listings = useMarketplaceListings({ search: '', tags: [] }, tenantId);
  const set = new Set<string>();
  for (const listing of listings) {
    for (const tag of listing.tags) set.add(tag);
  }
  return [...set].sort();
}

/** Returns a single marketplace listing by id. */
export function useMarketplaceListing(
  id: string,
  tenantId = '',
): MarketplaceListing | undefined {
  const { data } = useQuery({
    queryKey: marketplaceQueryKeys.entry(tenantId, id),
    queryFn: async ({ signal }) => {
      const url =
        tenantId !== ''
          ? `/t/${tenantId}/plugin-marketplace/${id}`
          : `/plugin-marketplace/${id}`;
      const resp = await customFetch<DaemonMarketplaceEntry>({
        url,
        method: 'GET',
        signal,
      });
      return daemonToListing(resp);
    },
    enabled: !!id,
    staleTime: 60_000,
  });
  return data;
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export interface InstallFromMarketplaceInput {
  /** Marketplace entry id. */
  marketplaceId: string;
  /** Optional version pin; daemon defaults to the latest. */
  version?: string;
}

export interface InstallFromMarketplaceResponse {
  installId: string;
  status: string;
}

/**
 * Triggers `POST /plugins/install-from-marketplace`. Returns the
 * daemon's install id, which the caller can subscribe to via the
 * install-progress SSE stream.
 */
export async function installFromMarketplace(
  tenantId: string,
  input: InstallFromMarketplaceInput,
): Promise<InstallFromMarketplaceResponse> {
  const resp = await customFetch<InstallFromMarketplaceResponse>({
    url: `/t/${tenantId}/plugins/install-from-marketplace`,
    method: 'POST',
    data: {
      id: input.marketplaceId,
      ...(input.version !== undefined ? { version: input.version } : {}),
    },
  });
  return resp;
}

export function useInstallFromMarketplaceMutation(tenantId: string) {
  return useMutation({
    mutationFn: (input: InstallFromMarketplaceInput) =>
      installFromMarketplace(tenantId, input),
  });
}
