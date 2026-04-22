import type { MantineThemeOverride } from '@mantine/core';
import { sharedTheme } from './tokens';

// High-contrast light: black primary on near-white backgrounds.
// primaryShade pushed to 9 (darkest) so near-black shades are selected.
// luminanceThreshold raised so autoContrast always picks the highest-contrast text.
export const hcLightTheme: MantineThemeOverride = {
  ...sharedTheme,
  primaryColor: 'dark',
  primaryShade: { light: 9, dark: 9 },
  luminanceThreshold: 0.5,
};
