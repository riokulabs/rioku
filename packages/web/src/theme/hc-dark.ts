import type { MantineThemeOverride } from '@mantine/core';
import { sharedTheme } from './tokens';

// High-contrast dark: white primary on near-black backgrounds.
// primaryShade pushed to 0 (lightest) so white/near-white shades are selected.
// luminanceThreshold raised so autoContrast always picks the highest-contrast text.
export const hcDarkTheme: MantineThemeOverride = {
  ...sharedTheme,
  primaryColor: 'gray',
  primaryShade: { light: 0, dark: 0 },
  luminanceThreshold: 0.5,
};
