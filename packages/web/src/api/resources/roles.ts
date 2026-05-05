// Owned by Plan 02 (identity) — types for the roles resource surface.

import type { ID, Grant } from './common';

export interface Role {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  parent_ids: ID[];
  grants: Grant[];
  denies: string[];
  system: boolean;
}
