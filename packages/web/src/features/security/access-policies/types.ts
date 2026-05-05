/**
 * Feature-local types for access-policies.
 * Reuses AccessPolicy from api/resources; adds form-specific helpers.
 */
export type { AccessPolicy, ID } from '@/api/resources';

/** Payload for create/update mutations — omits readonly server-computed fields. */
export interface AccessPolicyPayload {
  name: string;
  condition: string;
  action: 'allow' | 'deny';
  priority: number;
  enabled: boolean;
}
