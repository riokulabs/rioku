/**
 * <RateLimitForm> — create / edit a semantic rate-limit rule.
 *
 * Conditional scope-dependent fields:
 *   - scope='agent' → agent Select required
 *   - scope='tool'  → tool Select required
 *   - scope='tenant' → neither required
 *
 * Exemplars captured via `<TagsInput>`.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  NumberInput,
  SegmentedControl,
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
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import type { AiSemanticRateLimit } from '@/api/resources';
import { createRateLimit, updateRateLimit } from '../api';
import { createRateLimitSchema, updateRateLimitSchema } from '../schemas';

type Scope = AiSemanticRateLimit['scope'];
type Action = AiSemanticRateLimit['action'];

interface RateLimitFormValues {
  name: string;
  description: string;
  scope: Scope;
  agent_id: string;
  tool_id: string;
  exemplars: string[];
  similarity_threshold: number;
  window_seconds: number;
  max_matches: number;
  action: Action;
  enabled: boolean;
}

interface RateLimitFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  initialValues?: AiSemanticRateLimit;
  onSuccess: (rule: AiSemanticRateLimit) => void;
  onCancel: () => void;
}

function initialFromRule(r?: AiSemanticRateLimit): RateLimitFormValues {
  return {
    name: r?.name ?? '',
    description: r?.description ?? '',
    scope: r?.scope ?? 'tenant',
    agent_id: r?.agent_id ?? '',
    tool_id: r?.tool_id ?? '',
    exemplars: r ? [...r.exemplars] : [],
    similarity_threshold: r?.similarity_threshold ?? 0.8,
    window_seconds: r?.window_seconds ?? 60,
    max_matches: r?.max_matches ?? 10,
    action: r?.action ?? 'block',
    enabled: r?.enabled ?? true,
  };
}

export function RateLimitForm({
  mode,
  tenantId,
  initialValues,
  onSuccess,
  onCancel,
}: RateLimitFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useMockStore((s) => s.aiAgents);
  const tools = useMockStore((s) => s.aiTools);

  const agentOptions = Object.values(agents)
    .filter((a) => a.tenant_id === tenantId)
    .map((a) => ({ value: a.id, label: a.name }));
  const toolOptions = Object.values(tools)
    .filter((t) => t.tenant_id === tenantId)
    .map((t) => ({ value: t.id, label: t.name }));

  const schema = mode === 'create' ? createRateLimitSchema : updateRateLimitSchema;

  const form = useForm<RateLimitFormValues>({
    initialValues: initialFromRule(initialValues),
    validate: schemaResolver(schema, { sync: true }),
  });

  async function handleSubmit(values: RateLimitFormValues) {
    setLoading(true);
    setError(null);
    try {
      const description = values.description.trim();
      const base = {
        name: values.name.trim(),
        ...(description !== '' ? { description } : {}),
        scope: values.scope,
        ...(values.scope === 'agent' && values.agent_id !== ''
          ? { agent_id: values.agent_id }
          : {}),
        ...(values.scope === 'tool' && values.tool_id !== '' ? { tool_id: values.tool_id } : {}),
        exemplars: values.exemplars,
        similarity_threshold: values.similarity_threshold,
        window_seconds: values.window_seconds,
        max_matches: values.max_matches,
        action: values.action,
        enabled: values.enabled,
      };
      if (mode === 'create') {
        const rule = await createRateLimit(tenantId, base);
        notify.success('Rate limit created', `${rule.name} is active.`);
        onSuccess(rule);
      } else if (initialValues) {
        const rule = await updateRateLimit(initialValues.id, base);
        notify.success('Rate limit updated', `${rule.name} saved.`);
        onSuccess(rule);
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
          placeholder="e.g. block-jailbreak-prompts"
          required
          {...form.getInputProps('name')}
        />
        <Textarea
          label="Description"
          placeholder="Optional description"
          minRows={2}
          {...form.getInputProps('description')}
        />

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Scope
          </Text>
          <SegmentedControl<Scope>
            data={[
              { value: 'tenant', label: 'Tenant' },
              { value: 'agent', label: 'Agent' },
              { value: 'tool', label: 'Tool' },
            ]}
            value={form.values.scope}
            onChange={(value) => {
              form.setFieldValue('scope', value);
            }}
          />
        </Stack>

        {form.values.scope === 'agent' && (
          <Select
            label="Agent"
            placeholder="Pick the agent this rule applies to"
            data={agentOptions}
            required
            searchable
            {...form.getInputProps('agent_id')}
          />
        )}
        {form.values.scope === 'tool' && (
          <Select
            label="Tool"
            placeholder="Pick the tool this rule applies to"
            data={toolOptions}
            required
            searchable
            {...form.getInputProps('tool_id')}
          />
        )}

        <TagsInput
          label="Exemplars"
          description="Sample prompts/messages this rule should catch. Min 1, max 50."
          placeholder="Type and press Enter"
          maxTags={50}
          value={form.values.exemplars}
          onChange={(value) => {
            form.setFieldValue('exemplars', value);
          }}
        />

        <NumberInput
          label="Similarity threshold"
          description="Cosine-similarity score above which a match triggers the rule (0.0–1.0)."
          min={0}
          max={1}
          step={0.05}
          decimalScale={2}
          required
          {...form.getInputProps('similarity_threshold')}
        />

        <Group grow>
          <NumberInput
            label="Window (seconds)"
            description="Rolling evaluation window."
            min={1}
            max={86_400}
            required
            {...form.getInputProps('window_seconds')}
          />
          <NumberInput
            label="Max matches"
            description="Threshold hits before action."
            min={1}
            required
            {...form.getInputProps('max_matches')}
          />
        </Group>

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Action
          </Text>
          <SegmentedControl<Action>
            data={[
              { value: 'block', label: 'Block' },
              { value: 'degrade', label: 'Degrade' },
              { value: 'log', label: 'Log' },
            ]}
            value={form.values.action}
            onChange={(value) => {
              form.setFieldValue('action', value);
            }}
          />
        </Stack>

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
