/**
 * Unit tests for <InstallProgressModal> (Plan 6, Task 6b.4).
 *
 * Uses fake timers to drive the streaming emitter deterministically.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
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

/** djb2 mirror used to find a deterministic-success ref. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function findSuccessRef(): string {
  for (let i = 0; i < 2000; i++) {
    const candidate = `oci://ok/${String(i)}`;
    if (djb2(candidate) % 10 !== 0) return candidate;
  }
  throw new Error('no non-failing ref found — hash distribution unexpectedly skewed');
}

function findFailureRef(): string {
  for (let i = 0; i < 2000; i++) {
    const candidate = `oci://fail/${String(i)}`;
    if (djb2(candidate) % 10 === 0) return candidate;
  }
  throw new Error('no failing ref found');
}

const SUCCESS_CANDIDATE: ApprovalCandidate = {
  slug: 'com.example.stream',
  display_name: 'Stream Plugin',
  version: '1.0.0',
  parts: ['admin'],
  declared_permissions: ['com.example.stream:read'],
  reference: findSuccessRef(),
};

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('<InstallProgressModal>', () => {
  it('renders all four stage chips with accessibility hooks', () => {
    wrap(
      <InstallProgressModal
        candidate={SUCCESS_CANDIDATE}
        opened={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId('install-progress-stage-fetching')).toBeTruthy();
    expect(screen.getByTestId('install-progress-stage-verifying')).toBeTruthy();
    expect(screen.getByTestId('install-progress-stage-building')).toBeTruthy();
    expect(screen.getByTestId('install-progress-stage-swapping')).toBeTruthy();
    // Log is an aria-live region.
    const log = screen.getByTestId('install-progress-log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });

  it('calls onComplete (after dwell) and shows success state on a success run', async () => {
    const onComplete = vi.fn();
    wrap(
      <InstallProgressModal
        candidate={SUCCESS_CANDIDATE}
        opened={true}
        onClose={vi.fn()}
        onComplete={onComplete}
      />,
    );

    // Drive the streaming emitter to terminal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // Success alert appears.
    expect(screen.getByText(/Installed successfully/i)).toBeTruthy();

    // Dwell timer fires onComplete after ~1.5s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(onComplete).toHaveBeenCalledOnce();
    const pluginId = onComplete.mock.calls[0]?.[0] as string | undefined;
    expect(typeof pluginId).toBe('string');
    expect(pluginId).toMatch(/plugin-installed/);
  });

  it('shows the failure alert + "View build log" button on a failed run', async () => {
    const failCandidate: ApprovalCandidate = {
      ...SUCCESS_CANDIDATE,
      slug: 'com.example.fail',
      reference: findFailureRef(),
    };
    const onViewLog = vi.fn();
    wrap(
      <InstallProgressModal
        candidate={failCandidate}
        opened={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onViewLog={onViewLog}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // Error alert with stage in title.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Install failed/i);
    expect(screen.getByRole('button', { name: /View build log/i })).toBeTruthy();
  });
});
