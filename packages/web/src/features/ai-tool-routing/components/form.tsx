/**
 * <BindingForm> — create / edit a tool-routing binding.
 *
 * Fields: agent Select, tool Select, CEL condition Textarea with Preview
 * button, enabled Switch.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconEye } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import {
  createBinding,
  previewCondition,
  updateBinding,
} from '../api';
import { createBindingSchema, updateBindingSchema } from '../schemas';
import type { AiToolBinding, PreviewConditionResult } from '../types';

interface BindingFormValues {
  agent_id: string;
  tool_id: string;
  condition: string;
  enabled: boolean;
}

interface BindingFormProps {
  mode: 'create' | 'edit';
  tenantId: string;
  initialValues?: AiToolBinding;
  /** Pre-fill agent when opening "create" from an agent detail page. */
  defaultAgentId?: string;
  /** Pre-fill tool when opening "create" from a tool detail page. */
  defaultToolId?: string;
  onSuccess: (binding: AiToolBinding) => void;
  onCancel: () => void;
}

function initialFromBinding(
  b?: AiToolBinding,
  defaultAgentId?: string,
  defaultToolId?: string,
): BindingFormValues {
  return {
    agent_id: b?.agent_id ?? defaultAgentId ?? '',
    tool_id: b?.tool_id ?? defaultToolId ?? '',
    condition: b?.condition ?? '',
    enabled: b?.enabled ?? true,
  };
}

export function BindingForm({
  mode,
  tenantId,
  initialValues,
  defaultAgentId,
  defaultToolId,
  onSuccess,
  onCancel,
}: BindingFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewConditionResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const agents = useMockStore((s) => s.aiAgents);
  const tools = useMockStore((s) => s.aiTools);

  const agentOptions = Object.values(agents)
    .filter((a) => a.tenant_id === tenantId)
    .map((a) => ({ value: a.id, label: a.name }));
  const toolOptions = Object.values(tools)
    .filter((t) => t.tenant_id === tenantId)
    .map((t) => ({ value: t.id, label: t.name }));

  const schema = mode === 'create' ? createBindingSchema : updateBindingSchema;

  const form = useForm<BindingFormValues>({
    initialValues: initialFromBinding(initialValues, defaultAgentId, defaultToolId),
    validate: schemaResolver(schema, { sync: true }),
  });

  async function handlePreview() {
    setPreviewing(true);
    setPreview(null);
    try {
      const result = await previewCondition(form.values.condition, {});
      setPreview(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      setPreview({ parses: false, error: msg });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSubmit(values: BindingFormValues) {
    setLoading(true);
    setError(null);
    try {
      // Validate CEL condition if present before saving.
      if (values.condition.trim() !== '') {
        const p = await previewCondition(values.condition, {});
        if (!p.parses) {
          setError(p.error ?? 'CEL condition is invalid');
          setLoading(false);
          return;
        }
      }
      if (mode === 'create') {
        const binding = await createBinding(tenantId, {
          agent_id: values.agent_id,
          tool_id: values.tool_id,
          condition: values.condition,
          enabled: values.enabled,
        });
        notify.success('Binding created', 'Tool attached to agent.');
        onSuccess(binding);
      } else if (initialValues) {
        const binding = await updateBinding(initialValues.id, {
          agent_id: values.agent_id,
          tool_id: values.tool_id,
          condition: values.condition,
          enabled: values.enabled,
        });
        notify.success('Binding updated', 'Binding saved.');
        onSuccess(binding);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save binding';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const conditionHasValue = form.values.condition.trim() !== '';

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
          label="Agent"
          placeholder="Pick an agent"
          data={agentOptions}
          required
          searchable
          disabled={mode === 'edit'}
          {...form.getInputProps('agent_id')}
        />

        <Select
          label="Tool"
          placeholder="Pick a tool"
          data={toolOptions}
          required
          searchable
          disabled={mode === 'edit'}
          {...form.getInputProps('tool_id')}
        />

        <Stack gap="xs">
          <Textarea
            label="CEL condition"
            description="Optional — empty = always allow. Evaluated daemon-side at invocation."
            placeholder='e.g. request.user.role == "admin"'
            minRows={3}
            maxRows={8}
            {...form.getInputProps('condition')}
          />
          <Group gap="sm">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconEye size={14} />}
              loading={previewing}
              disabled={!conditionHasValue}
              onClick={() => void handlePreview()}
              type="button"
            >
              Preview
            </Button>
            {preview && (
              <Text
                size="xs"
                c={
                  preview.parses
                    ? 'var(--mantine-color-green-7)'
                    : 'var(--mantine-color-red-7)'
                }
              >
                {preview.parses
                  ? `Parses · sample evaluates ${preview.sample_result === true ? 'true' : 'false'}`
                  : `Syntax error: ${preview.error ?? 'unknown'}`}
              </Text>
            )}
          </Group>
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
            {mode === 'create' ? 'Create binding' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
