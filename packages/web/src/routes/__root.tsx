import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { Spotlight } from '@mantine/spotlight';
import { IconHome, IconCloud, IconSun } from '@tabler/icons-react';
import { useActiveTheme } from '@/hooks/use-active-theme';

// Theme cycle order for "Toggle theme" action
const THEME_CYCLE_ORDER = ['dark', 'light', 'hc-dark', 'hc-light'] as const;

/**
 * Spotlight command palette. Lives inside the router so `useNavigate()` is
 * available. The `spotlight` imperative singleton (used in TopBar) works because
 * `spotlightStore` is a module-level singleton in @mantine/spotlight.
 */
function SpotlightCommands() {
  const navigate = useNavigate();
  const [activeThemeName, setActiveThemeName] = useActiveTheme();

  function cycleTheme() {
    const idx = THEME_CYCLE_ORDER.indexOf(activeThemeName as (typeof THEME_CYCLE_ORDER)[number]);
    const next = THEME_CYCLE_ORDER[(idx + 1) % THEME_CYCLE_ORDER.length] ?? THEME_CYCLE_ORDER[0];
    setActiveThemeName(next);
  }

  return (
    <Spotlight
      shortcut={['mod+K', 'mod+P']}
      nothingFound="No results"
      highlightQuery
      actions={[
        {
          id: 'go-dashboard',
          label: 'Go to Dashboard',
          description: 'Navigate to tenant dashboard',
          leftSection: <IconHome size={18} />,
          onClick: () => void navigate({ to: '/t/$tenant/dashboard', params: { tenant: 'acme' } }),
        },
        {
          id: 'go-sites',
          label: 'Go to Sites',
          description: 'Navigate to tenant sites',
          leftSection: <IconCloud size={18} />,
          // No /t/$tenant/sites route exists yet — will hit notFound. Acceptable for stage 1.
          onClick: () => void navigate({ to: '/t/$tenant', params: { tenant: 'acme' } }),
        },
        {
          id: 'toggle-theme',
          label: 'Toggle theme',
          description: `Current: ${activeThemeName}`,
          leftSection: <IconSun size={18} />,
          onClick: cycleTheme,
        },
      ]}
    />
  );
}

function RootComponent() {
  return (
    <>
      <Outlet />
      <SpotlightCommands />
    </>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
