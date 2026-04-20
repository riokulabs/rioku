/**
 * Direct integration tests for settings/api.ts — avatar mutation paths.
 *
 * Tests the updateProfileAvatar function directly (bypassing the Dropzone stub)
 * to verify store persistence and audit emission for both clear and set paths.
 *
 * Task 8a.2 — FIX 4
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { updateProfileAvatar } from '../api';

function getDerrickId(): string {
  const state = useMockStore.getState();
  const user = Object.values(state.users).find((u) => u.email === 'derrick@rioku.dev');
  if (!user) throw new Error('Derrick user not found in seed data');
  return user.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  const derrickId = getDerrickId();
  useMockStore.setState({ currentUserId: derrickId });
});

describe('updateProfileAvatar', () => {
  it('clears avatar_url in store when called with null', async () => {
    const derrickId = getDerrickId();

    // Seed a URL first so there is something to clear.
    useMockStore.getState().updateEntity('users', derrickId, {
      avatar_url: 'https://example.com/avatar.png',
    });

    await updateProfileAvatar(derrickId, null);

    const user = useMockStore.getState().users[derrickId];
    expect(user?.avatar_url).toBe('');
  });

  it('sets avatar_url in store when called with a URL', async () => {
    const derrickId = getDerrickId();
    const newUrl = 'https://example.com/new-avatar.png';

    await updateProfileAvatar(derrickId, newUrl);

    const user = useMockStore.getState().users[derrickId];
    expect(user?.avatar_url).toBe(newUrl);
  });

  it('emits avatar_removed audit entry when clearing', async () => {
    const derrickId = getDerrickId();

    await updateProfileAvatar(derrickId, null);

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'user.profile.avatar_removed');
    expect(entry).toBeDefined();
  });

  it('emits update_avatar audit entry when setting a URL', async () => {
    const derrickId = getDerrickId();

    await updateProfileAvatar(derrickId, 'https://example.com/avatar.png');

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'user.profile.update_avatar');
    expect(entry).toBeDefined();
  });

  it('emits user:updated host event for both clear and set paths', async () => {
    const derrickId = getDerrickId();
    const hostEvents: { type: string; payload: unknown }[] = [];
    const listener = (e: Event) => {
      hostEvents.push({ type: (e as CustomEvent).type, payload: (e as CustomEvent).detail });
    };
    mockBus.addEventListener('user:updated', listener);

    await updateProfileAvatar(derrickId, null);
    await updateProfileAvatar(derrickId, 'https://example.com/avatar.png');

    expect(hostEvents.filter((e) => e.type === 'user:updated').length).toBe(2);

    mockBus.removeEventListener('user:updated', listener);
  });
});
