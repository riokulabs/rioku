// Owned by Plan 02 (identity) — types for the api-keys resource surface.

import type { ID } from './common';

export interface ApiKey {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly user_id?: ID;
  name: string;
  /** Displayable key prefix, e.g. `sk_acme_ab` — full value never stored after creation */
  prefix: string;
  scope: string[];
  last_used?: string;
  expires_at?: string;
  revoked: boolean;
  readonly created_at: string;
}
