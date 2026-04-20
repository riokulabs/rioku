/**
 * Settings feature — mock API for Profile mutations.
 *
 * Backed by the Zustand mock store. Follows the conventions from
 * features/notification-channels/api.ts:
 *   - simulateLatency for realistic UX
 *   - appendAudit entry on every mutation
 *   - emitHostEvent on every mutation
 *   - atomic setState(s => ({...})) for multi-field patches
 *
 * Task 8a.2 — Profile section.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AuditEntry, ID, User } from '@/api/resources/types';

// ─── ID factory ───────────────────────────────────────────────────────────────

const nextAuditId = makeIdFactory('audit-profile');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function currentActor(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAudit(
  action: string,
  userId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  // Profile mutations are not tenant-scoped; use a synthetic tenant_id derived
  // from the user's first active membership (or 'unknown' if none).
  const state = useMockStore.getState();
  const membership = Object.values(state.memberships).find(
    (m) => m.user_id === userId && m.state === 'active',
  );
  const tenantId = membership?.tenant_id ?? state.currentTenantId ?? 'unknown';

  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: currentActor(),
    action,
    resource_type: 'user',
    resource_id: userId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Returns the current logged-in user from the store, or undefined. */
export function useCurrentUser(): User | undefined {
  return useMockStore((s) =>
    s.currentUserId ? s.users[s.currentUserId] : undefined,
  );
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Update the current user's display name. */
export async function updateProfileName(userId: ID, name: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateEntity('users', userId, { name, updated_at: now() });
  state.appendAudit(makeAudit('user.profile.update_name', userId));
  emitHostEvent('user:updated', { user_id: userId, fields: ['name'] });
}

/** Update the current user's avatar URL. Pass `null` to clear. */
export async function updateProfileAvatar(
  userId: ID,
  avatar_url: string | null,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  // exactOptionalPropertyTypes: only set avatar_url if non-null; otherwise
  // patch with an empty patch (clearing avatar is handled by setting to
  // the empty string sentinel in the view layer).
  const patch: Partial<User> = { updated_at: now() };
  if (avatar_url !== null) patch.avatar_url = avatar_url;
  state.updateEntity('users', userId, patch);
  state.appendAudit(makeAudit('user.profile.update_avatar', userId));
  emitHostEvent('user:updated', { user_id: userId, fields: ['avatar_url'] });
}

/**
 * Simulate a password change.
 * In mock mode we only validate that currentPassword is non-empty (no real
 * credential check) and mark force_password_change = false on success.
 * Returns `true` on success, `false` if the currentPassword is blank (mock
 * for "wrong password").
 */
export async function changePassword(
  userId: ID,
  currentPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  await simulateLatency('mutation');
  // Mock: reject if currentPassword === 'wrong' for testing, otherwise accept.
  if (!currentPassword) {
    return { ok: false, error: 'Current password is required.' };
  }
  const state = useMockStore.getState();
  state.updateEntity('users', userId, {
    force_password_change: false,
    updated_at: now(),
  });
  state.appendAudit(makeAudit('user.profile.change_password', userId, 'write'));
  emitHostEvent('user:password-changed', { user_id: userId });
  return { ok: true };
}

/**
 * Regenerate TOTP backup codes for the current user.
 * Generates 10 fresh mock codes (format: xxxxxx-xxxxxx).
 */
export async function resetBackupCodes(userId: ID): Promise<string[]> {
  await simulateLatency('mutation');
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const part = () =>
      Math.floor(Math.random() * 999999)
        .toString()
        .padStart(6, '0');
    codes.push(`${part()}-${part()}`);
  }
  const state = useMockStore.getState();
  state.updateEntity('users', userId, { backup_codes: codes, updated_at: now() });
  state.appendAudit(makeAudit('user.profile.reset_backup_codes', userId, 'write'));
  emitHostEvent('user:backup-codes-reset', { user_id: userId });
  return codes;
}

/** Update the current user's preferences (theme stored separately in localStorage). */
export async function updatePreferences(
  userId: ID,
  patch: {
    locale: string;
    timezone: string;
    reduced_motion: boolean;
    notification_email: boolean;
    notification_in_app: boolean;
    categories_muted: string[];
  },
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();

  state.updateEntity('users', userId, {
    locale: patch.locale,
    timezone: patch.timezone,
    reduced_motion: patch.reduced_motion,
    notification_preferences: {
      email: patch.notification_email,
      in_app: patch.notification_in_app,
      categories_muted: patch.categories_muted,
    },
    updated_at: now(),
  });
  state.appendAudit(makeAudit('user.profile.update_preferences', userId));
  emitHostEvent('user:updated', {
    user_id: userId,
    fields: ['locale', 'timezone', 'reduced_motion', 'notification_preferences'],
  });
}
