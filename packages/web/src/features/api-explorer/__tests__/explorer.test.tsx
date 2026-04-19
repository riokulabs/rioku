/**
 * Unit test for <ApiExplorer>.
 *
 * Scalar's real renderer touches IntersectionObserver / ResizeObserver and
 * Vue internals that don't exist in jsdom. We mock `@scalar/api-reference-react`
 * with a deterministic stub so the test asserts the wrapping component mounts
 * and forwards the merged OpenAPI spec. Real Scalar render coverage is picked
 * up by the Playwright smoke test in `e2e/smoke/api-mgmt.spec.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@scalar/api-reference-react', () => ({
  ApiReferenceReact: ({
    configuration,
  }: {
    configuration: { content?: unknown };
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
      <div data-testid="scalar-stub" data-path-count={String(pathCount)}>
        Scalar (stub)
      </div>
    );
  },
}));

import { ApiExplorer } from '../components/explorer';

describe('<ApiExplorer>', () => {
  it('renders the Scalar component with the merged OpenAPI spec', () => {
    render(<ApiExplorer />);
    const stub = screen.getByTestId('scalar-stub');
    expect(stub).toBeInTheDocument();
    const pathCount = Number(stub.getAttribute('data-path-count'));
    expect(pathCount).toBeGreaterThan(0);
  });

  it('wraps Scalar in the full-height container', () => {
    render(<ApiExplorer />);
    expect(screen.getByTestId('api-explorer')).toBeInTheDocument();
  });
});
