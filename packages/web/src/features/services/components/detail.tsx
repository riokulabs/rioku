/**
 * <ServiceDetail> — drawer content for a service.
 *
 * Sections:
 *   - Header (name, description, health, env, tags)
 *   - Upstream (protocol, host, health-check config, last_reloaded_at)
 *   - Attached routes (nested <RouteList> scoped to this service)
 *   - Middlewares referenced by this service's routes (dedup)
 *   - Policies attached via this service's routes (dedup)
 *   - Actions (Edit, Force-reload, Delete — typed-name confirm)
 *   - Audit tail (last 10 entries for resource_type='service')
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconRefresh, IconServer } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useAuditList } from '@/features/audit/api';
import type { AuditFilter } from '@/features/audit/types';
import { useMiddlewareListReal } from '@/features/middlewares/api.stage2';
import type { MiddlewareFilter } from '@/features/middlewares/types';
import { useAccessPolicyList } from '@/features/security/access-policies';

const SERVICE_AUDIT_FILTER: AuditFilter = {
  actions: [],
  outcomes: [],
  resource_types: ['service'],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  resource_id_handles: [],
  search: '',
};

const EMPTY_MIDDLEWARE_FILTER: MiddlewareFilter = {
  search: '',
  kind: 'all',
  enabled: 'all',
};
import { notify } from '@/hooks/use-notify';
import { HealthChip, ProtocolBadge } from '@/features/api-mgmt-shared';
import { RouteList } from '@/features/routes/components/list';
import type { RouteFilter, Route } from '@/features/routes/types';
import { useServiceDetail, useServiceRoutes, deleteService, forceReloadService } from '../api';
import { ServiceInUseError } from '../types';

dayjs.extend(relativeTime);

interface ServiceDetailProps {
  serviceId: string;
  tenantId: string;
  onEdit: () => void;
  onSelectRoute: (route: Route) => void;
  onEditRoute: (route: Route) => void;
  onDeleteRoute: (route: Route) => void;
  onClose: () => void;
}

const DEFAULT_ROUTE_FILTER: RouteFilter = {
  search: '',
  method: 'all',
  enabled: 'all',
};

export function ServiceDetail({
  serviceId,
  tenantId,
  onEdit,
  onSelectRoute,
  onEditRoute,
  onDeleteRoute,
  onClose,
}: ServiceDetailProps) {
  const service = useServiceDetail(tenantId, serviceId);
  const routes = useServiceRoutes(tenantId, serviceId);
  const auditEntries = useAuditList(tenantId, SERVICE_AUDIT_FILTER);
  const { middlewares: middlewareList } = useMiddlewareListReal(tenantId, EMPTY_MIDDLEWARE_FILTER);
  const middlewares = useMemo(() => {
    const m: Record<string, (typeof middlewareList)[number]> = {};
    for (const mw of middlewareList) m[mw.id] = mw;
    return m;
  }, [middlewareList]);
  const { data: accessPolicyList } = useAccessPolicyList(tenantId);
  const accessPolicies = useMemo(() => {
    const m: Record<string, (typeof accessPolicyList)[number]> = {};
    for (const p of accessPolicyList) m[p.id] = p;
    return m;
  }, [accessPolicyList]);

  const usedMiddlewareIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of routes) {
      for (const mid of r.middleware_ids) set.add(mid);
    }
    return set;
  }, [routes]);
  const usedMiddlewares = useMemo(
    () =>
      Array.from(usedMiddlewareIds)
        .map((id) => middlewares[id])
        .filter((m): m is NonNullable<typeof m> => m !== undefined),
    [usedMiddlewareIds, middlewares],
  );

  const usedPolicyIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of routes) {
      for (const pid of r.policies) set.add(pid);
    }
    return set;
  }, [routes]);
  const usedPolicies = useMemo(
    () =>
      Array.from(usedPolicyIds)
        .map((id) => accessPolicies[id])
        .filter((p): p is NonNullable<typeof p> => p !== undefined),
    [usedPolicyIds, accessPolicies],
  );

  const auditTail = useMemo(() => {
    if (!service) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'service' && e.resource_id === service.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, service]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState(false);

  if (!service) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
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

  async function handleDelete() {
    if (!service) return;
    if (deleteInput !== service.name) return;
    setDeleting(true);
    try {
      await deleteService(tenantId, service.id);
      notify.success('Service deleted', `${service.name} was removed.`);
      closeDelete();
      onClose();
    } catch (err) {
      if (err instanceof ServiceInUseError) {
        notify.error(
          'Cannot delete — in use',
          `${String(err.routeIds.length)} route(s) still reference this service.`,
        );
      } else {
        notify.error('Failed to delete service', 'Please try again.');
      }
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  const deleteBlocked = routes.length > 0;

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconServer size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4} ff="monospace">
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
            {service.tags.length > 0 && (
              <Group gap={4} mt={4}>
                {service.tags.map((t) => (
                  <Badge key={t} size="xs" variant="light" color="gray">
                    {t}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Upstream */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Upstream
        </Text>
        <Group gap="xs">
          <ProtocolBadge kind={service.upstream_protocol} />
          <Text size="xs" ff="monospace">
            {service.upstream}
          </Text>
        </Group>
        {service.health_check ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Health check: GET {service.health_check.path} · every{' '}
            {String(service.health_check.interval_seconds)}s · timeout{' '}
            {String(service.health_check.timeout_seconds)}s
          </Text>
        ) : (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Health check: disabled
          </Text>
        )}
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Last reloaded:{' '}
          {service.last_reloaded_at ? dayjs(service.last_reloaded_at).fromNow() : 'never'}
        </Text>
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          loading={reloading}
          onClick={() => void handleForceReload()}
        >
          Force reload
        </Button>
        <Button
          size="sm"
          variant="subtle"
          color="red.8"
          disabled={deleteBlocked}
          onClick={openDelete}
          title={deleteBlocked ? 'Remove attached routes before deleting' : undefined}
        >
          Delete…
        </Button>
      </Group>

      <Divider />

      {/* Attached routes */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Routes ({String(routes.length)})
        </Text>
        <RouteList
          serviceId={service.id}
          tenantId={tenantId}
          filter={DEFAULT_ROUTE_FILTER}
          onSelect={onSelectRoute}
          onEdit={onEditRoute}
          onDelete={onDeleteRoute}
        />
      </Stack>

      <Divider />

      {/* Middlewares referenced */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Middlewares in use ({String(usedMiddlewares.length)})
        </Text>
        {usedMiddlewares.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No middlewares referenced by routes of this service.
          </Text>
        ) : (
          <Group gap={6}>
            {usedMiddlewares.map((m) => (
              <Badge key={m.id} size="xs" variant="light" color="violet">
                {m.name} · {m.kind}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      {/* Policies referenced */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Policies in use ({String(usedPolicies.length)})
        </Text>
        {usedPolicies.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No policies attached via routes under this service.
          </Text>
        ) : (
          <Group gap={6}>
            {usedPolicies.map((p) => (
              <Badge
                key={p.id}
                size="xs"
                variant="light"
                color={p.action === 'allow' ? 'green' : 'red'}
              >
                {p.name} · {p.action}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      <Divider />

      {/* Audit tail */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent activity
        </Text>
        {auditTail.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No audit entries for this service yet.
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

      {/* Delete modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete service"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the service. Routes still referencing it must be removed first.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {service.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={service.name}
            data-autofocus
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeDelete();
                setDeleteInput('');
              }}
            >
              Cancel
            </Button>
            <Button
              color="red.8"
              size="sm"
              loading={deleting}
              disabled={deleteInput !== service.name}
              onClick={() => void handleDelete()}
            >
              Delete permanently
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
