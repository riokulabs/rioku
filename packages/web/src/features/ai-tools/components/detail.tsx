/**
 * <ToolDetail> — definition view for an AI tool. Used inside the full-page
 * "Definition" tab. Contains identity, target, schema, agent bindings and
 * write actions (edit / delete with typed-name confirm).
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link } from '@tanstack/react-router';
import { IconAlertCircle, IconExternalLink, IconTool } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { DangerousToolBadge, ToolKindBadge } from '@/features/ai-shared';
import { deleteTool, useToolAgents, useToolDetail, useUpdateTool } from '../api';
import { ToolInUseError } from '../types';

interface ToolDetailProps {
  tenant: string;
  toolId: string;
  onEdit: () => void;
  onClose: () => void;
}

export function ToolDetail({ tenant, toolId, onEdit, onClose }: ToolDetailProps) {
  const tool = useToolDetail(tenant, toolId);
  const agentsUsing = useToolAgents(tenant, toolId);
  const updateMutation = useUpdateTool(tenant);

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!tool) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Tool not found.
      </Alert>
    );
  }

  function handleToggle(enabled: boolean) {
    if (!tool) return;
    updateMutation.mutate(
      { id: tool.id, input: { enabled } },
      {
        onError: () => {
          notify.error('Failed to update tool', 'Please try again.');
        },
      },
    );
  }

  async function handleDelete() {
    if (!tool) return;
    if (deleteInput !== tool.name) return;
    setDeleting(true);
    try {
      await deleteTool(tenant, tool.id);
      notify.success('Tool deleted', `${tool.name} was removed.`);
      closeDelete();
      onClose();
    } catch (err) {
      if (err instanceof ToolInUseError) {
        notify.error(
          'Cannot delete — in use',
          `${String(err.agentIds.length)} agent(s) and ${String(err.bindingIds.length)} binding(s) reference this tool.`,
        );
      } else {
        notify.error('Failed to delete tool', 'Please try again.');
      }
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconTool size={28} color="var(--mantine-color-indigo-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4} ff="monospace">
                {tool.name}
              </Title>
              <ToolKindBadge kind={tool.kind} />
              {tool.dangerous && <DangerousToolBadge />}
              <Switch
                size="sm"
                checked={tool.enabled}
                aria-label={`Toggle ${tool.name}`}
                onChange={(e) => {
                  handleToggle(e.currentTarget.checked);
                }}
              />
            </Group>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {tool.description}
            </Text>
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Kind-specific target */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Target
        </Text>
        {tool.kind === 'mcp' && (
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            MCP server: {tool.mcp_server_id ?? '—'}
          </Text>
        )}
        {tool.kind === 'http' && tool.http_endpoint && (
          <Stack gap={4}>
            <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
              {tool.http_endpoint.method} {tool.http_endpoint.url}
            </Text>
            {tool.http_endpoint.auth_header && (
              <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                Auth: {tool.http_endpoint.auth_header}
              </Text>
            )}
          </Stack>
        )}
        {tool.kind === 'native' && (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Daemon-built-in handler.
          </Text>
        )}
      </Stack>

      <Divider />

      {/* JSON schema (read-only) */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          JSON schema
        </Text>
        <Code block>{JSON.stringify(tool.schema, null, 2)}</Code>
      </Stack>

      <Divider />

      {/* Agents using this tool */}
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            Agents using this tool ({String(agentsUsing.length)})
          </Text>
          <Button
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/ai/tool-routing"
            params={{ tenant }}
            search={{ tool: tool.id }}
            size="xs"
            variant="subtle"
            rightSection={<IconExternalLink size={12} />}
          >
            View all bindings for this tool
          </Button>
        </Group>
        {agentsUsing.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No agents currently bound to this tool.
          </Text>
        ) : (
          <Group gap={6}>
            {agentsUsing.map((a) => (
              <Badge key={a.id} size="xs" variant="light" color="blue" ff="monospace">
                {a.id}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="subtle" color="red.8" onClick={openDelete}>
          Delete…
        </Button>
      </Group>

      {/* Delete modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete tool"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the tool. Agents and bindings referencing it must be removed
            first.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {tool.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={tool.name}
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
              disabled={deleteInput !== tool.name}
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
