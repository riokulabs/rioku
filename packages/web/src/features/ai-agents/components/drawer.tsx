/**
 * <AgentDrawer> — compact summary card + "Open full page" CTA.
 *
 * Shown in list-page side drawer for quick triage. Heavyweight tabs
 * (tools, traces, audit, invoke) live on the full-page route reached
 * via the "Open full page" link.
 */
import { Alert, Badge, Button, Group, Stack, Switch, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconAlertCircle, IconExternalLink, IconRobot } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { updateAgent, useAgentDetail } from '../api';

interface AgentDrawerProps {
  tenant: string;
  agentId: string;
  onEdit: () => void;
  onClose: () => void;
}

export function AgentDrawer({ tenant, agentId, onEdit, onClose }: AgentDrawerProps) {
  const agent = useAgentDetail(tenant, agentId);

  async function handleToggle(enabled: boolean) {
    if (!agent) return;
    try {
      await updateAgent(tenant, agent.id, { enabled });
    } catch {
      notify.error('Failed to update agent', 'Please try again.');
    }
  }

  if (!agent) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Agent not found.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <IconRobot size={28} color="var(--mantine-color-blue-6)" />
        <Stack gap={2} style={{ flex: 1 }}>
          <Group gap="xs">
            <Text fw={600} ff="monospace">
              {agent.name}
            </Text>
            <Badge size="sm" variant="outline" color="blue" ff="monospace">
              {agent.model}
            </Badge>
            <Switch
              size="sm"
              checked={agent.enabled}
              aria-label={`Toggle ${agent.name}`}
              onChange={(e) => {
                void handleToggle(e.currentTarget.checked);
              }}
            />
          </Group>
          {agent.description && (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {agent.description}
            </Text>
          )}
        </Stack>
      </Group>

      <Stack gap={4}>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Provider: <Text component="span" ff="monospace">{agent.provider_id || 'unset'}</Text>
        </Text>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Tools bound: {String(agent.tool_ids.length)} · Roles allowed:{' '}
          {String(agent.role_ids.length)}
        </Text>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          max_tokens: {String(agent.max_tokens_per_request)} · temperature:{' '}
          {agent.temperature.toFixed(2)}
        </Text>
      </Stack>

      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="light"
          rightSection={<IconExternalLink size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/ai/agents/$agentId"
          params={{ tenant, agentId }}
          onClick={onClose}
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
