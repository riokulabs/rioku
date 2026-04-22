import { Stack, Text, NavLink, Box, Badge } from '@mantine/core';
import {
  IconDashboard,
  IconWorld,
  IconRobot,
  IconUsers,
  IconKey,
  IconShield,
  IconScale,
  IconPlug,
  IconDevices,
  IconFileText,
  IconSettings,
  IconServer,
  IconRoute,
  IconStack,
  IconBook,
  IconBrain,
  IconTool,
  IconRouter,
  IconGauge,
  IconHistory,
  IconLayoutDashboard,
  IconBell,
  IconBadge,
  IconTopologyRing,
} from '@tabler/icons-react';
import { Link, useParams, useRouterState } from '@tanstack/react-router';
import type { FC } from 'react';
import { useSidebarEntries } from '@/hooks/use-sidebar-entries';
import { SidebarFooter } from './sidebar-footer';

interface NavItem {
  label: string;
  suffix: string;
  icon: FC<{ size?: number }>;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'General',
    items: [
      { label: 'Dashboard', suffix: 'dashboard', icon: IconDashboard },
      { label: 'Sites', suffix: 'sites', icon: IconWorld },
      { label: 'Notifications', suffix: 'notifications', icon: IconBell },
    ],
  },
  {
    heading: 'Analytics',
    items: [{ label: 'Insights', suffix: 'dashboards', icon: IconLayoutDashboard }],
  },
  {
    heading: 'AI',
    items: [
      { label: 'Providers', suffix: 'ai/providers', icon: IconBrain },
      { label: 'Agents', suffix: 'ai/agents', icon: IconRobot },
      { label: 'Tools', suffix: 'ai/tools', icon: IconTool },
      { label: 'Tool routing', suffix: 'ai/tool-routing', icon: IconRouter },
      { label: 'Rate limits', suffix: 'ai/rate-limits', icon: IconGauge },
      { label: 'Traces', suffix: 'ai/traces', icon: IconHistory },
      { label: 'MCP servers', suffix: 'ai/mcp-servers', icon: IconServer },
      // TODO(stage-2): dual view for API-scoped vs AI-scoped access policies
      {
        label: 'Access policies',
        suffix: 'security/access-policies',
        icon: IconShield,
      },
    ],
  },
  {
    heading: 'API management',
    items: [
      { label: 'Services', suffix: 'services', icon: IconServer },
      { label: 'Routes', suffix: 'routes', icon: IconRoute },
      { label: 'Policies', suffix: 'policies', icon: IconShield },
      { label: 'Middlewares', suffix: 'middlewares', icon: IconStack },
      { label: 'API Explorer', suffix: 'api-explorer', icon: IconBook },
    ],
  },
  {
    heading: 'Security',
    items: [
      { label: 'Users', suffix: 'security/users', icon: IconUsers },
      { label: 'Roles', suffix: 'security/roles', icon: IconBadge },
      { label: 'API keys', suffix: 'security/api-keys', icon: IconKey },
      {
        label: 'RBAC policies',
        suffix: 'security/rbac-policies',
        icon: IconScale,
      },
      { label: 'Sessions', suffix: 'security/sessions', icon: IconDevices },
      { label: 'Audit', suffix: 'security/audit', icon: IconFileText },
    ],
  },
  {
    heading: 'System',
    items: [
      { label: 'Cluster', suffix: 'cluster', icon: IconTopologyRing },
      { label: 'Plugins', suffix: 'plugins', icon: IconPlug },
      { label: 'Settings', suffix: 'settings', icon: IconSettings },
    ],
  },
];

interface SidebarProps {
  /**
   * Called when a nav link is clicked. Used by AppLayout to close the mobile
   * drawer after navigation. Optional — not needed on desktop.
   */
  onNavLinkClick?: () => void;
}

export function Sidebar({ onNavLinkClick }: SidebarProps) {
  const { location } = useRouterState();
  // Derive tenant from URL params; fall back to 'acme' when rendering outside
  // a tenant route (e.g. the tenants picker page).
  const { tenant: tenantSlug = 'acme' } = useParams({ strict: false });

  // Plugin-contributed sidebar entries, grouped
  const pluginEntries = useSidebarEntries('plugins');

  return (
    <Stack h="100%" gap={0}>
      <Box flex={1} p="xs" style={{ overflowY: 'auto' }}>
        {NAV_GROUPS.map((group) => (
          <Stack key={group.heading} gap={2} mb="md">
            <Text size="xs" tt="uppercase" fw={600} px="xs" pt="xs">
              {group.heading}
            </Text>
            {group.items.map((item) => {
              const to = `/t/${tenantSlug}/${item.suffix}`;
              const dashboardPath = `/t/${tenantSlug}/dashboard`;
              return (
                <NavLink
                  key={item.label}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                  component={Link as any}
                  to={to}
                  label={item.label}
                  leftSection={<item.icon size={16} />}
                  active={
                    to === dashboardPath
                      ? location.pathname === to
                      : location.pathname.startsWith(to)
                  }
                  {...(onNavLinkClick !== undefined && { onClick: onNavLinkClick })}
                />
              );
            })}
          </Stack>
        ))}

        {/* Plugin-contributed nav entries (group: 'plugins') */}
        {pluginEntries.length > 0 && (
          <Stack gap={2} mb="md">
            <Text size="xs" tt="uppercase" fw={600} px="xs" pt="xs">
              Plugins
            </Text>
            {pluginEntries.map((entry) => {
              // Plugin icons are typed as React.ComponentType (no enforced props).
              // We cast to accept size to match the Tabler-icons convention used
              // by first-party nav items.

              const Icon = entry.icon as React.ComponentType<{ size?: number }> | undefined;
              return (
                <NavLink
                  key={entry.id}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                  component={Link as any}
                  to={entry.path}
                  label={
                    <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{entry.label}</span>
                      <Badge size="xs" variant="dot" color="violet">
                        plugin
                      </Badge>
                    </Box>
                  }
                  leftSection={Icon ? <Icon size={16} /> : <IconPlug size={16} />}
                  active={location.pathname.startsWith(entry.path)}
                  {...(onNavLinkClick !== undefined && { onClick: onNavLinkClick })}
                />
              );
            })}
          </Stack>
        )}
      </Box>
      <SidebarFooter />
    </Stack>
  );
}
