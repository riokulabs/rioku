/**
 * <RouteDetail> — drawer content for a single route.
 *
 * Sections:
 *   - Header (name, method, enabled badge)
 *   - Match info (method + match_kind + path + strip_prefix + rewrite_path)
 *   - Attached policies  (<AttachedPolicies>)
 *   - Middleware stack   (<MiddlewareStackEditor>)
 *   - Headers summary
 *   - Audit tail for this route (last 10 entries)
 *   - Actions (Edit, Delete)
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
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconArrowsDiagonal, IconRoute } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { buildMatchPreview } from '@/features/api-mgmt-shared';
import { useRouteDetail, deleteRoute } from '../api';
import { AttachedPolicies } from './attached-policies';
import { MiddlewareStackEditor } from './middleware-stack-editor';

interface RouteDetailProps {
  routeId: string;
  tenantId: string;
  onEdit: () => void;
  onClose: () => void;
  /** Optional: navigate to the full-page detail view. */
  onOpenFullPage?: () => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'blue',
  POST: 'green',
  PUT: 'orange',
  PATCH: 'yellow',
  DELETE: 'red',
  ANY: 'gray',
};

export function RouteDetail({
  routeId,
  tenantId,
  onEdit,
  onClose,
  onOpenFullPage,
}: RouteDetailProps) {
  const route = useRouteDetail(routeId);
  const services = useMockStore((s) => s.services);
  const auditEntries = useMockStore((s) => s.audit);

  const service = route ? services[route.service_id] : undefined;

  const auditTail = useMemo(() => {
    if (!route) return [];
    return auditEntries
      .filter(
        (e) => e.resource_type === 'route' && e.resource_id === route.id,
      )
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, route]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] =
    useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!route) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Route not found.
      </Alert>
    );
  }

  async function handleDelete() {
    if (!route) return;
    if (deleteInput !== route.name) return;
    setDeleting(true);
    try {
      await deleteRoute(route.id);
      notify.success('Route deleted', `${route.name} was removed.`);
      closeDelete();
      onClose();
    } catch {
      notify.error('Failed to delete route', 'Please try again.');
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  const matchPreview = buildMatchPreview(route.method, route.match_kind, route.path);

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconRoute size={24} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4}>{route.name}</Title>
              <Badge
                size="sm"
                variant="light"
                color={METHOD_COLORS[route.method] ?? 'gray'}
              >
                {route.method}
              </Badge>
              <Badge
                size="sm"
                variant="light"
                color={route.enabled ? 'green' : 'gray'}
              >
                {route.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Service: {service?.name ?? route.service_id}
            </Text>
          </Stack>
        </Group>
        {onOpenFullPage && (
          <Tooltip label="Open full page" withArrow>
            <Button
              variant="subtle"
              size="xs"
              px={6}
              aria-label="Open full page"
              onClick={onOpenFullPage}
            >
              <IconArrowsDiagonal size={14} />
            </Button>
          </Tooltip>
        )}
      </Group>

      <Divider />

      {/* Match info */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Match
        </Text>
        <Text size="xs" ff="monospace">
          {matchPreview}
        </Text>
        <Group gap="lg">
          <Group gap="xs">
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Strip prefix:
            </Text>
            <Badge size="xs" variant="outline" color={route.strip_prefix ? 'green' : 'gray'}>
              {route.strip_prefix ? 'yes' : 'no'}
            </Badge>
          </Group>
          {route.rewrite_path && (
            <Group gap="xs">
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Rewrite path:
              </Text>
              <Text size="xs" ff="monospace">
                {route.rewrite_path}
              </Text>
            </Group>
          )}
        </Group>
      </Stack>

      <Divider />

      <AttachedPolicies routeId={route.id} />

      <Divider />

      <MiddlewareStackEditor routeId={route.id} tenantId={tenantId} />

      <Divider />

      {/* Headers summary */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Headers
        </Text>
        <Stack gap={2}>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Add:
          </Text>
          {Object.keys(route.headers_add).length === 0 ? (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              (none)
            </Text>
          ) : (
            <Stack gap={2} pl="md">
              {Object.entries(route.headers_add).map(([k, v]) => (
                <Text key={k} size="xs" ff="monospace">
                  {k}: {v}
                </Text>
              ))}
            </Stack>
          )}
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Remove:
          </Text>
          {route.headers_remove.length === 0 ? (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              (none)
            </Text>
          ) : (
            <Text size="xs" ff="monospace" pl="md">
              {route.headers_remove.join(', ')}
            </Text>
          )}
        </Stack>
      </Stack>

      <Divider />

      {/* Audit tail */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent activity
        </Text>
        {auditTail.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No audit entries for this route yet.
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

      <Divider />

      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="subtle" color="red" onClick={openDelete}>
          Delete…
        </Button>
      </Group>

      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete route"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the route. It cannot be undone.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {route.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={route.name}
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
              color="red"
              size="sm"
              loading={deleting}
              disabled={deleteInput !== route.name}
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
