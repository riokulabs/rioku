import { MantineProvider, createTheme, localStorageColorSchemeManager } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/spotlight/styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveTheme } from '@/hooks/use-active-theme';
import { useOsPreferences } from '@/hooks/use-os-preferences';
import { usePluginThemes } from '@/host/themes';
import { BUILTIN_THEMES } from '@/theme';
import { getDir } from '@/i18n/dir';
import { queryClient } from '@/api/query-client';
import { setNotifyBackend } from '@/host/notify';
import { useMockStore } from '@/api/mock-store';
import { emitNotification } from '@/features/notifications';

const colorSchemeManager = localStorageColorSchemeManager({ key: 'rioku-color-scheme' });

// Dark theme is always present as the first built-in; used as fallback.
const DARK_THEME = BUILTIN_THEMES.find((t) => t.name === 'dark') ?? BUILTIN_THEMES[0] ?? { name: 'dark', displayName: 'Dark', colorScheme: 'dark' as const, theme: {}, source: 'built-in' as const };

export function Providers({ children }: { children: ReactNode }) {
  const [activeThemeName, setActiveThemeName] = useActiveTheme();
  const { prefersDark, prefersReducedMotion, prefersContrastMore } = useOsPreferences();
  const { i18n } = useTranslation();

  // Plugin-contributed themes (reactive — re-resolves when plugins register/unregister)
  const pluginThemes = usePluginThemes();

  // Wire the notify backend once at mount — must run before any plugin code.
  // The backend forwards plugin emissions to `emitNotification` which writes
  // the inbox entry, dispatches on the inbox-stream bus, and fires the
  // Mantine toast. Tenant / user default to the current session when the
  // plugin omits them.
  useEffect(() => {
    setNotifyBackend({
      write(input) {
        const state = useMockStore.getState();
        emitNotification({
          tenant_id: input.tenant ?? state.currentTenantId ?? null,
          user_id: input.user ?? state.currentUserId ?? 'unknown',
          category: input.category,
          severity: input.severity,
          title: input.title,
          body: input.body,
          ...(input.action ? { action: input.action } : {}),
        });
      },
    });
    // Run once — setNotifyBackend is idempotent; backend is a module singleton.
     
  }, []);

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

  const allThemes = [...BUILTIN_THEMES, ...pluginThemes];
  const themeExists = allThemes.some((t) => t.name === resolvedThemeName);
  const resolvedTheme = themeExists
    ? (allThemes.find((t) => t.name === resolvedThemeName) ?? DARK_THEME)
    : DARK_THEME;

  // If the user-selected theme is a plugin theme that got uninstalled, reset
  // to 'dark'. useEffect avoids calling setState during render.
  useEffect(() => {
    if (!themeExists && resolvedThemeName !== 'dark') {
      setActiveThemeName('dark');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeExists, resolvedThemeName]);

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
      <Notifications position="top-right" />
      <ModalsProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  );
}
