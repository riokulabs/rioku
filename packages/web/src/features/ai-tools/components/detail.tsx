/**
 * <ToolDetail> — drawer content for an AI tool.
 *
 * Sections:
 *   - Identity (name, kind badge, dangerous flag, enabled switch)
 *   - JSON schema (read-only Code block)
 *   - MCP server link OR HTTP endpoint details (kind-dependent)
 *   - Agents using this tool
 *   - Test panel (sample input + result)
 *   - Actions (Edit, Delete — typed-name confirm)
 *   - Audit tail
 */
import { useMemo, useState } from 'react';
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
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link } from '@tanstack/react-router';
import { IconAlertCircle, IconExternalLink, IconTool } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { DangerousToolBadge, ToolKindBadge } from '@/features/ai-shared';
import { deleteTool, updateTool, useToolAgents, useToolDetail } from '../api';
import { ToolInUseError } from '../types';
import { TestPanel } from './test-panel';

dayjs.extend(relativeTime);

interface ToolDetailProps {
  toolId: string;
  tenantSlug: string;
  onEdit: () => void;
  onClose: () => void;
}

export function ToolDetail({ toolId, tenantSlug, onEdit, onClose }: ToolDetailProps) {
  const tool = useToolDetail(toolId);
  const agentsUsing = useToolAgents(toolId);
  const auditEntries = useMockStore((s) => s.audit);
  const mcpServers = useMockStore((s) => s.mcpServers);

  const auditTail = useMemo(() => {
    if (!tool) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'ai-tool' && e.resource_id === tool.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, tool]);

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

  async function handleToggle(enabled: boolean) {
    if (!tool) return;
    try {
      await updateTool(tool.id, { enabled });
    } catch {
      notify.error('Failed to update tool', 'Please try again.');
    }
  }

  async function handleDelete() {
    if (!tool) return;
    if (deleteInput !== tool.name) return;
    setDeleting(true);
    try {
      await deleteTool(tool.id);
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

  const mcpServer = tool.mcp_server_id ? mcpServers[tool.mcp_server_id] : undefined;

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
                  void handleToggle(e.currentTarget.checked);
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
            MCP server: {mcpServer ? `${mcpServer.name} (${mcpServer.url})` : tool.mcp_server_id}
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
            params={{ tenant: tenantSlug }}
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
              <Badge key={a.id} size="xs" variant="light" color="blue">
                {a.name} · {a.model}
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

      <Divider />

      {/* Test panel */}
      <TestPanel toolId={tool.id} />

      <Divider />

      {/* Audit tail */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent activity
        </Text>
        {auditTail.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No audit entries for this tool yet.
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
