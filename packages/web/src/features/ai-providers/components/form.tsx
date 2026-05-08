/**
 * <ProviderForm> — create/edit an AI provider.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
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
import { notify } from '@/hooks/use-notify';
import { useCreateProvider, useUpdateProvider } from '../api';
import { createProviderSchema, updateProviderSchema } from '../schemas';
import type { AiProvider } from '../types';

interface ProviderFormValues {
  name: string;
  kind: AiProvider['kind'];
  base_url: string;
  description: string;
  credential: string;
  enabled: boolean;
}

interface ProviderFormProps {
  mode: 'create' | 'edit';
  tenant: string;
  initialValues?: AiProvider;
  onSuccess: (provider: AiProvider) => void;
  onCancel: () => void;
}

function initialFromProvider(p?: AiProvider): ProviderFormValues {
  return {
    name: p?.name ?? '',
    kind: p?.kind ?? 'openai',
    base_url: p?.base_url ?? '',
    description: p?.description ?? '',
    credential: '',
    enabled: p?.enabled ?? true,
  };
}

export function ProviderForm({
  mode,
  tenant,
  initialValues,
  onSuccess,
  onCancel,
}: ProviderFormProps) {
  const [error, setError] = useState<string | null>(null);
  const createProviderMut = useCreateProvider(tenant);
  const updateProviderMut = useUpdateProvider(tenant);

  const schema = mode === 'create' ? createProviderSchema : updateProviderSchema;

  const form = useForm<ProviderFormValues>({
    initialValues: initialFromProvider(initialValues),
    validate: schemaResolver(schema, { sync: true }),
  });

  async function handleSubmit(values: ProviderFormValues) {
    setError(null);
    try {
      const description = values.description.trim();
      if (mode === 'create') {
        const provider = await createProviderMut.mutateAsync({
          name: values.name.trim(),
          kind: values.kind,
          base_url: values.base_url.trim(),
          credential: values.credential,
          enabled: values.enabled,
          ...(description !== '' ? { description } : {}),
        });
        notify.success('Provider created', `${provider.name} is ready.`);
        onSuccess(provider);
      } else if (initialValues) {
        const provider = await updateProviderMut.mutateAsync({
          id: initialValues.id,
          input: {
            name: values.name.trim(),
            kind: values.kind,
            base_url: values.base_url.trim(),
            description,
            enabled: values.enabled,
            ...(values.credential !== '' ? { credential: values.credential } : {}),
          },
        });
        notify.success('Provider updated', `${provider.name} saved.`);
        onSuccess(provider);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save provider';
      setError(msg);
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
          placeholder="openai-prod"
          required
          {...form.getInputProps('name')}
        />

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Kind
          </Text>
          <SegmentedControl<ProviderFormValues['kind']>
            data={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'gemini', label: 'Gemini' },
              { value: 'ollama', label: 'Ollama' },
              { value: 'custom', label: 'Custom' },
            ]}
            value={form.values.kind}
            onChange={(value) => {
              form.setFieldValue('kind', value);
            }}
          />
        </Stack>

        <TextInput
          label="Base URL"
          placeholder="https://api.openai.com/v1"
          required
          {...form.getInputProps('base_url')}
        />

        <Textarea
          label="Description"
          placeholder="Optional description"
          minRows={2}
          {...form.getInputProps('description')}
        />

        <PasswordInput
          label={mode === 'create' ? 'Credential' : 'Rotate credential (optional)'}
          placeholder={mode === 'create' ? 'sk-…' : 'Leave blank to keep existing credential'}
          description={
            mode === 'create' ? 'Shown once. Only the prefix is stored for display.' : undefined
          }
          required={mode === 'create'}
          {...form.getInputProps('credential')}
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
          <Button
            type="submit"
            loading={createProviderMut.isPending || updateProviderMut.isPending}
          >
            {mode === 'create' ? 'Create provider' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
