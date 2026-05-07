/**
 * Unit tests for <PluginDisabledTooltip>.
 *
 * Verifies that the tooltip renders the "Unsupported" badge when the
 * plugin's `kind` requires a capability the daemon lacks, and renders
 * children pass-through when the capability is available.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { PluginDisabledTooltip } from '../installed/components/disabled-tooltip';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.resetHandlers();
});

describe('<PluginDisabledTooltip>', () => {
  it('renders the unsupported badge when sideload kind is required + flag off', () => {
    server.use(
      http.get('/api/v1/capabilities', () =>
        HttpResponse.json({ sideload_enabled: false }),
      ),
    );
    wrap(
      <PluginDisabledTooltip kind="sideload">
        <span data-testid="install-button">Install</span>
      </PluginDisabledTooltip>,
    );
    expect(screen.getByLabelText('plugin-disabled-tooltip')).toBeTruthy();
    expect(screen.getByText(/Unsupported/i)).toBeTruthy();
  });

  it('passes children through when the capability is available', async () => {
    server.use(
      http.get('/api/v1/capabilities', () =>
        HttpResponse.json({ sideload_enabled: true }),
      ),
    );
    wrap(
      <PluginDisabledTooltip kind="sideload">
        <span data-testid="install-button">Install</span>
      </PluginDisabledTooltip>,
    );
    // Wait for the capabilities query to settle, then the tooltip
    // wrapper should disappear and only the children remain.
    await waitFor(() =>
      { expect(screen.queryByLabelText('plugin-disabled-tooltip')).toBeNull(); },
    );
    expect(screen.getByTestId('install-button')).toBeTruthy();
  });

  it('passes children through when no kind requires a daemon capability', () => {
    wrap(
      <PluginDisabledTooltip>
        <span data-testid="install-button">Install</span>
      </PluginDisabledTooltip>,
    );
    expect(screen.getByTestId('install-button')).toBeTruthy();
    expect(screen.queryByLabelText('plugin-disabled-tooltip')).toBeNull();
  });
});
