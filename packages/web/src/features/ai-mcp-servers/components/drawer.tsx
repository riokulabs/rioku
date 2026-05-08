/**
 * <McpServerDrawer> — quick-info drawer for an MCP server.
 *
 * Shows the bare essentials (identity, health, URL, auth, tool-count badge)
 * plus shortcuts: "Open full page" → routes to
 * `/t/{tenant}/ai/mcp-servers/{serverId}` for the full Tabs view, "Edit"
 * (handled by parent), and "Delete" (typed-name confirm).
 *
 * For the deeper experience (Configuration / Test connectivity / Tools /
 * Audit), see {@link McpServerFullPage}.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link } from '@tanstack/react-router';
import { IconAlertCircle, IconExternalLink, IconServer } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { McpHealthChip } from '@/features/ai-shared';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import type { McpServer } from '@/api/resources';
import { useMcpServerDetail, useDeleteMcpServer, useMcpServerTools } from '../api';

dayjs.extend(relativeTime);

interface McpServerDrawerProps {
  serverId: string;
  /** Tenant slug — used for both data fetches and the "Open full page" link. */
  tenant: string;
  onEdit: () => void;
  onClose: () => void;
}

const AUTH_COLORS: Record<McpServer['auth_kind'], string> = {
  none: 'gray',
  bearer: 'blue',
  'api-key': 'violet',
};

export function McpServerDrawer({ serverId, tenant, onEdit, onClose }: McpServerDrawerProps) {
  const server = useMcpServerDetail(tenant, serverId);
  const { items: tools } = useMcpServerTools(tenant, serverId);
  const deleteMutation = useDeleteMcpServer(tenant);
  const canWrite = usePermission('mcp-server:write');

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');

  if (!server) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        MCP server not found.
      </Alert>
    );
  }

  async function handleDelete() {
    if (!server) return;
    if (deleteInput !== server.name) return;
    try {
      await deleteMutation.mutateAsync(server.id);
      notify.success('MCP server deleted', `${server.name} was removed.`);
      closeDelete();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete server';
      notify.error('Cannot delete', msg);
    } finally {
      setDeleteInput('');
    }
  }

  return (
    <Stack gap="md">
      {/* Header */}
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <IconServer size={28} color="var(--mantine-color-violet-6)" />
        <Stack gap={2} style={{ flex: 1 }}>
          <Group gap="xs" wrap="wrap">
            <Title order={4} ff="monospace">
              {server.name}
            </Title>
            <McpHealthChip health={server.health} />
            <Badge size="sm" variant="light" color={AUTH_COLORS[server.auth_kind]}>
              {server.auth_kind}
            </Badge>
            <Badge size="sm" variant="outline" color={server.enabled ? 'teal' : 'gray'}>
              {server.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </Group>
          {server.description && (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {server.description}
            </Text>
          )}
          {server.last_seen_at && (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Last checked {dayjs(server.last_seen_at).fromNow()}
            </Text>
          )}
        </Stack>
      </Group>

      <Divider />

      {/* URL */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          URL
        </Text>
        <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)" data-testid="mcp-drawer-url">
          {server.url}
        </Text>
      </Stack>

      {/* Tool count */}
      <Group gap="xs">
        <Text size="sm" fw={600}>
          Exposed tools
        </Text>
        <Badge size="sm" variant="light" color="indigo">
          {String(tools.length)}
        </Badge>
      </Group>

      <Divider />

      {/* Actions */}
      <Group gap="sm" wrap="wrap">
        <Button
          // TanStack Link + Mantine polymorphic props require a cast.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/ai/mcp-servers/$serverId"
          params={{ tenant, serverId: server.id }}
          size="sm"
          rightSection={<IconExternalLink size={14} />}
        >
          Open full page
        </Button>
        <Button size="sm" variant="light" onClick={onEdit} disabled={!canWrite}>
          Edit
        </Button>
        <Button size="sm" variant="subtle" color="red.8" onClick={openDelete} disabled={!canWrite}>
          Delete…
        </Button>
      </Group>

      {/* Delete confirm modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete MCP server"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently removes the server from this tenant.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {server.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={server.name}
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
              loading={deleteMutation.isPending}
              disabled={deleteInput !== server.name}
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
