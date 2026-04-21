/**
 * <ApiExplorer> — Scalar API reference renderer for the merged OpenAPI
 * snapshot.
 *
 * Scalar ships its own Vue internals as a React wrapper; it uses browser
 * globals (IntersectionObserver etc.) that don't exist in jsdom, so the
 * unit tests for this component mock the `@scalar/api-reference-react`
 * module. The production bundle lands in a lazy chunk via the route-level
 * dynamic import — see `src/routes/t.$tenant/api-explorer.tsx`.
 */
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { openapiSpec } from '@/api-explorer';

export function ApiExplorer() {
  return (
    <div
      data-testid="api-explorer"
      style={{ height: '100%', minHeight: '100vh' }}
    >
      <ApiReferenceReact
        configuration={{
          content: openapiSpec,
          theme: 'default',
          hideDownloadButton: false,
        }}
      />
    </div>
  );
}
