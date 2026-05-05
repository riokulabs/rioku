// packages/web/src/api/sse-client.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { subscribeSSE, _resetForTests } from './sse-client';

class MockEventSource implements EventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState: number = EventSource.CONNECTING;
  withCredentials: boolean;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;

  CONNECTING = 0 as const;
  OPEN = 1 as const;
  CLOSED = 2 as const;
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSED = 2 as const;

  private listeners = new Map<string, Set<(ev: MessageEvent) => void>>();

  constructor(url: string | URL, opts?: EventSourceInit) {
    this.url = url.toString();
    this.withCredentials = opts?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, ev: EventSourceEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: (this: EventSource, event: MessageEvent) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, ev: EventSourceEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: (this: EventSource, event: MessageEvent) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(type: string, listener: (ev: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const set = this.listeners.get(event.type);
    if (set) for (const fn of set) fn(event as MessageEvent);
    return true;
  }

  close(): void {
    this.readyState = EventSource.CLOSED;
  }

  emit(eventType: string, data: unknown, lastEventId?: string): void {
    const ev = new MessageEvent(eventType, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId: lastEventId ?? '',
    });
    this.dispatchEvent(ev);
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  // Stub Math.random to 0.5 so jitter factor = 0.8 + 0.5 * 0.4 = 1.0 (no jitter).
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  _resetForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('subscribeSSE', () => {
  it('@read-only opens an EventSource with credentials and the topic URL', () => {
    const handler = vi.fn();
    const cleanup = subscribeSSE('audit', handler);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toContain('/events?topic=audit');
    expect(MockEventSource.instances[0]!.withCredentials).toBe(true);
    cleanup();
  });

  it('@read-only delivers messages to the handler', () => {
    const handler = vi.fn();
    const cleanup = subscribeSSE('audit', handler);
    MockEventSource.instances[0]!.emit('message', { id: 'a-1', action: 'create' });
    expect(handler).toHaveBeenCalledWith({ id: 'a-1', action: 'create' });
    cleanup();
  });

  it('@read-only tracks Last-Event-ID across messages', () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    subscribeSSE('audit', handler);
    const es = MockEventSource.instances[0]!;
    es.emit('message', { id: 'a-1' }, 'evt-1');
    es.emit('message', { id: 'a-2' }, 'evt-2');
    es.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(2000);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]!.url).toContain('last-event-id=evt-2');
    vi.useRealTimers();
  });

  it('@read-only stops reconnecting after cleanup', () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const cleanup = subscribeSSE('audit', handler);
    cleanup();
    MockEventSource.instances[0]!.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(2000);
    expect(MockEventSource.instances).toHaveLength(1);
    vi.useRealTimers();
  });

  it('@read-only doubles backoff on consecutive errors', () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    subscribeSSE('audit', handler);
    // First error: retryDelayMs=1000, jitter factor=1.0 → fires after exactly 1000ms
    MockEventSource.instances[0]!.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(1500);
    expect(MockEventSource.instances).toHaveLength(2);
    // Second error: retryDelayMs=2000, jitter factor=1.0 → fires after exactly 2000ms
    MockEventSource.instances[1]!.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(1500); // not enough (only 1500 of 2000ms elapsed)
    expect(MockEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1500); // total 3000ms elapsed since second error — enough
    expect(MockEventSource.instances).toHaveLength(3);
    vi.useRealTimers();
  });

  it('@read-only deduplicates topic subscriptions', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const c1 = subscribeSSE('audit', h1);
    const c2 = subscribeSSE('audit', h2);
    expect(MockEventSource.instances).toHaveLength(1);
    MockEventSource.instances[0]!.emit('message', { x: 1 });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    c1();
    c2();
  });
});
