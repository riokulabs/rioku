/**
 * Feature-local types for rbac-policies.
 *
 * The spec §7.4 RBAC admin-side gate policy types.
 * The existing RbacPolicy in api/resources maps a role to a subject —
 * that's the binding model. The spec's "RBAC policy" for this feature is
 * richer: it carries a policy_type and optional CEL condition.
 *
 * We extend the store's RbacPolicy with local UI-only fields rather than
 * mutating the shared type. The feature stores the extended shape; the
 * underlying mock-store RbacPolicy is used as the persistence target
 * with policy_type stored in a name-prefix convention for stage-1 simplicity.
 */
export type { ID } from '@/api/resources';

/** Policy types per spec §7.4. */
export type RbacPolicyType = 'totp-required' | 'step-up-required' | 'login-window' | 'custom';

/** Full RBAC policy shape used in the feature UI. */
export interface RbacPolicyFull {
  readonly id: string;
  readonly tenant_id: string;
  name: string;
  description: string;
  policy_type: RbacPolicyType;
  /** Role IDs this policy targets. */
  affected_role_ids: string[];
  /** Optional CEL expression — required when policy_type === 'custom'. */
  condition?: string;
  /**
   * For login-window: "07:00–19:00 UTC"
   * For step-up-required: number of seconds (e.g. 60)
   */
  window?: string;
  readonly created_at: string;
}

/** Payload for create/update — omits readonly fields. */
export interface RbacPolicyPayload {
  name: string;
  description: string;
  policy_type: RbacPolicyType;
  affected_role_ids: string[];
  condition?: string;
  window?: string;
}
