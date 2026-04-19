/**
 * Marketplace schemas — minimal (filter state is URL-synced, not form-validated).
 */
import { z } from 'zod';

export const marketplaceFilterSchema = z.object({
  search: z.string().max(120).default(''),
  tags: z.array(z.string()).default([]),
});

export type MarketplaceFilterFormValues = z.infer<typeof marketplaceFilterSchema>;
