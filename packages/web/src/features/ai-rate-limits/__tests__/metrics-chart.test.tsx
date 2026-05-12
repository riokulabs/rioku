/**
 * Stage-2 tests for <RateLimitMetricsChart>.
 *
 * Verifies the chart renders when the daemon returns a non-empty point
 * series, and the empty-state placeholder otherwise. Mantine's LineChart
 * is recharts-under-the-hood; in jsdom we just confirm the chart host
 * (`data-testid="rate-limit-metrics-chart"`) appears so we don't assert
 * on SVG internals that vary across recharts versions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { RateLimitMetricsChart } from '../components/metrics-chart';

const TENANT = 'tenant_acme';
const RULE_ID = 'rl-1';
const METRICS_URL = `*/api/v1/t/${TENANT}/ai/rate-limits/${RULE_ID}/metrics`;

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

describe('<RateLimitMetricsChart>', () => {
  it('renders the chart host when the daemon returns a point series', async () => {
    server.use(
      http.get(METRICS_URL, ({ request }) => {
        const url = new URL(request.url);
        // Verify the `since` query param plumbing works.
        expect(url.searchParams.get('since')).toBe('24h');
        return HttpResponse.json({
          rate_limit_id: RULE_ID,
          since: '24h',
          points: Array.from({ length: 24 }, (_, i) => ({
            timestamp: new Date(Date.UTC(2026, 4, 5, i)).toISOString(),
            throttle_events: i % 5,
          })),
        });
      }),
    );

    wrap(<RateLimitMetricsChart tenantId={TENANT} ruleId={RULE_ID} window="24h" />);

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-metrics-chart')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Throttle events over the last 24h/i)).toBeInTheDocument();
  });

  it('renders the empty-state placeholder when the daemon returns no points', async () => {
    server.use(
      http.get(METRICS_URL, () =>
        HttpResponse.json({ rate_limit_id: RULE_ID, since: '24h', points: [] }),
      ),
    );

    wrap(<RateLimitMetricsChart tenantId={TENANT} ruleId={RULE_ID} window="24h" />);

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-metrics-empty')).toBeInTheDocument();
    });
  });
});
