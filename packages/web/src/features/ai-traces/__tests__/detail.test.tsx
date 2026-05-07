/**
 * Unit tests for <TraceDetail>, <PromptCompletionView>, <ToolCallList>.
 *
 * Stage-2: <TraceDetail> is daemon-backed via Orval `useGetAITrace`. Tests
 * stub the GET handler with MSW and provide a QueryClientProvider. The
 * legacy mock-store path is retired; the only behaviour kept here is
 * surface coverage for the not-found alert, the error alert, the basic
 * header render, plus PromptCompletionView gating + ToolCallList.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { TraceDetail } from '../components/detail';
import { PromptCompletionView } from '../components/prompt-completion-view';
import { ToolCallList } from '../components/tool-call-list';
import type { AiTraceToolCall } from '@/api/resources';
import type { AITrace } from '@/api/generated/schemas';

const TENANT = 'acme';
const TRACE_ID = 'aitrace-1';
const GET_PATH = `*/api/v1/t/${TENANT}/ai/traces/:id`;

const baseTrace: AITrace = {
  id: TRACE_ID,
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

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('TraceDetail', () => {
  beforeEach(() => {
    server.use(http.get(GET_PATH, () => HttpResponse.json(baseTrace)));
  });

  it('renders header with agent + status chip', async () => {
    wrap(<TraceDetail traceId={TRACE_ID} tenantSlug={TENANT} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-detail')).toBeInTheDocument();
    });
    // Status chip ("success") + agent id are surfaced in the header.
    expect(screen.getAllByText('success').length).toBeGreaterThan(0);
    expect(screen.getByText('aiagent-1')).toBeInTheDocument();
  });

  it('surfaces the error alert when status === "error"', async () => {
    server.use(
      http.get(GET_PATH, () =>
        HttpResponse.json({
          ...baseTrace,
          status: 'error',
          error: 'upstream timeout',
        }),
      ),
    );
    wrap(<TraceDetail traceId={TRACE_ID} tenantSlug={TENANT} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-error-alert')).toBeInTheDocument();
    });
  });

  it('shows "trace not found" alert when the daemon returns 404', async () => {
    server.use(http.get(GET_PATH, () => new HttpResponse(null, { status: 404 })));
    wrap(<TraceDetail traceId="nonexistent" tenantSlug={TENANT} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-not-found')).toBeInTheDocument();
    });
    expect(screen.getByText(/trace not found/i)).toBeInTheDocument();
  });
});

describe('PromptCompletionView', () => {
  it('renders prompt + completion when unmasked === true', () => {
    wrap(<PromptCompletionView prompt="hello world" completion="world!" unmasked />);
    expect(screen.getByTestId('trace-prompt-completion')).toBeInTheDocument();
  });

  it('renders a redacted placeholder when unmasked is omitted', () => {
    wrap(<PromptCompletionView prompt="hello" completion="world" />);
    expect(screen.getByTestId('trace-redacted')).toBeInTheDocument();
    expect(screen.queryByTestId('trace-prompt-completion')).toBeNull();
  });
});

describe('ToolCallList', () => {
  const sampleCalls: AiTraceToolCall[] = [
    {
      tool_id: 'tool-a',
      tool_name: 'search_docs',
      arguments: { query: 'rioku' },
      result: { hits: 3 },
      latency_ms: 42,
      status: 'success',
    },
    {
      tool_id: 'tool-b',
      tool_name: 'run_query',
      arguments: { sql: 'SELECT 1' },
      result: null,
      latency_ms: 1200,
      status: 'error',
      error_message: 'connection reset',
    },
  ];

  it('renders one Timeline entry per tool call', () => {
    wrap(<ToolCallList calls={sampleCalls} />);
    expect(screen.getByTestId('tool-call-timeline')).toBeInTheDocument();
    expect(screen.getAllByText(/search_docs|run_query/).length).toBeGreaterThan(0);
  });

  it('shows error_message when a call fails', () => {
    wrap(<ToolCallList calls={sampleCalls} />);
    expect(screen.getByText('connection reset')).toBeInTheDocument();
  });

  it('renders an empty-state note when there are no calls', () => {
    wrap(<ToolCallList calls={[]} />);
    expect(screen.getByText(/no tool calls/i)).toBeInTheDocument();
  });
});
