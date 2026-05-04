import { createRootRoute, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { Spotlight } from '@mantine/spotlight';
import {
  IconSun,
  IconLogout,
  IconSwitchHorizontal,
  IconDashboard,
  IconWorld,
  IconBell,
  IconLayoutDashboard,
  IconBrain,
  IconRobot,
  IconTool,
  IconRouter,
  IconGauge,
  IconHistory,
  IconServer,
  IconShield,
  IconRoute,
  IconStack,
  IconBook,
  IconUsers,
  IconBadge,
  IconKey,
  IconScale,
  IconDevices,
  IconFileText,
  IconTopologyRing,
  IconPlug,
  IconSettings,
} from '@tabler/icons-react';
import { useActiveTheme } from '@/hooks/use-active-theme';
import { useSpotlightCommands } from '@/hooks/use-spotlight-commands';
import { ErrorBoundaryFallback } from '@/app/error-boundary';
import { ForcePasswordChangeGuard } from '@/features/auth/components/force-password-change-guard';
import { logout } from '@/features/auth/api';

// Theme cycle order for "Toggle theme" action
const THEME_CYCLE_ORDER = ['dark', 'light', 'hc-dark', 'hc-light'] as const;

interface NavEntry {
  label: string;
  suffix: string;
  description: string;
  icon: React.FC<{ size?: number }>;
  group: string;
}

// Mirror of NAV_GROUPS from sidebar.tsx — kept in sync manually.
// Each entry maps to a spotlight action.
const NAV_ENTRIES: NavEntry[] = [
  // General
  {
    label: 'Dashboard',
    suffix: 'dashboard',
    description: 'Tenant overview',
    icon: IconDashboard,
    group: 'General',
  },
  {
    label: 'Sites',
    suffix: 'sites',
    description: 'Manage Caddy sites',
    icon: IconWorld,
    group: 'General',
  },
  {
    label: 'Notifications',
    suffix: 'notifications',
    description: 'Notification inbox',
    icon: IconBell,
    group: 'General',
  },
  // Analytics
  {
    label: 'Insights',
    suffix: 'dashboards',
    description: 'Analytics dashboards',
    icon: IconLayoutDashboard,
    group: 'Analytics',
  },
  // AI
  {
    label: 'AI Providers',
    suffix: 'ai/providers',
    description: 'Manage LLM providers',
    icon: IconBrain,
    group: 'AI',
  },
  {
    label: 'AI Agents',
    suffix: 'ai/agents',
    description: 'Manage AI agents',
    icon: IconRobot,
    group: 'AI',
  },
  {
    label: 'AI Tools',
    suffix: 'ai/tools',
    description: 'Manage AI tools',
    icon: IconTool,
    group: 'AI',
  },
  {
    label: 'Tool routing',
    suffix: 'ai/tool-routing',
    description: 'Configure tool routing rules',
    icon: IconRouter,
    group: 'AI',
  },
  {
    label: 'AI Rate limits',
    suffix: 'ai/rate-limits',
    description: 'Manage AI rate limits',
    icon: IconGauge,
    group: 'AI',
  },
  {
    label: 'AI Traces',
    suffix: 'ai/traces',
    description: 'View AI request traces',
    icon: IconHistory,
    group: 'AI',
  },
  {
    label: 'MCP servers',
    suffix: 'ai/mcp-servers',
    description: 'Manage MCP servers',
    icon: IconServer,
    group: 'AI',
  },
  {
    label: 'Access policies',
    suffix: 'security/access-policies',
    description: 'Manage access policies',
    icon: IconShield,
    group: 'AI',
  },
  // API management
  {
    label: 'Services',
    suffix: 'services',
    description: 'Manage upstream services',
    icon: IconServer,
    group: 'API management',
  },
  {
    label: 'Routes',
    suffix: 'routes',
    description: 'Manage API routes',
    icon: IconRoute,
    group: 'API management',
  },
  {
    label: 'Policies',
    suffix: 'policies',
    description: 'Manage API policies',
    icon: IconShield,
    group: 'API management',
  },
  {
    label: 'Middlewares',
    suffix: 'middlewares',
    description: 'Manage middleware stack',
    icon: IconStack,
    group: 'API management',
  },
  {
    label: 'API Explorer',
    suffix: 'api-explorer',
    description: 'Browse and test APIs',
    icon: IconBook,
    group: 'API management',
  },
  // Security
  {
    label: 'Users',
    suffix: 'security/users',
    description: 'Manage tenant users',
    icon: IconUsers,
    group: 'Security',
  },
  {
    label: 'Roles',
    suffix: 'security/roles',
    description: 'Manage roles',
    icon: IconBadge,
    group: 'Security',
  },
  {
    label: 'API keys',
    suffix: 'security/api-keys',
    description: 'Manage API keys',
    icon: IconKey,
    group: 'Security',
  },
  {
    label: 'RBAC policies',
    suffix: 'security/rbac-policies',
    description: 'Manage RBAC policies',
    icon: IconScale,
    group: 'Security',
  },
  {
    label: 'Sessions',
    suffix: 'security/sessions',
    description: 'Manage active sessions',
    icon: IconDevices,
    group: 'Security',
  },
  {
    label: 'Audit',
    suffix: 'security/audit',
    description: 'View audit log',
    icon: IconFileText,
    group: 'Security',
  },
  // System
  {
    label: 'Cluster',
    suffix: 'cluster',
    description: 'Manage cluster nodes',
    icon: IconTopologyRing,
    group: 'System',
  },
  {
    label: 'Plugins',
    suffix: 'plugins',
    description: 'Manage plugins',
    icon: IconPlug,
    group: 'System',
  },
  {
    label: 'Settings',
    suffix: 'settings',
    description: 'Tenant settings',
    icon: IconSettings,
    group: 'System',
  },
];

/**
 * Spotlight command palette. Lives inside the router so `useNavigate()` is
 * available. The `spotlight` imperative singleton (used in TopBar) works because
 * `spotlightStore` is a module-level singleton in @mantine/spotlight.
 */
function SpotlightCommands() {
  const navigate = useNavigate();
  const { tenant: tenantSlug = 'acme' } = useParams({ strict: false });
  const [activeThemeName, setActiveThemeName] = useActiveTheme();
  const pluginCommands = useSpotlightCommands();

  function cycleTheme() {
    const idx = THEME_CYCLE_ORDER.indexOf(activeThemeName as (typeof THEME_CYCLE_ORDER)[number]);
    const next = THEME_CYCLE_ORDER[(idx + 1) % THEME_CYCLE_ORDER.length] ?? THEME_CYCLE_ORDER[0];
    setActiveThemeName(next);
  }

  // Nav entry actions — one per sidebar item
  const navActions = NAV_ENTRIES.map((entry) => ({
    id: `nav-${entry.suffix}`,
    label: entry.label,
    description: entry.description,
    group: entry.group,
    leftSection: <entry.icon size={18} />,
    onClick: () =>
      void navigate({
        to: `/t/$tenant/${entry.suffix}`,
        params: { tenant: tenantSlug },
      }),
  }));

  // Quick actions
  const quickActions = [
    {
      id: 'toggle-theme',
      label: 'Toggle theme',
      description: `Current: ${activeThemeName}`,
      group: 'Quick actions',
      leftSection: <IconSun size={18} />,
      onClick: cycleTheme,
    },
    {
      id: 'switch-tenant',
      label: 'Switch tenant',
      description: 'Go to tenant picker',
      group: 'Quick actions',
      leftSection: <IconSwitchHorizontal size={18} />,
      onClick: () => void navigate({ to: '/tenants' }),
    },
    {
      id: 'sign-out',
      label: 'Sign out',
      description: 'End your session',
      group: 'Quick actions',
      leftSection: <IconLogout size={18} />,
      onClick: () =>
        void logout().then(() => {
          void navigate({ to: '/login' });
        }),
    },
  ];

  // Merge plugin-contributed spotlight commands
  const pluginActions = pluginCommands.map((cmd) => ({
    id: cmd.id,
    label: cmd.label,
    ...(cmd.keywords && cmd.keywords.length > 0 ? { description: cmd.keywords.join(', ') } : {}),
    group: cmd.group ?? 'Plugins',
    onClick: cmd.onAction,
  }));

  return (
    <Spotlight
      shortcut={['mod+K', 'mod+P']}
      nothingFound="No results"
      highlightQuery
      actions={[...navActions, ...quickActions, ...pluginActions]}
    />
  );
}

function RootComponent() {
  return (
    <>
      <ForcePasswordChangeGuard />
      <Outlet />
      <SpotlightCommands />
    </>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: ErrorBoundaryFallback,
});
