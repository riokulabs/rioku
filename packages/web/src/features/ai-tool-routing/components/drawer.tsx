/**
 * <BindingDrawer> — quick-info side drawer for an AI tool-binding.
 *
 * Shows a compact summary of the binding (agent → tool, enabled state,
 * CEL condition, created timestamp) and offers an "Open full page"
 * button that navigates to the dedicated route for the binding.
 *
 * The full <BindingDetail> drawer is heavier — it wires the in-place
 * CEL editor, the audit tail, and the destructive delete flow. Use
 * <BindingDrawer> from row clicks where the user just wants a quick
 * peek; use <BindingDetail> from the existing list-page drawer where
 * editing in place is the expected interaction.
 */
import { Alert, Badge, Button, Divider, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconExternalLink, IconRouter } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Link } from '@tanstack/react-router';
import { useBindingDetailQuery } from '../api';
import { useAgentRefs, useToolRefs } from '../refs';

dayjs.extend(relativeTime);

interface BindingDrawerProps {
  tenantId: string;
  tenantSlug: string;
  bindingId: string;
  onClose: () => void;
}

export function BindingDrawer({ tenantId, tenantSlug, bindingId, onClose }: BindingDrawerProps) {
  const { data: binding, isLoading } = useBindingDetailQuery(tenantId, bindingId);
  const { byId: agents } = useAgentRefs(tenantId);
  const { byId: tools } = useToolRefs(tenantId);

  if (isLoading) {
    return <Loader size="sm" />;
  }
  if (!binding) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Binding not found.
      </Alert>
    );
  }

  const agent = agents[binding.agent_id];
  const tool = tools[binding.tool_id];
  const conditionDisplay = binding.condition.trim() === '' ? '(unconditional)' : binding.condition;

  return (
    <Stack gap="md">
      {/* Header */}
      <Group gap="sm" wrap="nowrap">
        <IconRouter size={28} color="var(--mantine-color-indigo-6)" />
        <Stack gap={2}>
          <Title order={4}>Tool binding</Title>
          <Group gap="xs" wrap="nowrap">
            <Badge size="sm" variant="light" color="blue" ff="monospace">
              {agent?.name ?? binding.agent_id}
            </Badge>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              →
            </Text>
            <Badge size="sm" variant="light" color="indigo" ff="monospace">
              {tool?.name ?? binding.tool_id}
            </Badge>
          </Group>
        </Stack>
      </Group>

      <Divider />

      {/* Quick info */}
      <Stack gap="xs">
        <Group gap="xs">
          <Text size="sm" fw={600}>
            Status:
          </Text>
          <Badge size="sm" color={binding.enabled ? 'green' : 'gray'} variant="light">
            {binding.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </Group>

        <Stack gap={2}>
          <Text size="sm" fw={600}>
            Condition
          </Text>
          <Text
            size="xs"
            ff="monospace"
            c="var(--mantine-color-gray-7)"
            aria-label="binding-condition-summary"
          >
            {conditionDisplay}
          </Text>
        </Stack>

        <Group gap="xs">
          <Text size="sm" fw={600}>
            Created:
          </Text>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            {dayjs(binding.created_at).format('MMM D, YYYY HH:mm')}
          </Text>
        </Group>
      </Stack>

      <Divider />

      <Group gap="sm" justify="flex-end">
        <Button variant="default" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          size="sm"
          leftSection={<IconExternalLink size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/ai/tool-bindings/$bindingId"
          params={{ tenant: tenantSlug, bindingId: binding.id }}
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
