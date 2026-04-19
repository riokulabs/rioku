/**
 * Tests for 1e.92 users CRUD polish: disable, delete, impersonation guard,
 * invite resend/revoke, membership role edit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  disableUser,
  enableUser,
  deleteUser,
  resendInvite,
  revokeInvite,
  updateMembershipRoles,
} from '../api';

/** Creates a pending membership for test use */
function createPendingMembership(): string {
  const state = useMockStore.getState();
  const tenantId = Object.keys(state.tenants)[0] ?? 'test-tenant';
  const userId = Object.keys(state.users)[0] ?? 'test-user';
  const membershipId = `test-pending-m-${String(Date.now())}`;
  state.addEntity('memberships', {
    id: membershipId,
    tenant_id: tenantId,
    user_id: userId,
    role_ids: [],
    state: 'pending',
    invited_at: new Date().toISOString(),
  });
  return membershipId;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('disableUser / enableUser', () => {
  it('sets disabled=true on the user', async () => {
    const state = useMockStore.getState();
    const user = Object.values(state.users).find((u) => !u.disabled);
    if (!user) throw new Error('No enabled user in seed');

    await disableUser(user.id);

    const updated = useMockStore.getState().users[user.id];
    expect(updated?.disabled).toBe(true);
  });

  it('sets disabled=false on a disabled user', async () => {
    const state = useMockStore.getState();
    // Disable first
    const user = Object.values(state.users)[0];
    if (!user) throw new Error('No user in seed');
    await disableUser(user.id);

    await enableUser(user.id);
    const updated = useMockStore.getState().users[user.id];
    expect(updated?.disabled).toBe(false);
  });

  it('emits a user:disable audit entry', async () => {
    const state = useMockStore.getState();
    const auditBefore = state.audit.length;
    const user = Object.values(state.users)[0];
    if (!user) throw new Error('No user');

    await disableUser(user.id);

    const auditAfter = useMockStore.getState().audit;
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('user:disable');
  });
});

describe('deleteUser', () => {
  it('removes the user from the store', async () => {
    const state = useMockStore.getState();
    const user = Object.values(state.users)[0];
    if (!user) throw new Error('No user');

    await deleteUser(user.id);

    const after = useMockStore.getState().users[user.id];
    expect(after).toBeUndefined();
  });

  it('emits a user:delete audit entry', async () => {
    const state = useMockStore.getState();
    const user = Object.values(state.users)[0];
    if (!user) throw new Error('No user');
    const auditBefore = state.audit.length;

    await deleteUser(user.id);

    const auditAfter = useMockStore.getState().audit;
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('user:delete');
  });
});

describe('resendInvite', () => {
  it('returns a new invite token and updates membership', async () => {
    const membershipId = createPendingMembership();
    const auditBefore = useMockStore.getState().audit.length;

    const result = await resendInvite(membershipId);
    expect(result.inviteToken).toBeTruthy();
    expect(result.inviteToken).toContain('inv-');

    const updated = useMockStore.getState().memberships[membershipId];
    expect(updated?.invite_token).toBe(result.inviteToken);

    // Audit entry emitted
    const auditAfter = useMockStore.getState().audit;
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
  });

  it('emits a user:invite.resend audit entry', async () => {
    const membershipId = createPendingMembership();
    const auditBefore = useMockStore.getState().audit.length;

    await resendInvite(membershipId);

    const auditAfter = useMockStore.getState().audit;
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('user:invite.resend');
  });
});

describe('revokeInvite', () => {
  it('transitions pending membership to removed', async () => {
    const membershipId = createPendingMembership();

    await revokeInvite(membershipId);

    const updated = useMockStore.getState().memberships[membershipId];
    expect(updated?.state).toBe('removed');
  });
});

describe('updateMembershipRoles', () => {
  it('updates the role_ids on the membership', async () => {
    const state = useMockStore.getState();
    const membership = Object.values(state.memberships).find(
      (m) => m.state === 'active',
    );
    if (!membership) throw new Error('No active membership');

    const roleIds = Object.keys(state.roles).slice(0, 2);
    await updateMembershipRoles(membership.id, roleIds);

    const updated = useMockStore.getState().memberships[membership.id];
    expect(updated?.role_ids).toEqual(roleIds);
  });

  it('emits a membership:role:update audit entry with diff', async () => {
    const state = useMockStore.getState();
    const membership = Object.values(state.memberships).find(
      (m) => m.state === 'active',
    );
    if (!membership) throw new Error('No active membership');
    const auditBefore = state.audit.length;
    const newRoles = ['r1'];

    await updateMembershipRoles(membership.id, newRoles);

    const auditAfter = useMockStore.getState().audit;
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('membership:role:update');
    expect(entry?.diff).toBeDefined();
  });
});
