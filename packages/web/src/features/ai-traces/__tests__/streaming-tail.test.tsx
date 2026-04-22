/**
 * Unit tests for <LiveTailBadge> + useTraceStream.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, renderHook, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { invokeAgentMock } from '@/features/ai-agents/api';
import { LiveTailBadge, useTraceStream } from '../components/streaming-tail';

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

function acmeId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant');
  return acme.id;
}

describe('LiveTailBadge', () => {
  it('renders "LIVE" with 0 counter', () => {
    wrap(<LiveTailBadge liveCount={0} />);
    const badge = screen.getByTestId('trace-live-badge');
    expect(badge.textContent).toContain('LIVE');
    expect(badge.textContent).not.toContain('+');
  });

  it('renders the counter when liveCount > 0', () => {
    wrap(<LiveTailBadge liveCount={5} />);
    const badge = screen.getByTestId('trace-live-badge');
    expect(badge.textContent).toContain('LIVE');
    expect(badge.textContent).toContain('+5');
  });
});

describe('useTraceStream', () => {
  it('invokes onTrace when a trace is published while enabled', async () => {
    const tenantId = acmeId();
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    );
    if (!agent) throw new Error('No agent seeded');

    const onTrace = vi.fn();
    renderHook(() => {
      useTraceStream(tenantId, true, onTrace);
    });

    await invokeAgentMock(agent.id, { prompt: 'live-tail test' });
    expect(onTrace).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onTrace when disabled', async () => {
    const tenantId = acmeId();
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    );
    if (!agent) throw new Error('No agent seeded');

    const onTrace = vi.fn();
    renderHook(() => {
      useTraceStream(tenantId, false, onTrace);
    });

    await invokeAgentMock(agent.id, { prompt: 'no-tail test' });
    expect(onTrace).not.toHaveBeenCalled();
  });

  it('unsubscribes cleanly on unmount', async () => {
    const tenantId = acmeId();
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    );
    if (!agent) throw new Error('No agent seeded');

    const onTrace = vi.fn();
    const hook = renderHook(() => {
      useTraceStream(tenantId, true, onTrace);
    });
    await invokeAgentMock(agent.id, { prompt: 'first' });
    hook.unmount();
    await invokeAgentMock(agent.id, { prompt: 'second' });
    expect(onTrace).toHaveBeenCalledTimes(1);
  });
});
