/* eslint-disable react-hooks/set-state-in-effect -- form state hydrates from server fetch on first load; this is the correct pattern */
/**
 * Real-API Integrations section — webhook CRUD + test send.
 *
 * Reads via `useGetSettingsIntegrations`, replaces via
 * `usePutSettingsIntegrations` (full-replace; we round-trip the rest of the
 * config and modify the `webhooks` array). Test-send via `usePostWebhookTest`.
 *
 * Plan 07 — Task 8.
 */
import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconTrash, IconSend } from '@tabler/icons-react';
import {
  useGetSettingsIntegrations,
  usePutSettingsIntegrations,
  usePostWebhookTest,
} from '@/api/generated/settings/settings';
import type { SettingsIntegrationsWebhooksItem } from '@/api/generated/schemas/settingsIntegrationsWebhooksItem';
import { notify } from '@/hooks/use-notify';
import { unwrap } from './_unwrap';

interface IntegrationsRealSectionProps {
  tenant: string;
}

function newId(): string {
  return `wh_${Math.random().toString(36).slice(2, 10)}`;
}

export function IntegrationsRealSection({ tenant }: IntegrationsRealSectionProps) {
  const q = useGetSettingsIntegrations(tenant);
  const put = usePutSettingsIntegrations();
  const test = usePostWebhookTest();

  const [webhooks, setWebhooks] = useState<SettingsIntegrationsWebhooksItem[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [dirty, setDirty] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});

  useEffect(() => {
    const d = unwrap<{
      webhooks?: SettingsIntegrationsWebhooksItem[];
      slack?: unknown;
      pagerduty?: unknown;
    }>(q.data);
    if (!d || dirty) return;
    setWebhooks(d.webhooks ?? []);
  }, [q.data, dirty]);

  if (q.isLoading)
    return (
      <Stack align="center" py="xl" data-testid="integrations-real-loading">
        <Loader />
      </Stack>
    );
  if (q.isError)
    return (
      <Alert color="red" data-testid="integrations-real-error">
        Failed to load: {(q.error as Error).message}
      </Alert>
    );

  function addWebhook() {
    if (!draftName.trim() || !draftUrl.trim()) return;
    setWebhooks((prev) => [
      ...prev,
      { id: newId(), name: draftName.trim(), url: draftUrl.trim(), enabled: true, events: [] },
    ]);
    setDraftName('');
    setDraftUrl('');
    setDirty(true);
  }

  function removeWebhook(id: string) {
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    setDirty(true);
  }

  function toggleWebhook(id: string, enabled: boolean) {
    setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, enabled } : w)));
    setDirty(true);
  }

  async function save() {
    try {
      const payload: { webhooks: SettingsIntegrationsWebhooksItem[]; slack?: unknown; pagerduty?: unknown } = {
        webhooks,
      };
      const cur = unwrap<{ slack?: unknown; pagerduty?: unknown }>(q.data);
      if (cur?.slack) payload.slack = cur.slack;
      if (cur?.pagerduty) payload.pagerduty = cur.pagerduty;
      await put.mutateAsync({ tenant, data: payload as Parameters<typeof put.mutateAsync>[0]['data'] });
      notify.success('Integrations saved');
      setDirty(false);
      await q.refetch();
    } catch (err) {
      notify.error('Save failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  async function sendTest(id: string) {
    try {
      const res = await test.mutateAsync({ tenant, id });
      const data = (res as unknown as { data?: { http_status?: number; duration_ms?: number; error?: string } }).data ?? {};
      const ok = (data.http_status ?? 0) >= 200 && (data.http_status ?? 0) < 300;
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ok,
          msg: ok
            ? `HTTP ${String(data.http_status)} in ${String(data.duration_ms ?? 0)}ms`
            : `Failed: ${data.error ?? `HTTP ${String(data.http_status ?? 'unknown')}`}`,
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, msg: err instanceof Error ? err.message : 'Test failed' },
      }));
    }
  }

  return (
    <Stack gap="lg" data-testid="integrations-real-section">
      <Title order={5}>Webhooks</Title>
      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>Add webhook</Title>
          <Group grow>
            <TextInput
              label="Name"
              value={draftName}
              onChange={(e) => {
                setDraftName(e.currentTarget.value);
              }}
              data-testid="integrations-real-draft-name"
            />
            <TextInput
              label="URL"
              value={draftUrl}
              onChange={(e) => {
                setDraftUrl(e.currentTarget.value);
              }}
              data-testid="integrations-real-draft-url"
            />
          </Group>
          <Group justify="flex-end">
            <Button
              size="xs"
              onClick={addWebhook}
              disabled={!draftName.trim() || !draftUrl.trim()}
              data-testid="integrations-real-add"
            >
              Add
            </Button>
          </Group>
        </Stack>
      </Card>

      {webhooks.length === 0 ? (
        <Text size="sm" c="dimmed" data-testid="integrations-real-empty">
          No webhooks configured.
        </Text>
      ) : (
        <Stack gap="xs">
          {webhooks.map((w) => {
            const id = w.id ?? '';
            const result = testResults[id];
            return (
              <Card key={id} withBorder data-testid={`integrations-real-webhook-${id}`}>
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Text fw={600} size="sm">
                        {w.name}
                      </Text>
                      {w.enabled ? (
                        <Badge color="green" variant="light" size="xs">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="outline" size="xs">
                          Disabled
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {w.url}
                    </Text>
                    {result && (
                      <Text
                        size="xs"
                        c={result.ok ? 'green' : 'red'}
                        data-testid={`integrations-real-test-result-${id}`}
                      >
                        {result.msg}
                      </Text>
                    )}
                  </Stack>
                  <Group gap="xs">
                    <Switch
                      checked={w.enabled ?? false}
                      onChange={(e) => {
                        toggleWebhook(id, e.currentTarget.checked);
                      }}
                      data-testid={`integrations-real-toggle-${id}`}
                    />
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconSend size={12} />}
                      loading={test.isPending}
                      onClick={() => {
                        void sendTest(id);
                      }}
                      data-testid={`integrations-real-test-${id}`}
                    >
                      Test send
                    </Button>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => {
                        removeWebhook(id);
                      }}
                      data-testid={`integrations-real-remove-${id}`}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}

      <Group justify="flex-end">
        <Button
          loading={put.isPending}
          disabled={!dirty}
          onClick={() => {
            void save();
          }}
          data-testid="integrations-real-save"
        >
          Save
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Audit emitted server-side on PUT.
      </Text>
    </Stack>
  );
}
