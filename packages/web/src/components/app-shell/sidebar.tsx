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
import { Link, useRouterState } from '@tanstack/react-router';
import type { FC } from 'react';
import { useSidebarEntries } from '@/hooks/use-sidebar-entries';
import { SidebarFooter } from './sidebar-footer';

interface NavItem {
  label: string;
  to: string;
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
      { label: 'Dashboard', to: '/t/acme/dashboard', icon: IconDashboard },
      { label: 'Sites', to: '/t/acme/sites', icon: IconWorld },
      { label: 'Notifications', to: '/t/acme/notifications', icon: IconBell },
    ],
  },
  {
    heading: 'Analytics',
    items: [{ label: 'Insights', to: '/t/acme/dashboards', icon: IconLayoutDashboard }],
  },
  {
    heading: 'AI',
    items: [
      { label: 'Providers', to: '/t/acme/ai/providers', icon: IconBrain },
      { label: 'Agents', to: '/t/acme/ai/agents', icon: IconRobot },
      { label: 'Tools', to: '/t/acme/ai/tools', icon: IconTool },
      { label: 'Tool routing', to: '/t/acme/ai/tool-routing', icon: IconRouter },
      { label: 'Rate limits', to: '/t/acme/ai/rate-limits', icon: IconGauge },
      { label: 'Traces', to: '/t/acme/ai/traces', icon: IconHistory },
      { label: 'MCP servers', to: '/t/acme/ai/mcp-servers', icon: IconServer },
      // TODO(stage-2): dual view for API-scoped vs AI-scoped access policies
      {
        label: 'Access policies',
        to: '/t/acme/security/access-policies',
        icon: IconShield,
      },
    ],
  },
  {
    heading: 'API management',
    items: [
      { label: 'Services', to: '/t/acme/services', icon: IconServer },
      { label: 'Routes', to: '/t/acme/routes', icon: IconRoute },
      { label: 'Policies', to: '/t/acme/policies', icon: IconShield },
      { label: 'Middlewares', to: '/t/acme/middlewares', icon: IconStack },
      { label: 'API Explorer', to: '/t/acme/api-explorer', icon: IconBook },
    ],
  },
  {
    heading: 'Security',
    items: [
      { label: 'Users', to: '/t/acme/security/users', icon: IconUsers },
      { label: 'Roles', to: '/t/acme/security/roles', icon: IconBadge },
      { label: 'API keys', to: '/t/acme/security/api-keys', icon: IconKey },
      {
        label: 'RBAC policies',
        to: '/t/acme/security/rbac-policies',
        icon: IconScale,
      },
      { label: 'Sessions', to: '/t/acme/security/sessions', icon: IconDevices },
      { label: 'Audit', to: '/t/acme/security/audit', icon: IconFileText },
    ],
  },
  {
    heading: 'System',
    items: [
      { label: 'Cluster', to: '/t/acme/cluster', icon: IconTopologyRing },
      { label: 'Plugins', to: '/t/acme/plugins', icon: IconPlug },
      { label: 'Settings', to: '/t/acme/settings', icon: IconSettings },
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
            {group.items.map((item) => (
              <NavLink
                key={item.label}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                component={Link as any}
                to={item.to}
                label={item.label}
                leftSection={<item.icon size={16} />}
                active={
                  item.to === '/t/acme/dashboard'
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to)
                }
                {...(onNavLinkClick !== undefined && { onClick: onNavLinkClick })}
              />
            ))}
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
