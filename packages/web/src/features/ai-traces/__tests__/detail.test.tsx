/**
 * Unit tests for <TraceDetail>, <PromptCompletionView>, <ToolCallList>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { TraceDetail } from '../components/detail';
import { PromptCompletionView } from '../components/prompt-completion-view';
import { ToolCallList } from '../components/tool-call-list';
import type { AiTraceToolCall } from '@/api/resources/types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function firstAcmeTrace() {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant');
  const trace = Object.values(useMockStore.getState().aiTraces).find(
    (t) => t.tenant_id === acme.id,
  );
  if (!trace) throw new Error('No trace seeded');
  return trace;
}

describe('TraceDetail', () => {
  it('renders header with agent + status chip', () => {
    const trace = firstAcmeTrace();
    wrap(<TraceDetail traceId={trace.id} tenantSlug="acme" onClose={vi.fn()} />);
    // Status chip
    expect(screen.getAllByText(trace.status).length).toBeGreaterThan(0);
    // Agent name
    const agent = useMockStore.getState().aiAgents[trace.agent_id];
    if (agent) {
      expect(screen.getByText(agent.name)).toBeInTheDocument();
    }
  });

  it('surfaces the error alert when status === "error"', () => {
    const errTrace = Object.values(useMockStore.getState().aiTraces).find(
      (t) => t.status === 'error' && t.error_message,
    );
    if (!errTrace) return;
    wrap(<TraceDetail traceId={errTrace.id} tenantSlug="acme" onClose={vi.fn()} />);
    expect(screen.getByTestId('trace-error-alert')).toBeInTheDocument();
  });

  it('shows "not found" alert for unknown trace', () => {
    wrap(<TraceDetail traceId="nonexistent" tenantSlug="acme" onClose={vi.fn()} />);
    expect(screen.getByText(/trace not found/i)).toBeInTheDocument();
  });
});

describe('PromptCompletionView', () => {
  it('renders prompt + completion when user has ai-trace:read-sensitive', () => {
    wrap(<PromptCompletionView prompt="hello world" completion="world!" />);
    expect(screen.getByTestId('trace-prompt-completion')).toBeInTheDocument();
  });

  it('renders a redacted placeholder when user lacks ai-trace:read-sensitive', () => {
    useMockStore.setState({ currentUserId: null });
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
