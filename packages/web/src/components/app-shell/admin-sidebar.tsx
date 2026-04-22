import { Stack, Text, NavLink, Box, Badge } from '@mantine/core';
import {
  IconBuilding,
  IconUsers,
  IconUserSearch,
  IconPlug,
  IconServer,
  IconFileText,
  IconShieldCheck,
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

const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    heading: 'General',
    items: [
      { label: 'Tenants', to: '/admin/tenants', icon: IconBuilding },
      { label: 'Users', to: '/admin/users', icon: IconUsers },
      { label: 'Impersonate', to: '/admin/impersonate', icon: IconUserSearch },
    ],
  },
  {
    heading: 'System',
    items: [
      { label: 'Plugins', to: '/admin/plugins', icon: IconPlug },
      { label: 'Signer allow-list', to: '/admin/plugin-signers', icon: IconShieldCheck },
      { label: 'Cluster', to: '/admin/cluster', icon: IconServer },
      { label: 'Audit', to: '/admin/audit', icon: IconFileText },
    ],
  },
];

export function AdminSidebar() {
  const { location } = useRouterState();

  return (
    <Stack h="100%" gap={0}>
      <Box flex={1} p="xs" style={{ overflowY: 'auto' }}>
        {/* Super-admin identity badge — not a dropdown, no tenant switching */}
        <Box
          p="xs"
          mb="sm"
          style={{
            borderRadius: 6,
            background: 'var(--mantine-color-gray-light)',
          }}
        >
          <Badge color="gray" variant="light" fullWidth>
            Super-admin
          </Badge>
        </Box>

        {ADMIN_NAV_GROUPS.map((group) => (
          <Stack key={group.heading} gap={2} mb="md">
            <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600} px="xs" pt="xs">
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
      {/* Profile footer stays the same; tenant switcher is replaced by Super-admin badge above */}
      <SidebarFooter />
    </Stack>
  );
}
