import { Stack, Text, NavLink, Box, Badge } from '@mantine/core';
import {
  IconDashboard,
  IconWorld,
  IconRobot,
  IconChartBar,
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
      { label: 'AI', to: '/t/acme/ai', icon: IconRobot },
      { label: 'Analytics', to: '/t/acme/analytics', icon: IconChartBar },
    ],
  },
  {
    heading: 'API management',
    items: [
      { label: 'Services', to: '/t/acme/services', icon: IconServer },
      { label: 'Routes', to: '/t/acme/routes', icon: IconRoute },
      { label: 'Policies', to: '/t/acme/policies', icon: IconShield },
      { label: 'Middlewares', to: '/t/acme/middlewares', icon: IconStack },
    ],
  },
  {
    heading: 'Security',
    items: [
      { label: 'Users & roles', to: '/t/acme/security/users', icon: IconUsers },
      { label: 'API keys', to: '/t/acme/security/api-keys', icon: IconKey },
      {
        label: 'Access policies',
        to: '/t/acme/security/access-policies',
        icon: IconShield,
      },
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
      { label: 'Plugins', to: '/t/acme/plugins', icon: IconPlug },
      { label: 'Settings', to: '/t/acme/settings', icon: IconSettings },
    ],
  },
];

export function Sidebar() {
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
                active={location.pathname.startsWith(item.to)}
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
