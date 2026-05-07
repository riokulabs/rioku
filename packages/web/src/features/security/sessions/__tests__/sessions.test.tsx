/**
 * Sessions feature — real-API tests.
 *
 * MSW backs every assertion, so the production code path under
 * `VITE_USE_MOCKS=false` is the one being verified. Covers:
 *   - list renders with device fingerprints (parsed from user-agent)
 *   - per-row Revoke removes a session from the rendered list
 *   - page-level Revoke-all-others keeps the current session active
 *   - parseDevice covers every fingerprint branch
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/msw-server';
import { SessionList } from '../components/list';
import { parseDevice } from '../api';

const TENANT = 'acme';
const LIST_URL = `*/api/v1/t/${TENANT}/sessions`;

interface SeededSession {
  id: string;
  userId: string;
  tenantId: string;
  ipAddress: string;
  userAgent: string;
  lastActivityAt: string;
  expiresAt: string;
  revoked: boolean;
}

const NOW = Date.now();
const TEN_MIN = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

function seed(): SeededSession[] {
  return [
    {
      id: 'sess-current',
      userId: 'user-1',
      tenantId: TENANT,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120',
      lastActivityAt: new Date(NOW - TEN_MIN).toISOString(),
      expiresAt: new Date(NOW + 7 * ONE_DAY).toISOString(),
      revoked: false,
    },
    {
      id: 'sess-other',
      userId: 'user-1',
      tenantId: TENANT,
      ipAddress: '10.0.0.2',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/121',
      lastActivityAt: new Date(NOW - ONE_HOUR).toISOString(),
      expiresAt: new Date(NOW + 7 * ONE_DAY).toISOString(),
      revoked: false,
    },
    {
      id: 'sess-cli',
      userId: 'user-1',
      tenantId: TENANT,
      ipAddress: '10.0.0.3',
      userAgent: 'rioku-cli/1.0.0',
      lastActivityAt: new Date(NOW - ONE_DAY).toISOString(),
      expiresAt: new Date(NOW + 7 * ONE_DAY).toISOString(),
      revoked: false,
    },
  ];
}

function installListHandler(initial: SeededSession[]): {
  read: () => SeededSession[];
  removeOthers: (keepId: string) => number;
  remove: (id: string) => boolean;
} {
  let store = [...initial];
  const read = () => store;
  const remove = (id: string) => {
    const before = store.length;
    store = store.filter((s) => s.id !== id);
    return store.length < before;
  };
  const removeOthers = (keepId: string) => {
    const before = store.length;
    store = store.filter((s) => s.id === keepId);
    return before - store.length;
  };

  server.use(
    http.get(LIST_URL, () => HttpResponse.json({ sessions: store })),
    http.delete(`${LIST_URL}/:id`, ({ params }) => {
      remove(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${LIST_URL}/revoke-others`, () => {
      // The daemon decides which session is current; in this test the
      // identity-bridge would normally provide it. We treat sess-current
      // as the kept session.
      removeOthers('sess-current');
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return { read, remove, removeOthers };
}

function wrap(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }) {
    return (
      <MantineProvider defaultColorScheme="dark">
        <Notifications />
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MantineProvider>
    );
  };
}

describe('SessionList — real-API', () => {
  it('renders rows with parsed device fingerprints', async () => {
    installListHandler(seed());

    const Wrapper = wrap();
    render(
      <Wrapper>
        <SessionList tenant={TENANT} currentSessionId="sess-current" />
      </Wrapper>,
    );

    // Wait for the daemon list to land.
    await waitFor(() => {
      expect(screen.getByText('Chrome')).toBeInTheDocument();
    });
    expect(screen.getByText('Firefox')).toBeInTheDocument();
    expect(screen.getByText('Rioku CLI')).toBeInTheDocument();

    // Current session badged.
    expect(screen.getByText('current')).toBeInTheDocument();

    // IPs are visible.
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.2')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.3')).toBeInTheDocument();
  });

  it('per-row Revoke removes that session from the rendered list', async () => {
    installListHandler(seed());

    const user = userEvent.setup();
    const Wrapper = wrap();
    render(
      <Wrapper>
        <SessionList tenant={TENANT} currentSessionId="sess-current" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Firefox')).toBeInTheDocument();
    });

    // Current session has no Revoke button.
    expect(screen.queryByTestId('revoke-sess-current')).not.toBeInTheDocument();

    // Revoke the Firefox session.
    const revokeFirefox = screen.getByTestId('revoke-sess-other');
    await user.click(revokeFirefox);

    // Firefox row disappears after the list invalidates + refetches.
    await waitFor(() => {
      expect(screen.queryByText('Firefox')).not.toBeInTheDocument();
    });

    // Other rows still present.
    expect(screen.getByText('Chrome')).toBeInTheDocument();
    expect(screen.getByText('Rioku CLI')).toBeInTheDocument();
  });

  it('Revoke all other sessions keeps only the current session', async () => {
    installListHandler(seed());

    const user = userEvent.setup();
    const Wrapper = wrap();
    render(
      <Wrapper>
        <SessionList tenant={TENANT} currentSessionId="sess-current" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Firefox')).toBeInTheDocument();
    });

    const revokeAll = screen.getByTestId('revoke-all-others');
    await user.click(revokeAll);

    // Firefox + CLI rows disappear, current session remains.
    await waitFor(() => {
      expect(screen.queryByText('Firefox')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Rioku CLI')).not.toBeInTheDocument();
    expect(screen.getByText('Chrome')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();

    // The page-level button hides once no other sessions remain.
    await waitFor(() => {
      expect(screen.queryByTestId('revoke-all-others')).not.toBeInTheDocument();
    });
  });

  it('renders an empty state when the daemon returns no sessions', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json({ sessions: [] })),
    );

    const Wrapper = wrap();
    render(
      <Wrapper>
        <SessionList tenant={TENANT} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('No sessions')).toBeInTheDocument();
    });
    // No revoke-all-others while list is empty.
    expect(screen.queryByTestId('revoke-all-others')).not.toBeInTheDocument();
  });

  it('renders an inline error alert when the list endpoint fails', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json({ title: 'boom' }, { status: 500 })),
    );

    const Wrapper = wrap();
    const { container } = render(
      <Wrapper>
        <SessionList tenant={TENANT} />
      </Wrapper>,
    );

    await waitFor(() => {
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(within(alert as HTMLElement).getByText(/failed to load sessions/i)).toBeInTheDocument();
    });
  });
});

describe('parseDevice', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120', 'Chrome'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/121', 'Firefox'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604', 'Safari'],
    ['rioku-cli/1.0.0', 'Rioku CLI'],
    ['curl/8.4.0', 'curl'],
    ['SomeRandomAgent/1.0', 'Unknown browser'],
    ['', 'Unknown device'],
  ])('parses %s → %s', (ua, expected) => {
    expect(parseDevice(ua)).toBe(expected);
  });
});
