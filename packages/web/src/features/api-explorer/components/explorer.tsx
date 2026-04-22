/**
 * <ApiExplorer> — Scalar API reference renderer for the merged OpenAPI
 * snapshot.
 *
 * Scalar ships its own Vue internals as a React wrapper; it uses browser
 * globals (IntersectionObserver etc.) that don't exist in jsdom, so the
 * unit tests for this component mock the `@scalar/api-reference-react`
 * module. The production bundle lands in a lazy chunk via the route-level
 * dynamic import — see `src/routes/t.$tenant/api-explorer.tsx`.
 *
 * Theme notes:
 *   - We use `theme: 'none'` so that Scalar's CSS variables are fully
 *     overridden by the scoped mapping below, which wires them to Mantine's
 *     design tokens.  This makes the explorer track the admin panel's color
 *     scheme automatically (dark ↔ light).
 *   - The `darkMode` boolean is passed explicitly so Scalar's internal logic
 *     also flips — some elements (e.g. syntax highlighting) read this prop
 *     rather than CSS variables.
 *   - On unmount we reset the global scrollbar properties that Scalar's
 *     style.css injects onto <html>/<body>.  Without this cleanup the
 *     browser scrollbar stays styled dark after navigating away from the
 *     explorer.
 */
import { useEffect } from 'react';
import { useComputedColorScheme } from '@mantine/core';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { openapiSpec } from '@/api-explorer';

export function ApiExplorer() {
  const colorScheme = useComputedColorScheme('dark');
  const isDark = colorScheme === 'dark';

  // Cleanup: undo global scrollbar styles that Scalar's style.css injects.
  // These persist on <html> after the component unmounts, causing the
  // scrollbar to remain dark until a hard page refresh.
  useEffect(() => {
    return () => {
      document.documentElement.style.scrollbarColor = '';
      document.documentElement.style.scrollbarWidth = '';
      document.body.style.scrollbarColor = '';
      document.body.style.scrollbarWidth = '';
    };
  }, []);

  return (
    <>
      {/*
       * Scoped CSS variable mapping: wire Scalar's design tokens to Mantine's.
       * Targeting [data-testid="api-explorer"] keeps these overrides scoped to
       * the Scalar container and avoids polluting the global namespace.
       *
       * All values reference Mantine's computed CSS variables so they
       * automatically respond to dark/light mode switches.
       */}
      <style>{`
        [data-testid="api-explorer"] {
          --scalar-background-1: var(--mantine-color-body);
          --scalar-background-2: var(--mantine-color-default);
          --scalar-background-3: var(--mantine-color-default-hover);
          --scalar-color-1: var(--mantine-color-text);
          --scalar-color-2: var(--mantine-color-dimmed);
          --scalar-color-3: var(--mantine-color-dimmed);
          --scalar-border-color: var(--mantine-color-default-border);
          --scalar-scrollbar-color: var(--mantine-color-default-border);
          --scalar-scrollbar-color-active: var(--mantine-color-dimmed);
        }
      `}</style>
      <div data-testid="api-explorer" style={{ height: '100%', minHeight: '100vh' }}>
        <ApiReferenceReact
          configuration={{
            content: openapiSpec,
            theme: 'none',
            darkMode: isDark,
            hideDownloadButton: false,
          }}
        />
      </div>
    </>
  );
}
