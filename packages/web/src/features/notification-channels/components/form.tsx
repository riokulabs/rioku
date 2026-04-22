/**
 * <ChannelForm> — create/edit a notification channel.
 *
 * Renders name/kind/enabled then delegates per-kind config to
 * <ChannelKindConfigPanel>. Outer fields are validated synchronously via
 * `schemaResolver(createChannelSchema.pick({...}), {sync: true})`; the per-kind
 * config is validated on submit via
 * `channelConfigSchemas[kind].safeParse(config)` (same pattern as the
 * middleware form, Plan 2b).
 */
import { useState } from 'react';
import { Alert, Button, Divider, Group, Select, Stack, Switch, TextInput } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { createChannel, updateChannel } from '../api';
import { CHANNEL_KINDS, channelConfigSchemas, createChannelSchema } from '../schemas';
import type { NotificationChannel } from '../types';
import { ChannelKindConfigPanel } from './kind-config-panel';

interface ChannelFormValues {
  name: string;
  kind: NotificationChannel['kind'];
  enabled: boolean;
}

interface ChannelFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  initialValues?: NotificationChannel;
  onSuccess: (c: NotificationChannel) => void;
  onCancel: () => void;
}

const DEFAULT_CONFIG: Record<NotificationChannel['kind'], Record<string, unknown>> = {
  email: {
    to: '',
    from: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
  },
  slack: { webhook_url: '' },
  webhook: { url: '', headers: {}, method: 'POST' },
  pagerduty: { routing_key: '' },
  teams: { webhook_url: '' },
  sms: { twilio_sid: '', twilio_token: '', from_number: '' },
};

export function ChannelForm({
  mode,
  tenantId,
  initialValues,
  onSuccess,
  onCancel,
}: ChannelFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>(() => {
    if (initialValues) {
      return { ...initialValues.config };
    }
    return { ...DEFAULT_CONFIG.email };
  });

  const form = useForm<ChannelFormValues>({
    initialValues: {
      name: initialValues?.name ?? '',
      kind: initialValues?.kind ?? 'email',
      enabled: initialValues?.enabled ?? true,
    },
    validate: schemaResolver(
      createChannelSchema.pick({
        name: true,
        kind: true,
        enabled: true,
      }),
      { sync: true },
    ),
  });

  // When kind changes in create mode, reset config to the per-kind default.
  // Follows the "setState during render" pattern used in the middleware form
  // to avoid useEffect cascades.
  const [lastKind, setLastKind] = useState(form.values.kind);
  if (mode === 'create' && lastKind !== form.values.kind) {
    setLastKind(form.values.kind);
    setConfig({ ...DEFAULT_CONFIG[form.values.kind] });
  }

  async function handleSubmit(values: ChannelFormValues) {
    setLoading(true);
    setError(null);
    try {
      const schema = channelConfigSchemas[values.kind];
      const result = schema.safeParse(config);
      if (!result.success) {
        const issue = result.error.issues[0];
        const path = issue?.path.join('.') ?? 'config';
        setError(`Invalid ${path}: ${issue?.message ?? 'see per-kind schema'}`);
        setLoading(false);
        return;
      }

      const parsedConfig = result.data as Record<string, unknown>;
      if (mode === 'create') {
        const c = await createChannel({
          tenant_id: tenantId,
          name: values.name.trim(),
          kind: values.kind,
          config: parsedConfig,
          enabled: values.enabled,
        });
        notify.success('Channel created', `${c.name} is ready.`);
        onSuccess(c);
      } else if (initialValues) {
        const c = await updateChannel(initialValues.id, {
          name: values.name.trim(),
          config: parsedConfig,
          enabled: values.enabled,
        });
        if (!c) {
          setError('Channel no longer exists.');
          return;
        }
        notify.success('Channel updated', `${c.name} saved.`);
        onSuccess(c);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save channel';
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

        <TextInput label="Name" placeholder="ops-alerts" required {...form.getInputProps('name')} />

        <Select
          label="Kind"
          data={CHANNEL_KINDS.map((k) => ({ value: k, label: k }))}
          allowDeselect={false}
          disabled={mode === 'edit'}
          {...form.getInputProps('kind')}
        />

        <Switch
          label="Enabled"
          checked={form.values.enabled}
          onChange={(e) => {
            form.setFieldValue('enabled', e.currentTarget.checked);
          }}
        />

        <Divider label="Kind-specific config" labelPosition="left" />

        <ChannelKindConfigPanel kind={form.values.kind} value={config} onChange={setConfig} />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {mode === 'create' ? 'Create channel' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
