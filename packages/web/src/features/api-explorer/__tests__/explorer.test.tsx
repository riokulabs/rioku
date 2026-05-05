/**
 * Unit test for <ApiExplorer>.
 *
 * Scalar's real renderer touches IntersectionObserver / ResizeObserver and
 * Vue internals that don't exist in jsdom. We mock `@scalar/api-reference-react`
 * with a deterministic stub so the test asserts the wrapping component mounts
 * and forwards the merged OpenAPI spec. Real Scalar render coverage is picked
 * up by the Playwright smoke test in `e2e/smoke/api-mgmt.spec.ts`.
 *
 * <ApiExplorer> now uses `useOpenAPISpec` (TanStack Query) and
 * `useComputedColorScheme` (Mantine), so all renders are wrapped in both
 * providers. The query is mocked to resolve immediately with the static spec
 * so tests don't depend on network state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@scalar/api-reference-react', () => ({
  ApiReferenceReact: ({
    configuration,
  }: {
    configuration: { content?: unknown; darkMode?: boolean };
  }) => {
    const pathCount =
      configuration.content !== null &&
      typeof configuration.content === 'object' &&
      'paths' in configuration.content &&
      configuration.content.paths !== null &&
      typeof configuration.content.paths === 'object'
        ? Object.keys(configuration.content.paths).length
        : 0;
    return (
      <div
        data-testid="scalar-stub"
        data-path-count={String(pathCount)}
        data-dark-mode={String(configuration.darkMode ?? false)}
      >
        Scalar (stub)
      </div>
    );
  },
}));

// Force the query to fall back to the static spec immediately (no real fetch).
const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  // 404 triggers the static-fallback path in useOpenAPISpec.
  mockFetch.mockResolvedValue(new Response('', { status: 404 }));
});

import { ApiExplorer } from '../components/explorer';

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MantineProvider>{children}</MantineProvider>
    </QueryClientProvider>
  );
}

describe('<ApiExplorer>', () => {
  it('renders the Scalar component with the merged OpenAPI spec', async () => {
    render(<ApiExplorer />, { wrapper: Wrapper });
    const stub = await screen.findByTestId('scalar-stub');
    expect(stub).toBeInTheDocument();
    const pathCount = Number(stub.getAttribute('data-path-count'));
    expect(pathCount).toBeGreaterThan(0);
  });

  it('wraps Scalar in the full-height container', async () => {
    render(<ApiExplorer />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('api-explorer')).toBeInTheDocument());
  });

  it('passes darkMode boolean to Scalar configuration', async () => {
    render(<ApiExplorer />, { wrapper: Wrapper });
    const stub = await screen.findByTestId('scalar-stub');
    // jsdom matchMedia always returns matches:false (prefers-color-scheme: dark
    // is reported as inactive), so MantineProvider resolves colorScheme to
    // 'light' by default — darkMode should be false.
    expect(stub.getAttribute('data-dark-mode')).toBe('false');
  });

  it('resets scrollbar styles on unmount', async () => {
    // Pre-set inline scrollbar styles to simulate Scalar's style.css injection.
    document.documentElement.style.scrollbarColor = 'red blue';
    document.documentElement.style.scrollbarWidth = 'thin';

    const { unmount } = render(<ApiExplorer />, { wrapper: Wrapper });
    // Wait for the query to settle so the component has fully mounted.
    await waitFor(() => expect(screen.queryByTestId('api-explorer')).toBeInTheDocument());
    unmount();

    expect(document.documentElement.style.scrollbarColor).toBe('');
    expect(document.documentElement.style.scrollbarWidth).toBe('');
  });
});
