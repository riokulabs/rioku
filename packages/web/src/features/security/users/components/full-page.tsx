/**
 * <UserFullPage> — full-page view for a single user with four tabs:
 *
 *   Profile | Effective Permissions | Sessions | Audit
 *
 * Stage-2 plan-02. Profile reuses the drawer's editable detail view.
 * Audit pulls from the audit list filtered by `resource_id`.
 */
import { useMemo } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Group,
  Loader,
  Stack,
  Tabs,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconHistory,
  IconShieldHalf,
  IconUser,
  IconDeviceDesktop,
} from '@tabler/icons-react';
import { EffectivePermissionsPanel } from '@/components/effective-permissions-panel';
import { StatusBadge } from '@/components/status-badge';
import { useStreamAuditEntries } from '@/api/generated/audit/audit';
import type { V1AuditEntry } from '@/api/generated/schemas/v1AuditEntry';
import { useUserDetail, useUserSessions } from '../api';

interface UserFullPageProps {
  userId: string;
  tenantId: string;
  tenantSlug: string;
}

export function UserFullPage({ userId, tenantId, tenantSlug }: UserFullPageProps) {
  const { detail, isLoading, isError } = useUserDetail(tenantId, userId);
  const { sessions } = useUserSessions(tenantId, userId);

  const auditQuery = useStreamAuditEntries(tenantId, {
    query: { enabled: !!tenantId },
  });

  const auditEntries = useMemo<V1AuditEntry[]>(() => {
    const raw = auditQuery.data?.data;
    if (typeof raw !== 'string' || raw.length === 0) return [];
    const out: V1AuditEntry[] = [];
    // Parse the SSE/JSONL body. Each event line is `data: <json>` (SSE) or
    // a bare JSON line (JSONL passthrough). Filter to entries scoped to
    // this user via `entityId`.
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.replace(/^data:\s*/, '').trim();
      if (!line || line.startsWith(':')) continue;
      try {
        const parsed = JSON.parse(line) as V1AuditEntry;
        if (parsed.entityId === userId) out.push(parsed);
      } catch {
        // skip malformed lines (heartbeats, partial events, etc.)
      }
    }
    return out;
  }, [auditQuery.data, userId]);

  if (isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }

  if (isError || !detail) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
        User not found in tenant <Text span fw={600}>{tenantSlug}</Text>.
      </Alert>
    );
  }

  const { user } = detail;

  return (
    <Stack gap="md" p="md">
      <Group gap="md" align="flex-start">
        <Avatar size="lg" color="blue" radius="xl">
          {user.name.charAt(0).toUpperCase()}
        </Avatar>
        <Stack gap={4}>
          <Group gap="xs">
            <Title order={2}>{user.name}</Title>
            {user.disabled ? (
              <StatusBadge kind="error" size="sm">
                disabled
              </StatusBadge>
            ) : (
              <StatusBadge kind="active" size="sm">
                enabled
              </StatusBadge>
            )}
          </Group>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {user.email}
          </Text>
        </Stack>
      </Group>

      <Tabs defaultValue="profile" data-testid="user-full-page-tabs">
        <Tabs.List>
          <Tabs.Tab value="profile" leftSection={<IconUser size={14} />}>
            Profile
          </Tabs.Tab>
          <Tabs.Tab value="permissions" leftSection={<IconShieldHalf size={14} />}>
            Effective Permissions
          </Tabs.Tab>
          <Tabs.Tab value="sessions" leftSection={<IconDeviceDesktop size={14} />}>
            Sessions
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profile" pt="md">
          <Stack gap="sm">
            <ProfileRow label="Email" value={user.email} />
            <ProfileRow label="Name" value={user.name} />
            <ProfileRow
              label="Status"
              value={user.disabled ? 'disabled' : 'enabled'}
              valueElement={
                <Badge color={user.disabled ? 'red' : 'green'} variant="light" size="sm">
                  {user.disabled ? 'disabled' : 'enabled'}
                </Badge>
              }
            />
            <ProfileRow label="TOTP" value={user.totp_enabled ? 'enabled' : 'disabled'} />
            <ProfileRow
              label="Created"
              value={new Date(user.created_at).toLocaleString()}
            />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="permissions" pt="md">
          <EffectivePermissionsPanel scope="user" id={userId} tenantId={tenantId} />
        </Tabs.Panel>

        <Tabs.Panel value="sessions" pt="md">
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>IP</Table.Th>
                <Table.Th>User Agent</Table.Th>
                <Table.Th>Last Seen</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sessions.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text size="sm" c="var(--mantine-color-gray-7)">
                      No sessions recorded for this user.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {sessions.map((sess) => (
                <Table.Tr key={sess.id}>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {sess.ip}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={1} title={sess.user_agent}>
                      {sess.user_agent}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{new Date(sess.last_seen).toLocaleString()}</Text>
                  </Table.Td>
                  <Table.Td>
                    {sess.revoked ? (
                      <StatusBadge kind="error" size="xs">
                        revoked
                      </StatusBadge>
                    ) : (
                      <StatusBadge kind="active" size="xs">
                        active
                      </StatusBadge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <Table striped data-testid="user-audit-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>Actor</Table.Th>
                <Table.Th>Operation</Table.Th>
                <Table.Th>Entity</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {auditEntries.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text size="sm" c="var(--mantine-color-gray-7)">
                      No audit entries found for this user.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {auditEntries.map((e, idx) => (
                <Table.Tr key={e.id ?? idx}>
                  <Table.Td>
                    <Text size="xs">
                      {e.occurredAt ? new Date(e.occurredAt).toLocaleString() : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {e.actor ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {e.operation ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color="blue">
                      {e.entityType ?? 'user'}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function ProfileRow({
  label,
  value,
  valueElement,
}: {
  label: string;
  value: string;
  valueElement?: React.ReactNode;
}) {
  return (
    <Group gap="xs">
      <Text size="sm" fw={500} w={140}>
        {label}:
      </Text>
      {valueElement ?? <Text size="sm">{value}</Text>}
    </Group>
  );
}
