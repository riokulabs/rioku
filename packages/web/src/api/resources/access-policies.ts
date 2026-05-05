// Owned by Plan 02 (identity) — types for the access-policies resource surface.

import type { ID } from './common';

export interface AccessPolicy {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  /** CEL expression */
  condition: string;
  action: 'allow' | 'deny';
  priority: number;
  enabled: boolean;
  readonly created_at: string;
}
