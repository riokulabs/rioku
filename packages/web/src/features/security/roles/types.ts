/**
 * Feature-local types for roles.
 * Reuses Role and Grant from api/resources/types.
 */
export type { Role, Grant, ID } from '@/api/resources/types';

/** Payload for create/update — omits readonly server-computed fields. */
export interface RolePayload {
  name: string;
  description?: string;
  parent_ids: string[];
  grants: { permission: string; when?: string }[];
  denies: string[];
}

/** Internal form row for a grant. */
export interface GrantRow {
  /** Transient client-only key for React list keying. */
  _key: string;
  permission: string;
  when: string;
}
