import { useMediaQuery } from '@mantine/hooks';

export function useOsPreferences() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const prefersContrastMore = useMediaQuery('(prefers-contrast: more)');
  return { prefersDark, prefersReducedMotion, prefersContrastMore };
}
