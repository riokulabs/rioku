/**
 * Unit tests for `installPluginWithProgress` + `getBuildLog` — Stage-2.
 *
 * The Stage-2 implementation:
 *   - POSTs the install request to /plugins/install
 *   - Subscribes to an SSE stream at /plugins/install/{id}/stream
 *   - Relays `progress` / `complete` / `failed` events on a returned EventTarget
 *
 * EventSource is not available in jsdom; we polyfill a minimal stub for
 * the duration of these tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { installPluginWithProgress, getBuildLog } from '../api';
import type { InstallProgressEvent, InstallCompleteEvent, InstallFailedEvent } from '../api';

let activeFakeES: StubEventSource | null = null;

class StubEventSource {
  url: string;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeFakeES = this;
  }
  addEventListener(name: string, fn: (ev: MessageEvent) => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  close(): void {
    this.closed = true;
    if (activeFakeES === this) activeFakeES = null;
  }
  /** Simulate the daemon emitting an SSE event of `name` with `payload`. */
  emit(name: string, payload: unknown): void {
    const fns = this.listeners[name] ?? [];
    const ev = { data: JSON.stringify(payload), type: name } as unknown as MessageEvent;
    for (const f of fns) f(ev);
  }
}

const RealEventSource = globalThis.EventSource;

beforeEach(() => {
  server.resetHandlers();
  activeFakeES = null;
  // @ts-expect-error - test stub
  globalThis.EventSource = StubEventSource;
});

afterEach(() => {
  globalThis.EventSource = RealEventSource;
});

function waitForES(): Promise<StubEventSource> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      if (activeFakeES) {
        resolve(activeFakeES);
        return;
      }
      if (Date.now() - t0 > 1000) {
        reject(new Error('timeout waiting for EventSource'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('installPluginWithProgress (real daemon SSE)', () => {
  const candidate = {
    slug: 'com.acme.demo',
    display_name: 'Acme Demo',
    version: '1.0.0',
    declared_permissions: [],
    parts: ['daemon' as const],
    reference: 'oci://demo',
  };

  it('streams progress events relayed from the daemon SSE stream', async () => {
    server.use(
      http.post('/api/v1/t/tenant-1/plugins/install', () =>
        HttpResponse.json({ installId: 'install-1', status: 'queued' }, { status: 202 }),
      ),
    );

    const emitter = installPluginWithProgress(candidate, 'tenant-1');
    const events: InstallProgressEvent[] = [];
    emitter.addEventListener('progress', (e) => {
      events.push((e as CustomEvent<InstallProgressEvent>).detail);
    });

    const es = await waitForES();
    es.emit('progress', { stage: 'fetching', progress: 10, message: 'fetch...' });
    es.emit('progress', { stage: 'building', progress: 60, message: 'build...' });

    expect(events.length).toBe(2);
    expect(events[0]?.stage).toBe('fetching');
    expect(events[1]?.progress).toBe(60);

    emitter.cancel();
  });

  it('emits a `complete` event with the daemon-reported plugin', async () => {
    server.use(
      http.post('/api/v1/t/tenant-1/plugins/install', () =>
        HttpResponse.json({ installId: 'install-2', status: 'queued' }, { status: 202 }),
      ),
    );

    const emitter = installPluginWithProgress(candidate, 'tenant-1');
    const completes: InstallCompleteEvent[] = [];
    emitter.addEventListener('complete', (e) => {
      completes.push((e as CustomEvent<InstallCompleteEvent>).detail);
    });

    const es = await waitForES();
    es.emit('complete', { plugin: { id: 'p-new', slug: candidate.slug } });

    expect(completes.length).toBe(1);
    const p = completes[0]?.plugin as { id?: string } | undefined;
    expect(p?.id).toBe('p-new');
  });

  it('emits a `failed` event with stage + log on a failed run', async () => {
    server.use(
      http.post('/api/v1/t/tenant-1/plugins/install', () =>
        HttpResponse.json({ installId: 'install-3', status: 'queued' }, { status: 202 }),
      ),
    );

    const emitter = installPluginWithProgress(candidate, 'tenant-1');
    const fails: InstallFailedEvent[] = [];
    emitter.addEventListener('failed', (e) => {
      fails.push((e as CustomEvent<InstallFailedEvent>).detail);
    });

    const es = await waitForES();
    es.emit('failed', {
      stage: 'building',
      message: 'compile error',
      log: '[error] foo',
    });

    expect(fails.length).toBe(1);
    expect(fails[0]?.stage).toBe('building');
    expect(fails[0]?.log).toContain('[error]');
  });

  it('cancel() closes the EventSource', async () => {
    server.use(
      http.post('/api/v1/t/tenant-1/plugins/install', () =>
        HttpResponse.json({ installId: 'install-4', status: 'queued' }, { status: 202 }),
      ),
    );
    const emitter = installPluginWithProgress(candidate, 'tenant-1');
    const es = await waitForES();
    expect(es.closed).toBe(false);
    emitter.cancel();
    expect(es.closed).toBe(true);
  });

  it('is a no-op when tenantSlug omitted (no events emitted)', () => {
    const emitter = installPluginWithProgress(candidate, '');
    const events: unknown[] = [];
    emitter.addEventListener('progress', () => events.push('p'));
    emitter.addEventListener('complete', () => events.push('c'));
    emitter.addEventListener('failed', () => events.push('f'));
    emitter.cancel();
    expect(events).toEqual([]);
  });
});

describe('getBuildLog (real daemon)', () => {
  it('fetches the build-log endpoint and returns its body', async () => {
    server.use(
      http.get('/api/v1/t/tenant-1/plugins/p-1/build-log', () =>
        HttpResponse.text('xcaddy v2.8.4 compiling…'),
      ),
    );
    const log = await getBuildLog('p-1', 'tenant-1');
    expect(log).toContain('xcaddy');
  });

  it('returns undefined on 404', async () => {
    server.use(
      http.get(
        '/api/v1/t/tenant-1/plugins/missing/build-log',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    const log = await getBuildLog('missing', 'tenant-1');
    expect(log).toBeUndefined();
  });

  it('returns undefined when tenant or plugin id is empty', async () => {
    expect(await getBuildLog('', 'tenant-1')).toBeUndefined();
    expect(await getBuildLog('p-1', '')).toBeUndefined();
  });
});
