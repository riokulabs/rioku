/**
 * <TestPanel> — inline "Send test notification" panel for a channel.
 *
 * Click button → calls `testChannel(id)` (mock ~800ms latency, deterministic
 * ~10% failure). Result is rendered inline: green success badge + latency, or
 * red alert with the error message.
 *
 * Gated on `notification-channel:test` — the button is disabled with a
 * tooltip-style description when the caller lacks the permission.
 */
import { useState } from 'react';
import { Alert, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconCheck, IconSend } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { testChannel } from '../api';
import type { TestChannelResult } from '../types';

interface TestPanelProps {
  channelId: string;
  channelName: string;
}

export function TestPanel({ channelId, channelName }: TestPanelProps) {
  const canTest = usePermission('notification-channel:test');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestChannelResult | null>(null);

  async function handleTest() {
    setLoading(true);
    setResult(null);
    try {
      const r = await testChannel(channelId);
      setResult(r);
      if (r.ok) {
        notify.success('Test sent', `${channelName} responded in ${String(r.latency_ms)}ms.`);
      } else {
        notify.error('Test failed', r.error ?? 'Unknown error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      notify.error('Test failed', msg);
      setResult({
        ok: false,
        latency_ms: 0,
        tested_at: new Date().toISOString(),
        error: msg,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="xs" data-testid="channel-test-panel">
      <Text size="sm" fw={600}>
        Send test notification
      </Text>
      <Group gap="sm" align="center">
        <Button
          leftSection={<IconSend size={14} />}
          size="sm"
          loading={loading}
          disabled={!canTest}
          onClick={() => void handleTest()}
          data-testid="channel-test-send"
        >
          Send test
        </Button>
        {!canTest && (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Requires the notification-channel:test permission.
          </Text>
        )}
      </Group>
      {result && result.ok && (
        <Group gap="xs" data-testid="channel-test-result-ok">
          <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>
            Delivered
          </Badge>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Latency: {String(result.latency_ms)}ms
          </Text>
        </Group>
      )}
      {result && !result.ok && (
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertCircle size={14} />}
          data-testid="channel-test-result-error"
        >
          <Text size="xs">{result.error ?? 'Test failed.'}</Text>
        </Alert>
      )}
    </Stack>
  );
}
