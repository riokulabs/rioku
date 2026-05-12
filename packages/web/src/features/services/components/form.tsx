/**
 * <ServiceForm> — create/edit a service.
 *
 * Single reusable form; `mode="create"` calls createService, `mode="edit"`
 * calls updateService. Uses Mantine form with zod schemaResolver.
 */
import { useState } from 'react';
import {
  Stack,
  TextInput,
  Textarea,
  Group,
  Button,
  SegmentedControl,
  Alert,
  NumberInput,
  Collapse,
  Text,
  Select,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { usePermission } from '@/hooks/use-permission';
import { notify } from '@/hooks/use-notify';
import { useServiceListReal } from '../api.stage2';
import { TagsInput } from '@/features/api-mgmt-shared';
import { createService, updateService } from '../api';
import { createServiceSchema } from '../schemas';
import type { Service } from '../types';

interface ServiceFormValues {
  name: string;
  description: string;
  upstream: string;
  upstream_protocol: 'http' | 'https' | 'grpc';
  env: string;
  tags: string[];
  health_check_enabled: boolean;
  health_check_path: string;
  health_check_interval: number;
  health_check_timeout: number;
}

interface ServiceFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  initialValues?: Service;
  onSuccess: (service: Service) => void;
  onCancel: () => void;
}

function initialFromService(svc?: Service): ServiceFormValues {
  return {
    name: svc?.name ?? '',
    description: svc?.description ?? '',
    upstream: svc?.upstream ?? '',
    upstream_protocol: svc?.upstream_protocol ?? 'http',
    env: svc?.env ?? 'production',
    tags: svc?.tags ?? [],
    health_check_enabled: svc?.health_check !== undefined,
    health_check_path: svc?.health_check?.path ?? '/health',
    health_check_interval: svc?.health_check?.interval_seconds ?? 30,
    health_check_timeout: svc?.health_check?.timeout_seconds ?? 5,
  };
}

export function ServiceForm({
  mode,
  tenantId,
  initialValues,
  onSuccess,
  onCancel,
}: ServiceFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWrite = usePermission('service:write');
  const [healthOpened, { toggle: toggleHealth }] = useDisclosure(
    initialValues?.health_check !== undefined,
  );

  const { services: envsSeen } = useServiceListReal(tenantId, {
    search: '',
    health: [],
    env: [],
    tags: [],
  });
  const envSet = new Set<string>();
  for (const svc of envsSeen) envSet.add(svc.env);
  const envOptions = Array.from(envSet).sort();
  if (!envOptions.includes('production')) envOptions.unshift('production');

  const form = useForm<ServiceFormValues>({
    initialValues: initialFromService(initialValues),
    validate: schemaResolver(
      createServiceSchema.pick({
        name: true,
        description: true,
        upstream: true,
        upstream_protocol: true,
        env: true,
        tags: true,
      }),
      { sync: true },
    ),
  });

  async function handleSubmit(values: ServiceFormValues) {
    setLoading(true);
    setError(null);
    try {
      const healthCheck = values.health_check_enabled
        ? {
            path: values.health_check_path,
            interval_seconds: values.health_check_interval,
            timeout_seconds: values.health_check_timeout,
          }
        : undefined;

      const payload = {
        name: values.name.trim(),
        ...(values.description.trim() !== '' ? { description: values.description.trim() } : {}),
        upstream: values.upstream.trim(),
        upstream_protocol: values.upstream_protocol,
        env: values.env.trim(),
        tags: values.tags,
        ...(healthCheck !== undefined ? { health_check: healthCheck } : {}),
      };

      if (mode === 'create') {
        const svc = await createService(tenantId, payload);
        notify.success('Service created', `${svc.name} is ready.`);
        onSuccess(svc);
      } else if (initialValues) {
        const svc = await updateService(tenantId, initialValues.id, payload);
        notify.success('Service updated', `${svc.name} saved.`);
        onSuccess(svc);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save service';
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

        <TextInput label="Name" placeholder="auth-api" required {...form.getInputProps('name')} />

        <Textarea
          label="Description"
          placeholder="Optional description"
          minRows={2}
          {...form.getInputProps('description')}
        />

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Upstream protocol
          </Text>
          <SegmentedControl<ServiceFormValues['upstream_protocol']>
            data={[
              { value: 'http', label: 'HTTP' },
              { value: 'https', label: 'HTTPS' },
              { value: 'grpc', label: 'gRPC' },
            ]}
            value={form.values.upstream_protocol}
            onChange={(value) => {
              form.setFieldValue('upstream_protocol', value);
            }}
          />
        </Stack>

        <TextInput
          label="Upstream"
          placeholder="http://upstream:8080"
          description="Host or URL where traffic is forwarded."
          required
          {...form.getInputProps('upstream')}
        />

        <Select
          label="Environment"
          data={envOptions.map((env) => ({ value: env, label: env }))}
          searchable
          allowDeselect={false}
          {...form.getInputProps('env')}
        />

        <TagsInput
          label="Tags"
          values={form.values.tags}
          onChange={(tags) => {
            form.setFieldValue('tags', tags);
          }}
        />

        <Stack gap="xs">
          <Button
            variant="subtle"
            size="xs"
            leftSection={
              healthOpened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
            }
            onClick={toggleHealth}
            style={{ alignSelf: 'flex-start' }}
            type="button"
          >
            Health check
          </Button>
          <Collapse expanded={healthOpened}>
            <Stack gap="sm" pl="md">
              <SegmentedControl
                data={[
                  { value: 'off', label: 'Disabled' },
                  { value: 'on', label: 'Enabled' },
                ]}
                value={form.values.health_check_enabled ? 'on' : 'off'}
                onChange={(value) => {
                  form.setFieldValue('health_check_enabled', value === 'on');
                }}
              />
              {form.values.health_check_enabled && (
                <>
                  <TextInput
                    label="Path"
                    placeholder="/health"
                    {...form.getInputProps('health_check_path')}
                  />
                  <Group grow>
                    <NumberInput
                      label="Interval (s)"
                      min={1}
                      max={3600}
                      {...form.getInputProps('health_check_interval')}
                    />
                    <NumberInput
                      label="Timeout (s)"
                      min={1}
                      max={60}
                      {...form.getInputProps('health_check_timeout')}
                    />
                  </Group>
                </>
              )}
            </Stack>
          </Collapse>
        </Stack>

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Tooltip disabled={canWrite} label="Requires service:write permission">
            <Button type="submit" loading={loading} disabled={!canWrite}>
              {mode === 'create' ? 'Create service' : 'Save changes'}
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </form>
  );
}
