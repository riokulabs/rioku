/**
 * <ToolForm> — create/edit an AI tool.
 *
 * Fields: name, description, kind SegmentedControl; conditional fields for
 * mcp_server_id (TextInput referencing the MCP server id) vs http_endpoint
 * (url / method / auth_header); JSON schema via JsonSchemaEditor; dangerous
 * flag; enabled flag.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { createTool, updateTool } from '../api';
import { createToolSchema, updateToolSchema } from '../schemas';
import type { AiTool } from '../types';
import { JsonSchemaEditor } from './json-schema-editor';

interface ToolFormValues {
  name: string;
  description: string;
  kind: AiTool['kind'];
  schema: Record<string, unknown>;
  mcp_server_id: string;
  http_url: string;
  http_method: 'GET' | 'POST';
  http_auth_header: string;
  dangerous: boolean;
  enabled: boolean;
}

const DEFAULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
  required: [],
};

interface ToolFormProps {
  mode: 'create' | 'edit';
  tenant: string;
  initialValues?: AiTool;
  onSuccess: (tool: AiTool) => void;
  onCancel: () => void;
}

function initialFromTool(t?: AiTool): ToolFormValues {
  return {
    name: t?.name ?? '',
    description: t?.description ?? '',
    kind: t?.kind ?? 'native',
    schema: t?.schema ?? { ...DEFAULT_SCHEMA },
    mcp_server_id: t?.mcp_server_id ?? '',
    http_url: t?.http_endpoint?.url ?? '',
    http_method: t?.http_endpoint?.method ?? 'POST',
    http_auth_header: t?.http_endpoint?.auth_header ?? '',
    dangerous: t?.dangerous ?? false,
    enabled: t?.enabled ?? true,
  };
}

export function ToolForm({ mode, tenant, initialValues, onSuccess, onCancel }: ToolFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaValid, setSchemaValid] = useState(true);

  const form = useForm<ToolFormValues>({
    initialValues: initialFromTool(initialValues),
    validate: schemaResolver(mode === 'create' ? createToolSchema : updateToolSchema, {
      sync: true,
    }),
  });

  async function handleSubmit(values: ToolFormValues) {
    if (!schemaValid) {
      setError('Please fix the JSON schema before saving.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const base = {
        name: values.name.trim(),
        description: values.description.trim(),
        schema: values.schema,
        kind: values.kind,
        dangerous: values.dangerous,
        enabled: values.enabled,
      };
      const kindExtras =
        values.kind === 'mcp'
          ? { mcp_server_id: values.mcp_server_id }
          : values.kind === 'http'
            ? {
                http_endpoint: {
                  url: values.http_url.trim(),
                  method: values.http_method,
                  ...(values.http_auth_header.trim() !== ''
                    ? { auth_header: values.http_auth_header.trim() }
                    : {}),
                },
              }
            : {};

      if (mode === 'create') {
        const tool = await createTool(tenant, {
          ...base,
          ...kindExtras,
        });
        notify.success('Tool created', `${tool.name} is ready.`);
        onSuccess(tool);
      } else if (initialValues) {
        const tool = await updateTool(tenant, initialValues.id, {
          ...base,
          ...kindExtras,
        });
        notify.success('Tool updated', `${tool.name} saved.`);
        onSuccess(tool);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save tool';
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
          placeholder="weather-lookup"
          required
          {...form.getInputProps('name')}
        />

        <Textarea
          label="Description"
          placeholder="Short description of what this tool does"
          minRows={2}
          required
          {...form.getInputProps('description')}
        />

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Kind
          </Text>
          <SegmentedControl<ToolFormValues['kind']>
            data={[
              { value: 'native', label: 'Native' },
              { value: 'mcp', label: 'MCP' },
              { value: 'http', label: 'HTTP' },
            ]}
            value={form.values.kind}
            onChange={(value) => {
              form.setFieldValue('kind', value);
            }}
          />
        </Stack>

        {form.values.kind === 'mcp' && (
          <TextInput
            label="MCP server id"
            placeholder="mcps-…"
            required
            {...form.getInputProps('mcp_server_id')}
          />
        )}

        {form.values.kind === 'http' && (
          <Stack gap="sm">
            <TextInput
              label="HTTP URL"
              placeholder="https://api.example.com/v1/tool"
              required
              {...form.getInputProps('http_url')}
            />
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                Method
              </Text>
              <SegmentedControl<'GET' | 'POST'>
                data={[
                  { value: 'GET', label: 'GET' },
                  { value: 'POST', label: 'POST' },
                ]}
                value={form.values.http_method}
                onChange={(v) => {
                  form.setFieldValue('http_method', v);
                }}
              />
            </Stack>
            <TextInput
              label="Auth header (optional)"
              placeholder="Authorization: Bearer …"
              {...form.getInputProps('http_auth_header')}
            />
          </Stack>
        )}

        <JsonSchemaEditor
          value={form.values.schema}
          onChange={(v) => {
            form.setFieldValue('schema', v);
          }}
          onValidityChange={setSchemaValid}
        />

        <Switch
          label="Dangerous"
          description="Flag this tool for explicit agent opt-in"
          checked={form.values.dangerous}
          onChange={(e) => {
            form.setFieldValue('dangerous', e.currentTarget.checked);
          }}
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
          <Button type="submit" loading={loading} disabled={!schemaValid}>
            {mode === 'create' ? 'Create tool' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
