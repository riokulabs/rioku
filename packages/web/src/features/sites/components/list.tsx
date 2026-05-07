/**
 * <SiteList> — DataTable list of sites for a tenant.
 *
 * Columns: domain (monospace + TLS badge), linked service name (clickable chip
 * or "Direct upstream"), rate-limit preset Badge, enabled Switch (inline
 * toggle), actions menu (Edit / Delete). Row click fires `onSelect`.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { ActionIcon, Badge, Group, Menu, Stack, Switch, Text } from '@mantine/core';
import { IconDots, IconPencil, IconTrash, IconWorld } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useMockStore } from '@/api/mock-store';
import type { Site } from '@/api/resources';
import { notify } from '@/hooks/use-notify';
import { useSiteList, toggleSite } from '../api';
import type { SiteFilter } from '../types';

interface SiteListProps {
  tenantId: string;
  tenantSlug: string;
  filter: SiteFilter;
  onSelect: (site: Site) => void;
  onEdit: (site: Site) => void;
  onDelete: (site: Site) => void;
}

function tlsBadge(mode: Site['tls_mode']) {
  if (mode === 'auto') {
    return (
      <Badge size="xs" color="green" variant="light">
        TLS auto
      </Badge>
    );
  }
  if (mode === 'manual') {
    return (
      <Badge size="xs" color="teal" variant="light">
        TLS manual
      </Badge>
    );
  }
  return (
    <Badge size="xs" color="gray" variant="outline">
      TLS off
    </Badge>
  );
}

function rateLimitColor(preset: Site['rate_limit_preset']): string {
  switch (preset) {
    case 'strict':
      return 'red';
    case 'standard':
      return 'orange';
    case 'lenient':
      return 'yellow';
    default:
      return 'gray';
  }
}

export function SiteList({
  tenantId,
  tenantSlug,
  filter,
  onSelect,
  onEdit,
  onDelete,
}: SiteListProps) {
  const sites = useSiteList(tenantId, filter);
  const services = useMockStore((s) => s.services);

  // Derive id → service map outside the selector for stable references.
  const servicesById = useMemo(() => services, [services]);

  async function handleToggle(site: Site, next: boolean) {
    try {
      await toggleSite(site.tenant_id, site.id, next);
      notify.success(
        next ? 'Site enabled' : 'Site disabled',
        `${site.domain} is now ${next ? 'serving traffic' : 'disabled'}.`,
      );
    } catch {
      notify.error('Failed to update site', 'Please try again.');
    }
  }

  const columns = useMemo<ColumnDef<Site>[]>(
    () => [
      {
        id: 'domain',
        header: 'Domain',
        accessorFn: (row) => row.domain,
        cell: ({ row }) => {
          const site = row.original;
          return (
            <Stack gap={2}>
              <Group gap="xs" wrap="nowrap">
                <IconWorld size={14} color="var(--mantine-color-blue-6)" />
                <Text size="sm" fw={500} ff="monospace">
                  {site.domain}
                </Text>
                {tlsBadge(site.tls_mode)}
              </Group>
              {site.name !== site.domain && (
                <Text size="xs" c="var(--mantine-color-gray-7)" lineClamp={1} title={site.name}>
                  {site.name}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'upstream',
        header: 'Upstream',
        accessorFn: (row) => row.upstream_service_id ?? 'direct',
        cell: ({ row }) => {
          const site = row.original;
          const serviceId = site.upstream_service_id;
          if (!serviceId) {
            return (
              <Text size="xs" c="var(--mantine-color-gray-7)" fs="italic">
                Direct upstream
              </Text>
            );
          }
          const svc = servicesById[serviceId];
          if (!svc) {
            return (
              <Text size="xs" c="var(--mantine-color-red-7)">
                Missing service
              </Text>
            );
          }
          return (
            <Badge
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
              component={Link as any}
              to="/t/$tenant/services_/$serviceId"
              params={{ tenant: tenantSlug, serviceId }}
              size="sm"
              variant="light"
              color="blue"
              style={{ cursor: 'pointer', textDecoration: 'none' }}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
              }}
            >
              {svc.name}
            </Badge>
          );
        },
      },
      {
        id: 'rate_limit',
        header: 'Rate limit',
        size: 140,
        accessorFn: (row) => row.rate_limit_preset,
        cell: ({ row }) => {
          const preset = row.original.rate_limit_preset;
          return (
            <Badge size="sm" variant="light" color={rateLimitColor(preset)}>
              {preset}
            </Badge>
          );
        },
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const site = row.original;
          return (
            <Switch
              size="sm"
              checked={site.enabled}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={(e) => {
                void handleToggle(site, e.currentTarget.checked);
              }}
              aria-label={`Toggle ${site.domain}`}
            />
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const site = row.original;
          return (
            <Menu shadow="md" width={180} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${site.domain}`}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconPencil size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(site);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(site);
                  }}
                >
                  Delete…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          );
        },
      },
    ],
    [servicesById, tenantSlug, onEdit, onDelete],
  );

  return (
    <DataTable
      data={sites}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="sites"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconWorld}
          title="No sites"
          description="Create your first site to publish a domain through Rioku."
        />
      }
      caption="Sites"
    />
  );
}
