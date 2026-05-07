/**
 * <ApiKeyFullPage> — full-page view for a single API key.
 *
 * Three tabs: Profile / Usage / Audit. Rotate / Revoke live in the
 * page header (survive across all three tabs). Rotate triggers the
 * <SecretCaptureModal> capture-once flow for the new plaintext.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
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
  IconBan,
  IconHistory,
  IconRefresh,
  IconChartLine,
  IconUser,
} from '@tabler/icons-react';
import { StatusBadge } from '@/components/status-badge';
import { notify } from '@/hooks/use-notify';
import { useGetAPIKeyUsage } from '@/api/generated/api-keys/api-keys';
import { useExportAuditJSONL } from '@/api/generated/audit/audit';
import type { V1AuditEntry } from '@/api/generated/schemas/v1AuditEntry';
import { useApiKey, useApiKeyMutations } from '../api';
import { SecretCaptureModal } from './secret-capture-modal';

interface ApiKeyFullPageProps {
  tenantId: string;
  tenantSlug: string;
  keyId: string;
}

export function ApiKeyFullPage({ tenantId, tenantSlug, keyId }: ApiKeyFullPageProps) {
  const key = useApiKey(tenantId, keyId);
  const mut = useApiKeyMutations(tenantId);
  const [working, setWorking] = useState(false);
  const [rotatedSecret, setRotatedSecret] = useState('');

  const usageQuery = useGetAPIKeyUsage(tenantId, keyId, {
    query: { enabled: !!tenantId && !!keyId },
  });

  const auditQuery = useExportAuditJSONL(tenantId, undefined, {
    query: { enabled: !!tenantId },
  });

  const auditEntries = useMemo<V1AuditEntry[]>(() => {
    const raw = (auditQuery.data as { data?: string } | undefined)?.data;
    if (typeof raw !== 'string' || raw.length === 0) return [];
    const out: V1AuditEntry[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as V1AuditEntry;
        if (parsed.entityId === keyId) out.push(parsed);
      } catch {
        // skip malformed
      }
    }
    return out;
  }, [auditQuery.data, keyId]);

  if (!key) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
        API key not found in tenant <Text span fw={600}>{tenantSlug}</Text>.
      </Alert>
    );
  }

  async function handleRevoke() {
    setWorking(true);
    try {
      await mut.revokeApiKey(keyId);
      notify.success('API key revoked', 'The key has been invalidated.');
    } catch {
      notify.error('Failed to revoke key', 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  async function handleRotate() {
    setWorking(true);
    try {
      const result = await mut.rotateApiKey(keyId);
      setRotatedSecret(result.fullValue);
    } catch {
      notify.error('Failed to rotate key', 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  const usage = usageQuery.data?.data as
    | { id?: string; usageCount?: number; lastUsedAt?: string; createdAt?: string }
    | undefined;

  return (
    <Stack gap="md" p="md">
      <Group gap="md" align="flex-start" justify="space-between">
        <Stack gap={4}>
          <Group gap="xs">
            <Title order={2}>{key.name}</Title>
            <StatusBadge
              kind={
                key.display_status === 'active'
                  ? 'active'
                  : key.display_status === 'revoked'
                    ? 'error'
                    : 'warn'
              }
              size="sm"
            >
              {key.display_status}
            </StatusBadge>
          </Group>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {key.prefix ? `${key.prefix}…` : '—'}
          </Text>
        </Stack>
        <Group gap="sm">
          {key.display_status === 'active' && (
            <Button
              size="sm"
              variant="light"
              loading={working}
              leftSection={<IconRefresh size={14} />}
              onClick={() => void handleRotate()}
            >
              Rotate
            </Button>
          )}
          {!key.revoked && (
            <Button
              size="sm"
              variant="light"
              color="orange"
              loading={working}
              leftSection={<IconBan size={14} />}
              onClick={() => void handleRevoke()}
            >
              Revoke
            </Button>
          )}
        </Group>
      </Group>

      <Tabs defaultValue="profile" data-testid="api-key-full-page-tabs">
        <Tabs.List>
          <Tabs.Tab value="profile" leftSection={<IconUser size={14} />}>
            Profile
          </Tabs.Tab>
          <Tabs.Tab value="usage" leftSection={<IconChartLine size={14} />}>
            Usage
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profile" pt="md">
          <Stack gap="sm">
            <ProfileRow label="Key ID" mono value={key.id} />
            <ProfileRow label="Prefix" mono value={key.prefix || '—'} />
            <ProfileRow label="Owner" mono value={key.user_id ?? '—'} />
            <ProfileRow
              label="Scope"
              valueElement={
                key.scope.length === 0 ? (
                  <Text size="sm" c="var(--mantine-color-gray-7)">
                    none
                  </Text>
                ) : (
                  <Group gap={4}>
                    {key.scope.map((s) => (
                      <Badge key={s} size="xs" variant="light">
                        {s}
                      </Badge>
                    ))}
                  </Group>
                )
              }
            />
            <ProfileRow label="Created" value={new Date(key.created_at).toLocaleString()} />
            <ProfileRow
              label="Expires"
              value={
                key.expires_at
                  ? `${String(key.expires_in_days ?? 0)}d (${new Date(key.expires_at).toLocaleString()})`
                  : 'Never'
              }
            />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="usage" pt="md">
          {usageQuery.isLoading ? (
            <Group justify="center" p="xl">
              <Loader size="sm" />
            </Group>
          ) : (
            <Stack gap="sm">
              <ProfileRow
                label="Total uses"
                value={usage?.usageCount !== undefined ? String(usage.usageCount) : '0'}
              />
              <ProfileRow
                label="Last used"
                value={usage?.lastUsedAt ? new Date(usage.lastUsedAt).toLocaleString() : 'Never'}
              />
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <Table striped data-testid="api-key-audit-table">
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
                      No audit entries found for this key.
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
                      {e.entityType ?? 'api-key'}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      </Tabs>

      <SecretCaptureModal
        opened={rotatedSecret !== ''}
        secret={rotatedSecret}
        title="API key rotated — copy the new secret"
        onConfirmCopied={() => {
          setRotatedSecret('');
          notify.success('Secret captured', 'The new key value will not be shown again.');
        }}
      />
    </Stack>
  );
}

function ProfileRow({
  label,
  value,
  mono,
  valueElement,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  valueElement?: React.ReactNode;
}) {
  return (
    <Group gap="xs" align="flex-start">
      <Text size="sm" fw={500} w={140}>
        {label}:
      </Text>
      {valueElement ?? (
        mono ? (
          <Text size="sm" ff="monospace">
            {value}
          </Text>
        ) : (
          <Text size="sm">{value}</Text>
        )
      )}
    </Group>
  );
}
