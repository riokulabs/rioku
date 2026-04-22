import type { MantineThemeOverride } from '@mantine/core';
import { darkTheme } from './dark';
import { lightTheme } from './light';
import { hcDarkTheme } from './hc-dark';
import { hcLightTheme } from './hc-light';

export type ThemeName = 'dark' | 'light' | 'hc-dark' | 'hc-light';
export type ColorScheme = 'dark' | 'light';

export interface RegisteredTheme {
  // Allows built-in ThemeName values plus arbitrary plugin-defined names.
  name: string;
  displayName: string;
  colorScheme: ColorScheme;
  theme: MantineThemeOverride;
  source: 'built-in' | 'plugin';
}

export const BUILTIN_THEMES: RegisteredTheme[] = [
  { name: 'dark', displayName: 'Dark', colorScheme: 'dark', theme: darkTheme, source: 'built-in' },
  {
    name: 'light',
    displayName: 'Light',
    colorScheme: 'light',
    theme: lightTheme,
    source: 'built-in',
  },
  {
    name: 'hc-dark',
    displayName: 'High Contrast Dark',
    colorScheme: 'dark',
    theme: hcDarkTheme,
    source: 'built-in',
  },
  {
    name: 'hc-light',
    displayName: 'High Contrast Light',
    colorScheme: 'light',
    theme: hcLightTheme,
    source: 'built-in',
  },
];
