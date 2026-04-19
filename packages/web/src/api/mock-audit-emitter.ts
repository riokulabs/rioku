/**
 * Mock audit SSE emitter — dev-only.
 *
 * Emits a synthetic 'audit:new' event on the mockBus every ~30s when
 * running in development mode. This drives the "Tail live" feature in
 * the audit feature without needing a real daemon.
 *
 * IMPORTANT: guarded by `import.meta.env.DEV`. In production builds and
 * Vitest tests (`import.meta.env.VITEST`) this is a complete no-op.
 *
 * Call `startMockAuditEmitter()` once from main.tsx (after store is seeded).
 */

import { publishMock } from './mock-sse';
import { useMockStore } from './mock-store';
import { makeIdFactory } from '../lib/id-generator';
import type { AuditEntry } from './resources/types';

const nextId = makeIdFactory('audit-live');

const LIVE_ACTIONS = [
  'user.login', 'api_key.create', 'session.revoke',
  'role.update', 'plugin.enable', 'service.update',
];

const LIVE_TIERS: AuditEntry['tier'][] = ['read', 'write', 'destructive'];
const LIVE_OUTCOMES: AuditEntry['outcome'][] = ['success', 'success', 'denied'];

let emitterTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the emitter. Safe to call multiple times — only one interval runs.
 * No-op outside DEV mode.
 */
export function startMockAuditEmitter(): void {
  if (!import.meta.env.DEV) return;
  if (emitterTimer !== null) return;

  emitterTimer = setInterval(() => {
    const state = useMockStore.getState();
    const userIds = Object.keys(state.users);
    const tenantIds = Object.keys(state.tenants);
    if (userIds.length === 0) return;

    const idx = Date.now() % userIds.length;
    const actorId = userIds[idx] ?? userIds[0] ?? 'unknown';
    const action = LIVE_ACTIONS[idx % LIVE_ACTIONS.length] ?? 'user.login';
    const outcome = LIVE_OUTCOMES[idx % LIVE_OUTCOMES.length] ?? 'success';
    const tier = LIVE_TIERS[idx % LIVE_TIERS.length] ?? 'write';
    const entry: AuditEntry = {
      id: nextId(),
      tenant_id: tenantIds[idx % tenantIds.length] ?? null,
      actor_id: actorId,
      action,
      resource_type: 'service',
      outcome,
      at: new Date().toISOString(),
      tier,
    };

    publishMock('audit:new', entry);
  }, 30_000);
}

/**
 * Stop the emitter (useful for testing cleanup).
 */
export function stopMockAuditEmitter(): void {
  if (emitterTimer !== null) {
    clearInterval(emitterTimer);
    emitterTimer = null;
  }
}
