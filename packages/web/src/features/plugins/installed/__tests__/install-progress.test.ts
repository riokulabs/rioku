/**
 * Unit tests for the streaming install-progress API (Plan 6).
 *
 * Covers:
 *   - Success path writes a Plugin + emits complete event
 *   - Failure path (deterministic per ref) emits failed event + audit 'plugin:install-failed'
 *   - Cancellation stops emission + appends audit 'plugin:install-cancelled'
 *   - getBuildLog reads plugin.last_build_log
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { ApprovalCandidate } from '../../install-approval/types';
import {
  installPluginWithProgress,
  getBuildLog,
  type InstallProgressEvent,
  type InstallCompleteEvent,
  type InstallFailedEvent,
} from '../api';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  vi.useFakeTimers();
});

function makeCandidate(overrides: Partial<ApprovalCandidate> = {}): ApprovalCandidate {
  return {
    slug: 'com.test.streaming',
    display_name: 'Streaming Test Plugin',
    version: '1.0.0',
    parts: ['admin'],
    declared_permissions: ['com.test.streaming:read'],
    reference: 'oci://registry.test.example/streaming:1.0.0-success',
    ...overrides,
  };
}

/** Drain a fake-timer interval until the emitter emits a terminal event. */
async function runToTerminal(
  emitter: EventTarget,
): Promise<{ kind: 'complete' | 'failed'; detail: unknown; progressCount: number }> {
  return new Promise((resolve) => {
    let progressCount = 0;
    emitter.addEventListener('progress', () => {
      progressCount++;
    });
    emitter.addEventListener('complete', (e) => {
      resolve({
        kind: 'complete',
        detail: (e as CustomEvent<InstallCompleteEvent>).detail,
        progressCount,
      });
    });
    emitter.addEventListener('failed', (e) => {
      resolve({
        kind: 'failed',
        detail: (e as CustomEvent<InstallFailedEvent>).detail,
        progressCount,
      });
    });
    // Advance fake timers enough to exhaust all stages (12 ticks × ~460ms each).
    void vi.advanceTimersByTimeAsync(10_000);
  });
}

describe('installPluginWithProgress', () => {
  it('streams progress events and writes a Plugin on success', async () => {
    // Reference chosen so the hash-mod-10 is nonzero → success path.
    const candidate = makeCandidate({
      reference: 'oci://registry.test.example/streaming:success-1',
    });
    const emitter = installPluginWithProgress(candidate);
    const result = await runToTerminal(emitter);

    expect(result.kind).toBe('complete');
    expect(result.progressCount).toBeGreaterThan(0);
    const detail = result.detail as InstallCompleteEvent;
    expect(detail.plugin.slug).toBe('com.test.streaming');
    expect(detail.plugin.build_state).toBe('stable');
    expect(detail.plugin.cosign_verified).toBe(true);

    // Plugin should be in the store.
    const inStore = Object.values(useMockStore.getState().plugins).find(
      (p) => p.slug === 'com.test.streaming',
    );
    expect(inStore?.id).toBe(detail.plugin.id);

    // Audit: plugin:install entry appended.
    const audit = useMockStore.getState().audit;
    const entry = audit[audit.length - 1];
    expect(entry?.action).toBe('plugin:install');
    expect(entry?.outcome).toBe('success');
  });

  it('emits `progress` with stage + monotonically non-decreasing pct', async () => {
    const candidate = makeCandidate({
      reference: 'oci://registry.test.example/streaming:success-2',
    });
    const emitter = installPluginWithProgress(candidate);
    const seen: InstallProgressEvent[] = [];
    emitter.addEventListener('progress', (e) => {
      seen.push((e as CustomEvent<InstallProgressEvent>).detail);
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(seen.length).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) {
      const prev = seen[i - 1];
      const curr = seen[i];
      if (!prev || !curr) throw new Error('seen[] hole — unexpected');
      expect(curr.progress).toBeGreaterThanOrEqual(prev.progress);
    }
    // Last event of a successful run should be 'complete' with progress=100.
    const last = seen[seen.length - 1];
    if (!last) throw new Error('no progress events captured');
    expect(last.stage).toBe('complete');
    expect(last.progress).toBe(100);
  });

  it('deterministic failure path — hash % 10 === 0 emits failed event', async () => {
    // Brute-force a reference string whose djb2 hash % 10 === 0.
    // We hit deterministically on the first match so the test stays fast.
    function djb2(s: string): number {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return h >>> 0;
    }
    let failRef = '';
    for (let i = 0; i < 2000; i++) {
      const candidate = `oci://fail/${String(i)}`;
      if (djb2(candidate) % 10 === 0) {
        failRef = candidate;
        break;
      }
    }
    expect(failRef).not.toBe('');

    const emitter = installPluginWithProgress(
      makeCandidate({ reference: failRef, slug: 'com.test.will-fail' }),
    );
    const result = await runToTerminal(emitter);

    expect(result.kind).toBe('failed');
    const detail = result.detail as InstallFailedEvent;
    expect(['fetching', 'verifying', 'building', 'swapping']).toContain(detail.stage);
    expect(detail.log).toContain('[error]');

    // No plugin should have landed in the store.
    const inStore = Object.values(useMockStore.getState().plugins).find(
      (p) => p.slug === 'com.test.will-fail',
    );
    expect(inStore).toBeUndefined();

    // Failure audit appended.
    const audit = useMockStore.getState().audit;
    const entry = audit[audit.length - 1];
    expect(entry?.action).toBe('plugin:install-failed');
    expect(entry?.outcome).toBe('error');
  });

  it('cancel() clears the interval and writes an install-cancelled audit', () => {
    const emitter = installPluginWithProgress(
      makeCandidate({ reference: 'oci://registry.test.example/streaming:cancel' }),
    );
    const onComplete = vi.fn();
    const onFailed = vi.fn();
    emitter.addEventListener('complete', onComplete);
    emitter.addEventListener('failed', onFailed);

    // Advance one tick, then cancel.
    void vi.advanceTimersByTimeAsync(500);
    emitter.cancel();
    void vi.advanceTimersByTimeAsync(10_000);

    expect(onComplete).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();

    const audit = useMockStore.getState().audit;
    const cancelEntry = audit.find((e) => e.action === 'plugin:install-cancelled');
    expect(cancelEntry).toBeDefined();
    expect(cancelEntry?.outcome).toBe('denied');
  });

  it('cancel() is idempotent — second call is a no-op', () => {
    const emitter = installPluginWithProgress(
      makeCandidate({ reference: 'oci://registry.test.example/streaming:cancel2' }),
    );
    emitter.cancel();
    const before = useMockStore.getState().audit.length;
    emitter.cancel();
    const after = useMockStore.getState().audit.length;
    expect(after).toBe(before);
  });
});

describe('getBuildLog', () => {
  it('returns last_build_log for the seeded broken plugin', () => {
    const broken = Object.values(useMockStore.getState().plugins).find(
      (p) => p.slug === 'com.example.broken-plugin',
    );
    if (!broken) throw new Error('broken-plugin seed missing');
    const log = getBuildLog(broken.id);
    expect(log).toBeDefined();
    expect(log).toContain('module not found');
  });

  it('returns undefined for plugins without a build log', () => {
    const ok = Object.values(useMockStore.getState().plugins).find(
      (p) => p.slug === 'com.acme.billing',
    );
    if (!ok) throw new Error('acme billing seed missing');
    expect(getBuildLog(ok.id)).toBeUndefined();
  });

  it('returns undefined for unknown plugin ids', () => {
    expect(getBuildLog('no-such-plugin')).toBeUndefined();
  });
});
