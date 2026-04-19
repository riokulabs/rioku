/**
 * <SettingsLayout> — settings page with subnav sidebar.
 *
 * Uses ?section=<slug> query param to track active section.
 * Each section renders a placeholder <EmptyState> citing the plan that
 * will populate it.
 *
 * spec / Task 1d.79
 */
import { useMemo } from 'react';
import {
  Group,
  Stack,
  NavLink,
  Box,
  Title,
  Text,
} from '@mantine/core';
import {
  IconUser,
  IconBuilding,
  IconShield,
  IconBell,
  IconNetwork,
  IconCertificate,
  IconLock,
  IconChartBar,
  IconPlug,
  IconCode,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import type { Icon } from '@tabler/icons-react';
import { EmptyState } from '@/components/empty-state';

// ─── Section definitions ──────────────────────────────────────────────────────

interface SettingsSection {
  slug: string;
  label: string;
  icon: Icon;
  plan: string;
}

const SECTIONS: SettingsSection[] = [
  { slug: 'profile', label: 'Profile', icon: IconUser, plan: 'Plan 1e' },
  { slug: 'tenant', label: 'Tenant', icon: IconBuilding, plan: 'Plan 1e' },
  { slug: 'authentication', label: 'Authentication', icon: IconShield, plan: 'Plan 1e' },
  { slug: 'notifications', label: 'Notifications', icon: IconBell, plan: 'Plan 7' },
  { slug: 'network', label: 'Network', icon: IconNetwork, plan: 'Plan 8' },
  { slug: 'pki', label: 'PKI', icon: IconCertificate, plan: 'Plan 8' },
  { slug: 'tls', label: 'TLS', icon: IconLock, plan: 'Plan 8' },
  { slug: 'observability', label: 'Observability', icon: IconChartBar, plan: 'Plan 8' },
  { slug: 'integrations', label: 'Integrations', icon: IconCode, plan: 'Plan 8' },
  { slug: 'plugins', label: 'Plugins', icon: IconPlug, plan: 'Plan 8' },
  { slug: 'danger-zone', label: 'Danger zone', icon: IconAlertTriangle, plan: 'Plan 1e' },
];

// ─── Component ────────────────────────────────────────────────────────────────

const DEFAULT_SECTION = SECTIONS[0];

export function SettingsLayout() {
  // Read active section from search param — strict: false so it works on any route
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search: any = useSearch({ strict: false });
  const navigate = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const activeSlug = (typeof search.section === 'string' ? search.section as string : null) ?? DEFAULT_SECTION?.slug ?? 'profile';

  const activeSection = useMemo(
    () => SECTIONS.find((s) => s.slug === activeSlug) ?? DEFAULT_SECTION ?? SECTIONS[0],
    [activeSlug],
  );

  function handleSectionClick(slug: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
    void (navigate as any)({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      search: (prev: any) => ({ ...(prev as object), section: slug }),
    });
  }

  return (
    <Group align="flex-start" gap={0} style={{ height: '100%' }}>
      {/* Subnav sidebar */}
      <Box
        style={{
          width: 220,
          borderRight: '1px solid var(--mantine-color-default-border)',
          height: '100%',
          flexShrink: 0,
        }}
        p="sm"
      >
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="xs" pt="xs" pb="xs">
          Settings
        </Text>
        <Stack gap={2}>
          {SECTIONS.map((section) => (
            <NavLink
              key={section.slug}
              label={section.label}
              leftSection={<section.icon size={16} />}
              active={activeSlug === section.slug}
              onClick={() => { handleSectionClick(section.slug); }}
              data-testid={`settings-nav-${section.slug}`}
            />
          ))}
        </Stack>
      </Box>

      {/* Section content */}
      <Box flex={1} p="md">
        <Stack gap="md">
          {activeSection && (
            <>
              <Title order={3}>{activeSection.label}</Title>
              <EmptyState
                icon={activeSection.icon}
                title={`${activeSection.label} settings`}
                description={`This section will be populated in ${activeSection.plan}.`}
              />
            </>
          )}
        </Stack>
      </Box>
    </Group>
  );
}
