/**
 * Feature-local types for API keys.
 */
export type { ApiKey, ID } from '@/api/resources';

import type { ApiKey } from '@/api/resources';

/** Enriched API key for display — computed fields added client-side. */
export interface ApiKeyWithMeta extends ApiKey {
  /** Human-readable summary of last usage, e.g. "3 hours ago" — undefined means never used */
  last_used_summary: string | undefined;
  /** Days until expiry, undefined if no expiry set */
  expires_in_days: number | undefined;
  /** Computed display status */
  display_status: 'active' | 'revoked' | 'expired';
}

/** Filter state for the API key list */
export interface ApiKeyFilter {
  status: 'all' | 'active' | 'revoked' | 'expired';
}
