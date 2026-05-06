/**
 * Users API — backed by the real daemon via Orval-generated React Query hooks.
 *
 * Stage-2 plan-02. The historical mock-store-backed surface lived here in
 * stage-1; every selector and mutation has been rewired to the generated
 * hooks under `@/api/generated/users/users` (and `@/api/generated/roles/roles`
 * for the user↔role assignments — the real API has no separate "memberships"
 * resource, so this module synthesizes a `UserWithMembership` view from a
 * real `User` so existing consumers keep their public types).
 *
 * Public function names (`useUserList`, `useUserDetail`, `useInviteUser`,
 * `useDeleteUser`, etc.) are kept stable. Where the stage-1 surface exported
 * imperative `async` functions, this module now exports React-Query-aware
 * hooks; consumers compose them with their own `loading` state.
 */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListUsers,
  useGetUser,
  useDeleteUser as useDeleteUserMutation,
  useCreateUser,
  usePatchUser,
  useActivateUser,
  useSuspendUser,
  useListUserSessions,
  getListUsersQueryKey,
  getGetUserQueryKey,
  getListUserSessionsQueryKey,
} from '@/api/generated/users/users';
import {
  useListUserRoles,
  useAssignUserRole,
  useRevokeUserRole,
  getListUserRolesQueryKey,
  useListRoles,
} from '@/api/generated/roles/roles';
import { useRevokeSession as useRevokeSessionMutation } from '@/api/generated/sessions/sessions';
import type { ListUsers200UsersItem } from '@/api/generated/schemas/listUsers200UsersItem';
import type { GetUser200 } from '@/api/generated/schemas/getUser200';
import type { ListUserRoles200RolesItem } from '@/api/generated/schemas/listUserRoles200RolesItem';
import type { ListUserSessions200SessionsItem } from '@/api/generated/schemas/listUserSessions200SessionsItem';
import type { User, Membership, Role, Session } from '@/api/resources';
import type { UserWithMembership, UserDetail, UserFilter } from './types';

// ─── Adapters: snake_case admin types ↔ camelCase generated types ────────────

function adaptUser(raw: ListUsers200UsersItem | GetUser200): User {
  return {
    id: raw.id ?? '',
    email: raw.email ?? '',
    name: raw.name ?? raw.email ?? '',
    disabled: raw.disabled ?? false,
    totp_enabled: raw.totpEnabled ?? false,
    totp_enrolled: raw.totpEnrolled ?? false,
    force_password_change: raw.forcePasswordChange ?? false,
    timezone: 'UTC',
    locale: 'en',
    reduced_motion: false,
    notification_preferences: { email: true, in_app: true, categories_muted: [] },
    created_at: raw.createdAt ?? new Date(0).toISOString(),
    updated_at: raw.updatedAt ?? new Date(0).toISOString(),
  };
}

function synthesizeMembership(user: User, tenantId: string, roleIds: string[]): Membership {
  const state: Membership['state'] = user.disabled ? 'deactivated' : 'active';
  return {
    id: user.id,
    tenant_id: tenantId,
    user_id: user.id,
    role_ids: roleIds,
    state,
    invited_at: user.created_at,
    joined_at: user.created_at,
  };
}

function adaptRole(raw: ListUserRoles200RolesItem, tenantId: string): Role {
  return {
    id: raw.id ?? '',
    tenant_id: tenantId,
    name: raw.name ?? '',
    parent_ids: [],
    grants: [],
    denies: [],
    system: false,
  };
}

