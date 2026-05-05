// packages/web/src/api/sse-client.ts
/**
 * Real SSE client.
 *
 * Daemon-side SSE protocol enhancements (Last-Event-ID resume + retry directive)
 * are shipped by Plan 1. This module manages connection lifecycle on the SPA side.
 *
 * One EventSource per topic — multiple subscribers share the connection.
 * Auto-reconnect on error, replaying with `last-event-id` query parameter.
 */

interface TopicConnection {
  es: EventSource;
  listeners: Set<(detail: unknown) => void>;
  lastEventId: string;
  closed: boolean;
  retryDelayMs: number;
}

const connections = new Map<string, TopicConnection>();

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

function buildUrl(topic: string, lastEventId: string): string {
  const qs = new URLSearchParams({ topic });
  if (lastEventId !== '') qs.set('last-event-id', lastEventId);
  return `${BASE}/events?${qs.toString()}`;
}

function openConnection(topic: string, conn: TopicConnection): void {
  const es = new EventSource(buildUrl(topic, conn.lastEventId), { withCredentials: true });
  conn.es = es;

  es.addEventListener('message', (ev: MessageEvent) => {
    if (ev.lastEventId !== '') conn.lastEventId = ev.lastEventId;
    conn.retryDelayMs = 1000; // reset backoff on successful receipt
    let detail: unknown = ev.data;
    if (typeof ev.data === 'string') {
      try {
        detail = JSON.parse(ev.data);
      } catch {
        detail = ev.data;
      }
    }
    for (const fn of conn.listeners) fn(detail);
  });

  es.addEventListener('error', () => {
    if (conn.closed) return;
    es.close();
    const jitter = conn.retryDelayMs * (0.8 + Math.random() * 0.4); // ±20%
    setTimeout(() => {
      if (!conn.closed) openConnection(topic, conn);
    }, jitter);
    conn.retryDelayMs = Math.min(conn.retryDelayMs * 2, 30000);
  });
}

export function subscribeSSE(topic: string, handler: (detail: unknown) => void): () => void {
  let conn = connections.get(topic);
  if (conn === undefined) {
    conn = {
      es: null as unknown as EventSource,
      listeners: new Set(),
      lastEventId: '',
      closed: false,
      retryDelayMs: 1000,
    };
    connections.set(topic, conn);
    openConnection(topic, conn);
  }
  const activeConn = conn;
  activeConn.listeners.add(handler);

  return () => {
    activeConn.listeners.delete(handler);
    if (activeConn.listeners.size === 0) {
      activeConn.closed = true;
      activeConn.es.close();
      connections.delete(topic);
    }
  };
}

/** Test-only reset hook. Not exported in production type surface. */
export function _resetForTests(): void {
  for (const conn of connections.values()) {
    conn.closed = true;
    conn.es.close();
  }
  connections.clear();
}
