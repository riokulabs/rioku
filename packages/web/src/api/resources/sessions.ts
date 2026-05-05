// Owned by Plan 01 (auth-bootstrap) — types for the sessions resource surface.

import type { ID } from './common';

export interface Session {
  readonly id: ID;
  readonly user_id: ID;
  readonly tenant_id: ID;
  ip: string;
  user_agent: string;
  last_seen: string;
  expires_at: string;
  revoked: boolean;
}
