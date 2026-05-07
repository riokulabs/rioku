/**
 * Feature-local types for rbac-policies.
 *
 * Aligned to the daemon model (see `api/generated/rbac-policies/rbac-policies.ts`):
 * an RBAC policy is a tenant-scoped binding that attaches a single role to a
 * single subject (user / group / service-account / role-template). Stage-2 has
 * dropped the stage-1 fiction of `policy_type` / CEL `condition` / `window`
 * fields — those did not exist on the wire and gaslit the UI into a model
 * that could not round-trip through the daemon.
 */
export type { ID } from '@/api/resources';

export type RbacSubjectType = 'user' | 'group' | 'service-account';

/** Full RBAC policy shape used in the feature UI. */
export interface RbacPolicyFull {
  readonly id: string;
  readonly tenant_id: string;
  name: string;
  description: string;
  enabled: boolean;
  subject_type: RbacSubjectType;
  subject_id: string;
  role_id: string;
  readonly created_at: string;
}

/** Payload for create/update — omits readonly fields. */
export interface RbacPolicyPayload {
  name: string;
  description: string;
  enabled: boolean;
  subject_type: RbacSubjectType;
  subject_id: string;
  role_id: string;
}
