/**
 * Unit test for <ApiExplorer>.
 *
 * Scalar's real renderer touches IntersectionObserver / ResizeObserver and
 * Vue internals that don't exist in jsdom. We mock `@scalar/api-reference-react`
 * with a deterministic stub so the test asserts the wrapping component mounts
 * and forwards the merged OpenAPI spec. Real Scalar render coverage is picked
 * up by the Playwright smoke test in `e2e/smoke/api-mgmt.spec.ts`.
 *
 * <ApiExplorer> now calls `useComputedColorScheme` from Mantine, so all
 * renders are wrapped in <MantineProvider> to satisfy the hook's context
 * requirement.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

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

import { ApiExplorer } from '../components/explorer';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe('<ApiExplorer>', () => {
  it('renders the Scalar component with the merged OpenAPI spec', () => {
    render(<ApiExplorer />, { wrapper: Wrapper });
    const stub = screen.getByTestId('scalar-stub');
    expect(stub).toBeInTheDocument();
    const pathCount = Number(stub.getAttribute('data-path-count'));
    expect(pathCount).toBeGreaterThan(0);
  });

  it('wraps Scalar in the full-height container', () => {
    render(<ApiExplorer />, { wrapper: Wrapper });
    expect(screen.getByTestId('api-explorer')).toBeInTheDocument();
  });

  it('passes darkMode boolean to Scalar configuration', () => {
    render(<ApiExplorer />, { wrapper: Wrapper });
    const stub = screen.getByTestId('scalar-stub');
    // jsdom matchMedia always returns matches:false (prefers-color-scheme: dark
    // is reported as inactive), so MantineProvider resolves colorScheme to
    // 'light' by default — darkMode should be false.
    expect(stub.getAttribute('data-dark-mode')).toBe('false');
  });

  it('resets scrollbar styles on unmount', () => {
    // Pre-set inline scrollbar styles to simulate Scalar's style.css injection.
    document.documentElement.style.scrollbarColor = 'red blue';
    document.documentElement.style.scrollbarWidth = 'thin';

    const { unmount } = render(<ApiExplorer />, { wrapper: Wrapper });
    unmount();

    expect(document.documentElement.style.scrollbarColor).toBe('');
    expect(document.documentElement.style.scrollbarWidth).toBe('');
  });
});
