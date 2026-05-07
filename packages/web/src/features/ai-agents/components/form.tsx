/**
 * <AgentForm> — create/edit an AI agent.
 *
 * Fields: name, description, provider_id (Select), model (Select populated
 * from the selected provider's models), system_prompt, tool_ids, role_ids,
 * max_tokens_per_request, temperature, stop_sequences, enabled.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useProviderList } from '@/features/ai-providers/api';
import type { ProviderFilter } from '@/features/ai-providers/types';
import { useRoleList } from '@/features/security/roles/api';
import { createAgent, updateAgent } from '../api';

const EMPTY_PROVIDER_FILTER: ProviderFilter = { search: '', kinds: [] };
import { createAgentSchema, updateAgentSchema } from '../schemas';
import type { AiAgent } from '../types';
import { ToolSelector } from './tool-selector';

interface AgentFormValues {
  name: string;
  description: string;
  provider_id: string;
  model: string;
  system_prompt: string;
  tool_ids: string[];
  role_ids: string[];
  max_tokens_per_request: number;
  temperature: number;
  stop_sequences: string[];
  scoped_credential: string;
  enabled: boolean;
}

interface AgentFormProps {
  mode: 'create' | 'edit';
  /** Tenant slug — passed to the daemon for create/update calls. */
  tenant: string;
  /** Mock-store tenant id — used for filtering provider/role/tool option lists. */
  tenantId: string;
  initialValues?: AiAgent;
  onSuccess: (agent: AiAgent) => void;
  onCancel: () => void;
}

function initialFromAgent(a?: AiAgent): AgentFormValues {
  return {
    name: a?.name ?? '',
    description: a?.description ?? '',
    provider_id: a?.provider_id ?? '',
    model: a?.model ?? '',
    system_prompt: a?.system_prompt ?? 'You are a helpful assistant.',
    tool_ids: a?.tool_ids ? [...a.tool_ids] : [],
    role_ids: a?.role_ids ? [...a.role_ids] : [],
    max_tokens_per_request: a?.max_tokens_per_request ?? 4096,
    temperature: a?.temperature ?? 0.7,
    stop_sequences: a?.stop_sequences ? [...a.stop_sequences] : [],
    scoped_credential: '',
    enabled: a?.enabled ?? true,
  };
}

