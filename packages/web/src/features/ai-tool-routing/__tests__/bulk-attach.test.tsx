/**
 * <BulkAttachModal> — multi-select + bulk POST coverage.
 *
 * Verifies:
 *   - Modal lists agents and tools fetched from the daemon
 *   - Selecting agents × tools and clicking Attach POSTs once per agent
 *     to `/ai/tool-bindings/bulk-attach` with the chosen tool ids
 *   - The MSW store reflects the new bindings (idempotent fan-out)
 *   - Existing (agent, tool) pairs are skipped server-side
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  createFileRoute: () => () => ({}),
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { BulkAttachModal } from '../components/bulk-attach';
import { bulkAttachToolsToAgent } from '../api';
import {
  aiToolBindingHandlers,
  makeAgent,
  makeBinding,
  makeTool,
  readBindingStore,
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
  resetBindingStore();
  resetAgentToolStores({
    agents: [
      makeAgent({ id: 'aiagent-1', name: 'Agent Alpha' }),
      makeAgent({ id: 'aiagent-2', name: 'Agent Beta' }),
    ],
    tools: [
      makeTool({ id: 'aitool-1', name: 'tool-alpha' }),
      makeTool({ id: 'aitool-2', name: 'tool-beta' }),
      makeTool({ id: 'aitool-3', name: 'tool-gamma' }),
    ],
  });
  server.use(...aiToolBindingHandlers);
});

describe('bulkAttachToolsToAgent — daemon API', () => {
  it('creates bindings for all (agent, tool) pairs and is idempotent', async () => {
    const created = await bulkAttachToolsToAgent(TENANT, 'aiagent-1', ['aitool-1', 'aitool-2']);
    expect(created.length).toBe(2);

    // Second call with the same pairs creates no new bindings.
    const second = await bulkAttachToolsToAgent(TENANT, 'aiagent-1', ['aitool-1', 'aitool-2']);
    expect(second.length).toBe(0);

    const all = Object.values(readBindingStore());
    expect(all.length).toBe(2);
  });
});

describe('<BulkAttachModal> integration', () => {
  it('multi-select agents + tools and submit fans out one POST per agent', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onClose = vi.fn();

    wrap(<BulkAttachModal tenantId={TENANT} opened onClose={onClose} onComplete={onComplete} />);

    // Wait for the agent + tool refs to populate (fetched from MSW).
    await waitFor(() => {
      expect(screen.getByText(/up to 0 binding/i)).toBeInTheDocument();
    });

    const agentInput = screen.getByLabelText(/Select agents to bulk-attach/i);
    await user.click(agentInput);
    await user.click(await screen.findByText('Agent Alpha'));
    await user.click(await screen.findByText('Agent Beta'));

    const toolInput = screen.getByLabelText(/Select tools to bulk-attach/i);
    await user.click(toolInput);
    await user.click(await screen.findByText('tool-alpha'));
    await user.click(await screen.findByText('tool-beta'));
    await user.click(await screen.findByText('tool-gamma'));

    // Plan reflects 2 × 3 = 6 bindings.
    await waitFor(() => {
      expect(screen.getByTestId('bulk-attach-plan')).toHaveTextContent(/up to 6 bindings/i);
    });

    await user.click(screen.getByRole('button', { name: /^Attach$/i }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    const summary = onComplete.mock.calls[0]?.[0] as {
      attached: number;
      agents: number;
      tools: number;
    };
    expect(summary.agents).toBe(2);
    expect(summary.tools).toBe(3);
    expect(summary.attached).toBe(6);

    // 6 bindings landed in the daemon store.
    expect(Object.values(readBindingStore())).toHaveLength(6);

    // Modal closed itself after the bulk-attach.
    expect(onClose).toHaveBeenCalled();
  });

  it('skips already-bound (agent, tool) pairs server-side', async () => {
    // Pre-seed one binding for Agent Alpha + tool-alpha.
    resetBindingStore([
      makeBinding({ id: 'bnd-existing', agentId: 'aiagent-1', toolId: 'aitool-1' }),
    ]);
    server.use(...aiToolBindingHandlers);

    const user = userEvent.setup();
    const onComplete = vi.fn();

    wrap(<BulkAttachModal tenantId={TENANT} opened onClose={vi.fn()} onComplete={onComplete} />);

    await waitFor(() => {
      expect(screen.getByText(/up to 0 binding/i)).toBeInTheDocument();
    });

    const agentInput = screen.getByLabelText(/Select agents to bulk-attach/i);
    await user.click(agentInput);
    await user.click(await screen.findByText('Agent Alpha'));

    const toolInput = screen.getByLabelText(/Select tools to bulk-attach/i);
    await user.click(toolInput);
    await user.click(await screen.findByText('tool-alpha'));
    await user.click(await screen.findByText('tool-beta'));

    await user.click(screen.getByRole('button', { name: /^Attach$/i }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    const summary = onComplete.mock.calls[0]?.[0] as { attached: number };
    // Only tool-beta was new — tool-alpha was already bound.
    expect(summary.attached).toBe(1);

    const all = Object.values(readBindingStore());
    expect(all).toHaveLength(2);
  });
});
