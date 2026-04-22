/**
 * Roles API — backed by the Zustand mock store.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import type { Role, RolePayload } from './types';

const nextId = makeIdFactory('role-new');

// ─── Selectors ─────────────────────────────────────────────────────────────────

export function useRoleList(): Role[] {
  const raw = useMockStore((s) => s.roles);
  return Object.values(raw);
}

export function useRole(id: string): Role | undefined {
  return useMockStore((s) => s.roles[id]);
}

/** Returns all roles as a Record (used for cycle detection). */
export function useRolesMap(): Record<string, Role> {
  return useMockStore((s) => s.roles);
}

/**
 * Compute user count per role from memberships.
 * Returns a map: roleId → count.
 */
export function useRoleUserCounts(): Record<string, number> {
  const memberships = useMockStore((s) => s.memberships);
  const counts: Record<string, number> = {};
  for (const m of Object.values(memberships)) {
    for (const rid of m.role_ids) {
      counts[rid] = (counts[rid] ?? 0) + 1;
    }
  }
  return counts;
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export async function createRoleMutation(tenantId: string, payload: RolePayload): Promise<Role> {
  await simulateLatency('mutation');
  const role: Role = {
    id: nextId(),
    tenant_id: tenantId,
    name: payload.name,
    parent_ids: payload.parent_ids,
    grants: payload.grants,
    denies: payload.denies,
    system: false,
  };
  useMockStore.getState().addEntity('roles', role);
  return role;
}

export async function updateRoleMutation(id: string, patch: Partial<RolePayload>): Promise<void> {
  await simulateLatency('mutation');
  useMockStore.getState().updateEntity('roles', id, patch);
}

export async function deleteRoleMutation(id: string): Promise<void> {
  await simulateLatency('mutation');
  useMockStore.getState().deleteEntity('roles', id);
}
