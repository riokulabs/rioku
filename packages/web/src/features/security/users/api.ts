/**
 * Users API — backed by the Zustand mock store.
 *
 * Follows the same patterns as features/security/roles/api.ts.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { User, Membership, UserWithMembership, UserFilter } from './types';
import type { AuditEntry } from '@/api/resources/types';

const nextUserId = makeIdFactory('user-new');
const nextMembershipId = makeIdFactory('membership-new');
const nextAuditId = makeIdFactory('audit-new');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function makeAuditEntry(
  actorId: string,
  tenantId: string | null,
  action: string,
  resourceType: string,
  resourceId?: string,
): AuditEntry {
  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    resource_type: resourceType,
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier: 'write',
  };
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Returns users with active (or any state matching filter) memberships in the
 * given tenant, applying opaque-filter search on name/email.
 */
export function useUserList(tenantId: string, filter: UserFilter): UserWithMembership[] {
  // Pull stable record references, filter/derive outside selector to avoid unstable arrays
  const users = useMockStore((s) => s.users);
  const memberships = useMockStore((s) => s.memberships);
  const roles = useMockStore((s) => s.roles);
  // Derive in render body — won't cause infinite loop since store references are stable

  const search = filter.search.toLowerCase().trim();
  const status = filter.status;

  // Collect memberships for this tenant, filtered by state
  const results: UserWithMembership[] = [];

  for (const membership of Object.values(memberships)) {
    if (membership.tenant_id !== tenantId) continue;
    if (status !== 'all' && membership.state !== status) continue;

    const user = users[membership.user_id];
    if (!user) continue;

    // Apply opaque search (name/email — never in URL directly)
    if (search) {
      const nameMatch = user.name.toLowerCase().includes(search);
      const emailMatch = user.email.toLowerCase().includes(search);
      if (!nameMatch && !emailMatch) continue;
    }

    const memberRoles = membership.role_ids
      .map((rid) => roles[rid])
      .filter((r): r is NonNullable<typeof r> => r !== undefined);

    results.push({ user, membership, roles: memberRoles });
  }

  return results;
}

/** Returns a single user + all memberships + roles map. */
export function useUserDetail(userId: string) {
  const user = useMockStore((s) => s.users[userId]);
  // Stable reference: pull all memberships then filter outside selector
  const allMemberships = useMockStore((s) => s.memberships);
  const roles = useMockStore((s) => s.roles);

  if (!user) return null;
  const memberships = Object.values(allMemberships).filter((m) => m.user_id === userId);
  return { user, memberships, roles };
}

/** Returns sessions for a user. */
export function useUserSessions(userId: string) {
  const allSessions = useMockStore((s) => s.sessions);
  return Object.values(allSessions).filter((sess) => sess.user_id === userId);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useUserMutations() {
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

export async function inviteUser(
  email: string,
  name: string | undefined,
  tenantId: string,
  roleIds: string[],
  forceTotpOnFirstLogin: boolean,
): Promise<{ userId: string; membershipId: string; inviteToken: string }> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const actorId = getCurrentActorId();

  // Check if user already exists by email
  const existingUser = Object.values(state.users).find((u) => u.email === email);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    userId = nextUserId();
    const user: User = {
      id: userId,
      email,
      name: name ?? email.split('@')[0] ?? email,
      disabled: false,
      totp_enabled: forceTotpOnFirstLogin,
      totp_enrolled: false,
      force_password_change: true,
      timezone: 'America/Los_Angeles',
      locale: 'en',
      reduced_motion: false,
      notification_preferences: { email: true, in_app: true, categories_muted: [] },
      created_at: now(),
      updated_at: now(),
    };
    state.addEntity('users', user);
  }

  const membershipId = nextMembershipId();
  const membership: Membership = {
    id: membershipId,
    tenant_id: tenantId,
    user_id: userId,
    role_ids: roleIds,
    state: 'pending',
    invited_at: now(),
  };
  state.addEntity('memberships', membership);

  // Audit entry
  state.appendAudit(
    makeAuditEntry(actorId, tenantId, 'user:invite', 'user', userId),
  );

  // Fake invite token
  const inviteToken = `inv-${userId.slice(-6)}-${membershipId.slice(-6)}`;

  // Emit host event so plugins can react (e.g. custom onboarding workflows)
  emitHostEvent('user:invited', { user_id: userId, tenant_id: tenantId, role_ids: roleIds });

  return { userId, membershipId, inviteToken };
}

