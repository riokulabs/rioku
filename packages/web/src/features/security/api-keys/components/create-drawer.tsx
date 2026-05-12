/**
 * <ApiKeyCreateDrawer> — form to create a new API key.
 *
 * Stage-2 plan-02. Posts via `useApiKeyMutations.createApiKey` to the
 * real daemon. The plaintext returned in the 201 body is forwarded to
 * the parent via `onCreated(fullValue)` — the parent renders the
 * confirm-before-dismiss <SecretCaptureModal>.
 */
import { useState } from 'react';
import { Stack, Button, TextInput, Group, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm, schemaResolver } from '@mantine/form';
import { PermissionSelector } from '@/components/permission-selector';
import { notify } from '@/hooks/use-notify';
import { useApiKeyMutations } from '../api';
import { createApiKeySchema, type CreateApiKeyFormValues } from '../schemas';

interface ApiKeyCreateDrawerProps {
  tenantId: string;
  onCreated: (fullValue: string) => void;
  onCancel: () => void;
}

export function ApiKeyCreateDrawer({ tenantId, onCreated, onCancel }: ApiKeyCreateDrawerProps) {
  const [submitting, setSubmitting] = useState(false);
  const mut = useApiKeyMutations(tenantId);

  const form = useForm<CreateApiKeyFormValues>({
    initialValues: {
      name: '',
      scope: [],
      expires_at: undefined,
    },
    validate: schemaResolver(createApiKeySchema),
  });

  async function handleSubmit(values: CreateApiKeyFormValues) {
    setSubmitting(true);
    try {
      const result = await mut.createApiKey(
        tenantId,
        values.name,
        values.scope,
        values.expires_at ?? undefined,
      );
      onCreated(result.fullValue);
    } catch {
      notify.error('Failed to create API key', 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="md">
      <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="e.g. ci-deploy, mobile-app"
            required
            {...form.getInputProps('name')}
          />

          <PermissionSelector
            label="Scope (permissions)"
            value={form.values.scope}
            onChange={(v) => {
              form.setFieldValue('scope', v);
            }}
          />
          {form.errors.scope && (
            <Text size="xs" c="red">
              {form.errors.scope}
            </Text>
          )}

          <DatePickerInput
            label="Expires at (optional)"
            placeholder="No expiration"
            clearable
            minDate={new Date()}
            value={form.values.expires_at ? new Date(form.values.expires_at) : null}
            onChange={(d) => {
              form.setFieldValue('expires_at', d ? new Date(d).toISOString() : undefined);
            }}
          />

          <Group justify="flex-end" gap="sm" mt="sm">
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} data-testid="api-key-create-submit">
              Create key
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
