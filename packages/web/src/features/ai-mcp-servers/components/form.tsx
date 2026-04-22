/**
 * <McpServerForm> — create / edit an MCP server.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  MultiSelect,
  PasswordInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import type { McpServer } from '@/api/resources/types';
import { createMcpServer, updateMcpServer } from '../api';
import { createMcpServerSchema, updateMcpServerSchema } from '../schemas';

type AuthKind = McpServer['auth_kind'];

interface McpServerFormValues {
  name: string;
  url: string;
  description: string;
  auth_kind: AuthKind;
  auth_credential: string;
  authorized_agent_ids: string[];
  enabled: boolean;
}

interface McpServerFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  initialValues?: McpServer;
  onSuccess: (srv: McpServer) => void;
  onCancel: () => void;
}

function initialFromServer(s?: McpServer): McpServerFormValues {
  return {
    name: s?.name ?? '',
    url: s?.url ?? '',
    description: s?.description ?? '',
    auth_kind: s?.auth_kind ?? 'none',
    auth_credential: '',
    authorized_agent_ids: s ? [...s.authorized_agent_ids] : [],
    enabled: s?.enabled ?? true,
  };
}

export function McpServerForm({
  mode,
  tenantId,
  initialValues,
  onSuccess,
  onCancel,
}: McpServerFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useMockStore((s) => s.aiAgents);
  const agentOptions = Object.values(agents)
    .filter((a) => a.tenant_id === tenantId)
    .map((a) => ({ value: a.id, label: a.name }));

  const schema = mode === 'create' ? createMcpServerSchema : updateMcpServerSchema;

  const form = useForm<McpServerFormValues>({
    initialValues: initialFromServer(initialValues),
    validate: schemaResolver(schema, { sync: true }),
  });

  async function handleSubmit(values: McpServerFormValues) {
    setLoading(true);
    setError(null);
    try {
      const description = values.description.trim();
      if (mode === 'create') {
        const srv = await createMcpServer(tenantId, {
          name: values.name.trim(),
          url: values.url.trim(),
          auth_kind: values.auth_kind,
          ...(description !== '' ? { description } : {}),
          ...(values.auth_credential !== '' ? { auth_credential: values.auth_credential } : {}),
          authorized_agent_ids: values.authorized_agent_ids,
          enabled: values.enabled,
        });
        notify.success('MCP server created', `${srv.name} is ready.`);
        onSuccess(srv);
      } else if (initialValues) {
        const srv = await updateMcpServer(initialValues.id, {
          name: values.name.trim(),
          url: values.url.trim(),
          auth_kind: values.auth_kind,
          description,
          authorized_agent_ids: values.authorized_agent_ids,
          enabled: values.enabled,
          ...(values.auth_credential !== '' ? { auth_credential: values.auth_credential } : {}),
        });
        notify.success('MCP server updated', `${srv.name} saved.`);
        onSuccess(srv);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save server';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const credentialRequired = mode === 'create' && form.values.auth_kind !== 'none';

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
          placeholder="e.g. corp-tools-mcp"
          required
          {...form.getInputProps('name')}
        />

        <TextInput
          label="URL"
          placeholder="https://mcp.example.com"
          required
          {...form.getInputProps('url')}
        />

        <Textarea
          label="Description"
          placeholder="Optional"
          minRows={2}
          {...form.getInputProps('description')}
        />

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Auth kind
          </Text>
          <SegmentedControl<AuthKind>
            data={[
              { value: 'none', label: 'None' },
              { value: 'bearer', label: 'Bearer' },
              { value: 'api-key', label: 'API key' },
            ]}
            value={form.values.auth_kind}
            onChange={(value) => {
              form.setFieldValue('auth_kind', value);
            }}
          />
        </Stack>

        {form.values.auth_kind !== 'none' && (
          <PasswordInput
            label={mode === 'create' ? 'Credential' : 'Rotate credential (optional)'}
            placeholder={
              mode === 'create' ? 'Paste the credential' : 'Leave blank to keep existing'
            }
            description={
              mode === 'create' ? 'Shown once. Only the prefix is stored for display.' : undefined
            }
            required={credentialRequired}
            {...form.getInputProps('auth_credential')}
          />
        )}

        <MultiSelect
          label="Authorized agents"
          description="Agents that may route tool calls through this server. Empty = all agents."
          placeholder={form.values.authorized_agent_ids.length === 0 ? 'All agents' : undefined}
          data={agentOptions}
          value={form.values.authorized_agent_ids}
          onChange={(value) => {
            form.setFieldValue('authorized_agent_ids', value);
          }}
          searchable
          clearable
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
            {mode === 'create' ? 'Create server' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
