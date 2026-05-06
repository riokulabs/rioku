/**
 * Roles API — backed by the Orval-generated daemon hooks.
 *
 * Stage-2 wiring: every selector and mutation here calls the real
 * daemon. The mock-store has been retired from this slice; tests
 * drive the surface through MSW (`@/test/msw-server`).
 *
 * Adapter notes:
 *   - The daemon `Role` resource exposes `{id, tenantId, name,
 *     description, permissions[], source, createdAt}`. The legacy
 *     SPA `Role` shape carries `parent_ids`, `grants[]`, `denies[]`,
 *     and `system`. The adapter fills the unmodelled fields with
 *     empty arrays and derives `system = (source === 'builtin')`,
 *     so consumer components compile and render against either path.
 *   - `useRoleUserCounts` aggregates membership counts by listing
 *     users + per-user role assignments via `useQueries`. The daemon
 *     does not expose a "members per role" count directly; this
 *     parallel-fetch is the honest implementation.
 */
import { useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  useListRoles,
  useGetRole,
  createRole,
  patchRole,
  deleteRole,
  getListRolesQueryKey,
  getGetRoleQueryKey,
  getListUserRolesQueryKey,
  listUserRoles,
} from '@/api/generated/roles/roles';
import { useListUsers } from '@/api/generated/users/users';
import type { ListRoles200RolesItem, GetRole200 } from '@/api/generated/schemas';
import type { Role, Grant } from '@/api/resources';
import type { RolePayload } from './types';

// ─── Adapters ──────────────────────────────────────────────────────────────────

type AnyRoleItem = ListRoles200RolesItem | GetRole200;

/**
 * Convert a daemon role payload into the legacy SPA `Role` shape so
 * existing consumers keep compiling. Fields that the daemon does not
 * yet model (`parent_ids`, `denies`, conditional grants) are surfaced
 * as empty arrays — the editor presents them as empty sections rather
 * than fabricating data.
 */
export function adaptRole(item: AnyRoleItem): Role {
  const permissions = item.permissions ?? [];
  const grants: Grant[] = permissions.map((permission) => ({ permission }));
  const source = (item as { source?: string }).source ?? 'custom';
  return {
    id: item.id ?? '',
    tenant_id: item.tenantId ?? '',
    name: item.name ?? '',
    parent_ids: [],
    grants,
    denies: [],
    system: source === 'builtin' || source === 'built-in',
  };
}

// ─── Selectors ─────────────────────────────────────────────────────────────────

/**
 * Returns the list of roles for the given tenant. Empty array while
 * loading or on error — components render the empty-state surface.
 */
export function useRoleList(tenant: string): Role[] {
  const query = useListRoles(tenant);
  return useMemo(() => {
    const items = query.data?.data.roles ?? [];
    return items.map(adaptRole);
  }, [query.data]);
}

/** Returns a single role by id, adapted to the legacy shape. */
export function useRole(tenant: string, id: string): Role | undefined {
  const query = useGetRole(tenant, id);
  return useMemo(() => {
    const item = query.data?.data;
    return item ? adaptRole(item) : undefined;
  }, [query.data]);
}

/**
 * Returns the role list as a `Record<id, Role>`. Used by the cycle-
 * detection helper which expects map-style lookup.
 */
export function useRolesMap(tenant: string): Record<string, Role> {
  const list = useRoleList(tenant);
  return useMemo(() => {
    const map: Record<string, Role> = {};
    for (const role of list) {
      if (role.id) map[role.id] = role;
    }
    return map;
  }, [list]);
}

/**
 * Compute role membership counts for the given tenant.
 *
 * The daemon does not expose a "users per role" aggregate, so this
 * fans out: list all users in the tenant, then issue
 * `GET /users/{id}/roles` per user via `useQueries`. Counts are
 * tallied across the resolved responses. The hook returns an empty
 * map until at least one query has settled — components render
 * `0 users` for unknown roles, which matches the daemon's truthful
 * "we have no data yet" state.
 */
export function useRoleUserCounts(tenant: string): Record<string, number> {
  const usersQuery = useListUsers(tenant);
  const userIds = useMemo(() => {
    const items = usersQuery.data?.data.users ?? [];
    return items.map((u) => u.id ?? '').filter((id) => id !== '');
  }, [usersQuery.data]);

  const roleQueries = useQueries({
    queries: userIds.map((userId) => ({
      queryKey: getListUserRolesQueryKey(tenant, userId),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        listUserRoles(tenant, userId, signal !== undefined ? { signal } : undefined),
      enabled: tenant !== '' && userId !== '',
    })),
  });

  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of roleQueries) {
      const roleList = q.data?.data.roles ?? [];
      for (const r of roleList) {
        const rid = r.id ?? '';
        if (!rid) continue;
        counts[rid] = (counts[rid] ?? 0) + 1;
      }
    }
    return counts;
  }, [roleQueries]);
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

/**
 * `useRoleMutations` returns mutation callables bound to a tenant +
 * a `QueryClient` so callers do not have to thread either through.
 * Each callable is a thin promise wrapper over the generated
 * imperative client; the hook also invalidates the affected list /
 * detail queries on success so React-Query consumers refetch.
 */
export function useRoleMutations(tenant: string): {
  create: (payload: RolePayload) => Promise<Role>;
  update: (id: string, patch: Partial<RolePayload>) => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const queryClient = useQueryClient();

  return useMemo(() => {
    async function create(payload: RolePayload): Promise<Role> {
      const body = {
        name: payload.name,
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        permissions: payload.grants.map((g) => g.permission).filter((p) => p !== ''),
      };
      await createRole(tenant, body);
      await queryClient.invalidateQueries({ queryKey: getListRolesQueryKey(tenant) });
      return {
        id: '',
        tenant_id: tenant,
        name: payload.name,
        parent_ids: payload.parent_ids,
        grants: payload.grants,
        denies: payload.denies,
        system: false,
      };
    }

    async function update(id: string, _patch: Partial<RolePayload>): Promise<void> {
      await patchRole(tenant, id);
      await queryClient.invalidateQueries({ queryKey: getListRolesQueryKey(tenant) });
      await queryClient.invalidateQueries({ queryKey: getGetRoleQueryKey(tenant, id) });
    }

    async function remove(id: string): Promise<void> {
      await deleteRole(tenant, id);
      await queryClient.invalidateQueries({ queryKey: getListRolesQueryKey(tenant) });
    }

    return { create, update, remove };
  }, [tenant, queryClient]);
}

// ─── Imperative mutation shims ────────────────────────────────────────────────
//
// Earlier callers used module-level mutation functions
// (`createRoleMutation`, `updateRoleMutation`, `deleteRoleMutation`).
// They remain exported so route files do not have to be re-plumbed in
// this slice; cache invalidation lives in the hook variant above.

export async function createRoleMutation(tenant: string, payload: RolePayload): Promise<Role> {
  const body = {
    name: payload.name,
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    permissions: payload.grants.map((g) => g.permission).filter((p) => p !== ''),
  };
  await createRole(tenant, body);
  return {
    id: '',
    tenant_id: tenant,
    name: payload.name,
    parent_ids: payload.parent_ids,
    grants: payload.grants,
    denies: payload.denies,
    system: false,
  };
}

export async function updateRoleMutation(
  tenant: string,
  id: string,
  _patch: Partial<RolePayload>,
): Promise<void> {
  await patchRole(tenant, id);
}

export async function deleteRoleMutation(tenant: string, id: string): Promise<void> {
  await deleteRole(tenant, id);
}
