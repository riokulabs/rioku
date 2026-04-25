/**
 * <AnalyticsNavPanel> — secondary-nav panel renderer for the Analytics section.
 *
 * Lists every dashboard in the active tenant as a NavLink, sorted with the
 * tenant default first. Includes a tenant-scoped search input and footer
 * actions for creating / importing dashboards. Replaces the static "Insights"
 * child for the Analytics rail section.
 */
import { useMemo, useState } from 'react';
import { Box, Button, Group, NavLink, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconLayoutDashboard,
  IconPlus,
  IconSearch,
  IconStar,
  IconUpload,
} from '@tabler/icons-react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useDisclosure } from '@mantine/hooks';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import {
  ImportDashboardModal,
  createDashboard,
  useDashboardList,
} from '@/features/dashboards';
import type { Dashboard, DashboardFilter } from '@/features/dashboards/types';

interface AnalyticsNavPanelProps {
  tenantSlug: string;
  onNavLinkClick?: () => void;
}

const EMPTY_FILTER: DashboardFilter = { search: '', modes: [], scopes: [] };

const MODE_COLORS: Record<Dashboard['mode'], string> = {
  metabase: 'blue',
  grafana: 'violet',
};

export function AnalyticsNavPanel({ tenantSlug, onNavLinkClick }: AnalyticsNavPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenantSlug),
  );
  const tenantId = tenantRecord?.id ?? '';
  const currentUserId = useMockStore((s) => s.currentUserId);
  const canWrite = usePermission('dashboard:write');

  const [query, setQuery] = useState('');
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false);

  const dashboards = useDashboardList(tenantId, EMPTY_FILTER);
  const sorted = useMemo(() => {
    const list = [...dashboards].sort((a, b) => {
      if (a.default !== b.default) return a.default ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    if (query.trim().length === 0) return list;
    const q = query.trim().toLowerCase();
    return list.filter(
      (d) => d.name.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q),
    );
  }, [dashboards, query]);

  async function handleNew() {
    try {
      const created = await createDashboard(tenantId, {
        name: 'Untitled dashboard',
        mode: 'metabase',
        scope: 'personal',
        owner_user_id: currentUserId ?? null,
      });
      notify.success('Dashboard created', 'Starting builder…');
      void navigate({
        to: '/t/$tenant/dashboards/$dashboardId/edit',
        params: { tenant: tenantSlug, dashboardId: created.id },
      } as unknown as Parameters<typeof navigate>[0]);
      onNavLinkClick?.();
    } catch (e) {
      notify.error('Create failed', (e as Error).message);
    }
  }

  return (
    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
      <Box p="sm" pb={6}>
        <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.06em' }}>
          Analytics
        </Text>
      </Box>

      <Box px="sm" pb="xs">
        <TextInput
          size="xs"
          placeholder="Search dashboards…"
          leftSection={<IconSearch size={12} />}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
          }}
          aria-label="Search dashboards"
          data-testid="analytics-nav-search"
        />
      </Box>

      <Box style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {sorted.length === 0 ? (
          <Text size="xs" c="dimmed" px="md" py="sm">
            {query.trim().length > 0
              ? `No dashboards match "${query}"`
              : 'No dashboards yet. Create one below.'}
          </Text>
        ) : (
          <Stack gap={2} px={6}>
            {sorted.map((d) => {
              const itemPath = `/t/${tenantSlug}/dashboards/${d.id}`;
              const active = location.pathname === itemPath;
              return (
                <NavLink
                  key={d.id}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                  component={Link as any}
                  to="/t/$tenant/dashboards/$dashboardId"
                  params={{ tenant: tenantSlug, dashboardId: d.id }}
                  active={active}
                  {...(onNavLinkClick !== undefined && { onClick: onNavLinkClick })}
                  data-testid={`analytics-nav-item-${d.id}`}
                  label={
                    <Group gap={4} wrap="nowrap" justify="space-between" align="center">
                      <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                        {d.name}
                      </Text>
                      <Group gap={4} wrap="nowrap">
                        {d.default && (
                          <Tooltip label="Tenant default" withArrow position="right">
                            <IconStar
                              size={12}
                              style={{
                                color: 'var(--mantine-color-green-6)',
                                flexShrink: 0,
                              }}
                            />
                          </Tooltip>
                        )}
                        <Box
                          aria-label={`Mode: ${d.mode}`}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: `var(--mantine-color-${MODE_COLORS[d.mode]}-6)`,
                            flexShrink: 0,
                          }}
                        />
                      </Group>
                    </Group>
                  }
                  leftSection={<IconLayoutDashboard size={14} />}
                />
              );
            })}
          </Stack>
        )}
      </Box>

      <Stack gap={6} px="sm" pb="sm" pt="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Tooltip
          label="You don't have permission to create dashboards"
          disabled={canWrite}
          withArrow
          position="top"
        >
          <span>
            <Button
              fullWidth
              size="xs"
              leftSection={<IconPlus size={14} />}
              disabled={!canWrite}
              onClick={() => {
                void handleNew();
              }}
              data-testid="analytics-nav-new"
            >
              New dashboard
            </Button>
          </span>
        </Tooltip>
        <Tooltip
          label="You don't have permission to import dashboards"
          disabled={canWrite}
          withArrow
          position="top"
        >
          <span>
            <Button
              fullWidth
              size="xs"
              variant="default"
              leftSection={<IconUpload size={14} />}
              disabled={!canWrite}
              onClick={openImport}
              data-testid="analytics-nav-import"
            >
              Import
            </Button>
          </span>
        </Tooltip>
      </Stack>

      <ImportDashboardModal
        opened={importOpened}
        tenantId={tenantId}
        onClose={closeImport}
        onImported={(imported) => {
          void navigate({
            to: '/t/$tenant/dashboards/$dashboardId',
            params: { tenant: tenantSlug, dashboardId: imported.id },
          } as unknown as Parameters<typeof navigate>[0]);
        }}
      />
    </Stack>
  );
}
