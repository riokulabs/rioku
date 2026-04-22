import type { MantineThemeOverride } from '@mantine/core';
import { sharedTheme } from './tokens';

export const darkTheme: MantineThemeOverride = {
  ...sharedTheme,
  primaryColor: 'green',
  primaryShade: { light: 6, dark: 5 },
};
