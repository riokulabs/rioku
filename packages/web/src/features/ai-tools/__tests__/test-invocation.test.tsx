/**
 * <TestInvocation> — exercises the Invoke flow end-to-end through MSW.
 *
 * Asserts:
 *   - clicking Invoke posts the JSON body to /invoke and renders the output
 *   - duration + tokens-used badges render when the daemon returns them
 *   - daemon-side errors render an inline alert
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...(rest as Record<string, unknown>)}>{children}</a>
  ),
}));

let _mockPermission: (key: string) => boolean = () => true;
function setMockPermission(fn: (key: string) => boolean): void {
  _mockPermission = fn;
}
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => _mockPermission(key),
}));

vi.mock('@monaco-editor/react', () => {
  const Editor = ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
  }) => (
    <textarea
      aria-label="Tool invocation input"
      data-testid="monaco-stub"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  return { default: Editor };
});

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { TestInvocation } from '../components/test-invocation';
import {
  aiToolHandlers,
  makeTool,
  resetToolStore,
  setInvokeImpl,
} from './msw-handlers';

const TENANT = 'acme';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetToolStore([makeTool({ id: 'aitool-1', name: 'web-search' })]);
  server.use(...aiToolHandlers);
  useMockStore.getState().reset();
  seedStore(useMockStore);
  setMockPermission(() => true);
});

describe('<TestInvocation>', () => {
  it('renders the invocation output with duration and tokens', async () => {
    setInvokeImpl((id, body) => ({
      ok: true,
      output: { tool: id, echoed: body },
      duration_ms: 42,
      tokens_used: 137,
    }));

    wrap(<TestInvocation tenant={TENANT} toolId="aitool-1" />);

    const editor = await screen.findByTestId('monaco-stub');
    fireEvent.change(editor, { target: { value: '{"q":"hello"}' } });

    fireEvent.click(screen.getByTestId('invoke-button'));

    await waitFor(() => {
      expect(screen.getByTestId('invoke-result')).toBeInTheDocument();
    });
    expect(screen.getByTestId('invoke-output').textContent).toContain('"echoed"');
    expect(screen.getByTestId('invoke-output').textContent).toContain('"q": "hello"');
    expect(screen.getByTestId('invoke-duration').textContent).toContain('42');
    expect(screen.getByTestId('invoke-tokens').textContent).toContain('137');
  });

  it('renders an error when the daemon returns ok=false', async () => {
    setInvokeImpl(() => ({
      ok: false,
      error: 'upstream timed out',
    }));

    wrap(<TestInvocation tenant={TENANT} toolId="aitool-1" />);
    const editor = await screen.findByTestId('monaco-stub');
    fireEvent.change(editor, { target: { value: '{}' } });
    fireEvent.click(screen.getByTestId('invoke-button'));

    await waitFor(() => {
      expect(screen.getByTestId('invoke-result-error')).toHaveTextContent(
        'upstream timed out',
      );
    });
  });

  it('renders a network error when the request fails', async () => {
    setInvokeImpl(() => new Response(null, { status: 500, statusText: 'boom' }));

    wrap(<TestInvocation tenant={TENANT} toolId="aitool-1" />);
    const editor = await screen.findByTestId('monaco-stub');
    fireEvent.change(editor, { target: { value: '{}' } });
    fireEvent.click(screen.getByTestId('invoke-button'));

    await waitFor(() => {
      expect(screen.getByTestId('invoke-call-error')).toBeInTheDocument();
    });
  });

  it('rejects non-object JSON before sending', async () => {
    wrap(<TestInvocation tenant={TENANT} toolId="aitool-1" />);
    const editor = await screen.findByTestId('monaco-stub');
    fireEvent.change(editor, { target: { value: '[1,2,3]' } });
    fireEvent.click(screen.getByTestId('invoke-button'));

    await waitFor(() => {
      expect(screen.getByTestId('invoke-parse-error')).toHaveTextContent(
        /JSON object/i,
      );
    });
  });

  it('viewers cannot invoke (button disabled)', async () => {
    setMockPermission(() => false);

    wrap(<TestInvocation tenant={TENANT} toolId="aitool-1" />);
    const btn = await screen.findByTestId('invoke-button');
    expect(btn).toBeDisabled();
  });
});
