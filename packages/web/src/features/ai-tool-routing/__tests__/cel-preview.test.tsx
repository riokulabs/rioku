/**
 * CEL preview — daemon-backed integration. Asserts that the CEL preview
 * surface (api.previewCondition + the full-page CEL preview tab) round-
 * trips against the daemon's `/preview-condition` endpoint and renders
 * matched / error correctly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  createFileRoute: () => () => ({}),
}));

// The real Monaco editor is unusable in jsdom — replace with a textarea so
// we can simulate user input without booting the heavy widget.
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (v: string | undefined) => void;
  }) => (
    <textarea
      aria-label="cel-editor-monaco-stub"
      value={value}
      onChange={(e) => {
        onChange?.(e.currentTarget.value);
      }}
    />
  ),
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { previewCondition } from '../api';
import { BindingFullPage } from '../components/full-page';
import {
  aiToolBindingHandlers,
  makeAgent,
  makeBinding,
  makeTool,
  resetAgentToolStores,
  resetBindingStore,
} from './msw-handlers';

const TENANT = 'acme';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <Notifications />
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetBindingStore([makeBinding({ id: 'bnd-1', agentId: 'aiagent-1', toolId: 'aitool-1' })]);
  resetAgentToolStores({
    agents: [makeAgent({ id: 'aiagent-1', name: 'Agent A' })],
    tools: [makeTool({ id: 'aitool-1', name: 'tool-a' })],
  });
  server.use(...aiToolBindingHandlers);
});

describe('previewCondition — daemon round-trip', () => {
  it('returns matched=true when the daemon evaluates the condition truthily', async () => {
    const result = await previewCondition(TENANT, 'request.user.role == "admin"', {
      request: { user: { role: 'admin' } },
    });
    expect(result.parses).toBe(true);
    expect(result.sample_result).toBe(true);
  });

  it('returns matched=false for a syntactically valid expression that does not match', async () => {
    const result = await previewCondition(TENANT, 'request.user.role == "guest"', {});
    expect(result.parses).toBe(true);
    expect(result.sample_result).toBe(false);
  });

  it('returns parses=false with an error string when the daemon reports a syntax error', async () => {
    // Unbalanced parens is the heuristic the test handler uses to surface a 400.
    const result = await previewCondition(TENANT, 'request.user.role == "admin"(', {});
    expect(result.parses).toBe(false);
    expect(typeof result.error).toBe('string');
    expect((result.error ?? '').length).toBeGreaterThan(0);
  });

  it('short-circuits empty conditions to matched=true without hitting the daemon', async () => {
    const result = await previewCondition(TENANT, '', {});
    expect(result.parses).toBe(true);
    expect(result.sample_result).toBe(true);
  });
});

describe('<BindingFullPage> CEL preview tab', () => {
  it('previewing a matching condition renders Matched: true', async () => {
    const user = userEvent.setup();
    wrap(<BindingFullPage tenantId={TENANT} bindingId="bnd-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Tool binding/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /CEL preview/i }));

    const editor = await screen.findByLabelText('cel-editor-monaco-stub');
    await user.clear(editor);
    await user.type(editor, 'request.user.role == "admin"');

    await user.click(screen.getByRole('button', { name: /Preview/i }));

    await waitFor(() => {
      const result = screen.getByTestId('cel-preview-result');
      expect(result).toHaveTextContent(/Matched: true/i);
    });
  });

  it('previewing a syntactically broken condition surfaces the daemon error', async () => {
    const user = userEvent.setup();
    wrap(<BindingFullPage tenantId={TENANT} bindingId="bnd-1" />);

    await user.click(await screen.findByRole('tab', { name: /CEL preview/i }));

    const editor = await screen.findByLabelText('cel-editor-monaco-stub');
    await user.clear(editor);
    await user.type(editor, '(invalid');

    await user.click(screen.getByRole('button', { name: /Preview/i }));

    await waitFor(() => {
      const err = screen.getByTestId('cel-preview-error');
      expect(err).toHaveTextContent(/Error/i);
    });
  });
});
