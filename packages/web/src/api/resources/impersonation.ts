// Owned by Plan 02 (identity) — types for the impersonation resource surface.

import type { ID } from './common';

export interface ImpersonationSession {
  readonly id: ID;
  readonly super_admin_id: ID;
  readonly tenant_id: ID;
  user_id?: ID;
  reason: string;
  ticketRef?: string;
  readonly started_at: string;
  expires_at: string;
  scope: string[];
}
