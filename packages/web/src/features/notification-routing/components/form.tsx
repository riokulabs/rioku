/**
 * <RoutingRuleForm> — create/edit a notification routing rule.
 *
 * Outer fields (name, event_filter, channels, enabled) are validated
 * synchronously via `schemaResolver(…, { sync: true })`.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  MultiSelect,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useMockStore } from '@/api/mock-store';
import { createRoutingRule, updateRoutingRule } from '../api';
import { createRoutingRuleSchema, updateRoutingRuleSchema } from '../schemas';
import type { NotificationRoutingRule } from '../types';

interface RoutingRuleFormValues {
  name: string;
  event_filter: string;
  channel_ids: string[];
  enabled: boolean;
}

interface RoutingRuleFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  initialValues?: NotificationRoutingRule;
  onSuccess: (r: NotificationRoutingRule) => void;
  onCancel: () => void;
}

export function RoutingRuleForm({
  mode,
  tenantId,
  initialValues,
  onSuccess,
  onCancel,
}: RoutingRuleFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channels = useMockStore((s) => s.notificationChannels);

  const channelOptions = useMemo(() => {
    return Object.values(channels)
      .filter((c) => c.tenant_id === tenantId)
      .map((c) => ({
        value: c.id,
        label: `${c.name} — ${c.kind}`,
      }));
  }, [channels, tenantId]);

  const form = useForm<RoutingRuleFormValues>({
    initialValues: {
      name: initialValues?.name ?? '',
      event_filter: initialValues?.event_filter ?? '*.*',
      channel_ids: initialValues?.channel_ids
        ? [...initialValues.channel_ids]
        : [],
      enabled: initialValues?.enabled ?? true,
    },
    validate: schemaResolver(
      mode === 'create'
        ? createRoutingRuleSchema.pick({
            name: true,
            event_filter: true,
            channel_ids: true,
            enabled: true,
          })
        : updateRoutingRuleSchema.pick({
            name: true,
            event_filter: true,
            channel_ids: true,
            enabled: true,
          }),
      { sync: true },
    ),
  });

  async function handleSubmit(values: RoutingRuleFormValues) {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'create') {
        const r = await createRoutingRule({
          tenant_id: tenantId,
          name: values.name.trim(),
          event_filter: values.event_filter.trim(),
          channel_ids: values.channel_ids,
          enabled: values.enabled,
        });
        notify.success('Rule created', `${r.name} is ready.`);
        onSuccess(r);
      } else if (initialValues) {
        const r = await updateRoutingRule(initialValues.id, {
          name: values.name.trim(),
          event_filter: values.event_filter.trim(),
          channel_ids: values.channel_ids,
          enabled: values.enabled,
        });
        if (!r) {
          setError('Rule no longer exists.');
          return;
        }
        notify.success('Rule updated', `${r.name} saved.`);
        onSuccess(r);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save rule';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={form.onSubmit((v) => {
        void handleSubmit(v);
      })}
    >
      <Stack gap="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        <TextInput
          label="Name"
          placeholder="security-on-call"
          required
          {...form.getInputProps('name')}
        />

        <Stack gap={4}>
          <TextInput
            label="Event filter"
            placeholder="security.*"
            required
            ff="monospace"
            {...form.getInputProps('event_filter')}
          />
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Syntax: <Text component="span" ff="monospace">{'<category>.<subtype>'}</Text>
            {' '}where each side is a lowercase slug or <Text component="span" ff="monospace">*</Text>.
            Examples: <Text component="span" ff="monospace">security.*</Text>,{' '}
            <Text component="span" ff="monospace">audit.destructive</Text>,{' '}
            <Text component="span" ff="monospace">*.error</Text>.
          </Text>
        </Stack>

        <MultiSelect
          label="Channels"
          data={channelOptions}
          required
          searchable
          value={form.values.channel_ids}
          onChange={(values) => {
            form.setFieldValue('channel_ids', values);
          }}
          placeholder={
            channelOptions.length === 0
              ? 'No channels — create one first'
              : 'Select channels'
          }
          disabled={channelOptions.length === 0}
          aria-label="Target channels"
        />

        <Switch
          label="Enabled"
          checked={form.values.enabled}
          onChange={(e) => {
            form.setFieldValue('enabled', e.currentTarget.checked);
          }}
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {mode === 'create' ? 'Create rule' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
