/**
 * <MiddlewareForm> — create/edit a middleware.
 *
 * Renders name/kind/description/enabled/order_hint then delegates per-kind
 * config to <KindConfigPanel>. Per-kind config schema is validated on submit
 * via middlewareConfigSchemas[kind].safeParse.
 */
import { useState } from 'react';
import {
  Stack,
  TextInput,
  Textarea,
  Select,
  NumberInput,
  Switch,
  Group,
  Button,
  Alert,
  Divider,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useForm, schemaResolver } from '@mantine/form';
import { notify } from '@/hooks/use-notify';
import {
  createMiddleware,
  updateMiddleware,
} from '../api';
import {
  MIDDLEWARE_KINDS,
  createMiddlewareSchema,
  middlewareConfigSchemas,
} from '../schemas';
import type { Middleware } from '../types';
import { KindConfigPanel } from './kind-config-panel';

interface MiddlewareFormValues {
  name: string;
  kind: Middleware['kind'];
  description: string;
  enabled: boolean;
  order_hint: number;
}

interface MiddlewareFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  initialValues?: Middleware;
  onSuccess: (m: Middleware) => void;
  onCancel: () => void;
}

const DEFAULT_CONFIG: Record<Middleware['kind'], Record<string, unknown>> = {
  'rate-limit': { requests_per_minute: 60, burst: 0, key_by: 'ip' },
  auth: { mode: 'bearer' },
  transform: {},
  cors: { allowed_origins: [], allowed_methods: [], allow_credentials: false },
  cache: { ttl_seconds: 60, vary_headers: [] },
  logging: { level: 'info', fields: [] },
  custom: {},
};

export function MiddlewareForm({
  mode,
  tenantId,
  initialValues,
  onSuccess,
  onCancel,
}: MiddlewareFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>(() => {
    if (initialValues) {
      return { ...initialValues.config };
    }
    return DEFAULT_CONFIG['rate-limit'];
  });

  const form = useForm<MiddlewareFormValues>({
    initialValues: {
      name: initialValues?.name ?? '',
      kind: initialValues?.kind ?? 'rate-limit',
      description: initialValues?.description ?? '',
      enabled: initialValues?.enabled ?? true,
      order_hint: initialValues?.order_hint ?? 100,
    },
    validate: schemaResolver(
      createMiddlewareSchema.pick({
        name: true,
        kind: true,
        description: true,
        enabled: true,
        order_hint: true,
      }),
      { sync: true },
    ),
  });

  // When kind changes in create mode, reset config to the per-kind default.
  // Using state-during-render via the "previous value" pattern avoids useEffect
  // cascades. React sees the setState during render and re-renders with both
  // updates merged.
  const [lastKind, setLastKind] = useState(form.values.kind);
  if (mode === 'create' && lastKind !== form.values.kind) {
    setLastKind(form.values.kind);
    setConfig({ ...DEFAULT_CONFIG[form.values.kind] });
  }

  async function handleSubmit(values: MiddlewareFormValues) {
    setLoading(true);
    setError(null);
    try {
      const schema = middlewareConfigSchemas[values.kind];
      const result = schema.safeParse(config);
      if (!result.success) {
        const issue = result.error.issues[0];
        const path = issue?.path.join('.') ?? 'config';
        setError(`Invalid ${path}: ${issue?.message ?? 'see per-kind schema'}`);
        setLoading(false);
        return;
      }

      const payload = {
        name: values.name.trim(),
        kind: values.kind,
        ...(values.description.trim() !== ''
          ? { description: values.description.trim() }
          : {}),
        config: result.data as Record<string, unknown>,
        enabled: values.enabled,
        order_hint: values.order_hint,
      };

      if (mode === 'create') {
        const m = await createMiddleware(tenantId, payload);
        notify.success('Middleware created', `${m.name} is ready.`);
        onSuccess(m);
      } else if (initialValues) {
        const m = await updateMiddleware(initialValues.id, payload);
        notify.success('Middleware updated', `${m.name} saved.`);
        onSuccess(m);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save middleware';
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
          placeholder="global-rate-limit"
          required
          {...form.getInputProps('name')}
        />

        <Select
          label="Kind"
          data={MIDDLEWARE_KINDS.map((k) => ({ value: k, label: k }))}
          allowDeselect={false}
          disabled={mode === 'edit'}
          {...form.getInputProps('kind')}
        />

        <Textarea
          label="Description"
          minRows={2}
          {...form.getInputProps('description')}
        />

        <Group grow>
          <NumberInput
            label="Order hint"
            description="Lower runs first; ties broken by id."
            min={0}
            max={10_000}
            {...form.getInputProps('order_hint')}
          />
          <Switch
            label="Enabled"
            mt="xl"
            {...form.getInputProps('enabled', { type: 'checkbox' })}
          />
        </Group>

        <Divider label="Kind-specific config" labelPosition="left" />

        <KindConfigPanel
          kind={form.values.kind}
          value={config}
          onChange={setConfig}
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {mode === 'create' ? 'Create middleware' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
