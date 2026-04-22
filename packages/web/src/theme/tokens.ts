import type { MantineThemeOverride } from '@mantine/core';

export const sharedTheme: MantineThemeOverride = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  defaultRadius: 'md',
  headings: {
    fontFamily: 'inherit',
    sizes: {
      h1: { fontSize: '1.75rem', fontWeight: '700' },
      h2: { fontSize: '1.5rem', fontWeight: '600' },
      h3: { fontSize: '1.25rem', fontWeight: '600' },
    },
  },
  autoContrast: true,
  luminanceThreshold: 0.3,
};
