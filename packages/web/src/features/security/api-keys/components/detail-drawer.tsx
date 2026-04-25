/**
 * <ApiKeyDetailDrawer> — read-only API key details + activity history.
 *
 * Two-tab drawer: "Details" (metadata + revoke/rotate) and "Activity" (usage
 * sparkline + audit timeline). Activity defaults to selected when the key is
 * active; falls back to Details for revoked keys (where Activity is mostly
 * historical).
 */
import { useState } from 'react';
import { Stack, Group, Text, Badge, Button, Divider, Alert, Tabs } from '@mantine/core';
import { IconAlertCircle, IconActivity, IconInfoCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useApiKey, revokeApiKey, rotateApiKey } from '../api';
import { ApiKeyActivityPanel } from './activity-panel';

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
  const [tab, setTab] = useState<'details' | 'activity'>('activity');

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

      <Tabs
        value={tab}
        onChange={(v) => {
          if (v === 'details' || v === 'activity') setTab(v);
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="activity" leftSection={<IconActivity size={14} />}>
            Activity
          </Tabs.Tab>
          <Tabs.Tab value="details" leftSection={<IconInfoCircle size={14} />}>
            Details
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="activity" pt="md">
          <ApiKeyActivityPanel apiKey={key} />
        </Tabs.Panel>

        <Tabs.Panel value="details" pt="md">
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

          <Divider my="md" />

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
        </Tabs.Panel>
      </Tabs>
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
