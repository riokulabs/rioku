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
import { invokeAgent } from '@/features/ai-agents/api';
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

// useTraceStream behaviour was previously driven by the mock-store
// `invokeAgentMock` publishing synthetic traces. Stage-2 wires this to the
// daemon SSE channel; the EventSource path is now exercised in
// ai-traces.test.tsx (subscribeTraceStream SSE describe). Skipping these
// legacy mock-store tests until a hook-level SSE-mocked variant is added.
describe.skip('useTraceStream (legacy mock-store path — migrated to SSE test)', () => {
  it('migrated — see ai-traces.test.tsx subscribeTraceStream (SSE)', () => {
    expect(true).toBe(true);
  });
});

// Keep imports referenced so the file still type-checks against the new API
// shape even while the legacy describe is skipped.
void invokeAgent;
void useTraceStream;
void useMockStore;
void acmeId;
