/**
 * <SiteFullPage> — full-screen tabbed view for a single site, rendered by
 * the per-site route file (`/t/$tenant/sites/$siteId`).
 *
 * Tabs (per stage-2 plan-03 T5):
 *   - Overview: name / domain / enabled / linked-service / rate-limit / basic-auth
 *   - TLS: tls_mode badge + auto/manual cert preview info
 *   - Routes: routes attached via the site's linked service (filtered list)
 *   - Audit: recent audit entries scoped to this site
 *
 * Backed by real Orval-generated hooks (`useSiteDetailReal` and the routes
 * `listRoutes` query). Audit entries are sourced from the host audit feed
 * (mock-backed today, replaced when Plan 5 ships SSE-backed audit lists).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Group, Stack, Tabs, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconHistory,
  IconInfoCircle,
  IconLock,
  IconRoute,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useAuditList } from '@/features/audit/api';
import type { AuditFilter } from '@/features/audit/types';
import { listRoutes, getListRoutesQueryKey } from '@/api/generated/routes/routes';
import type { V1Route } from '@/api/generated/schemas';
import { useSiteDetailReal } from '../api.stage2';

const SITE_AUDIT_FILTER: AuditFilter = {
  actions: [],
  outcomes: [],
  resource_types: ['site'],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  resource_id_handles: [],
  search: '',
};

dayjs.extend(relativeTime);

export interface SiteFullPageProps {
  tenantId: string;
  tenantSlug: string;
  siteId: string;
}

interface ListRoutesEnvelope {
  items?: V1Route[];
  data?: { items?: V1Route[] };
}

function tlsBadge(mode: string | undefined) {
  if (mode === 'auto') {
    return (
      <Badge size="md" color="green" variant="light" data-testid="tls-badge">
        TLS auto
      </Badge>
    );
  }
  if (mode === 'manual') {
    return (
      <Badge size="md" color="teal" variant="light" data-testid="tls-badge">
        TLS manual
      </Badge>
    );
  }
  return (
    <Badge size="md" color="gray" variant="outline" data-testid="tls-badge">
      TLS off
    </Badge>
  );
}

export function SiteFullPage({ tenantId, tenantSlug, siteId }: SiteFullPageProps) {
  const site = useSiteDetailReal(tenantId, siteId);

  // Routes attached via the site's linked service. The daemon's list-routes
  // endpoint is tenant-scoped; we filter client-side by serviceId.
  const routesQuery = useQuery({
    queryKey: getListRoutesQueryKey(tenantId),
    queryFn: ({ signal }) => listRoutes(tenantId, { signal }),
    enabled: Boolean(tenantId) && Boolean(site?.upstream_service_id),
  });

  const linkedServiceId = site?.upstream_service_id;
  const attachedRoutes: V1Route[] = useMemo(() => {
    const data = routesQuery.data as unknown as ListRoutesEnvelope | undefined;
    const items = data?.items ?? data?.data?.items ?? [];
    if (!linkedServiceId) return [];
    return items.filter((r) => r.serviceId === linkedServiceId);
  }, [routesQuery.data, linkedServiceId]);

  const auditEntries = useAuditList(tenantId, SITE_AUDIT_FILTER);
  const auditTail = useMemo(() => {
    return auditEntries
      .filter((e) => e.resource_id === siteId)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 20);
  }, [auditEntries, siteId]);

  if (!site) {
    return (
      <Stack gap="md" p="md">
        <Group gap="xs">
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconArrowLeft size={14} />}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            component={Link as any}
            to="/t/$tenant/sites"
            params={{ tenant: tenantSlug }}
          >
            Back to sites
          </Button>
        </Group>
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          Site not found or not accessible in this tenant.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md" p="md" data-testid="site-full-page">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconArrowLeft size={14} />}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            component={Link as any}
            to="/t/$tenant/sites"
            params={{ tenant: tenantSlug }}
          >
            Back to sites
          </Button>
          <Title order={2} ff="monospace">
            {site.domain}
          </Title>
          {tlsBadge(site.tls_mode)}
        </Group>
      </Group>

      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconInfoCircle size={14} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="tls" leftSection={<IconLock size={14} />}>
            TLS
          </Tabs.Tab>
          <Tabs.Tab value="routes" leftSection={<IconRoute size={14} />}>
            Routes
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Stack gap="sm" data-testid="tab-overview">
            <Group gap="xs">
              <Text size="sm" fw={600} w={160}>
                Name
              </Text>
              <Text size="sm">{site.name}</Text>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={600} w={160}>
                Domain
              </Text>
              <Text size="sm" ff="monospace">
                {site.domain}
              </Text>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={600} w={160}>
                Enabled
              </Text>
              <Badge size="sm" color={site.enabled ? 'green' : 'gray'} variant="light">
                {site.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={600} w={160}>
                Linked service
              </Text>
              <Text size="sm" ff="monospace">
                {site.upstream_service_id ?? '— (no linked service)'}
              </Text>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={600} w={160}>
                Basic auth
              </Text>
              <Badge size="sm" color={site.basic_auth_enabled ? 'indigo' : 'gray'} variant="light">
                {site.basic_auth_enabled ? 'on' : 'off'}
              </Badge>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={600} w={160}>
                Rate limit preset
              </Text>
              <Badge size="sm" color="orange" variant="light">
                {site.rate_limit_preset}
              </Badge>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="tls" pt="md">
          <Stack gap="sm" data-testid="tab-tls">
            <Group gap="xs">
              <Text size="sm" fw={600} w={160}>
                Mode
              </Text>
              {tlsBadge(site.tls_mode)}
            </Group>
            {site.tls_mode === 'auto' && (
              <Alert variant="light" color="green" icon={<IconLock size={16} />}>
                Caddy will provision and renew certificates automatically via ACME (default issuer).
              </Alert>
            )}
            {site.tls_mode === 'manual' && site.tls_manual_cert ? (
              <Stack gap={4} data-testid="tls-cert-info">
                <Text size="sm" fw={600}>
                  Certificate (PEM preview)
                </Text>
                <Text size="xs" ff="monospace">
                  cert: {site.tls_manual_cert.cert_pem_preview}…
                </Text>
                <Text size="xs" ff="monospace">
                  key: {site.tls_manual_cert.key_pem_preview}…
                </Text>
              </Stack>
            ) : site.tls_mode === 'manual' ? (
              <Alert variant="light" color="yellow" icon={<IconAlertCircle size={16} />}>
                Manual TLS mode is set but no certificate preview is available via the wire shape.
                Inspect via the daemon CLI.
              </Alert>
            ) : null}
            {site.tls_mode === 'off' && (
              <Alert variant="light" color="gray" icon={<IconAlertCircle size={16} />}>
                TLS is disabled for this site. Traffic will be served over plaintext HTTP.
              </Alert>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="routes" pt="md">
          <Stack gap="sm" data-testid="tab-routes">
            {!linkedServiceId && (
              <Alert variant="light" color="gray" icon={<IconAlertCircle size={16} />}>
                This site has no linked service, so no attached routes.
              </Alert>
            )}
            {linkedServiceId && routesQuery.isLoading && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                Loading routes…
              </Text>
            )}
            {linkedServiceId && !routesQuery.isLoading && attachedRoutes.length === 0 && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                No routes are attached to the linked service.
              </Text>
            )}
            {attachedRoutes.length > 0 && (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Service</Table.Th>
                    <Table.Th>Enabled</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {attachedRoutes.map((r) => (
                    <Table.Tr key={r.id ?? ''}>
                      <Table.Td>
                        <Text size="sm" ff="monospace">
                          {r.name ?? r.id ?? ''}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {r.serviceId ?? '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" color={r.enabled ? 'green' : 'gray'} variant="light">
                          {r.enabled ? 'enabled' : 'disabled'}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <Stack gap="sm" data-testid="tab-audit">
            {auditTail.length === 0 ? (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                No audit entries for this site yet.
              </Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Action</Table.Th>
                    <Table.Th>Actor</Table.Th>
                    <Table.Th>When</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {auditTail.map((e) => (
                    <Table.Tr key={e.id}>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {e.action}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{e.actor_id}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{dayjs(e.at).format('MMM D, HH:mm:ss')}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
