/**
 * <ServiceFullPage> — full-page detail view for a single service.
 *
 * Tabs:
 *   - Overview  : header + upstream + tags + last reload metadata
 *   - Routes    : routes attached to this service
 *   - Health    : health status + per-upstream check + force-reload action
 *   - Audit     : audit entries scoped to this service id
 */
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Stack, Tabs, Table, Text, Title } from '@mantine/core';
import {
  IconAlertCircle,
  IconHeartbeat,
  IconHistory,
  IconInfoCircle,
  IconRefresh,
  IconRoute,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { notify } from '@/hooks/use-notify';
import { HealthChip, ProtocolBadge } from '@/features/api-mgmt-shared';
import {
  useAuditList,
  encodeResourceHandle,
  type AuditFilter,
  type AuditEntry,
} from '@/features/audit';
import { useServiceDetail, useServiceRoutes, forceReloadService } from '../api';

dayjs.extend(relativeTime);

export interface ServiceFullPageProps {
  serviceId: string;
  tenantId: string;
}

const EMPTY_AUDIT_FILTER_BASE: Omit<AuditFilter, 'resource_id_handles'> = {
  actions: [],
  outcomes: [],
  resource_types: [],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  search: '',
};

export function ServiceFullPage({ serviceId, tenantId }: ServiceFullPageProps) {
  const service = useServiceDetail(tenantId, serviceId);
  const routes = useServiceRoutes(tenantId, serviceId);

  // Audit scoped to this service via the resource handle convention.
  const auditFilter: AuditFilter = useMemo(
    () => ({
      ...EMPTY_AUDIT_FILTER_BASE,
      resource_id_handles: [encodeResourceHandle('service', serviceId)],
    }),
    [serviceId],
  );
  const auditEntries = useAuditList(tenantId, auditFilter);

  const [reloading, setReloading] = useState(false);

  if (!service) {
    return (
      <Alert
        color="red"
        variant="light"
        icon={<IconAlertCircle size={16} />}
        data-testid="service-fullpage-not-found"
      >
        Service not found.
      </Alert>
    );
  }

  async function handleForceReload() {
    if (!service) return;
    setReloading(true);
    try {
      await forceReloadService(tenantId, service.id);
      notify.success('Service reloaded', `${service.name} reloaded.`);
    } catch {
      notify.error('Failed to reload service', 'Please try again.');
    } finally {
      setReloading(false);
    }
  }

  return (
    <Stack gap="md" data-testid="service-fullpage">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs">
            <Title order={3} ff="monospace">
              {service.name}
            </Title>
            <HealthChip status={service.health} />
            <Badge size="sm" variant="outline" color="blue">
              {service.env}
            </Badge>
          </Group>
          {service.description && (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {service.description}
            </Text>
          )}
        </Stack>
      </Group>

      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab
            value="overview"
            leftSection={<IconInfoCircle size={14} />}
            data-testid="service-fullpage-tab-overview"
          >
            Overview
          </Tabs.Tab>
          <Tabs.Tab
            value="routes"
            leftSection={<IconRoute size={14} />}
            data-testid="service-fullpage-tab-routes"
          >
            Routes ({String(routes.length)})
          </Tabs.Tab>
          <Tabs.Tab
            value="health"
            leftSection={<IconHeartbeat size={14} />}
            data-testid="service-fullpage-tab-health"
          >
            Health
          </Tabs.Tab>
          <Tabs.Tab
            value="audit"
            leftSection={<IconHistory size={14} />}
            data-testid="service-fullpage-tab-audit"
          >
            Audit ({String(auditEntries.length)})
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md" data-testid="service-fullpage-panel-overview">
          <Stack gap="sm">
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Upstream:
              </Text>
              <ProtocolBadge kind={service.upstream_protocol} />
              <Text size="sm" ff="monospace">
                {service.upstream}
              </Text>
            </Group>
            <Text size="sm">
              <Text component="span" fw={600}>
                Tags:{' '}
              </Text>
              {service.tags.length === 0 ? (
                <Text component="span" c="var(--mantine-color-gray-7)">
                  none
                </Text>
              ) : (
                service.tags.join(', ')
              )}
            </Text>
            <Text size="sm">
              <Text component="span" fw={600}>
                Created:{' '}
              </Text>
              {service.created_at ? dayjs(service.created_at).format('MMM D, YYYY HH:mm') : '—'}
            </Text>
            <Text size="sm">
              <Text component="span" fw={600}>
                Last reloaded:{' '}
              </Text>
              {service.last_reloaded_at ? dayjs(service.last_reloaded_at).fromNow() : 'never'}
            </Text>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="routes" pt="md" data-testid="service-fullpage-panel-routes">
          {routes.length === 0 ? (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              No routes attached to this service.
            </Text>
          ) : (
            <Table highlightOnHover data-testid="service-fullpage-routes-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Method</Table.Th>
                  <Table.Th>Path</Table.Th>
                  <Table.Th>Enabled</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {routes.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {r.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light">
                        {r.method}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {r.path}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" color={r.enabled ? 'green' : 'gray'}>
                        {r.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="health" pt="md" data-testid="service-fullpage-panel-health">
          <Stack gap="sm">
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Status:
              </Text>
              <HealthChip status={service.health} />
            </Group>
            {service.health_check ? (
              <Stack gap={4}>
                <Text size="sm">
                  <Text component="span" fw={600}>
                    Health check:{' '}
                  </Text>
                  GET {service.health_check.path}
                </Text>
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  Interval: {String(service.health_check.interval_seconds)}s · Timeout:{' '}
                  {String(service.health_check.timeout_seconds)}s
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                Health check: disabled
              </Text>
            )}
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Last reloaded:{' '}
              {service.last_reloaded_at ? dayjs(service.last_reloaded_at).fromNow() : 'never'}
            </Text>
            <Group>
              <Button
                size="sm"
                variant="light"
                leftSection={<IconRefresh size={14} />}
                loading={reloading}
                onClick={() => void handleForceReload()}
                data-testid="service-fullpage-force-reload"
              >
                Force reload
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md" data-testid="service-fullpage-panel-audit">
          {auditEntries.length === 0 ? (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              No audit entries for this service yet.
            </Text>
          ) : (
            <Table striped highlightOnHover data-testid="service-fullpage-audit-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Action</Table.Th>
                  <Table.Th>Actor</Table.Th>
                  <Table.Th>Outcome</Table.Th>
                  <Table.Th>When</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {auditEntries.map((entry: AuditEntry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {entry.action}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{entry.actor_id}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        color={
                          entry.outcome === 'success'
                            ? 'green'
                            : entry.outcome === 'denied'
                              ? 'orange'
                              : 'red'
                        }
                      >
                        {entry.outcome}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{dayjs(entry.at).format('MMM D, HH:mm:ss')}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
