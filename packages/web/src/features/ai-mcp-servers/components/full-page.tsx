/**
 * <McpServerFullPage> — dedicated route view for one MCP server.
 *
 * Layout: header (identity + health + actions) + Mantine Tabs:
 *   - Configuration: read-only summary + opens edit drawer
 *   - Test connectivity: button + structured result (status badge,
 *     latency, error, server version)
 *   - Tools: list of tools exposed by the server (from
 *     `GET /ai/mcp-servers/{id}/tools`)
 *   - Audit: recent audit entries scoped to this resource (uses the
 *     daemon's per-entity audit endpoint)
 */
import { useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Drawer,
  Group,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  IconAlertCircle,
  IconChevronLeft,
  IconHistory,
  IconPlugConnected,
  IconServer,
  IconSettings,
  IconTools,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { customFetch } from '@/api/mutator';
import { McpHealthChip } from '@/features/ai-shared';
import { McpServerForm } from './form';
import { TestConnectivityPanel } from './test-connectivity-panel';
import { ToolsTab } from './tools-tab';
import { useMcpServerDetail } from '../api';
import type { McpServer } from '@/api/resources';

dayjs.extend(relativeTime);

const AUTH_COLORS: Record<McpServer['auth_kind'], string> = {
  none: 'gray',
  bearer: 'blue',
  'api-key': 'violet',
};

interface McpServerFullPageProps {
  /** Tenant slug. */
  tenant: string;
  serverId: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actorId?: string;
  actor_id?: string;
  at?: string;
  occurredAt?: string;
  outcome?: string;
}

export function McpServerFullPage({ tenant, serverId }: McpServerFullPageProps) {
  const server = useMcpServerDetail(tenant, serverId);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [activeTab, setActiveTab] = useState<string | null>('configuration');

  if (!server) {
    return (
      <Stack gap="md" p="md">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/ai/mcp-servers"
          params={{ tenant }}
          size="sm"
        >
          <Group gap={4}>
            <IconChevronLeft size={14} />
            Back to MCP servers
          </Group>
        </Anchor>
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          MCP server <Code>{serverId}</Code> not found in this tenant.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md" p="md">
      <Anchor
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        component={Link as any}
        to="/t/$tenant/ai/mcp-servers"
        params={{ tenant }}
        size="sm"
      >
        <Group gap={4}>
          <IconChevronLeft size={14} />
          Back to MCP servers
        </Group>
      </Anchor>

      {/* Header */}
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <IconServer size={32} color="var(--mantine-color-violet-6)" />
          <Stack gap={4}>
            <Group gap="xs" align="center" wrap="wrap">
              <Title order={2} ff="monospace">
                {server.name}
              </Title>
              <McpHealthChip health={server.health} />
              <Badge size="md" variant="light" color={AUTH_COLORS[server.auth_kind]}>
                {server.auth_kind}
              </Badge>
              <Badge size="md" variant="outline" color={server.enabled ? 'teal' : 'gray'}>
                {server.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            {server.description && <Text c="var(--mantine-color-gray-7)">{server.description}</Text>}
            <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
              {server.url}
            </Text>
          </Stack>
        </Group>
        <Group gap="sm">
          <Button onClick={openEdit}>Edit</Button>
        </Group>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="configuration" leftSection={<IconSettings size={14} />}>
            Configuration
          </Tabs.Tab>
          <Tabs.Tab value="connectivity" leftSection={<IconPlugConnected size={14} />}>
            Test connectivity
          </Tabs.Tab>
          <Tabs.Tab value="tools" leftSection={<IconTools size={14} />}>
            Tools
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="configuration" pt="md">
          <ConfigurationPanel server={server} onEdit={openEdit} />
        </Tabs.Panel>

        <Tabs.Panel value="connectivity" pt="md">
          <TestConnectivityPanel tenant={tenant} serverId={server.id} />
        </Tabs.Panel>

        <Tabs.Panel value="tools" pt="md">
          <ToolsTab tenant={tenant} serverId={server.id} />
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <AuditPanel tenant={tenant} serverId={server.id} />
        </Tabs.Panel>
      </Tabs>

      {/* Edit drawer reuses the existing form — no need for a separate flow. */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={editOpened}
        onClose={closeEdit}
        title={`Edit — ${server.name}`}
        position="right"
        size="min(560px, 95vw)"
        padding="md"
      >
        <McpServerForm
          mode="edit"
          tenant={tenant}
          initialValues={server}
          onSuccess={closeEdit}
          onCancel={closeEdit}
        />
      </Drawer>
    </Stack>
  );
}

function ConfigurationPanel({ server, onEdit }: { server: McpServer; onEdit: () => void }) {
  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={4}>Configuration</Title>
          <Button size="xs" variant="light" onClick={onEdit}>
            Edit
          </Button>
        </Group>
        <Table withRowBorders={false}>
          <Table.Tbody>
            <ConfigRow label="Name" value={server.name} mono />
            <ConfigRow label="URL" value={server.url} mono />
            <ConfigRow label="Auth kind" value={server.auth_kind} />
            <ConfigRow label="Enabled" value={server.enabled ? 'yes' : 'no'} />
            <ConfigRow
              label="Authorized agents"
              value={
                server.authorized_agent_ids.length === 0
                  ? 'all agents'
                  : server.authorized_agent_ids.join(', ')
              }
            />
            <ConfigRow
              label="Last checked"
              value={server.last_seen_at ? dayjs(server.last_seen_at).fromNow() : 'never'}
            />
            <ConfigRow label="Created" value={dayjs(server.created_at).format('YYYY-MM-DD HH:mm')} />
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
}

function ConfigRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Table.Tr>
      <Table.Td style={{ width: 180 }}>
        <Text size="sm" fw={600}>
          {label}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" {...(mono ? { ff: 'monospace' } : {})}>
          {value}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

function AuditPanel({ tenant, serverId }: { tenant: string; serverId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-mcp-servers', tenant, 'audit', serverId],
    queryFn: async () => {
      const url = `/t/${tenant}/audit/entity/mcp-server/${serverId}`;
      const raw = await customFetch<{ items?: AuditEntry[] } | { data?: { items?: AuditEntry[] } }>(
        { url, method: 'GET' },
      );
      const env = raw as { data?: { items?: AuditEntry[] }; items?: AuditEntry[] };
      return env.data?.items ?? env.items ?? [];
    },
    enabled: tenant !== '' && serverId !== '',
  });

  if (isLoading) {
    return <Text size="sm">Loading audit history…</Text>;
  }
  if (error) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Failed to load audit history.
      </Alert>
    );
  }

  const entries = data ?? [];
  if (entries.length === 0) {
    return (
      <Card withBorder padding="md">
        <Text size="sm" c="var(--mantine-color-gray-7)">
          No audit entries for this server yet.
        </Text>
      </Card>
    );
  }

  return (
    <Card withBorder padding="md">
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Action</Table.Th>
            <Table.Th>Actor</Table.Th>
            <Table.Th>Outcome</Table.Th>
            <Table.Th>When</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map((e) => {
            const at = e.at ?? e.occurredAt ?? '';
            const actor = e.actorId ?? e.actor_id ?? '';
            return (
              <Table.Tr key={e.id}>
                <Table.Td>
                  <Text size="xs" ff="monospace">
                    {e.action}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{actor}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{e.outcome ?? '—'}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{at ? dayjs(at).format('MMM D, HH:mm:ss') : '—'}</Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
