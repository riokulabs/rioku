/**
 * Feature-local types for users.
 * Extends core resource types with UI composite shapes.
 */
export type { User, Membership, Role, Session, ID } from '@/api/resources';

import type { User, Membership, Role } from '@/api/resources';

/** Composite shape used in the users list — user + their membership in the current tenant + resolved roles. */
export interface UserWithMembership {
  user: User;
  membership: Membership;
  roles: Role[];
}

/** Composite shape for the user detail drawer — includes all memberships + sessions. */
export interface UserDetail {
  user: User;
  memberships: Membership[];
  roles: Record<string, Role>;
}

/** Filter state for user list. */
export interface UserFilter {
  search: string;
  status: 'all' | 'pending' | 'active' | 'deactivated' | 'removed';
}
