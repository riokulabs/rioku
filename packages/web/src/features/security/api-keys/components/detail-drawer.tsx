/**
 * <ApiKeyDetailDrawer> — read-only API key details + revoke/rotate actions.
 */
import { useState } from 'react';
import { Stack, Group, Text, Badge, Button, Divider, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useApiKey, revokeApiKey, rotateApiKey } from '../api';

const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  revoked: 'red',
  expired: 'orange',
};

interface ApiKeyDetailDrawerProps {
  keyId: string;
  onClose: () => void;
  /** Called when a rotate happens so the parent can show the new value */
  onRotated?: (fullValue: string) => void;
}

export function ApiKeyDetailDrawer({
  keyId,
  onClose: _onClose,
  onRotated,
}: ApiKeyDetailDrawerProps) {
  const key = useApiKey(keyId);
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
      await revokeApiKey(keyId);
      notify.success('API key revoked', 'The key has been invalidated.');
    } catch {
      notify.error('Failed to revoke key', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRotate() {
    setLoading(true);
    try {
      const result = await rotateApiKey(keyId);
      onRotated?.(result.fullValue);
      notify.success('API key rotated', 'A new key value has been generated.');
    } catch {
      notify.error('Failed to rotate key', 'Please try again.');
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
            {key.prefix}…
          </Text>
        </Stack>
        <Badge size="sm" color={STATUS_COLORS[key.display_status] ?? 'gray'} variant="light">
          {key.display_status}
        </Badge>
      </Group>

      <Divider />

      <Stack gap="xs">
        <Group gap="xs">
          <Text size="sm" fw={500} w={100}>
            Scope:
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {key.scope.join(', ') || '—'}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="sm" fw={500} w={100}>
            Created:
          </Text>
          <Text size="sm">{new Date(key.created_at).toLocaleDateString()}</Text>
        </Group>
        <Group gap="xs">
          <Text size="sm" fw={500} w={100}>
            Last used:
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {key.last_used_summary ?? '—'}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="sm" fw={500} w={100}>
            Expires:
          </Text>
          <Text size="sm">
            {key.expires_at
              ? `${String(key.expires_in_days ?? 0)}d (${new Date(key.expires_at).toLocaleDateString()})`
              : 'Never'}
          </Text>
        </Group>
      </Stack>

      <Divider />

      <Group gap="sm">
        {key.display_status === 'active' && (
          <Button size="sm" variant="light" loading={loading} onClick={() => void handleRotate()}>
            Rotate
          </Button>
        )}
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
      </Group>
    </Stack>
  );
}
