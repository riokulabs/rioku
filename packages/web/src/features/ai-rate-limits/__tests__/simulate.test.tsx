/**
 * Stage-2 tests for the <Simulator> component (probe-style).
 *
 * Covers both branches of the response surface:
 *   - would_throttle=true   — daemon reports the probe exceeds the limit;
 *                             the badge flips to "Would throttle" and the
 *                             retry-after hint appears.
 *   - would_throttle=false  — daemon clears the probe; the badge reads
 *                             "Within limit" and retry_after_ms is 0.
 *
 * The fetch path is mocked via MSW; we don't reach into the Orval client
 * directly to keep the contract close to production.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { Simulator } from '../components/simulator';

const TENANT = 'tenant_acme';
const RULE_ID = 'rl-1';
const SIMULATE_URL = `*/api/v1/t/${TENANT}/ai/rate-limits/${RULE_ID}/simulate`;

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  server.resetHandlers();
});

describe('<Simulator>', () => {
  it('renders would_throttle=true and the retry hint when the probe exceeds the limit', async () => {
    server.use(
      http.post(SIMULATE_URL, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        // Sanity-check the body shape so we know the form wired correctly.
        expect(body.request_count).toBe(50);
        expect(body.time_window_seconds).toBe(60);
        expect(body.principal).toBe('user-2');
        return HttpResponse.json({
          rate_limit_id: RULE_ID,
          principal: 'user-2',
          would_throttle: true,
          retry_after_ms: 60_000,
          current_consumption: 50,
          limit: 10,
        });
      }),
    );

    wrap(<Simulator tenantId={TENANT} ruleId={RULE_ID} />);

    // Form defaults: request_count=50, window=60 — set the principal then run.
    fireEvent.change(screen.getByLabelText(/Principal/i), {
      target: { value: 'user-2' },
    });
    fireEvent.click(screen.getByTestId('simulator-run'));

    await waitFor(() => {
      expect(screen.getByTestId('simulator-result')).toBeInTheDocument();
    });
    expect(screen.getByTestId('simulator-would-throttle').textContent).toMatch(
      /Would throttle/i,
    );
    expect(screen.getByTestId('simulator-result-throttle').textContent).toBe('true');
    expect(screen.getByText(/retry after 60000ms/i)).toBeInTheDocument();
  });

  it('renders would_throttle=false when the probe stays within the limit', async () => {
    server.use(
      http.post(SIMULATE_URL, () =>
        HttpResponse.json({
          rate_limit_id: RULE_ID,
          principal: 'user-1',
          would_throttle: false,
          retry_after_ms: 0,
          current_consumption: 3,
          limit: 10,
        }),
      ),
    );

    wrap(<Simulator tenantId={TENANT} ruleId={RULE_ID} />);
    fireEvent.click(screen.getByTestId('simulator-run'));

    await waitFor(() => {
      expect(screen.getByTestId('simulator-result')).toBeInTheDocument();
    });
    expect(screen.getByTestId('simulator-would-throttle').textContent).toMatch(
      /Within limit/i,
    );
    expect(screen.getByTestId('simulator-result-throttle').textContent).toBe('false');
    // Should NOT show retry-after hint when the probe is admitted.
    expect(screen.queryByText(/retry after/i)).toBeNull();
  });
});
