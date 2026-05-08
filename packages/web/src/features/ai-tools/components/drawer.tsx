/**
 * <ToolDrawer> — quick-info side panel for an AI tool.
 *
 * Renders identity, kind, dangerous flag, target preview and an "Open full
 * page" button that navigates to /t/$tenant/ai/tools/$toolId for the full
 * Definition / Test invocation / Audit experience.
 */
import { Alert, Badge, Button, Code, Divider, Group, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconAlertCircle, IconArrowRight, IconTool } from '@tabler/icons-react';
import { DangerousToolBadge, ToolKindBadge } from '@/features/ai-shared';
import { useToolDetail } from '../api';

interface ToolDrawerProps {
  tenant: string;
  toolId: string;
  onClose: () => void;
}

export function ToolDrawer({ tenant, toolId, onClose }: ToolDrawerProps) {
  const tool = useToolDetail(tenant, toolId);

  if (!tool) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Tool not found.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <IconTool size={28} color="var(--mantine-color-indigo-6)" />
        <Stack gap={2} style={{ flex: 1 }}>
          <Group gap="xs">
            <Title order={4} ff="monospace">
              {tool.name}
            </Title>
            <ToolKindBadge kind={tool.kind} />
            {tool.dangerous && <DangerousToolBadge />}
            <Badge
              size="xs"
              variant="light"
              color={tool.enabled ? 'green' : 'gray'}
              aria-label={`Status: ${tool.enabled ? 'enabled' : 'disabled'}`}
            >
              {tool.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </Group>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {tool.description}
          </Text>
        </Stack>
      </Group>

      <Divider />

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--mantine-color-gray-7)">
          Target
        </Text>
        {tool.kind === 'mcp' && (
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            MCP · {tool.mcp_server_id ?? '—'}
          </Text>
        )}
        {tool.kind === 'http' && tool.http_endpoint && (
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {tool.http_endpoint.method} {tool.http_endpoint.url}
          </Text>
        )}
        {tool.kind === 'native' && (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Daemon-built-in handler.
          </Text>
        )}
      </Stack>

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--mantine-color-gray-7)">
          Schema (preview)
        </Text>
        <Code block style={{ maxHeight: 180, overflow: 'auto' }}>
          {JSON.stringify(tool.schema, null, 2)}
        </Code>
      </Stack>

      <Group justify="flex-end" gap="sm" mt="md">
        <Button variant="default" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link polymorphic props require a cast
          component={Link as any}
          to="/t/$tenant/ai/tools/$toolId"
          params={{ tenant, toolId }}
          size="sm"
          rightSection={<IconArrowRight size={14} />}
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