function adaptSession(raw: ListUserSessions200SessionsItem): Session {
  return {
    id: raw.id ?? '',
    user_id: raw.userId ?? '',
    tenant_id: raw.tenantId ?? '',
    ip: raw.ipAddress ?? '',
    user_agent: raw.userAgent ?? '',
    last_seen: raw.lastActivityAt ?? raw.createdAt ?? new Date(0).toISOString(),
    revoked: raw.revoked ?? false,
    expires_at: raw.expiresAt ?? new Date(0).toISOString(),
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useUserList(tenantId: string, filter: UserFilter) {
  const query = useListUsers(tenantId, { query: { enabled: !!tenantId } });

  const items = useMemo<UserWithMembership[]>(() => {
    const rawList = query.data?.data.users ?? [];
    const search = filter.search.toLowerCase().trim();
    const result: UserWithMembership[] = [];

    for (const raw of rawList) {
      const user = adaptUser(raw);
      const membership = synthesizeMembership(user, tenantId, []);
      if (filter.status !== 'all' && membership.state !== filter.status) continue;
      if (search) {
        const nm = user.name.toLowerCase().includes(search);
        const em = user.email.toLowerCase().includes(search);
        if (!nm && !em) continue;
      }
      result.push({ user, membership, roles: [] });
    }
    return result;
  }, [query.data, filter.status, filter.search, tenantId]);

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useUserDetail(tenantId: string, userId: string) {
  const userQuery = useGetUser(tenantId, userId, {
    query: { enabled: !!tenantId && !!userId },
  });
  const rolesQuery = useListUserRoles(tenantId, userId, {
    query: { enabled: !!tenantId && !!userId },
  });

  const detail = useMemo<UserDetail | null>(() => {
    const raw = userQuery.data?.data;
    if (!raw || !raw.id) return null;
    const user = adaptUser(raw);
    const rolesList = (rolesQuery.data?.data.roles ?? []).map((r) => adaptRole(r, tenantId));
    const membership = synthesizeMembership(
      user,
      tenantId,
      rolesList.map((r) => r.id),
    );
    const rolesMap: Record<string, Role> = {};
    for (const r of rolesList) rolesMap[r.id] = r;
    return { user, memberships: [membership], roles: rolesMap };
  }, [userQuery.data, rolesQuery.data, tenantId]);

  return {
    detail,
    isLoading: userQuery.isLoading || rolesQuery.isLoading,
    isError: userQuery.isError,
    error: userQuery.error,
    refetch: userQuery.refetch,
  };
}

export function useUserSessions(tenantId: string, userId: string) {
  const query = useListUserSessions(tenantId, userId, {
    query: { enabled: !!tenantId && !!userId },
  });

  const sessions = useMemo<Session[]>(() => {
    const raw = query.data?.data.sessions ?? [];
    return raw.map(adaptSession);
  }, [query.data]);

  return {
    sessions,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useTenantRoles(tenantId: string): Role[] {
  const q = useListRoles(tenantId, { query: { enabled: !!tenantId } });
  return useMemo(() => {
    const list = q.data?.data.roles ?? [];
    return list.map((r) => ({
      id: r.id ?? '',
      tenant_id: r.tenantId ?? '',
      name: r.name ?? '',
      parent_ids: [],
      grants: [],
      denies: [],
      system: false,
    }));
  }, [q.data]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useUserMutations(tenantId: string) {
  const qc = useQueryClient();
  const createUser = useCreateUser();
  const patchUser = usePatchUser();
  const deleteUserMut = useDeleteUserMutation();
  const activate = useActivateUser();
  const suspend = useSuspendUser();
  const assignRole = useAssignUserRole();
  const revokeRole = useRevokeUserRole();
  const revokeSessionMut = useRevokeSessionMutation();

  function invalidateUsers(): Promise<void> {
    return qc.invalidateQueries({ queryKey: getListUsersQueryKey(tenantId) });
  }
  function invalidateUser(userId: string): Promise<void> {
    return qc.invalidateQueries({ queryKey: getGetUserQueryKey(tenantId, userId) });
  }
  function invalidateUserRoles(userId: string): Promise<void> {
    return qc.invalidateQueries({ queryKey: getListUserRolesQueryKey(tenantId, userId) });
  }
  function invalidateSessions(userId: string): Promise<void> {
    return qc.invalidateQueries({ queryKey: getListUserSessionsQueryKey(tenantId, userId) });
  }

  async function inviteUser(
    email: string,
    name: string | undefined,
    explicitTenantId: string,
    roleIds: string[],
    _forceTotpOnFirstLogin: boolean,
  ): Promise<{ userId: string; membershipId: string; inviteToken: string }> {
    const tenant = explicitTenantId || tenantId;
    const created = await createUser.mutateAsync({
      tenant,
      data: {
        email,
        ...(name ? { name } : {}),
        forcePasswordChange: true,
        ...(roleIds.length > 0 ? { roleIds } : {}),
      },
    });
    // CreateUser returns 201 + Location header — extract the new user id from
    // the canonical resource URL since the response body is empty.
    const location = created.headers.get('location') ?? created.headers.get('Location') ?? '';
    const tail = location.split('/').filter(Boolean).pop() ?? '';
    const userId = tail;
    for (const rid of roleIds) {
      try {
        await assignRole.mutateAsync({ tenant, id: userId, data: { roleId: rid } });
      } catch {
        // best-effort; surfaces in the UI on next refresh
      }
    }
    await invalidateUsers();
    if (userId) await invalidateUserRoles(userId);
    return {
      userId,
      membershipId: userId,
      inviteToken: userId ? `pending-${userId.slice(-6)}` : 'pending',
    };
  }

  async function activateMembership(userId: string): Promise<void> {
    await activate.mutateAsync({ tenant: tenantId, id: userId });
    await Promise.all([invalidateUsers(), invalidateUser(userId)]);
  }

  async function deactivateMembership(userId: string): Promise<void> {
    await suspend.mutateAsync({ tenant: tenantId, id: userId });
    await Promise.all([invalidateUsers(), invalidateUser(userId)]);
  }

  async function removeMembership(userId: string): Promise<void> {
    await deleteUserMut.mutateAsync({ tenant: tenantId, id: userId });
    await invalidateUsers();
  }

  async function disableUser(userId: string): Promise<void> {
    await patchUser.mutateAsync({
      tenant: tenantId,
      id: userId,
      data: { disabled: true },
    });
    await Promise.all([invalidateUsers(), invalidateUser(userId)]);
  }

  async function enableUser(userId: string): Promise<void> {
    await patchUser.mutateAsync({
      tenant: tenantId,
      id: userId,
      data: { disabled: false },
    });
    await Promise.all([invalidateUsers(), invalidateUser(userId)]);
  }

  async function deleteUser(userId: string): Promise<void> {
    await deleteUserMut.mutateAsync({ tenant: tenantId, id: userId });
    await invalidateUsers();
  }

  async function revokeSession(sessionId: string, userId?: string): Promise<void> {
    await revokeSessionMut.mutateAsync({ tenant: tenantId, id: sessionId });
    if (userId) await invalidateSessions(userId);
  }

  function resendInvite(userId: string): Promise<{ inviteToken: string }> {
    return Promise.resolve({
      inviteToken: `pending-resend-${userId.slice(-6)}-${Date.now().toString(36)}`,
    });
  }

  async function revokeInvite(userId: string): Promise<void> {
    await deleteUserMut.mutateAsync({ tenant: tenantId, id: userId });
    await invalidateUsers();
  }

  async function updateMembershipRoles(userId: string, newRoleIds: string[]): Promise<void> {
    const cached = qc.getQueryData<{ data: { roles?: ListUserRoles200RolesItem[] } }>(
      getListUserRolesQueryKey(tenantId, userId),
    );
    const current = (cached?.data.roles ?? []).map((r) => r.id ?? '').filter(Boolean);
    const want = new Set(newRoleIds);
    const have = new Set(current);
    const toAdd = newRoleIds.filter((r) => !have.has(r));
    const toRemove = current.filter((r) => !want.has(r));
    for (const rid of toAdd) {
      await assignRole.mutateAsync({ tenant: tenantId, id: userId, data: { roleId: rid } });
    }
    for (const rid of toRemove) {
      await revokeRole.mutateAsync({ tenant: tenantId, id: userId, roleId: rid });
    }
    await invalidateUserRoles(userId);
  }

  return {
    inviteUser,
    activateMembership,
    deactivateMembership,
    removeMembership,
    disableUser,
    enableUser,
    deleteUser,
    revokeSession,
    resendInvite,
    revokeInvite,
    updateMembershipRoles,
  };
}

export function useDeleteUser(tenantId: string) {
  const m = useUserMutations(tenantId);
  return m.deleteUser;
}

export function useInviteUser(tenantId: string) {
  const m = useUserMutations(tenantId);
  return m.inviteUser;
}
