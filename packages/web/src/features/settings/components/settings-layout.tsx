/**
 * <SettingsLayout> — settings page with subnav sidebar.
 *
 * Uses ?section=<slug> query param to track active section.
 * Each section renders a placeholder <EmptyState> citing the plan that
 * will populate it.
 *
 * spec / Task 1d.79
 */
import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBell,
  IconBuilding,
  IconCertificate,
  IconChartBar,
  IconCode,
  IconLock,
  IconNetwork,
  IconPlug,
  IconShield,
  IconUser,
} from '@tabler/icons-react';
import { Link, useSearch, useNavigate } from '@tanstack/react-router';
import type { Icon } from '@tabler/icons-react';
import { EmptyState } from '@/components/empty-state';
import { SettingsSearch } from './settings-search';
import { useMockStore } from '@/api/mock-store';
import { ProfileSection } from '../sections/profile';
import { TenantSection } from '../sections/tenant';
import { AuthenticationSection } from '../sections/authentication';
import { NetworkSection } from '../sections/network';
import { PkiSection } from '../sections/pki';
import { TlsSection } from '../sections/tls';
import { ObservabilitySection } from '../sections/observability';
import { IntegrationsSection } from '../sections/integrations';
import { PluginSettingsSection } from '../sections/plugin-settings';
import { DangerZoneSection } from '../sections/danger-zone';

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

/**
 * Sections that have a real landing subroute now. These render a "Open <page>"
 * anchor instead of the placeholder EmptyState so users can jump straight into
 * the implemented UI.
 */
const SECTION_ROUTES: Record<string, { to: string; linkLabel: string }> = {
  notifications: {
    to: '/t/$tenant/settings/notifications',
    linkLabel: 'Open notifications',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

const DEFAULT_SECTION = SECTIONS[0];

export function SettingsLayout() {
  // Read active section from search param — strict: false so it works on any route
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search: any = useSearch({ strict: false });
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Derive tenant slug from the active mock-store tenant — the layout is
  // rendered inside a `/t/$tenant` tree, but the test harness stubs the router
  // so we avoid `useParams()` here.
  const tenantSlug = useMockStore((s) => {
    const tenant = s.tenants[s.currentTenantId ?? ''];
    return tenant?.slug ?? '';
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const activeSlug = (typeof search.section === 'string' ? search.section as string : null) ?? DEFAULT_SECTION?.slug ?? 'profile';

  const activeSection = useMemo(
    () => SECTIONS.find((s) => s.slug === activeSlug) ?? DEFAULT_SECTION ?? SECTIONS[0],
    [activeSlug],
  );

  const visibleSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const sectionRoute = activeSection ? SECTION_ROUTES[activeSection.slug] : undefined;

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
        <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600} px="xs" pt="xs" pb="xs">
          Settings
        </Text>
        <SettingsSearch
          sections={visibleSections}
          query={searchQuery}
          onChange={(q) => { setSearchQuery(q); setFocusedIndex(0); }}
          activeSlug={activeSlug}
          focusedIndex={focusedIndex}
          onFocusedIndexChange={setFocusedIndex}
          onSectionClick={handleSectionClick}
        />
      </Box>

      {/* Section content */}
      <Box flex={1} p="md">
        <Stack gap="md">
          {activeSection && (
            <>
              <Title order={3}>{activeSection.label}</Title>
              {activeSection.slug === 'profile' ? (
                <ProfileSection />
              ) : activeSection.slug === 'tenant' ? (
                <TenantSection />
              ) : activeSection.slug === 'authentication' ? (
                <AuthenticationSection />
              ) : activeSection.slug === 'network' ? (
                <NetworkSection />
              ) : activeSection.slug === 'pki' ? (
                <PkiSection />
              ) : activeSection.slug === 'tls' ? (
                <TlsSection />
              ) : activeSection.slug === 'observability' ? (
                <ObservabilitySection />
              ) : activeSection.slug === 'integrations' ? (
                <IntegrationsSection />
              ) : activeSection.slug === 'plugins' ? (
                <PluginSettingsSection />
              ) : activeSection.slug === 'danger-zone' ? (
                <DangerZoneSection />
              ) : sectionRoute ? (
                <Stack gap="sm" align="flex-start">
                  <Text size="sm">
                    {activeSection.label} settings live on a dedicated page — it
                    manages channels, routing rules, and the delivery log.
                  </Text>
                  <Button
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
                    component={Link as any}
                    to={sectionRoute.to}
                    params={{ tenant: tenantSlug }}
                    rightSection={<IconArrowRight size={14} />}
                    variant="light"
                    size="sm"
                    data-testid={`settings-section-open-${activeSection.slug}`}
                  >
                    {sectionRoute.linkLabel}
                  </Button>
                  <Text size="xs" c="var(--mantine-color-gray-7)">
                    ({activeSection.plan})
                  </Text>
                </Stack>
              ) : (
                <EmptyState
                  icon={activeSection.icon}
                  title={`${activeSection.label} settings`}
                  description={`This section will be populated in ${activeSection.plan}.`}
                />
              )}
            </>
          )}
        </Stack>
      </Box>
    </Group>
  );
}
