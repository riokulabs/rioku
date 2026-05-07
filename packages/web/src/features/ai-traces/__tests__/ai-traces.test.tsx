/**
 * AI Traces — list / SSE live-tail / viewer-gating tests.
 *
 * - List: real Orval-backed query hook returns the expected rows.
 * - SSE live tail: subscribeTraceStream fires onTrace when an event
 *   lands on the multiplexed `/api/v1/events?topic=...` channel.
 * - Viewer gating: <PromptCompletionView> redacts by default and only
 *   surfaces the unmasked text when `unmasked === true`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import type { ReactNode } from 'react';
import { server } from '@/test/msw-server';
import { useTraceList, subscribeTraceStream } from '../api';
import { PromptCompletionView } from '../components/prompt-completion-view';
import type { TraceFilter } from '../types';
import type { AITrace } from '@/api/generated/schemas';

const TENANT = 'acme';
const LIST_PATH = `*/api/v1/t/${TENANT}/ai/traces`;

const sample: AITrace = {
  id: 'aitrace-1',
  tenantId: 'tenant-acme',
  agentId: 'aiagent-1',
  providerId: 'aiprov-1',
  model: 'gpt-4o',
  status: 'success',
  inputTokens: 100,
  outputTokens: 50,
  durationMs: 250,
  prompt: null,
  completion: null,
  toolCalls: [],
  error: null,
  occurredAt: '2026-05-06T00:00:00.000Z',
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MantineProvider>
          <ModalsProvider>{children}</ModalsProvider>
        </MantineProvider>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

function emptyFilter(): TraceFilter {
  return { search: '', agent_ids: [], statuses: [] };
}

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

describe('useTraceList (daemon-backed)', () => {
  beforeEach(() => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({ items: [sample, { ...sample, id: 'aitrace-2' }], total: 2 }),
      ),
    );
  });

  it('returns rows from the daemon list endpoint', async () => {
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => useTraceList(TENANT, emptyFilter()), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
  });

  it('filters by agent_ids client-side', async () => {
    const Wrapper = makeWrapper();
    const { result } = renderHook(
      () => useTraceList(TENANT, { ...emptyFilter(), agent_ids: ['aiagent-1'] }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });
    for (const t of result.current) {
      expect(t.agent_id).toBe('aiagent-1');
    }
  });

  it('passes the status filter to the daemon as a query param when exactly one status is set', async () => {
    let capturedStatus: string | null = null;
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        const url = new URL(request.url);
        capturedStatus = url.searchParams.get('status');
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    const Wrapper = makeWrapper();
    renderHook(() => useTraceList(TENANT, { ...emptyFilter(), statuses: ['error'] }), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(capturedStatus).toBe('error');
    });
  });
});

// ─── SSE live tail ───────────────────────────────────────────────────────────

interface MockEventSource {
  url: string;
  listeners: Map<string, ((ev: MessageEvent | Event) => void)[]>;
  addEventListener(name: string, fn: (ev: MessageEvent | Event) => void): void;
  removeEventListener(name: string, fn: (ev: MessageEvent | Event) => void): void;
  close(): void;
  emit(name: string, data: string, lastEventId?: string): void;
}

const eventSourceInstances: MockEventSource[] = [];

function installMockEventSource() {
  const Original = (globalThis as { EventSource?: unknown }).EventSource;
  class MockES implements MockEventSource {
    url: string;
    listeners = new Map<string, ((ev: MessageEvent | Event) => void)[]>();
    constructor(url: string, _init?: { withCredentials?: boolean }) {
      this.url = url;
      eventSourceInstances.push(this);
    }
    addEventListener(name: string, fn: (ev: MessageEvent | Event) => void) {
      const arr = this.listeners.get(name) ?? [];
      arr.push(fn);
      this.listeners.set(name, arr);
    }
    removeEventListener(name: string, fn: (ev: MessageEvent | Event) => void) {
      const arr = this.listeners.get(name);
      if (!arr) return;
      this.listeners.set(
        name,
        arr.filter((f) => f !== fn),
      );
    }
    close() {
      this.listeners.clear();
    }
    emit(name: string, data: string, lastEventId = '') {
      const ev = { data, lastEventId } as MessageEvent;
      for (const fn of this.listeners.get(name) ?? []) fn(ev);
    }
  }
  (globalThis as { EventSource?: unknown }).EventSource = MockES;
  return () => {
    (globalThis as { EventSource?: unknown }).EventSource = Original;
  };
}

describe('subscribeTraceStream (SSE)', () => {
  let restore: () => void;
  beforeEach(() => {
    eventSourceInstances.length = 0;
    restore = installMockEventSource();
  });
  afterEach(() => {
    restore();
  });

  it('fires onTrace when a JSON-encoded event lands on the topic channel', () => {
    const onTrace = vi.fn();
    const unsub = subscribeTraceStream(TENANT, onTrace);
    expect(eventSourceInstances.length).toBe(1);
    const es = eventSourceInstances[0]!;
    expect(es.url).toContain('topic=ai-traces');
    expect(es.url).toContain(TENANT);

    const payload = { ...sample, id: 'live-1' };
    es.emit('message', JSON.stringify(payload), 'evt-1');
    expect(onTrace).toHaveBeenCalledWith(expect.objectContaining({ id: 'live-1' }));

    unsub();
  });

  it('unsubscribe stops further deliveries', () => {
    const onTrace = vi.fn();
    const unsub = subscribeTraceStream(TENANT, onTrace);
    const es = eventSourceInstances[0]!;
    unsub();
    es.emit('message', JSON.stringify({ ...sample, id: 'after-unsub' }));
    expect(onTrace).not.toHaveBeenCalled();
  });
});

// ─── Viewer gating ──────────────────────────────────────────────────────────

describe('<PromptCompletionView> viewer gating', () => {
  function wrap(ui: ReactNode) {
    return render(
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>,
    );
  }

  it('redacts by default (unmasked omitted)', () => {
    wrap(<PromptCompletionView prompt="secret" completion="answer" />);
    expect(screen.getByTestId('trace-redacted')).toBeInTheDocument();
    expect(screen.queryByTestId('trace-prompt-completion')).toBeNull();
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('renders unmasked content when unmasked === true', () => {
    wrap(<PromptCompletionView prompt="hello" completion="world" unmasked />);
    expect(screen.getByTestId('trace-prompt-completion')).toBeInTheDocument();
    expect(screen.queryByTestId('trace-redacted')).toBeNull();
  });
});

