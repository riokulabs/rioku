import { Stack, Text, NavLink, Box } from '@mantine/core';
import {
  IconDashboard,
  IconWorld,
  IconBolt,
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
} from '@tabler/icons-react';
import { Link, useRouterState } from '@tanstack/react-router';
import type { FC } from 'react';
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
      { label: 'API management', to: '/t/acme/api-mgmt', icon: IconBolt },
      { label: 'AI', to: '/t/acme/ai', icon: IconRobot },
      { label: 'Analytics', to: '/t/acme/analytics', icon: IconChartBar },
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
      </Box>
      <SidebarFooter />
    </Stack>
  );
}
