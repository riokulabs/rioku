/**
 * Marketplace feature types.
 */
export type { MarketplaceListing, ID } from '@/api/resources/types';

/** URL-synced filter for the marketplace grid. */
export interface MarketplaceFilter {
  search: string;
  tags: string[];
}
