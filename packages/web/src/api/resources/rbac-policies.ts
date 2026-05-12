// Types for the rbac-policies resource surface.

import type { ID } from './common';

export interface RbacPolicy {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  role_id: ID;
  subject_kind: 'user' | 'group' | 'service-account';
  subject_id: ID;
  readonly created_at: string;
}
