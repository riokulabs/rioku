import type { MantineThemeOverride } from '@mantine/core';
import { sharedTheme } from './tokens';

export const lightTheme: MantineThemeOverride = {
  ...sharedTheme,
  primaryColor: 'green',
  primaryShade: { light: 7, dark: 6 },
};
