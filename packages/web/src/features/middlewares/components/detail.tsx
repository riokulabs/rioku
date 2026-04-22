/**
 * <MiddlewareDetail> — drawer content for a middleware.
 *
 * Sections:
 *   - Header (name, kind, enabled badge)
 *   - Config (rendered read-only via <KindConfigPanel readOnly>)
 *   - Referencing routes (list of routes that include this middleware id)
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
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconStack } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { isDestructiveMiddleware } from '@/features/api-mgmt-shared';
import { useMiddlewareDetail, deleteMiddleware } from '../api';
import { MiddlewareInUseError } from '../types';
import { KindConfigPanel } from './kind-config-panel';

interface MiddlewareDetailProps {
  middlewareId: string;
  onEdit: () => void;
  onClose: () => void;
}

const KIND_COLORS: Record<string, string> = {
  'rate-limit': 'cyan',
  auth: 'red',
  transform: 'violet',
  cors: 'orange',
  cache: 'green',
  logging: 'gray',
  custom: 'grape',
};

export function MiddlewareDetail({ middlewareId, onEdit, onClose }: MiddlewareDetailProps) {
  const middleware = useMiddlewareDetail(middlewareId);
  const routes = useMockStore((s) => s.routes);
  const services = useMockStore((s) => s.services);

  const referencingRoutes = useMemo(() => {
    if (!middleware) return [];
    return Object.values(routes).filter((r) => r.middleware_ids.includes(middleware.id));
  }, [routes, middleware]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!middleware) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Middleware not found.
      </Alert>
    );
  }

  async function handleDelete() {
    if (!middleware) return;
    if (deleteInput !== middleware.name) return;
    setDeleting(true);
    try {
      await deleteMiddleware(middleware.id);
      notify.success('Middleware deleted', `${middleware.name} was removed.`);
      closeDelete();
      onClose();
    } catch (err) {
      if (err instanceof MiddlewareInUseError) {
        notify.error(
          'Cannot delete — in use',
          `${String(err.routeIds.length)} route(s) still reference this middleware.`,
        );
      } else {
        notify.error('Failed to delete middleware', 'Please try again.');
      }
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  const destructive = isDestructiveMiddleware(middleware.kind);

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconStack size={24} color="var(--mantine-color-violet-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4}>{middleware.name}</Title>
              <Badge size="sm" variant="light" color={KIND_COLORS[middleware.kind] ?? 'gray'}>
                {middleware.kind}
              </Badge>
              <Badge size="sm" variant="light" color={middleware.enabled ? 'green' : 'gray'}>
                {middleware.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            {middleware.description && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {middleware.description}
              </Text>
            )}
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Order hint: {String(middleware.order_hint)}
            </Text>
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Config (read-only) */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Configuration
        </Text>
        <KindConfigPanel
          kind={middleware.kind}
          value={middleware.config}
          onChange={() => {
            // read-only
          }}
          readOnly
        />
      </Stack>

      <Divider />

      {/* Referencing routes */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Referenced by {String(referencingRoutes.length)} route
          {referencingRoutes.length === 1 ? '' : 's'}
        </Text>
        {referencingRoutes.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No routes reference this middleware.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Route</Table.Th>
                <Table.Th>Service</Table.Th>
                <Table.Th>Method</Table.Th>
                <Table.Th>Path</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {referencingRoutes.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Text size="xs">{r.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{services[r.service_id]?.name ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="outline">
                      {r.method}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {r.path}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="subtle" color="red" onClick={openDelete}>
          Delete…
        </Button>
      </Group>

      {/* Delete modal — typed-name confirm */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete middleware"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            {destructive
              ? 'This middleware enforces authentication or payload transforms — removing it may change request semantics.'
              : 'This permanently deletes the middleware. It cannot be undone.'}
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {middleware.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={middleware.name}
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
              disabled={deleteInput !== middleware.name}
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