export function AgentForm({ mode, tenant, tenantId, initialValues, onSuccess, onCancel }: AgentFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerList = useProviderList(tenant, EMPTY_PROVIDER_FILTER);
  const providers = useMemo(() => {
    const m: Record<string, (typeof providerList)[number]> = {};
    for (const p of providerList) m[p.id] = p;
    return m;
  }, [providerList]);
  const roleList = useRoleList(tenant);
  const roles = useMemo(() => {
    const m: Record<string, (typeof roleList)[number]> = {};
    for (const r of roleList) m[r.id] = r;
    return m;
  }, [roleList]);

  const providerOptions = useMemo(
    () => providerList.map((p) => ({ value: p.id, label: `${p.name} (${p.kind})` })),
    [providerList],
  );

  const roleOptions = useMemo(
    () => roleList.map((r) => ({ value: r.id, label: r.name })),
    [roleList],
  );

  const form = useForm<AgentFormValues>({
    initialValues: initialFromAgent(initialValues),
    validate: schemaResolver(mode === 'create' ? createAgentSchema : updateAgentSchema, {
      sync: true,
    }),
  });

  const modelOptions = useMemo(() => {
    const provider = providers[form.values.provider_id];
    if (!provider) return [];
    return provider.models
      .filter((m) => m.enabled)
      .map((m) => ({ value: m.alias, label: `${m.alias} (${m.upstream_id})` }));
  }, [providers, form.values.provider_id]);

  async function handleSubmit(values: AgentFormValues) {
    setLoading(true);
    setError(null);
    try {
      const description = values.description.trim();
      if (mode === 'create') {
        const agent = await createAgent(tenant, {
          name: values.name.trim(),
          provider_id: values.provider_id,
          model: values.model.trim(),
          system_prompt: values.system_prompt,
          tool_ids: values.tool_ids,
          role_ids: values.role_ids,
          max_tokens_per_request: values.max_tokens_per_request,
          temperature: values.temperature,
          stop_sequences: values.stop_sequences,
          enabled: values.enabled,
          ...(description !== '' ? { description } : {}),
          ...(values.scoped_credential !== ''
            ? { scoped_credential: values.scoped_credential }
            : {}),
        });
        notify.success('Agent created', `${agent.name} is ready.`);
        onSuccess(agent);
      } else if (initialValues) {
        const agent = await updateAgent(tenant, initialValues.id, {
          name: values.name.trim(),
          provider_id: values.provider_id,
          model: values.model.trim(),
          system_prompt: values.system_prompt,
          tool_ids: values.tool_ids,
          role_ids: values.role_ids,
          max_tokens_per_request: values.max_tokens_per_request,
          temperature: values.temperature,
          stop_sequences: values.stop_sequences,
          enabled: values.enabled,
          description,
        });
        notify.success('Agent updated', `${agent.name} saved.`);
        onSuccess(agent);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save agent';
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
          placeholder="assistant-prod"
          required
          {...form.getInputProps('name')}
        />

        <Textarea
          label="Description"
          placeholder="Optional description"
          minRows={2}
          {...form.getInputProps('description')}
        />

        <Select
          label="Provider"
          data={providerOptions}
          required
          allowDeselect={false}
          searchable
          value={form.values.provider_id}
          onChange={(v) => {
            form.setFieldValue('provider_id', v ?? '');
            // Clear the model when provider changes.
            form.setFieldValue('model', '');
          }}
        />

        <Select
          label="Model"
          data={modelOptions}
          required
          allowDeselect={false}
          searchable
          disabled={form.values.provider_id === ''}
          value={form.values.model}
          onChange={(v) => {
            form.setFieldValue('model', v ?? '');
          }}
          placeholder={
            form.values.provider_id === '' ? 'Select a provider first' : 'Select a model'
          }
        />

        <Textarea
          label="System prompt"
          placeholder="You are a helpful assistant…"
          minRows={4}
          maxRows={10}
          required
          {...form.getInputProps('system_prompt')}
        />

        <ToolSelector
          tenantId={tenantId}
          value={form.values.tool_ids}
          onChange={(ids) => {
            form.setFieldValue('tool_ids', ids);
          }}
        />

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Roles allowed to invoke
          </Text>
          <Select
            data={roleOptions}
            value={null}
            placeholder="Add a role…"
            searchable
            clearable
            aria-label="Add role"
            onChange={(v) => {
              if (v && !form.values.role_ids.includes(v)) {
                form.setFieldValue('role_ids', [...form.values.role_ids, v]);
              }
            }}
          />
          <Group gap={4} mt={4}>
            {form.values.role_ids.map((rid) => {
              const r = roles[rid];
              return (
                <Button
                  key={rid}
                  size="compact-xs"
                  variant="light"
                  color="gray"
                  onClick={() => {
                    form.setFieldValue(
                      'role_ids',
                      form.values.role_ids.filter((x) => x !== rid),
                    );
                  }}
                >
                  {r?.name ?? rid} ×
                </Button>
              );
            })}
          </Group>
        </Stack>

        <Group grow>
          <NumberInput
            label="Max tokens / request"
            min={1}
            max={128_000}
            {...form.getInputProps('max_tokens_per_request')}
          />
          <NumberInput
            label="Temperature"
            min={0}
            max={2}
            step={0.1}
            decimalScale={2}
            {...form.getInputProps('temperature')}
          />
        </Group>

        <TagsInput
          label="Stop sequences"
          placeholder="Press Enter to add"
          value={form.values.stop_sequences}
          onChange={(v) => {
            form.setFieldValue('stop_sequences', v);
          }}
        />

        {mode === 'create' && (
          <PasswordInput
            label="Scoped credential (optional)"
            placeholder="Leave blank to inherit provider credential"
            description="Only the prefix is stored for display."
            {...form.getInputProps('scoped_credential')}
          />
        )}

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
            {mode === 'create' ? 'Create agent' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
