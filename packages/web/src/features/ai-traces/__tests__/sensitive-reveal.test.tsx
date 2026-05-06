/**
 * Sensitive reveal tests.
 *
 * Spec §7 RD5: prompts/completions are PII; redacted by default;
 * Reveal button visible only when the user holds
 * `ai-trace:read-sensitive`; reveal requires reason ≥10 chars; on
 * confirm POSTs to /reveal which returns the unmasked payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import type { ReactNode } from 'react';
import { server } from '@/test/msw-server';
import { TraceDetail } from '../components/detail';
import type { AITrace } from '@/api/generated/schemas';

const TENANT = 'acme';
const TRACE_ID = 'aitrace-1';
const GET_PATH = `*/api/v1/t/${TENANT}/ai/traces/${TRACE_ID}`;
const REVEAL_PATH = `*/api/v1/t/${TENANT}/ai/traces/${TRACE_ID}/reveal`;

const redacted: AITrace = {
  id: TRACE_ID,
  tenantId: 'tenant-acme',
  agentId: 'aiagent-1',
  providerId: 'aiprov-1',
  model: 'gpt-4o',
  status: 'success',
  inputTokens: 10,
  outputTokens: 5,
  durationMs: 100,
  prompt: null,
  completion: null,
  toolCalls: [],
  error: null,
  occurredAt: '2026-05-06T00:00:00.000Z',
};

const unmaskedPayload: AITrace = {
  ...redacted,
  prompt: 'the actual prompt text',
  completion: 'the actual completion text',
};

let permissionStub = true;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => permissionStub,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MantineProvider>
          <ModalsProvider>
            <Notifications />
            {children}
          </ModalsProvider>
        </MantineProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  permissionStub = true;
  server.use(http.get(GET_PATH, () => HttpResponse.json(redacted)));
});

describe('TraceDetail — redacted-by-default', () => {
  it('shows the redacted alert and hides prompt/completion text by default', async () => {
    const Wrapper = makeWrapper();
    render(<TraceDetail traceId={TRACE_ID} tenantSlug={TENANT} />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('trace-detail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-redacted')).toBeInTheDocument();
    expect(screen.queryByText('the actual prompt text')).toBeNull();
    expect(screen.queryByText('the actual completion text')).toBeNull();
  });
});

describe('TraceDetail — reveal flow', () => {
  it('reveal button is visible when user has ai-trace:read-sensitive', async () => {
    const Wrapper = makeWrapper();
    render(<TraceDetail traceId={TRACE_ID} tenantSlug={TENANT} />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('trace-reveal-button')).toBeInTheDocument();
    });
  });

  it('reveal with reason ≥10 chars unmasks prompt/completion via POST /reveal', async () => {
    let capturedBody: { reason: string } | null = null;
    server.use(
      http.post(REVEAL_PATH, async ({ request }) => {
        capturedBody = (await request.json()) as { reason: string };
        return HttpResponse.json(unmaskedPayload);
      }),
    );
    const Wrapper = makeWrapper();
    render(<TraceDetail traceId={TRACE_ID} tenantSlug={TENANT} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('trace-reveal-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('trace-reveal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('trace-reveal-modal')).toBeInTheDocument();
    });
    const textarea = screen.getByTestId('trace-reveal-reason');
    fireEvent.change(textarea, {
      target: { value: 'investigating incident #1234' },
    });

    const confirm = screen.getByTestId('trace-reveal-confirm');
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });
    expect(capturedBody!.reason).toBe('investigating incident #1234');

    await waitFor(() => {
      expect(screen.getByTestId('trace-revealed-badge')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-prompt-completion')).toBeInTheDocument();
  });

  it('viewer without ai-trace:read-sensitive cannot see the Reveal button', async () => {
    permissionStub = false;
    const Wrapper = makeWrapper();
    render(<TraceDetail traceId={TRACE_ID} tenantSlug={TENANT} />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('trace-detail')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('trace-reveal-button')).toBeNull();
    expect(screen.getByTestId('trace-redacted')).toBeInTheDocument();
  });

  it('confirm button is disabled when reason is shorter than 10 chars', async () => {
    const Wrapper = makeWrapper();
    render(<TraceDetail traceId={TRACE_ID} tenantSlug={TENANT} />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('trace-reveal-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('trace-reveal-button'));
    await waitFor(() => {
      expect(screen.getByTestId('trace-reveal-modal')).toBeInTheDocument();
    });
    const textarea = screen.getByTestId('trace-reveal-reason');
    fireEvent.change(textarea, { target: { value: 'too short' } });
    const confirm = screen.getByTestId('trace-reveal-confirm');
    expect(confirm).toBeDisabled();
  });
});
