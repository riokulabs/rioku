/**
 * Tests for <InvokePanel> — verifies SSE stream rendering, error handling,
 * and abort. Backed by MSW handlers that emit real `event:` frames.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { InvokePanel } from '../components/invoke-panel';
import {
  aiAgentHandlers,
  invokeErrorHandler,
  invokeSlowHandler,
  makeAgent,
  resetAgentStore,
} from './msw-handlers';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  resetAgentStore([makeAgent({ id: 'aiagent-a', name: 'Streamer' })]);
  server.use(...aiAgentHandlers);
});

describe('<InvokePanel> SSE streaming', () => {
  it('renders streaming chunks then summary on done', async () => {
    wrap(<InvokePanel tenant="acme" agentId="aiagent-a" />);

    const promptArea = screen.getByLabelText('Prompt');
    fireEvent.change(promptArea, { target: { value: 'hello' } });
    const btn = screen.getByRole('button', { name: /Invoke/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    // Chunks 1+2 concatenated → "Hello world."
    await waitFor(() => {
      expect(screen.getByTestId('invoke-output')).toBeInTheDocument();
      const out = screen.getByTestId('invoke-output');
      expect(out.textContent).toContain('Hello world.');
    });

    // Done summary surfaces latency.
    await waitFor(() => {
      expect(screen.getByText(/42ms/)).toBeInTheDocument();
    });
  });

  it('shows error alert when daemon returns non-2xx', async () => {
    server.use(invokeErrorHandler);
    wrap(<InvokePanel tenant="acme" agentId="aiagent-a" />);

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'fail' } });
    fireEvent.click(screen.getByRole('button', { name: /Invoke/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Invocation failed/i)).toBeInTheDocument();
    });
  });

  it('aborts an in-flight stream and surfaces the Aborted state', async () => {
    server.use(invokeSlowHandler);
    wrap(<InvokePanel tenant="acme" agentId="aiagent-a" />);

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'slow' } });
    fireEvent.click(screen.getByRole('button', { name: /Invoke/i }));

    // Wait until streaming starts (Abort button appears) and the first chunk lands.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Abort/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Abort/i }));

    await waitFor(() => {
      expect(screen.getByText(/Aborted/i)).toBeInTheDocument();
    });
  });

  it('rejects malformed variables JSON before invoking', () => {
    wrap(<InvokePanel tenant="acme" agentId="aiagent-a" />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'p' } });
    fireEvent.change(screen.getByLabelText('Variables'), {
      target: { value: '{not json' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Invoke/i }));
    // Synchronous error → input shows error.
    expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
  });
});
