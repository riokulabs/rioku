/**
 * <ApiKeyDrawer> — quick info side-drawer for an API key.
 *
 * Stage-2 plan-02. Shows the key name, prefix, status, and a small
 * action set (Revoke + "Open full page"). For deeper inspection the
 * user clicks "Open full page" which navigates to
 * /t/$tenant/security/api-keys/$keyId.
 */
import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { Stack, Group, Text, Badge, Button, Divider, Alert } from '@mantine/core';
import { IconAlertCircle, IconExternalLink } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useApiKey, useApiKeyMutations } from '../api';

const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  revoked: 'red',
  expired: 'orange',
};

interface ApiKeyDrawerProps {
  keyId: string;
  tenantId: string;
  onClose: () => void;
}

export function ApiKeyDrawer({ keyId, tenantId, onClose: _onClose }: ApiKeyDrawerProps) {
  const params = useParams({ strict: false });
  const tenantSlug = (params as { tenant?: string }).tenant ?? '';
  const key = useApiKey(tenantId, keyId);
  const mut = useApiKeyMutations(tenantId);
  const [loading, setLoading] = useState(false);

  if (!key) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
        API key not found.
      </Alert>
    );
  }

  async function handleRevoke() {
    setLoading(true);
    try {
      await mut.revokeApiKey(keyId);
      notify.success('API key revoked', 'The key has been invalidated.');
    } catch {
      notify.error('Failed to revoke key', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Text fw={600}>{key.name}</Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {key.prefix ? `${key.prefix}…` : '—'}
          </Text>
        </Stack>
        <Badge size="sm" color={STATUS_COLORS[key.display_status] ?? 'gray'} variant="light">
          {key.display_status}
        </Badge>
      </Group>

      <Stack gap="xs">
        <DetailRow label="Scope" value={key.scope.join(', ') || '—'} />
        <DetailRow label="Created" value={new Date(key.created_at).toLocaleDateString()} />
        <DetailRow label="Last used" value={key.last_used_summary ?? '—'} />
        <DetailRow
          label="Expires"
          value={
            key.expires_at
              ? `${String(key.expires_in_days ?? 0)}d (${new Date(key.expires_at).toLocaleDateString()})`
              : 'Never'
          }
        />
      </Stack>

      <Divider />

      <Group gap="sm">
        {!key.revoked && (
          <Button
            size="sm"
            variant="light"
            color="orange"
            loading={loading}
            onClick={() => void handleRevoke()}
          >
            Revoke
          </Button>
        )}
        <Button
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
          component={Link as any}
          to="/t/$tenant/security/api-keys/$keyId"
          params={{ tenant: tenantSlug, keyId }}
          size="sm"
          variant="default"
          leftSection={<IconExternalLink size={14} />}
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Group gap="xs">
      <Text size="sm" fw={500} w={100}>
        {label}:
      </Text>
      <Text size="sm" c="var(--mantine-color-gray-7)">
        {value}
      </Text>
    </Group>
  );
}
