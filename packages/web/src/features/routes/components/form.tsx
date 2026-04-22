/**
 * <RouteForm> — create/edit a route.
 *
 * Supports match rules (method, match_kind, path), strip_prefix, rewrite_path,
 * headers add/remove (key/value rows), enabled toggle. Policies and middleware
 * stack are managed via <AttachedPolicies> + <MiddlewareStackEditor> (not in
 * the form — those are edit-in-place on route detail).
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Switch,
  TagsInput,
  TextInput,
  Text,
  ActionIcon,
} from '@mantine/core';
import { IconAlertCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { useForm, schemaResolver } from '@mantine/form';
import { z } from 'zod';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { createRoute, updateRoute } from '../api';
import { isValidRegex } from '../schemas';
import type { Route } from '../types';

/**
 * Form-level validation schema — a trimmed copy of the top-level fields of
 * `createRouteSchema` plus the regex refinement. We don't use
 * `createRouteSchema.pick` because zod v4 forbids `.pick()` on refined object
 * schemas (the .refine at the end of createRouteSchema blocks it).
 */
const routeFormSchema = z
  .object({
    service_id: z.string().min(1),
    name: z.string().min(1).max(80),
    path: z.string().startsWith('/'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY']),
    match_kind: z.enum(['prefix', 'exact', 'regex']),
  })
  .refine((v) => v.match_kind !== 'regex' || isValidRegex(v.path), {
    path: ['path'],
    message: 'Invalid regex pattern',
  });

interface HeaderPair {
  key: string;
  value: string;
}

interface RouteFormValues {
  service_id: string;
  name: string;
  path: string;
  method: Route['method'];
  match_kind: Route['match_kind'];
  strip_prefix: boolean;
  rewrite_path: string;
  enabled: boolean;
  headers_remove: string[];
}

interface RouteFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  /** If create-mode, optional pre-selected service. */
  defaultServiceId?: string;
  initialValues?: Route;
  onSuccess: (route: Route) => void;
  onCancel: () => void;
}

function headersAddToPairs(h: Record<string, string>): HeaderPair[] {
  return Object.entries(h).map(([key, value]) => ({ key, value }));
}

function pairsToHeadersAdd(pairs: HeaderPair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    if (p.key.trim() !== '') out[p.key.trim()] = p.value;
  }
  return out;
}

export function RouteForm({
  mode,
  tenantId,
  defaultServiceId,
  initialValues,
  onSuccess,
  onCancel,
}: RouteFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerPairs, setHeaderPairs] = useState<HeaderPair[]>(
    initialValues ? headersAddToPairs(initialValues.headers_add) : [],
  );

  const services = useMockStore((s) => s.services);
  const serviceOptions = Object.values(services)
    .filter((s) => s.tenant_id === tenantId)
    .map((s) => ({ value: s.id, label: s.name }));

  const form = useForm<RouteFormValues>({
    initialValues: {
      service_id: initialValues?.service_id ?? defaultServiceId ?? '',
      name: initialValues?.name ?? '',
      path: initialValues?.path ?? '/',
      method: initialValues?.method ?? 'GET',
      match_kind: initialValues?.match_kind ?? 'prefix',
      strip_prefix: initialValues?.strip_prefix ?? false,
      rewrite_path: initialValues?.rewrite_path ?? '',
      enabled: initialValues?.enabled ?? true,
      headers_remove: initialValues?.headers_remove ?? [],
    },
    validate: schemaResolver(routeFormSchema, { sync: true }),
  });

  async function handleSubmit(values: RouteFormValues) {
    setLoading(true);
    setError(null);
    try {
      const headers_add = pairsToHeadersAdd(headerPairs);

      const payload = {
        name: values.name.trim(),
        path: values.path.trim(),
        method: values.method,
        match_kind: values.match_kind,
        strip_prefix: values.strip_prefix,
        ...(values.rewrite_path.trim() !== '' ? { rewrite_path: values.rewrite_path.trim() } : {}),
        headers_add,
        headers_remove: values.headers_remove,
        enabled: values.enabled,
      };

      if (mode === 'create') {
        const r = await createRoute({
          service_id: values.service_id,
          ...payload,
        });
        notify.success('Route created', `${r.name} is ready.`);
        onSuccess(r);
      } else if (initialValues) {
        const r = await updateRoute(initialValues.id, payload);
        notify.success('Route updated', `${r.name} saved.`);
        onSuccess(r);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save route';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function addHeaderRow() {
    setHeaderPairs((prev) => [...prev, { key: '', value: '' }]);
  }

  function updateHeaderRow(index: number, patch: Partial<HeaderPair>) {
    setHeaderPairs((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function removeHeaderRow(index: number) {
    setHeaderPairs((prev) => prev.filter((_, i) => i !== index));
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

        <Select
          label="Service"
          data={serviceOptions}
          searchable
          required
          disabled={mode === 'edit'}
          allowDeselect={false}
          {...form.getInputProps('service_id')}
        />

        <TextInput label="Name" placeholder="user-get" required {...form.getInputProps('name')} />

        <Group grow>
          <Select
            label="Method"
            data={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'].map((m) => ({
              value: m,
              label: m,
            }))}
            allowDeselect={false}
            {...form.getInputProps('method')}
          />
          <Select
            label="Match kind"
            data={[
              { value: 'prefix', label: 'Prefix' },
              { value: 'exact', label: 'Exact' },
              { value: 'regex', label: 'Regex' },
            ]}
            allowDeselect={false}
            {...form.getInputProps('match_kind')}
          />
        </Group>

        <TextInput label="Path" placeholder="/api/users" required {...form.getInputProps('path')} />

        <Group grow align="flex-end">
          <Switch
            label="Strip prefix"
            {...form.getInputProps('strip_prefix', { type: 'checkbox' })}
          />
          <Switch label="Enabled" {...form.getInputProps('enabled', { type: 'checkbox' })} />
        </Group>

        <TextInput
          label="Rewrite path (optional)"
          placeholder="/internal/users"
          {...form.getInputProps('rewrite_path')}
        />

        {/* Headers add */}
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={500}>
              Add request headers
            </Text>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconPlus size={14} />}
              onClick={addHeaderRow}
              type="button"
            >
              Add header
            </Button>
          </Group>
          {headerPairs.length === 0 ? (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              No added headers.
            </Text>
          ) : (
            <Stack gap="xs">
              {headerPairs.map((p, i) => (
                <Group key={i} gap="xs" align="flex-end">
                  <TextInput
                    placeholder="X-Header"
                    value={p.key}
                    onChange={(e) => {
                      updateHeaderRow(i, { key: e.currentTarget.value });
                    }}
                    style={{ flex: 1 }}
                    aria-label={`Header ${String(i + 1)} name`}
                  />
                  <TextInput
                    placeholder="value"
                    value={p.value}
                    onChange={(e) => {
                      updateHeaderRow(i, { value: e.currentTarget.value });
                    }}
                    style={{ flex: 1 }}
                    aria-label={`Header ${String(i + 1)} value`}
                  />
                  <ActionIcon
                    color="red.8"
                    variant="subtle"
                    onClick={() => {
                      removeHeaderRow(i);
                    }}
                    aria-label={`Remove header ${String(i + 1)}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>

        {/* Headers remove */}
        <TagsInput
          label="Remove headers"
          placeholder="Authorization"
          value={form.values.headers_remove}
          onChange={(v) => {
            form.setFieldValue('headers_remove', v);
          }}
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {mode === 'create' ? 'Create route' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
