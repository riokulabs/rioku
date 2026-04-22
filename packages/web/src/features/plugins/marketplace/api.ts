/**
 * Marketplace API — read-only selectors against the seeded store.
 *
 * No mutations: installing a plugin is handled by `install-approval` feature.
 */
import { useMockStore } from '@/api/mock-store';
import type { MarketplaceListing } from '@/api/resources/types';
import type { MarketplaceFilter } from './types';

/**
 * Returns marketplace listings sorted by install count (desc), filtered by
 * search (name/author) and tag intersection.
 *
 * Stable-selector pattern: pull raw record, derive array in the hook body.
 */
export function useMarketplaceListings(filter: MarketplaceFilter): MarketplaceListing[] {
  const listings = useMockStore((s) => s.marketplaceListings);

  const search = filter.search.toLowerCase().trim();
  const tagFilter = filter.tags;

  const results: MarketplaceListing[] = [];
  for (const listing of Object.values(listings)) {
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
export function useMarketplaceTags(): string[] {
  const listings = useMockStore((s) => s.marketplaceListings);
  const set = new Set<string>();
  for (const listing of Object.values(listings)) {
    for (const tag of listing.tags) set.add(tag);
  }
  return [...set].sort();
}

/** Returns a single marketplace listing by id (stable reference). */
export function useMarketplaceListing(id: string): MarketplaceListing | undefined {
  return useMockStore((s) => s.marketplaceListings[id]);
}