export async function activateMembership(membershipId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const membership = state.memberships[membershipId];
  if (!membership) return;

  state.updateEntity('memberships', membershipId, {
    state: 'active',
    joined_at: now(),
  });

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      membership.tenant_id,
      'user:membership.activate',
      'membership',
      membershipId,
    ),
  );
}

export async function deactivateMembership(membershipId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const membership = state.memberships[membershipId];
  if (!membership) return;

  state.updateEntity('memberships', membershipId, { state: 'deactivated' });

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      membership.tenant_id,
      'user:membership.deactivate',
      'membership',
      membershipId,
    ),
  );
}

export async function removeMembership(membershipId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const membership = state.memberships[membershipId];
  if (!membership) return;

  state.updateEntity('memberships', membershipId, { state: 'removed' });

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      membership.tenant_id,
      'user:membership.remove',
      'membership',
      membershipId,
    ),
  );
}

export async function disableUser(userId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateEntity('users', userId, { disabled: true, updated_at: now() });
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), state.currentTenantId, 'user:disable', 'user', userId),
  );
  emitHostEvent('user:disabled', { user_id: userId, tenant_id: state.currentTenantId });
}

export async function enableUser(userId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateEntity('users', userId, { disabled: false, updated_at: now() });
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), state.currentTenantId, 'user:enable', 'user', userId),
  );
  emitHostEvent('user:updated', { user_id: userId, tenant_id: state.currentTenantId, change: 'enabled' });
}

export async function deleteUser(userId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.deleteEntity('users', userId);
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), state.currentTenantId, 'user:delete', 'user', userId),
  );
}

export async function revokeSession(sessionId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  // Mark revoked = true, do NOT delete (audit trail needs it)
  state.updateEntity('sessions', sessionId, { revoked: true });
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), state.currentTenantId, 'session:revoke', 'session', sessionId),
  );
}

export async function resendInvite(
  membershipId: string,
): Promise<{ inviteToken: string }> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const membership = state.memberships[membershipId];
  if (!membership) throw new Error('Membership not found');

  // Generate a fresh invite token
  const inviteToken = `inv-${membership.user_id.slice(-6)}-${membershipId.slice(-6)}-r${Date.now().toString(36)}`;
  state.updateEntity('memberships', membershipId, {
    invite_token: inviteToken,
    invite_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      membership.tenant_id,
      'user:invite.resend',
      'membership',
      membershipId,
    ),
  );

  return { inviteToken };
}

export async function revokeInvite(membershipId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const membership = state.memberships[membershipId];
  if (!membership) return;

  state.updateEntity('memberships', membershipId, { state: 'removed' });

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      membership.tenant_id,
      'user:invite.revoke',
      'membership',
      membershipId,
    ),
  );
}

export async function updateMembershipRoles(
  membershipId: string,
  newRoleIds: string[],
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const membership = state.memberships[membershipId];
  if (!membership) return;

  const before = [...membership.role_ids];
  state.updateEntity('memberships', membershipId, { role_ids: newRoleIds });

  state.appendAudit({
    ...makeAuditEntry(
      getCurrentActorId(),
      membership.tenant_id,
      'membership:role:update',
      'membership',
      membershipId,
    ),
    tier: 'write',
    diff: { before: { role_ids: before }, after: { role_ids: newRoleIds } },
  });

  emitHostEvent('user:role-changed', {
    user_id: membership.user_id,
    tenant_id: membership.tenant_id,
    membership_id: membershipId,
    before: before,
    after: newRoleIds,
  });
}
