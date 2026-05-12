/**
 * Unit tests for <InstallProgressModal> — Stage-2.
 *
 * The Stage-2 modal subscribes to a real daemon SSE stream. We
 * intercept the install POST with MSW, polyfill EventSource, and
 * drive the modal by emitting events on the stub stream.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { InstallProgressModal } from '../components/install-progress-modal';
import type { ApprovalCandidate } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

let activeFakeES: StubEventSource | null = null;

class StubEventSource {
  url: string;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeFakeES = this;
  }
  addEventListener(name: string, fn: (ev: MessageEvent) => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  close(): void {
    this.closed = true;
  }
  emit(name: string, payload: unknown): void {
    const fns = this.listeners[name] ?? [];
    const ev = { data: JSON.stringify(payload), type: name } as unknown as MessageEvent;
    for (const f of fns) f(ev);
  }
}

const RealEventSource = globalThis.EventSource;

const CANDIDATE: ApprovalCandidate = {
  slug: 'com.example.stream',
  display_name: 'Stream Plugin',
  version: '1.0.0',
  parts: ['admin'],
  declared_permissions: ['com.example.stream:read'],
  reference: 'oci://demo/stream',
};

beforeEach(() => {
  server.resetHandlers();
  activeFakeES = null;
  // @ts-expect-error - test stub
  globalThis.EventSource = StubEventSource;
  server.use(
    http.post('/api/v1/t/tenant-1/plugins/install', () =>
      HttpResponse.json({ installId: 'install-1', status: 'queued' }, { status: 202 }),
    ),
  );
});

afterEach(() => {
  globalThis.EventSource = RealEventSource;
});

async function waitForES(): Promise<StubEventSource> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      if (activeFakeES) {
        resolve(activeFakeES);
        return;
      }
      if (Date.now() - t0 > 1500) {
        reject(new Error('timeout waiting for EventSource'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('<InstallProgressModal> (real daemon SSE)', () => {
  it('renders all four stage chips with accessibility hooks', () => {
    wrap(
      <InstallProgressModal
        candidate={CANDIDATE}
        opened={true}
        tenantSlug="tenant-1"
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId('install-progress-stage-fetching')).toBeTruthy();
    expect(screen.getByTestId('install-progress-stage-verifying')).toBeTruthy();
    expect(screen.getByTestId('install-progress-stage-building')).toBeTruthy();
    expect(screen.getByTestId('install-progress-stage-swapping')).toBeTruthy();
    const log = screen.getByTestId('install-progress-log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });

  it('calls onComplete and shows success state on a `complete` SSE event', async () => {
    const onComplete = vi.fn();
    wrap(
      <InstallProgressModal
        candidate={CANDIDATE}
        opened={true}
        tenantSlug="tenant-1"
        onClose={vi.fn()}
        onComplete={onComplete}
      />,
    );

    const es = await waitForES();
    // eslint-disable-next-line @typescript-eslint/require-await
    await act(async () => {
      es.emit('progress', { stage: 'fetching', progress: 20, message: 'fetch...' });
      es.emit('complete', { plugin: { id: 'plugin-installed-x' } });
    });

    await waitFor(() => screen.getByText(/Installed successfully/i));
    await waitFor(
      () => {
        expect(onComplete).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
    const pluginId = onComplete.mock.calls[0]?.[0] as string | undefined;
    expect(pluginId).toBe('plugin-installed-x');
  });

  it('shows the failure alert + "View build log" button on a `failed` SSE event', async () => {
    const onViewLog = vi.fn();
    wrap(
      <InstallProgressModal
        candidate={CANDIDATE}
        opened={true}
        tenantSlug="tenant-1"
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onViewLog={onViewLog}
      />,
    );

    const es = await waitForES();
    // eslint-disable-next-line @typescript-eslint/require-await
    await act(async () => {
      es.emit('failed', {
        stage: 'building',
        message: 'compile error',
        log: '[error] xcaddy failed',
      });
    });

    await waitFor(() => screen.getByRole('button', { name: /View build log/i }));
    const alerts = screen.getAllByRole('alert');
    const failedAlert = alerts.find((a) =>
      /Install failed/i.test(a.textContent),
    );
    expect(failedAlert).toBeTruthy();
  });
});
