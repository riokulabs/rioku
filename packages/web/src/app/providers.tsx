import { MantineProvider, createTheme, localStorageColorSchemeManager } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import '@mantine/spotlight/styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveTheme } from '@/hooks/use-active-theme';
import { useOsPreferences } from '@/hooks/use-os-preferences';
import { BUILTIN_THEMES, type RegisteredTheme } from '@/theme';
import { getDir } from '@/i18n/dir';
import { queryClient } from '@/api/query-client';

const colorSchemeManager = localStorageColorSchemeManager({ key: 'rioku-color-scheme' });

// Plugin-contributed themes (populated in Phase 1f)
const PLUGIN_THEMES: RegisteredTheme[] = [];

// Dark theme is always present as the first built-in; used as fallback.
const DARK_THEME = BUILTIN_THEMES.find((t) => t.name === 'dark') ?? BUILTIN_THEMES[0] ?? { name: 'dark', displayName: 'Dark', colorScheme: 'dark' as const, theme: {}, source: 'built-in' as const };

export function Providers({ children }: { children: ReactNode }) {
  const [activeThemeName] = useActiveTheme();
  const { prefersDark, prefersReducedMotion, prefersContrastMore } = useOsPreferences();
  const { i18n } = useTranslation();

  // Resolve theme: if user hasn't manually picked (still default 'dark'),
  // use OS preferences to determine the best theme.
  const isDefault = activeThemeName === 'dark';
  let resolvedThemeName = activeThemeName;
  if (isDefault) {
    if (prefersContrastMore) {
      resolvedThemeName = prefersDark ? 'hc-dark' : 'hc-light';
    } else if (!prefersDark) {
      resolvedThemeName = 'light';
    }
  }

  const allThemes = [...BUILTIN_THEMES, ...PLUGIN_THEMES];
  const resolvedTheme = allThemes.find((t) => t.name === resolvedThemeName) ?? DARK_THEME;

  const dir = getDir(i18n.language);

  useEffect(() => {
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', i18n.language);
  }, [dir, i18n.language]);

  const mantineTheme = createTheme({
    ...resolvedTheme.theme,
    respectReducedMotion: prefersReducedMotion,
  });

  return (
    <MantineProvider
      theme={mantineTheme}
      forceColorScheme={resolvedTheme.colorScheme}
      colorSchemeManager={colorSchemeManager}
    >
      <ModalsProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  );
}
