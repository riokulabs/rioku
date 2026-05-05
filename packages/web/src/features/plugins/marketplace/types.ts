/**
 * Marketplace feature types.
 */
export type { MarketplaceListing, ID } from '@/api/resources';

/** URL-synced filter for the marketplace grid. */
export interface MarketplaceFilter {
  search: string;
  tags: string[];
}
