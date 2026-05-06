/**
 * Unit tests for <LiveTailBadge> + useAuditStream.
 *
 * Stage 2: useAuditStream now subscribes via `subscribeSSE` (real
 * EventSource). Tests use a MockEventSource that dispatches message
 * events to simulate the daemon SSE stream. The mock is installed on
 * globalThis.EventSource before each test and torn down after.
 *
 * Lifecycle contract preserved from Stage 1:
 *   - onEntry fires for each JSON message while enabled
 *   - no-op when disabled
 *   - SSE topic is tenant-scoped (different tenant → no call)
 *   - unsubscribes cleanly on unmount
 *   - re-subscribes when enabled toggles true
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, renderHook, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { _resetForTests } from '@/api/sse-client';
import type { AuditEntry } from '@/api/resources';
import { LiveTailBadge, useAuditStream } from '../components/streaming-tail';

// ─── Mock EventSource ─────────────────────────────────────────────────────────

// Intentionally not `implements EventSource` — the DOM `addEventListener`
// overloads in the lib include `MessageEvent`-typed listeners that conflict
// with the simpler `(ev: Event) => void` shape we use in tests. The cast at
// `globalThis.EventSource = MockEventSource` keeps the runtime substitution
// working.
class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;
  readyState = 0 as const;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  CONNECTING = 0 as const;
  OPEN = 1 as const;
  CLOSED = 2 as const;
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSED = 2 as const;

  private _listeners = new Map<string, Set<(ev: Event) => void>>();
  closed = false;

  constructor(url: string | URL, opts?: EventSourceInit) {
    this.url = url.toString();
    this.withCredentials = opts?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: Event) => void): void {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (ev: Event) => void): void {
    this._listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const set = this._listeners.get(event.type);
    if (set) for (const fn of set) fn(event);
    return true;
  }

  close(): void {
    this.closed = true;
  }

  /** Helper: emit a message event with JSON payload. */
  emit(payload: unknown, lastEventId = ''): void {
    const ev = new MessageEvent('message', {
      data: JSON.stringify(payload),
      lastEventId,
    });
    this.dispatchEvent(ev);
  }

  /** Helper: trigger an error to test reconnect logic (we don't need reconnect in unit tests). */
  emitError(): void {
    const ev = new Event('error');
    this.dispatchEvent(ev);
  }
}

// Install before tests, restore after.
const OriginalEventSource = globalThis.EventSource;
beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error -- patching global for test purposes
  globalThis.EventSource = MockEventSource;
  useMockStore.getState().reset();
  seedStore(useMockStore);
});
afterEach(() => {
  _resetForTests();
  globalThis.EventSource = OriginalEventSource;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

function acmeId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant');
  return acme.id;
}

function synthEntry(tenantId: string, id: string): AuditEntry {
  return {
    id,
    tenant_id: tenantId,
    actor_id: 'u_test',
    action: 'test.action',
    resource_type: 'test',
    resource_id: 'r_test',
    outcome: 'success',
    at: new Date().toISOString(),
    tier: 'read',
  };
}

/** Get the single MockEventSource created by subscribeSSE, or throw. */
function getSource(): MockEventSource {
  const src = MockEventSource.instances[0];
  if (!src) throw new Error('No MockEventSource created');
  return src;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LiveTailBadge', () => {
  it('renders "LIVE" with no counter when newCount is 0', () => {
    wrap(<LiveTailBadge newCount={0} isLive />);
    const badge = screen.getByTestId('audit-live-badge');
    expect(badge.textContent).toContain('LIVE');
    expect(badge.textContent).not.toContain('+');
  });

  it('renders the counter when newCount > 0', () => {
    wrap(<LiveTailBadge newCount={7} isLive />);
    const badge = screen.getByTestId('audit-live-badge');
    expect(badge.textContent).toContain('LIVE');
    expect(badge.textContent).toContain('+7');
  });

  it('renders "Paused" with no counter when isLive is false', () => {
    wrap(<LiveTailBadge newCount={3} isLive={false} />);
    const badge = screen.getByTestId('audit-live-badge');
    expect(badge.textContent).toContain('Paused');
    expect(badge.textContent).not.toContain('+');
    expect(badge.textContent).not.toContain('LIVE');
  });

  it('uses role=status with aria-live=polite for screen reader updates', () => {
    wrap(<LiveTailBadge newCount={2} isLive />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
  });
});

describe('useAuditStream', () => {
  it('invokes onEntry when an SSE message arrives while enabled', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    renderHook(() => {
      useAuditStream(tenantId, true, onEntry);
    });

    const src = getSource();
    // URL must be scoped to the tenant
    expect(src.url).toContain(tenantId);

    const entry = synthEntry(tenantId, 'a1');
    src.emit(entry);
    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(onEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('does not create an EventSource when disabled', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    renderHook(() => {
      useAuditStream(tenantId, false, onEntry);
    });

    // No EventSource should have been created
    expect(MockEventSource.instances).toHaveLength(0);
    expect(onEntry).not.toHaveBeenCalled();
  });

  it('closes the EventSource on unmount', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    const hook = renderHook(() => {
      useAuditStream(tenantId, true, onEntry);
    });

    const src = getSource();
    src.emit(synthEntry(tenantId, 'a4'));
    hook.unmount();

    expect(src.closed).toBe(true);
  });

  it('creates an EventSource when enabled toggles to true', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    let enabled = false;
    const hook = renderHook(() => {
      useAuditStream(tenantId, enabled, onEntry);
    });

    // disabled — no source yet
    expect(MockEventSource.instances).toHaveLength(0);

    enabled = true;
    hook.rerender();

    const src = getSource();
    src.emit(synthEntry(tenantId, 'a7'));
    expect(onEntry).toHaveBeenCalledTimes(1);
  });

  it('closes the EventSource when enabled toggles to false', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    let enabled = true;
    const hook = renderHook(() => {
      useAuditStream(tenantId, enabled, onEntry);
    });

    const src = getSource();
    src.emit(synthEntry(tenantId, 'a8'));
    expect(onEntry).toHaveBeenCalledTimes(1);

    enabled = false;
    hook.rerender();

    expect(src.closed).toBe(true);

    // Events after close should not reach onEntry
    // (src is closed so no new messages, but verify call count stayed at 1)
    expect(onEntry).toHaveBeenCalledTimes(1);
  });

  it('uses a tenant-scoped SSE topic URL', () => {
    const tenantId = acmeId();
    renderHook(() => {
      useAuditStream(tenantId, true, vi.fn());
    });

    const src = getSource();
    // subscribeSSE URL-encodes the topic; decode before asserting the tenant scope
    const decoded = decodeURIComponent(src.url);
    expect(decoded).toContain(`t/${tenantId}/audit`);
  });

  it('ignores non-object SSE messages', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    renderHook(() => {
      useAuditStream(tenantId, true, onEntry);
    });

    const src = getSource();
    // Emit a plain string — should be silently dropped
    src.dispatchEvent(
      new MessageEvent('message', { data: 'not-json', lastEventId: '' }),
    );
    expect(onEntry).not.toHaveBeenCalled();
  });
});
